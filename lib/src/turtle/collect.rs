use lyon_geom::{CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc};

use super::{
    Turtle,
    elements::{DrawCommand, Stroke},
};

/// Collects drawing commands into [Stroke]s for pre-flattening operations.
#[derive(Debug, Default)]
pub struct StrokeCollectingTurtle {
    strokes: Vec<Stroke>,
    pending: Vec<DrawCommand>,
    stroke_start: Point<f64>,
    current_pos: Point<f64>,
}

impl StrokeCollectingTurtle {
    fn flush(&mut self) {
        let has_geometry = self
            .pending
            .iter()
            .any(|c| !matches!(c, DrawCommand::Comment(_)));
        if has_geometry {
            self.strokes.push(Stroke {
                start_point: self.stroke_start,
                commands: std::mem::take(&mut self.pending),
            });
        } else {
            self.pending.clear();
        }
    }

    pub fn into_strokes(self) -> Vec<Stroke> {
        self.strokes
    }
}

impl Turtle for StrokeCollectingTurtle {
    fn begin(&mut self) {}

    fn end(&mut self) {
        self.flush();
    }

    fn comment(&mut self, comment: String) {
        self.pending.push(DrawCommand::Comment(comment));
    }

    fn move_to(&mut self, to: Point<f64>) {
        self.flush();
        self.stroke_start = to;
        self.current_pos = to;
    }

    fn line_to(&mut self, to: Point<f64>) {
        self.pending.push(DrawCommand::LineTo {
            from: self.current_pos,
            to,
        });
        self.current_pos = to;
    }

    fn arc(&mut self, svg_arc: SvgArc<f64>) {
        self.pending.push(DrawCommand::Arc(svg_arc));
        self.current_pos = svg_arc.to;
    }

    fn cubic_bezier(&mut self, cbs: CubicBezierSegment<f64>) {
        self.pending.push(DrawCommand::CubicBezier(cbs));
        self.current_pos = cbs.to;
    }

    fn quadratic_bezier(&mut self, qbs: QuadraticBezierSegment<f64>) {
        self.pending.push(DrawCommand::QuadraticBezier(qbs));
        self.current_pos = qbs.to;
    }
}
