/// TODO: Documentation
use crate::code::*;
use crate::machine::Machine;
use lyon_geom::euclid::{default::Transform2D, Angle};
use lyon_geom::math::{point, vector, F64Point};
use lyon_geom::{ArcFlags, CubicBezierSegment, QuadraticBezierSegment, SvgArc};

/// Turtle graphics simulator for paths that outputs the gcode representation for each operation.
/// Handles trasforms, scaling, position, offsets, etc.  See https://www.w3.org/TR/SVG/paths.html
pub struct Turtle {
    current_position: F64Point,
    initial_position: F64Point,
    current_transform: Transform2D<f64>,
    scaling: Option<Transform2D<f64>>,
    transform_stack: Vec<Transform2D<f64>>,
    pub machine: Machine,
    previous_control: Option<F64Point>,
}

impl Turtle {
    /// Create a turtle at the origin with no scaling or transform
    pub fn new(machine: Machine) -> Self {
        Self {
            current_position: point(0.0, 0.0),
            initial_position: point(0.0, 0.0),
            current_transform: Transform2D::identity(),
            scaling: None,
            transform_stack: vec![],
            machine,
            previous_control: None,
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
        let inverse_transform = self.current_transform.inverse().unwrap();
        let original_current_position = inverse_transform.transform_point(self.current_position);
        let x = x
            .into()
            .map(|x| if abs { x } else { original_current_position.x + x })
            .unwrap_or(original_current_position.x);
        let y = y
            .into()
            .map(|y| if abs { y } else { original_current_position.y + y })
            .unwrap_or(original_current_position.y);

        let mut to = point(x, y);
        to = self.current_transform.transform_point(to);
        self.current_position = to;
        self.initial_position = to;
        self.previous_control = None;

        self.machine
            .tool_off()
            .iter()
            .chain(self.machine.absolute().iter())
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
        if (self.current_position - self.initial_position)
            .abs()
            .lower_than(vector(std::f64::EPSILON, std::f64::EPSILON))
            .all()
        {
            return vec![];
        }
        self.current_position = self.initial_position;

        self.machine
            .tool_on()
            .iter()
            .chain(self.machine.absolute().iter())
            .chain(std::iter::once(&Self::linear_interpolation(
                self.initial_position.x.into(),
                self.initial_position.y.into(),
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
        let inverse_transform = self.current_transform.inverse().unwrap();
        let original_current_position = inverse_transform.transform_point(self.current_position);
        let x = x
            .into()
            .map(|x| if abs { x } else { original_current_position.x + x })
            .unwrap_or(original_current_position.x);
        let y = y
            .into()
            .map(|y| if abs { y } else { original_current_position.y + y })
            .unwrap_or(original_current_position.y);

        let mut to = point(x, y);
        to = self.current_transform.transform_point(to);
        self.current_position = to;
        self.previous_control = None;

        self.machine
            .tool_on()
            .iter()
            .chain(self.machine.absolute().iter())
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
        let last_point = std::cell::Cell::new(self.current_position);
        let cubic: Vec<Command> = cbs
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
        self.current_position = last_point.get();
        // See https://www.w3.org/TR/SVG/paths.html#ReflectedControlPoints
        self.previous_control = point(
            2.0 * self.current_position.x - cbs.ctrl2.x,
            2.0 * self.current_position.y - cbs.ctrl2.y,
        )
        .into();

        self.machine
            .tool_on()
            .iter()
            .chain(self.machine.absolute().iter())
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
        let from = self.current_position;
        let mut ctrl1 = point(x1, y1);
        let mut ctrl2 = point(x2, y2);
        let mut to = point(x, y);
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(self.current_position);
            ctrl1 += original_current_position.to_vector();
            ctrl2 += original_current_position.to_vector();
            to += original_current_position.to_vector();
        }
        ctrl1 = self.current_transform.transform_point(ctrl1);
        ctrl2 = self.current_transform.transform_point(ctrl2);
        to = self.current_transform.transform_point(to);
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
        let from = self.current_position;
        let ctrl1 = self.previous_control.unwrap_or(self.current_position);
        let mut ctrl2 = point(x2, y2);
        let mut to = point(x, y);
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(self.current_position);
            ctrl2 += original_current_position.to_vector();
            to += original_current_position.to_vector();
        }
        ctrl2 = self.current_transform.transform_point(ctrl2);
        to = self.current_transform.transform_point(to);
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
        let from = self.current_position;
        let ctrl = self.previous_control.unwrap_or(self.current_position);
        let mut to = point(x, y);
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(self.current_position);
            to += original_current_position.to_vector();
        }
        to = self.current_transform.transform_point(to);
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
        let from = self.current_position;
        let mut ctrl = point(x1, y1);
        let mut to = point(x, y);
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(self.current_position);
            to += original_current_position.to_vector();
            ctrl += original_current_position.to_vector();
        }
        ctrl = self.current_transform.transform_point(ctrl);
        to = self.current_transform.transform_point(to);
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

        let from = self.current_position;
        let mut to: F64Point = point(x, y);
        to = self.current_transform.transform_point(to);
        if !abs {
            to -= vector(self.current_transform.m31, self.current_transform.m32);
            to += self.current_position.to_vector();
        }

        let mut radii = vector(rx, ry);
        radii = self.current_transform.transform_vector(radii);

        let arc = SvgArc {
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
        let last_point = std::cell::Cell::new(self.current_position);

        let mut ellipse = vec![];
        arc.for_each_flattened(tolerance, &mut |point: F64Point| {
            ellipse.push(Self::linear_interpolation(
                point.x.into(),
                point.y.into(),
                z.into(),
                f.into(),
            ));
            last_point.set(point);
        });
        self.current_position = last_point.get();
        self.previous_control = None;

        self.machine
            .tool_on()
            .iter()
            .chain(self.machine.absolute().iter())
            .chain(ellipse.iter())
            .map(Clone::clone)
            .collect()
    }

    /// Push a new scaling-only transform onto the stack
    /// This is useful for handling things like the viewBox
    /// https://www.w3.org/TR/SVG/coords.html#ViewBoxAttribute
    pub fn stack_scaling(&mut self, scaling: Transform2D<f64>) {
        self.current_transform = self.current_transform.post_transform(&scaling);
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
        self.transform_stack.push(self.current_transform);
        if let Some(ref scaling) = self.scaling {
            self.current_transform = self
                .current_transform
                .post_transform(&scaling.inverse().unwrap())
                .pre_transform(&trans)
                .post_transform(&scaling);
        } else {
            self.current_transform = self.current_transform.post_transform(&trans);
        }
    }

    /// Pop a generic transform off the stack, returning to the previous transform state
    /// This means that most recent transform went out of scope
    pub fn pop_transform(&mut self) {
        self.current_transform = self
            .transform_stack
            .pop()
            .expect("popped when no transforms left");
    }

    /// Reset the position of the turtle to the origin in the current transform stack
    pub fn reset(&mut self) {
        self.current_position = point(0.0, 0.0);
        self.current_position = self.current_transform.transform_point(self.current_position);
        self.previous_control = None;
        self.initial_position = self.current_position;
    }
}
