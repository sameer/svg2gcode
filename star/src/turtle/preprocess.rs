use lyon_geom::Box2D;

use super::{Turtle, elements::Shape};

/// Generates a bounding box for all draw operations, used to properly apply [`crate::lower::ConversionConfig::origin`]
///
/// The box intentionally includes the origin so drawings within the page keep their layout.
#[derive(Debug, Default)]
pub struct PreprocessTurtle {
    bounding_box: Box2D<f64>,
}

impl PreprocessTurtle {
    pub fn into_inner(self) -> Box2D<f64> {
        self.bounding_box
    }
}

impl Turtle for PreprocessTurtle {
    fn begin(&mut self) {}

    fn end(&mut self) {}

    #[cfg(feature = "image")]
    fn image(&mut self, image: super::elements::RasterImage) {
        let Box2D { min, max } = image.bounding_box();
        self.bounding_box =
            Box2D::from_points([self.bounding_box.min, self.bounding_box.max, min, max]);
    }

    fn fill(&mut self, shape: Shape) {
        let Box2D { min, max } = shape.bounding_box();
        self.bounding_box =
            Box2D::from_points([self.bounding_box.min, self.bounding_box.max, min, max]);
    }

    fn stroke(&mut self, stroke: super::elements::Stroke) {
        let Box2D { min, max } = stroke.bounding_box();
        self.bounding_box =
            Box2D::from_points([self.bounding_box.min, self.bounding_box.max, min, max]);
    }
}
