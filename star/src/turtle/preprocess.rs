use std::iter;

use lyon_geom::Box2D;

use super::{Turtle, elements::FillPolygon};

/// Generates a bounding box for all draw operations, used to properly apply [crate::lower::ConversionConfig::origin]
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
        self.bounding_box = self.bounding_box.union(&image.dimensions);
    }

    fn fill_polygon(&mut self, polygon: FillPolygon) {
        self.bounding_box = iter::once(polygon.outer)
            .chain(polygon.holes)
            .flat_map(|s| s.into_commands())
            .filter_map(|c| c.bounding_box())
            .fold(self.bounding_box, |acc, b| {
                Box2D::from_points([acc.min, acc.max, b.min, b.max])
            });
    }

    fn stroke(&mut self, stroke: super::elements::Stroke) {
        self.bounding_box = Box2D::from_points([
            self.bounding_box.min,
            self.bounding_box.max,
            stroke.start_point(),
        ]);
        for command in stroke.into_commands() {
            if let Some(b) = command.bounding_box() {
                self.bounding_box = Box2D::from_points([
                    self.bounding_box.min,
                    self.bounding_box.max,
                    b.min,
                    b.max,
                ]);
            }
        }
    }
}
