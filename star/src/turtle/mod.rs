use std::fmt::Debug;

use lyon_geom::{
    ArcFlags, CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc, Vector,
    euclid::{Angle, default::Transform2D},
    point, vector,
};
use svgtypes::PathSegment;

use self::elements::{FillPolygon, Transformed};
use crate::turtle::elements::{DrawCommand, FillRule, Stroke};

mod collect;
mod dpi;
/// Intermediate representation of elements used by a [`Turtle`].
pub mod elements;
mod preprocess;
mod svg_preview;

pub use self::{
    collect::StrokeCollectingTurtle, dpi::DpiConvertingTurtle, preprocess::PreprocessTurtle,
    svg_preview::SvgPreviewTurtle,
};

/// The coordinate system expected by a [`Turtle`] implementation.
///
/// Passed as a parameter to [`crate::lower::svg_to_turtle`] so each backend can declare
/// whether it needs SVG's native Y-down space or Y-up (typical for machine tools / G-code).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CoordinateSystem {
    /// Y increases downward (SVG default). No extra transform is applied.
    #[default]
    YDown,
    /// Y increases upward (typical for machine tools / G-code).
    ///
    /// [`crate::lower::svg_to_turtle`] will flip the Y axis so that coordinates delivered to
    /// the turtle have the origin at the bottom-left and Y increasing upward.
    YUp,
}

/// Abstraction for drawing paths based on [Turtle graphics](https://en.wikipedia.org/wiki/Turtle_graphics)
pub trait Turtle: Debug {
    fn begin(&mut self);
    fn end(&mut self);
    fn stroke(&mut self, stroke: Stroke);

    #[cfg(feature = "image")]
    fn image(&mut self, image: self::elements::RasterImage);
    fn fill_polygon(&mut self, polygon: FillPolygon);
}

/// Handles SVG complexities outside of [Turtle] scope (transforms, position, offsets, etc.)
/// <https://www.w3.org/TR/SVG/paths.html>
#[derive(Debug)]
pub(crate) struct Terrarium<T: Turtle + std::fmt::Debug> {
    turtle: T,
    has_begun: bool,
    current_position: Point<f64>,
    initial_position: Point<f64>,
    current_transform: Transform2D<f64>,
    pub transform_stack: Vec<Transform2D<f64>>,
    previous_quadratic_control: Option<Point<f64>>,
    previous_cubic_control: Option<Point<f64>>,
    comment: Option<String>,
}

impl<T: Turtle + std::fmt::Debug> Terrarium<T> {
    /// Create a turtle at the origin with no transform
    pub fn new(turtle: T) -> Self {
        Self {
            turtle,
            has_begun: false,
            current_position: Point::zero(),
            initial_position: Point::zero(),
            current_transform: Transform2D::identity(),
            transform_stack: vec![],
            previous_quadratic_control: None,
            previous_cubic_control: None,
            comment: None,
        }
    }

    /// Move the turtle to the given absolute/relative coordinates in the current transform
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataMovetoCommands>
    fn move_to(&mut self, abs: bool, x: f64, y: f64) -> Point<f64> {
        let inverse_transform = self
            .current_transform
            .inverse()
            .expect("transform is invertible");
        let original_current_position = inverse_transform.transform_point(self.current_position);
        let x = if abs {
            x
        } else {
            original_current_position.x + x
        };

        let y = if abs {
            y
        } else {
            original_current_position.y + y
        };

        let to = self.current_transform.transform_point(point(x, y));
        self.current_position = to;
        self.initial_position = to;
        self.previous_quadratic_control = None;
        self.previous_cubic_control = None;
        to
    }

    /// Close an SVG path, cutting back to its initial position
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataClosePathCommand>
    fn close(&mut self) -> Option<DrawCommand> {
        // See https://www.w3.org/TR/SVG/paths.html#Segment-CompletingClosePath
        let command = if !(self.current_position - self.initial_position)
            .abs()
            .lower_than(vector(f64::EPSILON, f64::EPSILON))
            .all()
        {
            Some(DrawCommand::LineTo {
                from: self.current_position,
                to: self.initial_position,
            })
        } else {
            None
        };
        self.current_position = self.initial_position;
        self.previous_quadratic_control = None;
        self.previous_cubic_control = None;

        command
    }

