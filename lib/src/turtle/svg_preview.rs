use std::fmt::Write;

use lyon_geom::{Box2D, CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc};

use super::Turtle;

/// Builds an SVG preview of the toolpath:
/// - Red solid: tool-on moves (line_to, arc, cubic_bezier, quadratic_bezier)
/// - Green dashed: rapid/tool-off moves (move_to, when position changes)
///
/// Coordinates arrive in GCode space (Y-flipped, mm). The viewBox is derived
/// from the accumulated bounding box, so the image is self-consistent.
#[derive(Debug, Default)]
pub struct SvgPreviewTurtle {
    tool_on_paths: String,
    rapid_paths: String,
    bounding_box: Option<Box2D<f64>>,
    current_pos: Point<f64>,
    current_tool_on_d: String,
}

impl SvgPreviewTurtle {
    fn add_box(&mut self, bb: Box2D<f64>) {
        self.bounding_box = Some(
            self.bounding_box
                // Box2D::union discards empty boxes
                .map(|existing| Box2D::from_points([existing.min, existing.max, bb.min, bb.max]))
                .unwrap_or(bb),
        );
    }

    fn add_point(&mut self, p: Point<f64>) {
        self.add_box(Box2D { min: p, max: p });
    }

    fn flush_tool_on(&mut self) {
        if !self.current_tool_on_d.is_empty() {
            writeln!(
                self.tool_on_paths,
                "<path d=\"{}\" stroke=\"red\" fill=\"none\" stroke-width=\"1\" vector-effect=\"non-scaling-stroke\"/>",
                self.current_tool_on_d
            )
            .unwrap();
            self.current_tool_on_d.clear();
        }
    }

    pub fn into_preview(mut self) -> String {
        self.flush_tool_on();
        const PADDING: f64 = 2.0;
        match self.bounding_box {
            None => {
                "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"></svg>\n".to_string()
            }
            Some(bb) => {
                let vb_x = bb.min.x - PADDING;
                let vb_y = bb.min.y - PADDING;
                let vb_w = (bb.max.x - bb.min.x + 2.0 * PADDING).max(1.0);
                let vb_h = (bb.max.y - bb.min.y + 2.0 * PADDING).max(1.0);
                let flip_ty = -(bb.min.y + bb.max.y);
                format!(
                    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{vb_x} {vb_y} {vb_w} {vb_h}\">\n<g transform=\"scale(1,-1) translate(0,{flip_ty})\">\n{}{}</g>\n</svg>\n",
                    self.rapid_paths, self.tool_on_paths,
                )
            }
        }
    }
}

impl Turtle for SvgPreviewTurtle {
    fn begin(&mut self) {}

    fn end(&mut self) {
        self.flush_tool_on();
    }

    fn comment(&mut self, _: String) {}

    fn move_to(&mut self, to: Point<f64>) {
        self.flush_tool_on();
        if to != self.current_pos {
            writeln!(
                self.rapid_paths,
                "<path d=\"M {},{} L {},{}\" stroke=\"green\" fill=\"none\" stroke-width=\"1\" stroke-dasharray=\"4 3\" vector-effect=\"non-scaling-stroke\"/>",
                self.current_pos.x, self.current_pos.y, to.x, to.y,
            )
            .unwrap();
            self.add_point(to);
        }
        self.current_pos = to;
        write!(self.current_tool_on_d, "M {},{} ", to.x, to.y).unwrap();
    }

    fn line_to(&mut self, to: Point<f64>) {
        write!(self.current_tool_on_d, "L {},{} ", to.x, to.y).unwrap();
        self.add_point(to);
        self.current_pos = to;
    }

    fn arc(&mut self, svg_arc: SvgArc<f64>) {
        if svg_arc.is_straight_line() {
            self.line_to(svg_arc.to);
            return;
        }
        write!(
            self.current_tool_on_d,
            "A {},{} {} {} {} {},{} ",
            svg_arc.radii.x,
            svg_arc.radii.y,
            svg_arc.x_rotation.to_degrees(),
            if svg_arc.flags.large_arc { 1 } else { 0 },
            if svg_arc.flags.sweep { 1 } else { 0 },
            svg_arc.to.x,
            svg_arc.to.y,
        )
        .unwrap();
        self.add_box(svg_arc.to_arc().bounding_box());
        self.current_pos = svg_arc.to;
    }

    fn cubic_bezier(&mut self, cbs: CubicBezierSegment<f64>) {
        write!(
            self.current_tool_on_d,
            "C {},{} {},{} {},{} ",
            cbs.ctrl1.x, cbs.ctrl1.y, cbs.ctrl2.x, cbs.ctrl2.y, cbs.to.x, cbs.to.y,
        )
        .unwrap();
        self.add_box(cbs.bounding_box());
        self.current_pos = cbs.to;
    }

    fn quadratic_bezier(&mut self, qbs: QuadraticBezierSegment<f64>) {
        write!(
            self.current_tool_on_d,
            "Q {},{} {},{} ",
            qbs.ctrl.x, qbs.ctrl.y, qbs.to.x, qbs.to.y,
        )
        .unwrap();
        self.add_box(qbs.bounding_box());
        self.current_pos = qbs.to;
    }
}
