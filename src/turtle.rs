use crate::code::{GCode};
use crate::machine::Machine;
use lyon_geom::euclid::{Angle, Transform2D};
use lyon_geom::math::{point, vector, F64Point};
use lyon_geom::{ArcFlags, CubicBezierSegment, QuadraticBezierSegment, SvgArc};

pub struct Turtle {
    curpos: F64Point,
    initpos: F64Point,
    curtran: Transform2D<f64>,
    scaling: Option<Transform2D<f64>>,
    transtack: Vec<Transform2D<f64>>,
    pub mach: Machine,
    prev_ctrl: F64Point,
}

impl Default for Turtle {
    fn default() -> Self {
        Self {
            curpos: point(0.0, 0.0),
            initpos: point(0.0, 0.0),
            curtran: Transform2D::identity(),
            scaling: None,
            transtack: vec![],
            mach: Machine::default(),
            prev_ctrl: point(0.0, 0.0),
        }
    }
}

impl Turtle {
    pub fn move_to<X, Y>(&mut self, abs: bool, x: X, y: Y) -> Vec<GCode>
    where
        X: Into<Option<f64>>,
        Y: Into<Option<f64>>,
    {
        let invtran = self.curtran.inverse().unwrap();
        let origcurpos = invtran.transform_point(&self.curpos);
        let x = x
            .into()
            .map(|x| if abs { x } else { origcurpos.x + x })
            .unwrap_or(origcurpos.x);
        let y = y
            .into()
            .map(|y| if abs { y } else { origcurpos.y + y })
            .unwrap_or(origcurpos.y);

        let mut to = point(x, y);
        to = self.curtran.transform_point(&to);
        self.curpos = to;
        self.initpos = to;
        self.prev_ctrl = to;

        vec![
            self.mach.tool_off(),
            self.mach.absolute(),
            vec![GCode::RapidPositioning {
                x: to.x.into(),
                y: to.y.into(),
            }],
        ]
        .drain(..)
        .flatten()
        .collect()
    }

