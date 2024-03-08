use std::fmt::Debug;

use lyon_geom::{
    euclid::{default::Transform2D, Angle},
    point, vector, ArcFlags, CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc, Vector,
};

use crate::arc::Transformed;

mod dpi;
mod g_code;
mod preprocess;
pub use self::dpi::DpiConvertingTurtle;
pub use self::g_code::GCodeTurtle;
pub use self::preprocess::PreprocessTurtle;

/// Abstraction based on [Turtle graphics](https://en.wikipedia.org/wiki/Turtle_graphics)
pub trait Turtle: Debug {
    fn begin(&mut self);
    fn end(&mut self);
    fn comment(&mut self, comment: String);
    fn move_to(&mut self, to: Point<f64>);
    fn line_to(&mut self, to: Point<f64>);
    fn arc(&mut self, svg_arc: SvgArc<f64>);
    fn cubic_bezier(&mut self, cbs: CubicBezierSegment<f64>);
    fn quadratic_bezier(&mut self, qbs: QuadraticBezierSegment<f64>);
}

/// Wrapper for [Turtle] that handles transforms, position, offsets, etc.  See https://www.w3.org/TR/SVG/paths.html
#[derive(Debug)]
pub struct Terrarium<T: Turtle + std::fmt::Debug> {
    pub turtle: T,
    current_position: Point<f64>,
    initial_position: Point<f64>,
    current_transform: Transform2D<f64>,
    pub transform_stack: Vec<Transform2D<f64>>,
    previous_quadratic_control: Option<Point<f64>>,
    previous_cubic_control: Option<Point<f64>>,
}

impl<T: Turtle + std::fmt::Debug> Terrarium<T> {
    /// Create a turtle at the origin with no transform
    pub fn new(turtle: T) -> Self {
        Self {
            turtle,
            current_position: Point::zero(),
            initial_position: Point::zero(),
            current_transform: Transform2D::identity(),
            transform_stack: vec![],
            previous_quadratic_control: None,
            previous_cubic_control: None,
        }
    }

    /// Move the turtle to the given absolute/relative coordinates in the current transform
    /// https://www.w3.org/TR/SVG/paths.html#PathDataMovetoCommands
    pub fn move_to<X, Y>(&mut self, abs: bool, x: X, y: Y)
    where
        X: Into<Option<f64>>,
        Y: Into<Option<f64>>,
    {
        let inverse_transform = self.current_transform.inverse().unwrap();
        let original_current_position = inverse_transform.transform_point(self.current_position);
        let x = x
            .into()
            .map(|x| {
                if abs {
                    x
                } else {
                    original_current_position.x + x
                }
            })
            .unwrap_or(original_current_position.x);
        let y = y
            .into()
            .map(|y| {
                if abs {
                    y
                } else {
                    original_current_position.y + y
                }
            })
            .unwrap_or(original_current_position.y);

        let to = self.current_transform.transform_point(point(x, y));
        self.current_position = to;
        self.initial_position = to;
        self.previous_quadratic_control = None;
        self.previous_cubic_control = None;
        self.turtle.move_to(to);
    }

    /// Close an SVG path, cutting back to its initial position
    /// https://www.w3.org/TR/SVG/paths.html#PathDataClosePathCommand
    pub fn close(&mut self) {
        // See https://www.w3.org/TR/SVG/paths.html#Segment-CompletingClosePath
        // which could result in a G91 G1 X0 Y0
        if !(self.current_position - self.initial_position)
            .abs()
            .lower_than(vector(std::f64::EPSILON, std::f64::EPSILON))
            .all()
        {
            self.turtle.line_to(self.initial_position);
        }
        self.current_position = self.initial_position;
        self.previous_quadratic_control = None;
        self.previous_cubic_control = None;
    }

    /// Draw a line from the current position in the current transform to the specified position
    /// https://www.w3.org/TR/SVG/paths.html#PathDataLinetoCommands
    pub fn line<X, Y>(&mut self, abs: bool, x: X, y: Y)
    where
        X: Into<Option<f64>>,
        Y: Into<Option<f64>>,
    {
        let inverse_transform = self.current_transform.inverse().unwrap();
        let original_current_position = inverse_transform.transform_point(self.current_position);
        let x = x
            .into()
            .map(|x| {
                if abs {
                    x
                } else {
                    original_current_position.x + x
                }
            })
            .unwrap_or(original_current_position.x);
        let y = y
            .into()
            .map(|y| {
                if abs {
                    y
                } else {
                    original_current_position.y + y
                }
            })
            .unwrap_or(original_current_position.y);

        let to = self.current_transform.transform_point(point(x, y));
        self.current_position = to;
        self.previous_quadratic_control = None;
        self.previous_cubic_control = None;

        self.turtle.line_to(to);
    }

