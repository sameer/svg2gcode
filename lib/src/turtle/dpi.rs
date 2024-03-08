use std::fmt::Debug;

use lyon_geom::{point, vector, CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc, Vector};
use uom::si::{
    f64::Length,
    length::{inch, millimeter},
};

use crate::Turtle;

/// Wrapper turtle that converts from user units to millimeters at a given DPI
#[derive(Debug)]
pub struct DpiConvertingTurtle<T: Turtle> {
    pub dpi: f64,
    pub inner: T,
}

impl<T: Turtle> DpiConvertingTurtle<T> {
    fn to_mm(&self, value: f64) -> f64 {
        Length::new::<inch>(value / self.dpi).get::<millimeter>()
    }

    fn point_to_mm(&self, p: Point<f64>) -> Point<f64> {
        point(self.to_mm(p.x), self.to_mm(p.y))
    }

    fn vector_to_mm(&self, v: Vector<f64>) -> Vector<f64> {
        vector(self.to_mm(v.x), self.to_mm(v.y))
    }
}

impl<T: Turtle> Turtle for DpiConvertingTurtle<T> {
    fn begin(&mut self) {
        self.inner.begin()
    }

    fn end(&mut self) {
        self.inner.end()
    }

    fn comment(&mut self, comment: String) {
        self.inner.comment(comment)
    }

    fn move_to(&mut self, to: Point<f64>) {
        self.inner.move_to(self.point_to_mm(to))
    }

    fn line_to(&mut self, to: Point<f64>) {
        self.inner.line_to(self.point_to_mm(to))
    }

    fn arc(
        &mut self,
        SvgArc {
            from,
            to,
            radii,
            x_rotation,
            flags,
        }: SvgArc<f64>,
    ) {
        self.inner.arc(SvgArc {
            from: self.point_to_mm(from),
            to: self.point_to_mm(to),
            radii: self.vector_to_mm(radii),
            x_rotation,
            flags,
        })
    }

    fn cubic_bezier(
        &mut self,
        CubicBezierSegment {
            from,
            ctrl1,
            ctrl2,
            to,
        }: CubicBezierSegment<f64>,
    ) {
        self.inner.cubic_bezier(CubicBezierSegment {
            from: self.point_to_mm(from),
            ctrl1: self.point_to_mm(ctrl1),
            ctrl2: self.point_to_mm(ctrl2),
            to: self.point_to_mm(to),
        })
    }

    fn quadratic_bezier(
        &mut self,
        QuadraticBezierSegment { from, ctrl, to }: QuadraticBezierSegment<f64>,
    ) {
        self.inner.quadratic_bezier(QuadraticBezierSegment {
            from: self.point_to_mm(from),
            to: self.point_to_mm(to),
            ctrl: self.point_to_mm(ctrl),
        })
    }
}
