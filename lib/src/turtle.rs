use crate::arc::{to_svg_arc, ArcOrLineSegment, FlattenWithArcs, Transformed};
use crate::machine::Machine;
use g_code::{command, emit::Token};
use lyon_geom::euclid::{default::Transform2D, Angle};
use lyon_geom::{point, vector, Point, Vector};
use lyon_geom::{ArcFlags, CubicBezierSegment, QuadraticBezierSegment, SvgArc};

type F64Point = Point<f64>;

/// Turtle graphics simulator for paths that outputs the g-code representation for each operation.
/// Handles transforms, position, offsets, etc.  See https://www.w3.org/TR/SVG/paths.html
#[derive(Debug)]
pub struct Turtle<'input> {
    current_position: F64Point,
    initial_position: F64Point,
    current_transform: Transform2D<f64>,
    transform_stack: Vec<Transform2D<f64>>,
    pub machine: Machine<'input>,
    previous_control: Option<F64Point>,
}

impl<'input> Turtle<'input> {
    /// Create a turtle at the origin with no transform
    pub fn new(machine: Machine<'input>) -> Self {
        Self {
            current_position: Point::zero(),
            initial_position: Point::zero(),
            current_transform: Transform2D::identity(),
            transform_stack: vec![],
            machine,
            previous_control: None,
        }
    }

    /// Move the turtle to the given absolute/relative coordinates in the current transform
    /// https://www.w3.org/TR/SVG/paths.html#PathDataMovetoCommands
    pub fn move_to<X, Y>(&mut self, abs: bool, x: X, y: Y) -> Vec<Token<'input>>
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
        self.previous_control = None;

