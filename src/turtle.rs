/// TODO: Documentation
use crate::code::*;
use crate::machine::Machine;
use lyon_geom::euclid::{default::Transform2D, Angle};
use lyon_geom::math::{point, vector, F64Point};
use lyon_geom::{ArcFlags, CubicBezierSegment, QuadraticBezierSegment, SvgArc};

/// Turtle graphics simulator for paths that outputs the gcode representation for each operation.
/// Handles trasforms, scaling, position, offsets, etc.  See https://www.w3.org/TR/SVG/paths.html
pub struct Turtle {
    curpos: F64Point,
    initpos: F64Point,
    curtran: Transform2D<f64>,
    scaling: Option<Transform2D<f64>>,
    transtack: Vec<Transform2D<f64>>,
    pub mach: Machine,
    prev_ctrl: Option<F64Point>,
}

impl Turtle {
    /// Create a turtle at the origin with no scaling or transform
    pub fn new(machine: Machine) -> Self {
        Self {
            curpos: point(0.0, 0.0),
            initpos: point(0.0, 0.0),
            curtran: Transform2D::identity(),
            scaling: None,
            transtack: vec![],
            mach: machine,
            prev_ctrl: None,
        }
    }
}

impl Turtle {
    /// Move the turtle to the given absolute/relative coordinates in the current transform
    /// https://www.w3.org/TR/SVG/paths.html#PathDataMovetoCommands
    pub fn move_to<X, Y>(&mut self, abs: bool, x: X, y: Y) -> Vec<Command>
    where
        X: Into<Option<f64>>,
        Y: Into<Option<f64>>,
    {
        let invtran = self.curtran.inverse().unwrap();
        let origcurpos = invtran.transform_point(self.curpos);
        let x = x
            .into()
            .map(|x| if abs { x } else { origcurpos.x + x })
            .unwrap_or(origcurpos.x);
        let y = y
            .into()
            .map(|y| if abs { y } else { origcurpos.y + y })
            .unwrap_or(origcurpos.y);

        let mut to = point(x, y);
        to = self.curtran.transform_point(to);
        self.curpos = to;
        self.initpos = to;
        self.prev_ctrl = None;

        self.mach
            .tool_off()
            .iter()
            .chain(self.mach.absolute().iter())
            .chain(std::iter::once(&command!(CommandWord::RapidPositioning, {
                x : to.x as f64,
                y : to.y as f64,
            })))
            .map(Clone::clone)
            .collect()
    }

    fn linear_interpolation(x: f64, y: f64, z: Option<f64>, f: Option<f64>) -> Command {
        let mut linear_interpolation = command!(CommandWord::LinearInterpolation, {
            x: x,
            y: y,
        });
        if let Some(z) = z {
            linear_interpolation.push(Word {
                letter: 'Z',
                value: Value::Float(z),
            });
        }
        if let Some(f) = f {
            linear_interpolation.push(Word {
                letter: 'F',
                value: Value::Float(f),
            });
        }
        linear_interpolation
    }

    /// Close an SVG path, cutting back to its initial position
    /// https://www.w3.org/TR/SVG/paths.html#PathDataClosePathCommand
    pub fn close<Z, F>(&mut self, z: Z, f: F) -> Vec<Command>
    where
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        // See https://www.w3.org/TR/SVG/paths.html#Segment-CompletingClosePath
        // which could result in a G91 G1 X0 Y0
        if (self.curpos - self.initpos)
            .abs()
            .lower_than(vector(std::f64::EPSILON, std::f64::EPSILON))
            .all()
        {
            return vec![];
        }
        self.curpos = self.initpos;