    /// Draw a line from the current position in the current transform to the specified position
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataLinetoCommands>
    fn line(&mut self, abs: bool, x: Option<f64>, y: Option<f64>) -> DrawCommand {
        let inverse_transform = self
            .current_transform
            .inverse()
            .expect("transform is invertible");
        let original_current_position = inverse_transform.transform_point(self.current_position);
        let x = x
            .map(|x| {
                if abs {
                    x
                } else {
                    original_current_position.x + x
                }
            })
            .unwrap_or(original_current_position.x);
        let y = y
            .map(|y| {
                if abs {
                    y
                } else {
                    original_current_position.y + y
                }
            })
            .unwrap_or(original_current_position.y);

        let from = self.current_position;
        let to = self.current_transform.transform_point(point(x, y));
        self.current_position = to;
        self.previous_quadratic_control = None;
        self.previous_cubic_control = None;

        DrawCommand::LineTo { from, to }
    }

    /// Draw a cubic curve from the current point to (x, y) with specified control points (x1, y1) and (x2, y2)
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands>
    fn cubic_bezier(
        &mut self,
        abs: bool,
        mut ctrl1: Point<f64>,
        mut ctrl2: Point<f64>,
        mut to: Point<f64>,
    ) -> CubicBezierSegment<f64> {
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

        let cbs = CubicBezierSegment {
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

        cbs
    }

    /// Draw a shorthand/smooth cubic bezier segment, where the first control point was already given
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands>
    fn smooth_cubic_bezier(
        &mut self,
        abs: bool,
        mut ctrl2: Point<f64>,
        mut to: Point<f64>,
    ) -> CubicBezierSegment<f64> {
        let from = self.current_position;
        let ctrl1 = self.previous_cubic_control.unwrap_or(self.current_position);
        if !abs {
            let inverse_transform = self
                .current_transform
                .inverse()
                .expect("transform is invertible");
            let original_current_position = inverse_transform.transform_point(from);
            ctrl2 = original_current_position + ctrl2.to_vector();
            to = original_current_position + to.to_vector();
        }
        ctrl2 = self.current_transform.transform_point(ctrl2);
        to = self.current_transform.transform_point(to);

        let cbs = CubicBezierSegment {
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

        cbs
    }

    /// Draw a shorthand/smooth cubic bezier segment, where the control point was already given
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataQuadraticBezierCommands>
    fn smooth_quadratic_bezier(
        &mut self,
        abs: bool,
        mut to: Point<f64>,
    ) -> QuadraticBezierSegment<f64> {
        let from = self.current_position;
        let ctrl = self
            .previous_quadratic_control
            .unwrap_or(self.current_position);
        if !abs {
            let inverse_transform = self
                .current_transform
                .inverse()
                .expect("transform is invertible");
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

        qbs
    }

    /// Draw a quadratic bezier segment
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataQuadraticBezierCommands>
    fn quadratic_bezier(
        &mut self,
        abs: bool,
        mut ctrl: Point<f64>,
        mut to: Point<f64>,
    ) -> QuadraticBezierSegment<f64> {
        let from = self.current_position;
        if !abs {
            let inverse_transform = self
                .current_transform
                .inverse()
                .expect("transform is invertible");
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

        qbs
    }

    /// Draw an elliptical arc segment
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataEllipticalArcCommands>
    fn elliptical(
        &mut self,
        abs: bool,
        radii: Vector<f64>,
        x_rotation: Angle<f64>,
        flags: ArcFlags,
        mut to: Point<f64>,
    ) -> SvgArc<f64> {
        let from = self
            .current_transform
            .inverse()
            .expect("transform is invertible")
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

        svg_arc
    }

    fn begin(&mut self) {
        if !self.has_begun {
            self.turtle.begin();
            self.has_begun = true;
        }
    }

    /// Reset the position of the turtle to the origin in the current transform stack
    /// Used for starting a new path
    fn reset(&mut self) {
        self.current_position = self.current_transform.transform_point(Point::zero());
        self.initial_position = self.current_position;
        self.previous_quadratic_control = None;
        self.previous_cubic_control = None;
    }

    /// <https://www.w3.org/TR/SVG/embedded.html#ImageElement>
    #[cfg(feature = "image")]
    pub fn image(&mut self, image: image::DynamicImage, x: f64, y: f64, width: f64, height: f64) {
        // Transform the corners to get the final x, y, width, height.
        let t0 = self.current_transform.transform_point(point(x, y));
        let t1 = self
            .current_transform
            .transform_point(point(x, y) + vector(width, height));
        self.turtle.image(crate::turtle::elements::RasterImage {
            // After transformation, the corners may be swapped resulting in a new x y.
            dimensions: lyon_geom::Box2D::new(
                point(t0.x.min(t1.x), t0.y.min(t1.y)),
                point(t0.x.max(t1.x), t0.y.max(t1.y)),
            ),
            image,
        });
    }

    /// Push a generic transform onto the stack
    /// Could be any valid CSS transform https://drafts.csswg.org/css-transforms-1/#typedef-transform-function
    /// <https://www.w3.org/TR/SVG/coords.html#InterfaceSVGTransform>
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
            .expect("pop only called when transforms remain");
    }

    pub fn comment(&mut self, comment: String) {
        self.comment = Some(comment);
    }

    /// Maps [PathSegments](PathSegment) into concrete operations.
    pub fn apply_path(&mut self, path: impl IntoIterator<Item = PathSegment>) {
        use PathSegment::*;
        self.begin();
        self.reset();

        let mut start_point = Point::zero();
        let mut commands = vec![];
        let mut pending_comment = self.comment.take();

        for segment in path {
            match segment {
                MoveTo { abs, x, y } => {
                    if !commands.is_empty() {
                        self.turtle
                            .stroke(Stroke::new(start_point, std::mem::take(&mut commands)));
                    }
                    start_point = self.move_to(abs, x, y);
                    if let Some(comment) = pending_comment.take() {
                        commands.push(DrawCommand::Comment(comment));
                    }
                }
                ClosePath { .. } => {
                    if let Some(command) = self.close() {
                        commands.push(command);
                    }
                    if !commands.is_empty() {
                        self.turtle
                            .stroke(Stroke::new(start_point, std::mem::take(&mut commands)));
                    }
                }
                LineTo { abs, x, y } => {
                    commands.push(self.line(abs, Some(x), Some(y)));
                }
                HorizontalLineTo { abs, x } => {
                    commands.push(self.line(abs, Some(x), None));
                }
                VerticalLineTo { abs, y } => {
                    commands.push(self.line(abs, None, Some(y)));
                }
                CurveTo {
                    abs,
                    x1,
                    y1,
                    x2,
                    y2,
                    x,
                    y,
                } => {
                    commands.push(DrawCommand::CubicBezier(self.cubic_bezier(
                        abs,
                        point(x1, y1),
                        point(x2, y2),
                        point(x, y),
                    )));
                }
                SmoothCurveTo { abs, x2, y2, x, y } => {
                    commands.push(DrawCommand::CubicBezier(self.smooth_cubic_bezier(
                        abs,
                        point(x2, y2),
                        point(x, y),
                    )));
                }
                Quadratic { abs, x1, y1, x, y } => {
                    commands.push(DrawCommand::QuadraticBezier(self.quadratic_bezier(
                        abs,
                        point(x1, y1),
                        point(x, y),
                    )));
                }
                SmoothQuadratic { abs, x, y } => {
                    commands.push(DrawCommand::QuadraticBezier(
                        self.smooth_quadratic_bezier(abs, point(x, y)),
                    ));
                }
                EllipticalArc {
                    abs,
                    rx,
                    ry,
                    x_axis_rotation,
                    large_arc,
                    sweep,
                    x,
                    y,
                } => {
                    commands.push(DrawCommand::Arc(self.elliptical(
                        abs,
                        vector(rx, ry),
                        Angle::degrees(x_axis_rotation),
                        ArcFlags { large_arc, sweep },
                        point(x, y),
                    )));
                }
            }
        }

        if !commands.is_empty() {
            self.turtle
                .stroke(Stroke::new(start_point, std::mem::take(&mut commands)));
        }
    }

    pub fn apply_strokes(&mut self, strokes: impl IntoIterator<Item = Stroke>) {
        self.begin();

        for stroke in strokes {
            self.reset();
            self.turtle.stroke(stroke);
        }
    }

    /// Converts an SVG polygon into [FillPolygon(s)](FillPolygon) on a turtle.
    pub fn apply_polygon(
        &mut self,
        segments: impl IntoIterator<Item = PathSegment>,
        fill_rule: FillRule,
    ) {
        let mut sub = Terrarium {
            has_begun: false,
            turtle: StrokeCollectingTurtle::default(),
            current_position: self.current_position,
            initial_position: self.initial_position,
            current_transform: self.current_transform,
            transform_stack: self.transform_stack.clone(),
            previous_quadratic_control: self.previous_quadratic_control,
            previous_cubic_control: self.previous_cubic_control,
            comment: self.comment.clone(),
        };
        sub.apply_path(segments);
        let segments = sub.finish().into_strokes();
        for polygon in self::elements::fill::into_fill_polygons(segments, fill_rule) {
            self.turtle.fill_polygon(polygon);
        }
    }

    pub fn finish(mut self) -> T {
        if self.has_begun {
            self.turtle.end();
        }
        self.turtle
    }
}
