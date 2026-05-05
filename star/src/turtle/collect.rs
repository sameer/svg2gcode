use super::{Turtle, elements::Stroke};

/// Collects [Stroke]s for pre-flattening operations.
#[derive(Debug, Default)]
pub struct StrokeCollectingTurtle {
    strokes: Vec<Stroke>,
}

impl StrokeCollectingTurtle {
    pub fn into_strokes(self) -> Vec<Stroke> {
        self.strokes
    }
}

impl Turtle for StrokeCollectingTurtle {
    fn begin(&mut self) {}
    fn end(&mut self) {}

    fn stroke(&mut self, stroke: Stroke) {
        self.strokes.push(stroke);
    }

    #[cfg(feature = "image")]
    fn image(&mut self, _image: super::elements::RasterImage) {}

    fn fill_polygon(&mut self, _polygon: super::elements::FillPolygon) {
        // TODO?
    }
}