        self.machine
            .tool_off()
            .drain(..)
            .chain(self.machine.absolute())
            .chain(
                command!(RapidPositioning {
                    X: to.x as f64,
                    Y: to.y as f64,
                })
                .into_token_vec(),
            )
            .collect()
    }

    fn linear_interpolation(x: f64, y: f64, feedrate: f64) -> Vec<Token<'static>> {
        command!(LinearInterpolation {
            X: x,
            Y: y,
            F: feedrate,
        })
        .into_token_vec()
    }

    fn circular_interpolation(svg_arc: SvgArc<f64>, feedrate: f64) -> Vec<Token<'input>> {
        debug_assert!((svg_arc.radii.x.abs() - svg_arc.radii.y.abs()).abs() < f64::EPSILON);
        match (svg_arc.flags.large_arc, svg_arc.flags.sweep) {
            (false, true) => command!(CounterclockwiseCircularInterpolation {
                X: svg_arc.to.x,
                Y: svg_arc.to.y,
                R: svg_arc.radii.x,
                F: feedrate,
            })
            .into_token_vec(),
            (false, false) => command!(ClockwiseCircularInterpolation {
                X: svg_arc.to.x,
                Y: svg_arc.to.y,
                R: svg_arc.radii.x,
                F: feedrate,
            })
            .into_token_vec(),
            (true, _) => {
                let (left, right) = svg_arc.to_arc().split(0.5);
                let mut token_vec = Self::circular_interpolation(to_svg_arc(left), feedrate);
                token_vec.append(&mut Self::circular_interpolation(
                    to_svg_arc(right),
                    feedrate,
                ));
                token_vec
            }
        }
    }

    /// Close an SVG path, cutting back to its initial position
    /// https://www.w3.org/TR/SVG/paths.html#PathDataClosePathCommand
    pub fn close(&mut self, feedrate: f64) -> Vec<Token<'input>> {
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
            .drain(..)
            .chain(self.machine.absolute())
            .chain(Self::linear_interpolation(
                self.initial_position.x,
                self.initial_position.y,
                feedrate,
            ))
            .collect()
    }

    /// Draw a line from the current position in the current transform to the specified position
    /// https://www.w3.org/TR/SVG/paths.html#PathDataLinetoCommands
    pub fn line<X, Y>(&mut self, abs: bool, x: X, y: Y, feedrate: f64) -> Vec<Token<'input>>
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
        self.previous_control = None;

        self.machine
            .tool_on()
            .drain(..)
            .chain(self.machine.absolute())
            .chain(Self::linear_interpolation(to.x, to.y, feedrate))
            .collect()
    }

    /// Draw a cubic bezier curve segment
    /// The public bezier functions call this command after converting to a cubic bezier segment
    /// https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands
    fn bezier(
        &mut self,
        cbs: CubicBezierSegment<f64>,
        tolerance: f64,
        feedrate: f64,
    ) -> Vec<Token<'input>> {
        let tokens: Vec<_> = if self
            .machine
            .supported_functionality()
            .circular_interpolation
        {
            FlattenWithArcs::<f64>::flattened(&cbs, tolerance)
                .drain(..)
                .flat_map(|segment| match segment {
                    ArcOrLineSegment::Arc(arc) => Self::circular_interpolation(arc, feedrate),
                    ArcOrLineSegment::Line(line) => {
                        Self::linear_interpolation(line.to.x, line.to.y, feedrate)
                    }
                })
                .collect()
        } else {
            cbs.flattened(tolerance)
                .flat_map(|point| Self::linear_interpolation(point.x, point.y, feedrate))
                .collect()
        };

        self.current_position = cbs.to;

        // See https://www.w3.org/TR/SVG/paths.html#ReflectedControlPoints
        self.previous_control = Some(
            point(
                self.current_position.x - cbs.ctrl2.x,
                self.current_position.y - cbs.ctrl2.y,
            ) * 2.,
        );

        self.machine
            .tool_on()
            .drain(..)
            .chain(self.machine.absolute())
            .chain(tokens)
            .collect()
    }

    /// Draw a cubic curve from the current point to (x, y) with specified control points (x1, y1) and (x2, y2)
    /// https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands
    pub fn cubic_bezier(
        &mut self,
        abs: bool,
        mut ctrl1: Point<f64>,
        mut ctrl2: Point<f64>,
        mut to: Point<f64>,
        tolerance: f64,
        feedrate: f64,
    ) -> Vec<Token<'input>> {
        let from = self.current_position;
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(from);
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
        self.bezier(cbs, tolerance, feedrate)
    }

    /// Draw a shorthand/smooth cubic bezier segment, where the first control point was already given
    /// https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands
    pub fn smooth_cubic_bezier(
        &mut self,
        abs: bool,
        mut ctrl2: Point<f64>,
        mut to: Point<f64>,
        tolerance: f64,
        feedrate: f64,
    ) -> Vec<Token<'input>> {
        let from = self.current_position;
        let ctrl1 = self.previous_control.unwrap_or(self.current_position);
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(from);
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
        self.bezier(cbs, tolerance, feedrate)
    }

    /// Draw a shorthand/smooth cubic bezier segment, where the control point was already given
    /// https://www.w3.org/TR/SVG/paths.html#PathDataQuadraticBezierCommands
    pub fn smooth_quadratic_bezier(
        &mut self,
        abs: bool,
        mut to: Point<f64>,
        tolerance: f64,
        feedrate: f64,
    ) -> Vec<Token<'input>> {
        let from = self.current_position;
        let ctrl = self.previous_control.unwrap_or(self.current_position);
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(from);
            to += original_current_position.to_vector();
        }
        to = self.current_transform.transform_point(to);

        let qbs = QuadraticBezierSegment { from, ctrl, to };
        self.bezier(qbs.to_cubic(), tolerance, feedrate)
    }

    /// Draw a quadratic bezier segment
    /// https://www.w3.org/TR/SVG/paths.html#PathDataQuadraticBezierCommands
    pub fn quadratic_bezier(
        &mut self,
        abs: bool,
        mut ctrl: Point<f64>,
        mut to: Point<f64>,
        tolerance: f64,
        feedrate: f64,
    ) -> Vec<Token<'input>> {
        let from = self.current_position;
        if !abs {
            let inverse_transform = self.current_transform.inverse().unwrap();
            let original_current_position = inverse_transform.transform_point(from);
            to += original_current_position.to_vector();
            ctrl += original_current_position.to_vector();
        }
        ctrl = self.current_transform.transform_point(ctrl);
        to = self.current_transform.transform_point(to);

        let qbs = QuadraticBezierSegment { from, ctrl, to };
        self.bezier(qbs.to_cubic(), tolerance, feedrate)
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
        feedrate: f64,
        tolerance: f64,
    ) -> Vec<Token<'input>> {
        let from = self
            .current_transform
            .inverse()
            .unwrap()
            .transform_point(self.current_position);

        if !abs {
            to += from.to_vector()
        }
        let svg_arc = SvgArc {
            from,
            to,
            radii,
            x_rotation,
            flags,
        }
        .transformed(&self.current_transform);

        let arc_tokens = if svg_arc.is_straight_line() {
            Self::linear_interpolation(svg_arc.to.x, svg_arc.to.y, feedrate)
        } else if self
            .machine
            .supported_functionality()
            .circular_interpolation
        {
            FlattenWithArcs::flattened(&svg_arc, tolerance)
                .drain(..)
                .flat_map(|segment| match segment {
                    ArcOrLineSegment::Arc(arc) => Self::circular_interpolation(arc, feedrate),
                    ArcOrLineSegment::Line(line) => {
                        Self::linear_interpolation(line.to.x, line.to.y, feedrate)
                    }
                })
                .collect()
        } else {
            svg_arc
                .to_arc()
                .flattened(tolerance)
                .flat_map(|point| Self::linear_interpolation(point.x, point.y, feedrate))
                .collect()
        };

        self.current_position = svg_arc.to;
        self.previous_control = None;

        self.machine
            .tool_on()
            .drain(..)
            .chain(self.machine.absolute())
            .chain(arc_tokens)
            .collect()
    }

    /// Push a generic transform onto the stack
    /// Could be any valid CSS transform https://drafts.csswg.org/css-transforms-1/#typedef-transform-function
    /// https://www.w3.org/TR/SVG/coords.html#InterfaceSVGTransform
    pub fn push_transform(&mut self, trans: Transform2D<f64>) {
        self.transform_stack.push(self.current_transform);
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

    /// Remove all transforms, returning to true absolute coordinates
    pub fn pop_all_transforms(&mut self) {
        self.transform_stack.clear();
        self.current_transform = Transform2D::identity();
    }

    /// Reset the position of the turtle to the origin in the current transform stack
    /// Used for starting a new path
    pub fn reset(&mut self) {
        self.current_position = Point::zero();
        self.current_position = self
            .current_transform
            .transform_point(self.current_position);
        self.previous_control = None;
        self.initial_position = self.current_position;
    }
}
