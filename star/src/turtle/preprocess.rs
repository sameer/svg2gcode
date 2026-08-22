use std::iter;

use lyon_geom::Box2D;

use super::{Turtle, elements::FillPolygon};
use crate::turtle::elements::DrawCommand;

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
        self.bounding_box = Box2D::from_points([
            self.bounding_box.min,
            self.bounding_box.max,
            image.dimensions.min,
            image.dimensions.max,
        ]);
    }

    fn fill_polygon(&mut self, polygon: FillPolygon) {
        self.bounding_box = iter::once(polygon.outer)
            .chain(polygon.holes)
            .flat_map(|s| s.into_commands())
            .map(|c| c.bounding_box())
            .fold(self.bounding_box, |acc, b| {
                Box2D::from_points([acc.min, acc.max, b.min, b.max])
            });
    }

    fn stroke(&mut self, stroke: super::elements::Stroke) {
        self.bounding_box = stroke.commands().map(DrawCommand::bounding_box).fold(
            Box2D::from_points([
                self.bounding_box.min,
                self.bounding_box.max,
                stroke.start_point(),
            ]),
            |bounding_box, cmd_bbox| {
                Box2D::from_points([
                    bounding_box.min,
                    bounding_box.max,
                    cmd_bbox.min,
                    cmd_bbox.max,
                ])
            },
        );
    }
}
