use std::fmt::Debug;

use lyon_geom::{
    CubicBezierSegment, LineSegment, Point, QuadraticBezierSegment, SvgArc, Vector, point, vector,
};
use uom::si::{
    f64::Length,
    length::{inch, millimeter},
};

use super::{
    Turtle,
    elements::{DrawCommand, Shape, Stroke},
};

/// Wrapper turtle that converts from user units to millimeters at a given DPI
#[derive(Debug)]
pub struct DpiConvertingTurtle<T: Turtle> {
    dpi: f64,
    inner: T,
}

impl<T: Turtle> DpiConvertingTurtle<T> {
    pub fn new(dpi: f64, inner: T) -> Self {
        Self { dpi, inner }
    }

    pub fn into_inner(self) -> T {
        self.inner
    }

    fn to_mm(&self, value: f64) -> f64 {
        Length::new::<inch>(value / self.dpi).get::<millimeter>()
    }

    fn point_to_mm(&self, p: Point<f64>) -> Point<f64> {
        point(self.to_mm(p.x), self.to_mm(p.y))
    }

    fn vector_to_mm(&self, v: Vector<f64>) -> Vector<f64> {
        vector(self.to_mm(v.x), self.to_mm(v.y))
    }

    #[cfg(feature = "image")]
    fn box_to_mm(&self, b: lyon_geom::Box2D<f64>) -> lyon_geom::Box2D<f64> {
        lyon_geom::Box2D::new(self.point_to_mm(b.min), self.point_to_mm(b.max))
    }

    fn stroke_to_mm(&self, stroke: Stroke) -> Stroke {
        let comment = stroke.comment().map(ToString::to_string);
        Stroke::new(
            self.point_to_mm(stroke.start_point()),
            stroke
                .into_commands()
                .into_iter()
                .map(|cmd| match cmd {
                    DrawCommand::LineTo(LineSegment { from, to }) => {
                        DrawCommand::LineTo(LineSegment {
                            from: self.point_to_mm(from),
                            to: self.point_to_mm(to),
                        })
                    }
                    DrawCommand::Arc(SvgArc {
                        from,
                        to,
                        radii,
                        x_rotation,
                        flags,
                    }) => {
                        let arc = SvgArc {
                            from: self.point_to_mm(from),
                            to: self.point_to_mm(to),
                            radii: self.vector_to_mm(radii),
                            x_rotation,
                            flags,
                        };
                        if arc.is_straight_line() {
                            DrawCommand::LineTo(LineSegment {
                                from: arc.from,
                                to: arc.to,
                            })
                        } else {
                            DrawCommand::Arc(arc)
                        }
                    }
                    DrawCommand::CubicBezier(CubicBezierSegment {
                        from,
                        ctrl1,
                        ctrl2,
                        to,
                    }) => DrawCommand::CubicBezier(CubicBezierSegment {
                        from: self.point_to_mm(from),
                        ctrl1: self.point_to_mm(ctrl1),
                        ctrl2: self.point_to_mm(ctrl2),
                        to: self.point_to_mm(to),
                    }),
                    DrawCommand::QuadraticBezier(QuadraticBezierSegment { from, ctrl, to }) => {
                        DrawCommand::QuadraticBezier(QuadraticBezierSegment {
                            from: self.point_to_mm(from),
                            ctrl: self.point_to_mm(ctrl),
                            to: self.point_to_mm(to),
                        })
                    }
                })
                .collect(),
            comment,
        )
    }
}

impl<T: Turtle> Turtle for DpiConvertingTurtle<T> {
    fn begin(&mut self) {
        self.inner.begin();
    }

    fn end(&mut self) {
        self.inner.end();
    }

    fn stroke(&mut self, stroke: Stroke) {
        self.inner.stroke(self.stroke_to_mm(stroke));
    }

    #[cfg(feature = "image")]
    fn image(&mut self, img: super::elements::RasterImage) {
        self.inner.image(super::elements::RasterImage {
            dimensions: self.box_to_mm(img.dimensions),
            image: img.image,
        });
    }

    fn fill(&mut self, shape: Shape) {
        self.inner.fill(Shape {
            outer: self.stroke_to_mm(shape.outer),
            holes: shape
                .holes
                .into_iter()
                .map(|s| self.stroke_to_mm(s))
                .collect(),
        });
    }
}