    /// Draw a cubic curve from the current point to (x, y) with specified control points (x1, y1) and (x2, y2)
    /// https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands
    pub fn cubic_bezier(
        &mut self,
        abs: bool,
        mut ctrl1: Point<f64>,
        mut ctrl2: Point<f64>,
        mut to: Point<f64>,
    ) {
        let from = self.current_position;
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(from);
            ctrl1 = original_current_position + ctrl1.to_vector();
            ctrl2 = original_current_position + ctrl2.to_vector();
            to = original_current_position + to.to_vector();
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

        self.current_position = cbs.to;

        // See https://www.w3.org/TR/SVG/paths.html#ReflectedControlPoints
        self.previous_cubic_control = Some(point(
            2. * self.current_position.x - cbs.ctrl2.x,
            2. * self.current_position.y - cbs.ctrl2.y,
        ));
        self.previous_quadratic_control = None;

        self.turtle.cubic_bezier(cbs);
    }

    /// Draw a shorthand/smooth cubic bezier segment, where the first control point was already given
    /// https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands
    pub fn smooth_cubic_bezier(&mut self, abs: bool, mut ctrl2: Point<f64>, mut to: Point<f64>) {
        let from = self.current_position;
        let ctrl1 = self.previous_cubic_control.unwrap_or(self.current_position);
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(from);
            ctrl2 = original_current_position + ctrl2.to_vector();
            to = original_current_position + to.to_vector();
        }
        ctrl2 = self.current_transform.transform_point(ctrl2);
        to = self.current_transform.transform_point(to);

        let cbs = lyon_geom::CubicBezierSegment {
            from,
            ctrl1,
            ctrl2,
            to,
        };

        self.current_position = cbs.to;

        // See https://www.w3.org/TR/SVG/paths.html#ReflectedControlPoints
        self.previous_cubic_control = Some(point(
            2. * self.current_position.x - cbs.ctrl2.x,
            2. * self.current_position.y - cbs.ctrl2.y,
        ));
        self.previous_quadratic_control = None;

        self.turtle.cubic_bezier(cbs);
    }

    /// Draw a shorthand/smooth cubic bezier segment, where the control point was already given
    /// https://www.w3.org/TR/SVG/paths.html#PathDataQuadraticBezierCommands
    pub fn smooth_quadratic_bezier(&mut self, abs: bool, mut to: Point<f64>) {
        let from = self.current_position;
        let ctrl = self
            .previous_quadratic_control
            .unwrap_or(self.current_position);
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(from);
            to = original_current_position + to.to_vector();
        }
        to = self.current_transform.transform_point(to);

        let qbs = QuadraticBezierSegment { from, ctrl, to };

        self.current_position = qbs.to;

        // See https://www.w3.org/TR/SVG/paths.html#ReflectedControlPoints
        self.previous_quadratic_control = Some(point(
            2. * self.current_position.x - qbs.ctrl.x,
            2. * self.current_position.y - qbs.ctrl.y,
        ));
        self.previous_cubic_control = None;

        self.turtle.quadratic_bezier(qbs);
    }

    /// Draw a quadratic bezier segment
    /// https://www.w3.org/TR/SVG/paths.html#PathDataQuadraticBezierCommands
    pub fn quadratic_bezier(&mut self, abs: bool, mut ctrl: Point<f64>, mut to: Point<f64>) {
        let from = self.current_position;
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(from);
            to = original_current_position + to.to_vector();
            ctrl = original_current_position + ctrl.to_vector();
        }
        ctrl = self.current_transform.transform_point(ctrl);
        to = self.current_transform.transform_point(to);

        let qbs = QuadraticBezierSegment { from, ctrl, to };

        self.current_position = qbs.to;

        // See https://www.w3.org/TR/SVG/paths.html#ReflectedControlPoints
        self.previous_quadratic_control = Some(point(
            2. * self.current_position.x - qbs.ctrl.x,
            2. * self.current_position.y - qbs.ctrl.y,
        ));
        self.previous_cubic_control = None;

        self.turtle.quadratic_bezier(qbs);
    }

    /// Draw an elliptical arc segment
    /// https://www.w3.org/TR/SVG/paths.html#PathDataEllipticalArcCommands
    pub fn elliptical(
        &mut self,
        abs: bool,
        radii: Vector<f64>,
        x_rotation: Angle<f64>,
        flags: ArcFlags,
        mut to: Point<f64>,
    ) {
        let from = self
            .current_transform
            .inverse()
            .unwrap()
            .transform_point(self.current_position);

        if !abs {
            to = from + to.to_vector()
        }
        let svg_arc = SvgArc {
            from,
            to,
            radii,
            x_rotation,
            flags,
        }
        .transformed(&self.current_transform);

        self.current_position = svg_arc.to;
        self.previous_quadratic_control = None;
        self.previous_cubic_control = None;

        self.turtle.arc(svg_arc);
    }

    /// Push a generic transform onto the stack
    /// Could be any valid CSS transform https://drafts.csswg.org/css-transforms-1/#typedef-transform-function
    /// https://www.w3.org/TR/SVG/coords.html#InterfaceSVGTransform
    pub fn push_transform(&mut self, trans: Transform2D<f64>) {
        self.transform_stack.push(self.current_transform);
        // https://stackoverflow.com/questions/18582935/the-applying-order-of-svg-transforms
        self.current_transform = trans.then(&self.current_transform);
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
    /// Used for starting a new path
    pub fn reset(&mut self) {
        self.current_position = self.current_transform.transform_point(Point::zero());
        self.initial_position = self.current_position;
        self.previous_quadratic_control = None;
        self.previous_cubic_control = None;
    }
}
