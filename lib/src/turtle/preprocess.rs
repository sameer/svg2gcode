use lyon_geom::{Box2D, CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc};

use super::Turtle;

#[derive(Debug, Default)]
pub struct PreprocessTurtle {
    pub bounding_box: Box2D<f64>,
}

impl Turtle for PreprocessTurtle {
    fn begin(&mut self) {}

    fn end(&mut self) {}

    fn comment(&mut self, _comment: String) {}

    fn move_to(&mut self, to: Point<f64>) {
        self.bounding_box = Box2D::from_points([self.bounding_box.min, self.bounding_box.max, to]);
    }

    fn line_to(&mut self, to: Point<f64>) {
        self.bounding_box = Box2D::from_points([self.bounding_box.min, self.bounding_box.max, to]);
    }

    fn arc(&mut self, svg_arc: SvgArc<f64>) {
        if svg_arc.is_straight_line() {
            self.line_to(svg_arc.to);
        } else {
            self.bounding_box = self.bounding_box.union(&svg_arc.to_arc().bounding_box());
        }
    }

    fn cubic_bezier(&mut self, cbs: CubicBezierSegment<f64>) {
        self.bounding_box = self.bounding_box.union(&cbs.bounding_box());
    }

    fn quadratic_bezier(&mut self, qbs: QuadraticBezierSegment<f64>) {
        self.bounding_box = self.bounding_box.union(&qbs.bounding_box());
    }
}