    pub fn close<Z, F>(&mut self, z: Z, f: F) -> Vec<GCode>
    where
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        self.curpos = self.initpos;
        vec![
            self.mach.tool_on(),
            self.mach.absolute(),
            vec![GCode::LinearInterpolation {
                x: self.initpos.x.into(),
                y: self.initpos.y.into(),
                z: z.into(),
                f: f.into(),
            }],
        ]
        .drain(..)
        .flatten()
        .collect()
    }

    pub fn line<X, Y, Z, F>(&mut self, abs: bool, x: X, y: Y, z: Z, f: F) -> Vec<GCode>
    where
        X: Into<Option<f64>>,
        Y: Into<Option<f64>>,
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        let invtran = self.curtran.inverse().unwrap();
        let origcurpos = invtran.transform_point(&self.curpos);
        let x = x
            .into()
            .map(|x| if abs { x } else { origcurpos.x + x })
            .unwrap_or(origcurpos.x);
        let y = y
            .into()
            .map(|y| if abs { y } else { origcurpos.y + y })
            .unwrap_or(origcurpos.y);

        let mut to = point(x, y);
        to = self.curtran.transform_point(&to);
        self.curpos = to;
        self.prev_ctrl = self.curpos;

        vec![
            self.mach.tool_on(),
            self.mach.absolute(),
            vec![GCode::LinearInterpolation {
                x: to.x.into(),
                y: to.y.into(),
                z: z.into(),
                f: f.into(),
            }],
        ]
        .drain(..)
        .flatten()
        .collect()
    }

    fn bezier<Z: Into<Option<f64>>, F: Into<Option<f64>>>(
        &mut self,
        cbs: CubicBezierSegment<f64>,
        tolerance: f64,
        z: Z,
        f: F,
    ) -> Vec<GCode> {
        let z = z.into();
        let f = f.into();
        let last_point = std::cell::Cell::new(self.curpos);
        let mut cubic = vec![];
        cbs.flattened(tolerance).for_each(|point| {
            cubic.push(GCode::LinearInterpolation {
                x: point.x.into(),
                y: point.y.into(),
                z,
                f,
            });
            last_point.set(point);
        });
        self.curpos = last_point.get();
        self.prev_ctrl = cbs.ctrl1;

        vec![self.mach.tool_on(), self.mach.absolute(), cubic]
            .drain(..)
            .flatten()
            .collect()
    }

    pub fn cubic_bezier<Z, F>(
        &mut self,
        abs: bool,
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        x: f64,
        y: f64,
        tolerance: f64,
        z: Z,
        f: F,
    ) -> Vec<GCode>
    where
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        let from = self.curpos;
        let mut ctrl1 = point(x1, y1);
        let mut ctrl2 = point(x2, y2);
        let mut to = point(x, y);
        if !abs {
            let invtran = self.curtran.inverse().unwrap();
            let origcurpos = invtran.transform_point(&self.curpos);
            ctrl1 += origcurpos.to_vector();
            ctrl2 += origcurpos.to_vector();
            to += origcurpos.to_vector();
        }
        ctrl1 = self.curtran.transform_point(&ctrl1);
        ctrl2 = self.curtran.transform_point(&ctrl2);
        to = self.curtran.transform_point(&to);
        let cbs = lyon_geom::CubicBezierSegment {
            from,
            ctrl1,
            ctrl2,
            to,
        };

        self.bezier(cbs, tolerance, z, f)
    }

    pub fn smooth_cubic_bezier<Z, F>(
        &mut self,
        abs: bool,
        x2: f64,
        y2: f64,
        x: f64,
        y: f64,
        tolerance: f64,
        z: Z,
        f: F,
    ) -> Vec<GCode>
    where
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        let from = self.curpos;
        let ctrl1 = self.prev_ctrl;
        let mut ctrl2 = point(x2, y2);
        let mut to = point(x, y);
        if !abs {
            let invtran = self.curtran.inverse().unwrap();
            let origcurpos = invtran.transform_point(&self.curpos);
            ctrl2 += origcurpos.to_vector();
            to += origcurpos.to_vector();
        }
        ctrl2 = self.curtran.transform_point(&ctrl2);
        to = self.curtran.transform_point(&to);
        let cbs = lyon_geom::CubicBezierSegment {
            from,
            ctrl1,
            ctrl2,
            to,
        };

        self.bezier(cbs, tolerance, z, f)
    }

    pub fn smooth_quadratic_bezier<Z, F>(
        &mut self,
        abs: bool,
        x: f64,
        y: f64,
        tolerance: f64,
        z: Z,
        f: F,
    ) -> Vec<GCode>
    where
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        let from = self.curpos;
        let ctrl = self.prev_ctrl;
        let mut to = point(x, y);
        if !abs {
            let invtran = self.curtran.inverse().unwrap();
            let origcurpos = invtran.transform_point(&self.curpos);
            to += origcurpos.to_vector();
        }
        to = self.curtran.transform_point(&to);
        let qbs = QuadraticBezierSegment { from, ctrl, to };

        self.bezier(qbs.to_cubic(), tolerance, z, f)
    }

    pub fn quadratic_bezier<Z, F>(
        &mut self,
        abs: bool,
        x1: f64,
        y1: f64,
        x: f64,
        y: f64,
        tolerance: f64,
        z: Z,
        f: F,
    ) -> Vec<GCode>
    where
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        let from = self.curpos;
        let mut ctrl = point(x1, y1);
        let mut to = point(x, y);
        if !abs {
            let invtran = self.curtran.inverse().unwrap();
            let origcurpos = invtran.transform_point(&self.curpos);
            to += origcurpos.to_vector();
            ctrl += origcurpos.to_vector();
        }
        ctrl = self.curtran.transform_point(&ctrl);
        to = self.curtran.transform_point(&to);
        let qbs = QuadraticBezierSegment { from, ctrl, to };

        self.bezier(qbs.to_cubic(), tolerance, z, f)
    }

    pub fn elliptical<Z, F>(
        &mut self,
        abs: bool,
        rx: f64,
        ry: f64,
        x_axis_rotation: f64,
        large_arc: bool,
        sweep: bool,
        x: f64,
        y: f64,
        z: Z,
        f: F,
        tolerance: f64,
    ) -> Vec<GCode>
    where
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        let z = z.into();
        let f = f.into();

        let from = self.curpos;
        let mut to = point(x, y);
        to = self.curtran.transform_point(&to);
        if !abs {
            to -= vector(self.curtran.m31, self.curtran.m32);
            to += self.curpos.to_vector();
        }

        let mut radii = vector(rx, ry);
        radii = self.curtran.transform_vector(&radii);

        let sarc = SvgArc {
            from,
            to,
            radii,
            x_rotation: Angle {
                radians: x_axis_rotation,
            },
            flags: ArcFlags {
                large_arc: !large_arc,
                sweep: sweep,
            },
        };
        let last_point = std::cell::Cell::new(self.curpos);

        let mut ellipse = vec![];
        sarc.for_each_flattened(tolerance, &mut |point: F64Point| {
            ellipse.push(GCode::LinearInterpolation {
                x: point.x.into(),
                y: point.y.into(),
                z,
                f,
            });
            last_point.set(point);
        });
        self.curpos = last_point.get();
        self.prev_ctrl = self.curpos;

        vec![self.mach.tool_on(), self.mach.absolute(), ellipse]
            .drain(..)
            .flatten()
            .collect()
    }

    pub fn stack_scaling(&mut self, scaling: Transform2D<f64>) {
        self.curtran = self.curtran.post_mul(&scaling);
        if let Some(ref current_scaling) = self.scaling {
            self.scaling = Some(current_scaling.post_mul(&scaling));
        } else {
            self.scaling = Some(scaling);
        }
    }

    pub fn push_transform(&mut self, trans: Transform2D<f64>) {
        self.transtack.push(self.curtran);
        if let Some(ref scaling) = self.scaling {
            self.curtran = self
                .curtran
                .post_mul(&scaling.inverse().unwrap())
                .pre_mul(&trans)
                .post_mul(&scaling);
        } else {
            self.curtran = self.curtran.post_mul(&trans);
        }
    }

    pub fn pop_transform(&mut self) {
        self.curtran = self
            .transtack
            .pop()
            .expect("popped when no transforms left");
    }

    pub fn reset(&mut self) {
        self.curpos = point(0.0, 0.0);
        self.curpos = self.curtran.transform_point(&self.curpos);
        self.prev_ctrl = self.curpos;
        self.initpos = self.curpos;
    }
}
