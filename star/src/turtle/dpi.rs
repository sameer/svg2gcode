use std::fmt::Debug;

use lyon_geom::Transform;
use uom::si::{
    f64::Length,
    length::{inch, millimeter},
};

use super::{
    Turtle,
    elements::{Shape, Stroke},
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

    fn transform(&self) -> Transform<f64> {
        let factor = self.to_mm(1.0);
        Transform::scale(factor, factor)
    }

    #[cfg(feature = "image")]
    fn box_to_mm(&self, b: lyon_geom::Box2D<f64>) -> lyon_geom::Box2D<f64> {
        let factor = self.to_mm(1.0);
        lyon_geom::Box2D::new(
            lyon_geom::point(b.min.x * factor, b.min.y * factor),
            lyon_geom::point(b.max.x * factor, b.max.y * factor),
        )
    }

    fn stroke_to_mm(&self, mut stroke: Stroke) -> Stroke {
        stroke.transform(&self.transform());
        stroke
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

    fn fill(&mut self, mut shape: Shape) {
        shape.transform(&self.transform());
        self.inner.fill(shape);
    }
}