        self.mach
            .tool_on()
            .iter()
            .chain(self.mach.absolute().iter())
            .chain(std::iter::once(&Self::linear_interpolation(
                self.initpos.x.into(),
                self.initpos.y.into(),
                z.into(),
                f.into(),
            )))
            .map(Clone::clone)
            .collect()
    }

    /// Draw a line from the current position in the current transform to the specified position
    /// https://www.w3.org/TR/SVG/paths.html#PathDataLinetoCommands
    pub fn line<X, Y, Z, F>(&mut self, abs: bool, x: X, y: Y, z: Z, f: F) -> Vec<Command>
    where
        X: Into<Option<f64>>,
        Y: Into<Option<f64>>,
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        let invtran = self.curtran.inverse().unwrap();
        let origcurpos = invtran.transform_point(self.curpos);
        let x = x
            .into()
            .map(|x| if abs { x } else { origcurpos.x + x })
            .unwrap_or(origcurpos.x);
        let y = y
            .into()
            .map(|y| if abs { y } else { origcurpos.y + y })
            .unwrap_or(origcurpos.y);

        let mut to = point(x, y);
        to = self.curtran.transform_point(to);
        self.curpos = to;
        self.prev_ctrl = None;

        self.mach
            .tool_on()
            .iter()
            .chain(self.mach.absolute().iter())
            .chain(std::iter::once(&Self::linear_interpolation(
                to.x.into(),
                to.y.into(),
                z.into(),
                f.into(),
            )))
            .map(Clone::clone)
            .collect()
    }

    /// Draw a cubic bezier curve segment
    /// The public bezier functions call this command after converting to a cubic bezier segment
    /// https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands
    fn bezier<Z: Into<Option<f64>>, F: Into<Option<f64>>>(
        &mut self,
        cbs: CubicBezierSegment<f64>,
        tolerance: f64,
        z: Z,
        f: F,
    ) -> Vec<Command> {
        let z = z.into();
        let f = f.into();
        let last_point = std::cell::Cell::new(self.curpos);
        let mut cubic: Vec<Command> = cbs
            .flattened(tolerance)
            .map(|point| {
                last_point.set(point);
                Self::linear_interpolation(
                    point.x.into(),
                    point.y.into(),
                    z.into(),
                    f.into(),
                )
            })
            .collect();
        self.curpos = last_point.get();
        // See https://www.w3.org/TR/SVG/paths.html#ReflectedControlPoints
        self.prev_ctrl = point(
            2.0 * self.curpos.x - cbs.ctrl2.x,
            2.0 * self.curpos.y - cbs.ctrl2.y,
        )
        .into();

        self.mach
            .tool_on()
            .iter()
            .chain(self.mach.absolute().iter())
            .chain(cubic.iter())
            .map(Clone::clone)
            .collect()
    }

    /// Draw a cubic curve from the current point to (x, y) with specified control points (x1, y1) and (x2, y2)
    /// https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands
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
    ) -> Vec<Command>
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
            let origcurpos = invtran.transform_point(self.curpos);
            ctrl1 += origcurpos.to_vector();
            ctrl2 += origcurpos.to_vector();
            to += origcurpos.to_vector();
        }
        ctrl1 = self.curtran.transform_point(ctrl1);
        ctrl2 = self.curtran.transform_point(ctrl2);
        to = self.curtran.transform_point(to);
        let cbs = lyon_geom::CubicBezierSegment {
            from,
            ctrl1,
            ctrl2,
            to,
        };

        self.bezier(cbs, tolerance, z, f)
    }

    /// Draw a shorthand/smooth cubic bezier segment, where the first control point was already given
    /// https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands
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
    ) -> Vec<Command>
    where
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        let from = self.curpos;
        let ctrl1 = self.prev_ctrl.unwrap_or(self.curpos);
        let mut ctrl2 = point(x2, y2);
        let mut to = point(x, y);
        if !abs {
            let invtran = self.curtran.inverse().unwrap();
            let origcurpos = invtran.transform_point(self.curpos);
            ctrl2 += origcurpos.to_vector();
            to += origcurpos.to_vector();
        }
        ctrl2 = self.curtran.transform_point(ctrl2);
        to = self.curtran.transform_point(to);
        let cbs = lyon_geom::CubicBezierSegment {
            from,
            ctrl1,
            ctrl2,
            to,
        };

        self.bezier(cbs, tolerance, z, f)
    }

    /// Draw a shorthand/smooth cubic bezier segment, where the control point was already given
    /// https://www.w3.org/TR/SVG/paths.html#PathDataQuadraticBezierCommands
    pub fn smooth_quadratic_bezier<Z, F>(
        &mut self,
        abs: bool,
        x: f64,
        y: f64,
        tolerance: f64,
        z: Z,
        f: F,
    ) -> Vec<Command>
    where
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        let from = self.curpos;
        let ctrl = self.prev_ctrl.unwrap_or(self.curpos);
        let mut to = point(x, y);
        if !abs {
            let invtran = self.curtran.inverse().unwrap();
            let origcurpos = invtran.transform_point(self.curpos);
            to += origcurpos.to_vector();
        }
        to = self.curtran.transform_point(to);
        let qbs = QuadraticBezierSegment { from, ctrl, to };

        self.bezier(qbs.to_cubic(), tolerance, z, f)
    }

    /// Draw a quadratic bezier segment
    /// https://www.w3.org/TR/SVG/paths.html#PathDataQuadraticBezierCommands
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
    ) -> Vec<Command>
    where
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        let from = self.curpos;
        let mut ctrl = point(x1, y1);
        let mut to = point(x, y);
        if !abs {
            let invtran = self.curtran.inverse().unwrap();
            let origcurpos = invtran.transform_point(self.curpos);
            to += origcurpos.to_vector();
            ctrl += origcurpos.to_vector();
        }
        ctrl = self.curtran.transform_point(ctrl);
        to = self.curtran.transform_point(to);
        let qbs = QuadraticBezierSegment { from, ctrl, to };

        self.bezier(qbs.to_cubic(), tolerance, z, f)
    }

    /// Draw an elliptical arc curve
    /// https://www.w3.org/TR/SVG/paths.html#PathDataEllipticalArcCommands
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
    ) -> Vec<Command>
    where
        Z: Into<Option<f64>>,
        F: Into<Option<f64>>,
    {
        let z = z.into();
        let f = f.into();

        let from = self.curpos;
        let mut to: F64Point = point(x, y);
        to = self.curtran.transform_point(to);
        if !abs {
            to -= vector(self.curtran.m31, self.curtran.m32);
            to += self.curpos.to_vector();
        }

        let mut radii = vector(rx, ry);
        radii = self.curtran.transform_vector(radii);

        let sarc = SvgArc {
            from,
            to,
            radii,
            x_rotation: Angle {
                radians: x_axis_rotation,
            },
            flags: ArcFlags {
                large_arc: !large_arc,
                sweep,
            },
        };
        let last_point = std::cell::Cell::new(self.curpos);

        let mut ellipse = vec![];
        sarc.for_each_flattened(tolerance, &mut |point: F64Point| {
            ellipse.push(Self::linear_interpolation(
                point.x.into(),
                point.y.into(),
                z.into(),
                f.into(),
            ));
            last_point.set(point);
        });
        self.curpos = last_point.get();
        self.prev_ctrl = None;

        self.mach
            .tool_on()
            .iter()
            .chain(self.mach.absolute().iter())
            .chain(ellipse.iter())
            .map(Clone::clone)
            .collect()
    }

    /// Push a new scaling-only transform onto the stack
    /// This is useful for handling things like the viewBox
    /// https://www.w3.org/TR/SVG/coords.html#ViewBoxAttribute
    pub fn stack_scaling(&mut self, scaling: Transform2D<f64>) {
        self.curtran = self.curtran.post_transform(&scaling);
        if let Some(ref current_scaling) = self.scaling {
            self.scaling = Some(current_scaling.post_transform(&scaling));
        } else {
            self.scaling = Some(scaling);
        }
    }

    /// Push a generic transform onto the stack
    /// Could be any valid CSS transform https://drafts.csswg.org/css-transforms-1/#typedef-transform-function
    /// https://www.w3.org/TR/SVG/coords.html#InterfaceSVGTransform
    pub fn push_transform(&mut self, trans: Transform2D<f64>) {
        self.transtack.push(self.curtran);
        if let Some(ref scaling) = self.scaling {
            self.curtran = self
                .curtran
                .post_transform(&scaling.inverse().unwrap())
                .pre_transform(&trans)
                .post_transform(&scaling);
        } else {
            self.curtran = self.curtran.post_transform(&trans);
        }
    }

    /// Pop a generic transform off the stack, returning to the previous transform state
    /// This means that most recent transform went out of scope
    pub fn pop_transform(&mut self) {
        self.curtran = self
            .transtack
            .pop()
            .expect("popped when no transforms left");
    }

    /// Reset the position of the turtle to the origin in the current transform stack
    pub fn reset(&mut self) {
        self.curpos = point(0.0, 0.0);
        self.curpos = self.curtran.transform_point(self.curpos);
        self.prev_ctrl = None;
        self.initpos = self.curpos;
    }
}
