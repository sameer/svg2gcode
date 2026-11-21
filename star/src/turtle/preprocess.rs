use lyon_geom::Box2D;

use super::{Turtle, elements::Shape};

/// Generates a tight bounding box for all draw operations, used to apply [`crate::lower::ConversionConfig::origin`]
/// and SVG features like `clipPathUnits="objectBoundingBox"`.
#[derive(Debug, Default)]
pub struct PreprocessTurtle {
    bounding_box: Option<Box2D<f64>>,
}

impl PreprocessTurtle {
    pub fn into_inner(self) -> Option<Box2D<f64>> {
        self.bounding_box
    }

    fn expand(&mut self, bbox: Box2D<f64>) {
        self.bounding_box = Some(match self.bounding_box {
            Some(existing) => Box2D::from_points([existing.min, existing.max, bbox.min, bbox.max]),
            None => bbox,
        });
    }
}

impl Turtle for PreprocessTurtle {
    fn begin(&mut self) {}

    fn end(&mut self) {}

    #[cfg(feature = "image")]
    fn image(&mut self, image: super::elements::RasterImage) {
        self.expand(image.bounding_box());
    }

    fn fill(&mut self, shape: Shape) {
        self.expand(shape.bounding_box());
    }

    fn stroke(&mut self, stroke: super::elements::Stroke) {
        self.expand(stroke.bounding_box());
    }
}
