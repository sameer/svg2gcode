use std::fmt::Debug;

use log::warn;
use lyon_geom::{
    ArcFlags, Box2D, CubicBezierSegment, LineSegment, Point, QuadraticBezierSegment, SvgArc,
    Vector,
    euclid::{Angle, default::Transform2D},
    point, vector,
};
use svgtypes::PathSegment;

use self::elements::{FillPolygon, Transformed};
use crate::turtle::elements::{DrawCommand, FillRule, Stroke, clip::ClipStack};

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
    current_bounds: Option<Box2D<f64>>,
    bounds_stack: Vec<Option<Box2D<f64>>>,
    clip_stack: ClipStack,
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
            current_bounds: None,
            bounds_stack: vec![],
            clip_stack: ClipStack::default(),
        }
    }

    pub fn push_clip_layer(&mut self, polys: Vec<FillPolygon>) {
        self.clip_stack.push_clip(polys);
    }

    pub fn pop_clip_layer(&mut self) -> Option<Vec<FillPolygon>> {
        self.clip_stack.pop_clip()
    }

    pub fn push_viewport_bounds(&mut self, viewport_box: Box2D<f64>) {
        let new_bounds = self.current_transform.outer_transformed_box(&viewport_box);
        let combined_bounds = match self.current_bounds {
            Some(parent) => parent.intersection(&new_bounds),
            None => Some(new_bounds),
        };
        self.push_bounds(combined_bounds);
    }

    pub fn push_viewport_clip(&mut self, viewport_box: Box2D<f64>) {
        // TODO: this is breaking the turtle abstraction a little
        let t = self.current_transform();
        let p1 = t.transform_point(point(viewport_box.min.x, viewport_box.min.y));
        let p2 = t.transform_point(point(viewport_box.max.x, viewport_box.min.y));
        let p3 = t.transform_point(point(viewport_box.max.x, viewport_box.max.y));
        let p4 = t.transform_point(point(viewport_box.min.x, viewport_box.max.y));
        self.push_clip_layer(vec![FillPolygon {
            outer: Stroke::new(
                p1,
                vec![
                    DrawCommand::LineTo(LineSegment { from: p1, to: p2 }),
                    DrawCommand::LineTo(LineSegment { from: p2, to: p3 }),
                    DrawCommand::LineTo(LineSegment { from: p3, to: p4 }),
                    DrawCommand::LineTo(LineSegment { from: p4, to: p1 }),
                ],
                None,
            ),
            holes: vec![],
        }]);
    }

    pub fn push_bounds(&mut self, bounds: Option<Box2D<f64>>) {
        self.bounds_stack.push(self.current_bounds);
        self.current_bounds = bounds;
    }

    pub fn pop_bounds(&mut self) {
        self.current_bounds = self.bounds_stack.pop().expect("bounds stack underflow");
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
        let command = if (self.current_position - self.initial_position)
            .abs()
            .lower_than(vector(f64::EPSILON, f64::EPSILON))
            .all()
        {
            Some(DrawCommand::LineTo(LineSegment {
                from: self.current_position,
                to: self.initial_position,
            }))
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
        let x = x.map_or(original_current_position.x, |x| {
            if abs {
                x
            } else {
                original_current_position.x + x
            }
        });
        let y = y.map_or(original_current_position.y, |y| {
            if abs {
                y
            } else {
                original_current_position.y + y
            }
        });

        let from = self.current_position;
        let to = self.current_transform.transform_point(point(x, y));
        self.current_position = to;
        self.previous_quadratic_control = None;
        self.previous_cubic_control = None;

        DrawCommand::LineTo(LineSegment { from, to })
    }

    /// Draw a cubic curve from the current point to (x, y) with specified control points (x1, y1) and (x2, y2)
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands>
    fn cubic_bezier(
        &mut self,
        abs: bool,
        mut ctrl1: Point<f64>,
        mut ctrl2: Point<f64>,
        mut to: Point<f64>,
    ) -> DrawCommand {
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

        DrawCommand::CubicBezier(cbs)
    }

    /// Draw a shorthand/smooth cubic bezier segment, where the first control point was already given
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands>
    fn smooth_cubic_bezier(
        &mut self,
        abs: bool,
        mut ctrl2: Point<f64>,
        mut to: Point<f64>,
    ) -> DrawCommand {
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

        DrawCommand::CubicBezier(cbs)
    }

    /// Draw a shorthand/smooth cubic bezier segment, where the control point was already given
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataQuadraticBezierCommands>
    fn smooth_quadratic_bezier(&mut self, abs: bool, mut to: Point<f64>) -> DrawCommand {
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

        DrawCommand::QuadraticBezier(qbs)
    }

    /// Draw a quadratic bezier segment
    /// <https://www.w3.org/TR/SVG/paths.html#PathDataQuadraticBezierCommands>
    fn quadratic_bezier(
        &mut self,
        abs: bool,
        mut ctrl: Point<f64>,
        mut to: Point<f64>,
    ) -> DrawCommand {
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

        DrawCommand::QuadraticBezier(qbs)
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
    ) -> DrawCommand {
        let from = self
            .current_transform
            .inverse()
            .expect("transform is invertible")
            .transform_point(self.current_position);

        if !abs {
            to = from + to.to_vector();
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

        if svg_arc.is_straight_line() {
            DrawCommand::LineTo(LineSegment {
                from: svg_arc.from,
                to: svg_arc.to,
            })
        } else {
            DrawCommand::Arc(svg_arc)
        }
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
    pub fn image(
        &mut self,
        image: image::DynamicImage,
        image_to_user: Transform2D<f64>,
        preserve_aspect_ratio: svgtypes::AspectRatio,
    ) {
        let (image, transformed_box) = self::elements::image_ops::transform_image(
            image,
            image_to_user,
            &self.current_transform,
            preserve_aspect_ratio,
        );

        let final_raster_image = if let Some(bounds) = self.current_bounds {
            self::elements::image_ops::crop_image_to_bounds(image, transformed_box, bounds)
        } else {
            Some(crate::turtle::elements::RasterImage {
                dimensions: transformed_box,
                image,
            })
        };

        if let Some(raster_image) = final_raster_image {
            self.turtle.image(raster_image);
        }
    }

    /// Push a generic transform onto the stack
    /// Could be any valid CSS transform <https://drafts.csswg.org/css-transforms-1/#typedef-transform-function>
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

    pub fn current_transform(&self) -> Transform2D<f64> {
        self.current_transform
    }

    pub fn comment(&mut self, comment: String) {
        self.comment = Some(comment);
    }

    /// Maps [`PathSegments`](PathSegment) into concrete operations.
    pub fn apply_path(&mut self, path: impl IntoIterator<Item = PathSegment>) {
        use PathSegment::{
            ClosePath, CurveTo, EllipticalArc, HorizontalLineTo, LineTo, MoveTo, Quadratic,
            SmoothCurveTo, SmoothQuadratic, VerticalLineTo,
        };
        self.begin();
        self.reset();

        let mut start_point = Point::zero();
        let mut commands = vec![];
        let mut path_comment = self.comment.take();
        let mut strokes = vec![];

        let mut push_stroke = |stroke_start: Point<f64>, commands: &mut Vec<DrawCommand>| {
            if commands.is_empty() {
                return;
            }
            let cmds = std::mem::take(commands);
            strokes.push(Stroke::new(stroke_start, cmds, path_comment.take()));
        };

        for segment in path {
            match segment {
                MoveTo { abs, x, y } => {
                    push_stroke(start_point, &mut commands);
                    start_point = self.move_to(abs, x, y);
                }
                ClosePath { .. } => {
                    if let Some(command) = self.close() {
                        commands.push(command);
                    }
                    push_stroke(start_point, &mut commands);
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
                    commands.push(self.cubic_bezier(
                        abs,
                        point(x1, y1),
                        point(x2, y2),
                        point(x, y),
                    ));
                }
                SmoothCurveTo { abs, x2, y2, x, y } => {
                    commands.push(self.smooth_cubic_bezier(abs, point(x2, y2), point(x, y)));
                }
                Quadratic { abs, x1, y1, x, y } => {
                    commands.push(self.quadratic_bezier(abs, point(x1, y1), point(x, y)));
                }
                SmoothQuadratic { abs, x, y } => {
                    commands.push(self.smooth_quadratic_bezier(abs, point(x, y)));
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
                    commands.push(self.elliptical(
                        abs,
                        vector(rx, ry),
                        Angle::degrees(x_axis_rotation),
                        ArcFlags { large_arc, sweep },
                        point(x, y),
                    ));
                }
            }
        }

        // Handle unclosed path
        push_stroke(start_point, &mut commands);

        self.apply_strokes(strokes);
    }

    pub fn apply_strokes(&mut self, strokes: impl IntoIterator<Item = Stroke>) {
        self.begin();
        if self.clip_stack.is_active() {
            let strokes = self.clip_stack.clip_strokes(strokes).collect::<Vec<_>>();
            for stroke in strokes {
                self.reset();
                self.turtle.stroke(stroke);
            }
        } else {
            for stroke in strokes {
                self.reset();
                self.turtle.stroke(stroke);
            }
        }
    }

    pub fn to_fill_polygons(
        &self,
        segments: impl IntoIterator<Item = PathSegment>,
        fill_rule: FillRule,
    ) -> Vec<elements::FillPolygon> {
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
            current_bounds: self.current_bounds,
            bounds_stack: vec![],
            clip_stack: self.clip_stack.clone(),
        };
        sub.apply_path(segments);
        let strokes = sub.finish().into_strokes();
        let polys = self::elements::fill::into_fill_polygons(&strokes, fill_rule);
        if self.clip_stack.is_active() {
            // TODO: polygon clipping is non-trivial
            warn!("Polygon clipping is not yet unimplemented, skipping clip");
            polys
        } else {
            polys
        }
    }

    /// Converts an SVG polygon into [FillPolygon(s)](FillPolygon) on a turtle.
    pub fn apply_polygon(
        &mut self,
        segments: impl IntoIterator<Item = PathSegment>,
        fill_rule: FillRule,
    ) {
        for polygon in self.to_fill_polygons(segments, fill_rule) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lower::{ConversionConfig, ConversionOptions, svg_to_turtle};

    #[test]
    fn test_clip_layer_out_of_bounds_shape_filtered() {
        let svg_text = r#"<svg width="20mm" height="20mm" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse">
      <circle cx="-2" cy="5" r="5" fill="black"/>
    </pattern>
  </defs>
  <rect x="0" y="0" width="20" height="20" fill="url(#p)"/>
</svg>"#;
        let doc = roxmltree::Document::parse(svg_text).unwrap();

        #[derive(Debug, Default)]
        struct TestTurtle {
            polygons: Vec<FillPolygon>,
        }
        impl Turtle for TestTurtle {
            fn begin(&mut self) {}
            fn end(&mut self) {}
            fn stroke(&mut self, _stroke: Stroke) {}
            fn fill_polygon(&mut self, polygon: FillPolygon) {
                self.polygons.push(polygon);
            }
            #[cfg(feature = "image")]
            fn image(&mut self, _image: super::elements::RasterImage) {}
        }

        let conv = ConversionConfig::default();
        let turtle = TestTurtle::default();
        let result = svg_to_turtle(
            &doc,
            &conv,
            ConversionOptions::default(),
            turtle,
            CoordinateSystem::YDown,
        );

        // All emitted polygons must have non-zero area and bounding boxes strictly inside [0, 20] x [0, 20]
        assert!(!result.polygons.is_empty(), "Should emit clipped polygons");
        for poly in &result.polygons {
            let bbox = poly.outer.bounding_box();
            assert!(
                bbox.min.x >= -1e-3,
                "Min X should be within bounds: {}",
                bbox.min.x
            );
            assert!(
                bbox.max.x <= 20.0 + 1e-3,
                "Max X should be within bounds: {}",
                bbox.max.x
            );
            assert!(
                bbox.min.y >= -1e-3,
                "Min Y should be within bounds: {}",
                bbox.min.y
            );
            assert!(
                bbox.max.y <= 20.0 + 1e-3,
                "Max Y should be within bounds: {}",
                bbox.max.y
            );
        }
    }
}
