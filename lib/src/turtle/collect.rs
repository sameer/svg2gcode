use lyon_geom::{ArcFlags, CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc};

use super::Turtle;

/// A single drawing command within a stroke
#[derive(Debug, Clone)]
pub enum DrawingCommand {
    LineTo(Point<f64>),
    Arc(SvgArc<f64>),
    CubicBezier(CubicBezierSegment<f64>),
    QuadraticBezier(QuadraticBezierSegment<f64>),
    Comment(String),
}

impl DrawingCommand {
    fn end_point(&self) -> Option<Point<f64>> {
        match self {
            DrawingCommand::LineTo(to) => Some(*to),
            DrawingCommand::Arc(arc) => Some(arc.to),
            DrawingCommand::CubicBezier(cbs) => Some(cbs.to),
            DrawingCommand::QuadraticBezier(qbs) => Some(qbs.to),
            DrawingCommand::Comment(_) => None,
        }
    }
}

/// A continuous pen-down sequence with a known start point
#[derive(Debug, Clone)]
pub struct Stroke {
    pub start_point: Point<f64>,
    pub commands: Vec<DrawingCommand>,
}

impl Stroke {
    pub fn end_point(&self) -> Point<f64> {
        self.commands
            .iter()
            .rev()
            .find_map(DrawingCommand::end_point)
            .unwrap_or(self.start_point)
    }

    /// Reverse the stroke so it runs from end_point to start_point.
    pub fn reversed(self) -> Self {
        let new_start = self.end_point();

        // Collect the geometric position before each command so we can reconstruct
        // LineTo endpoints when reversed (a LineTo's 'from' becomes the new 'to').
        let mut positions: Vec<Point<f64>> = Vec::with_capacity(self.commands.len() + 1);
        positions.push(self.start_point);
        for cmd in &self.commands {
            positions.push(cmd.end_point().unwrap_or(*positions.last().unwrap()));
        }

        // Reverse: each command i's new 'to' is positions[i] (the old 'from').
        let reversed_cmds = self
            .commands
            .into_iter()
            .enumerate()
            .rev()
            .map(|(i, cmd)| match cmd {
                DrawingCommand::LineTo(_) => DrawingCommand::LineTo(positions[i]),
                DrawingCommand::Arc(arc) => DrawingCommand::Arc(SvgArc {
                    from: arc.to,
                    to: arc.from,
                    flags: ArcFlags {
                        sweep: !arc.flags.sweep,
                        ..arc.flags
                    },
                    ..arc
                }),
                DrawingCommand::CubicBezier(cbs) => {
                    DrawingCommand::CubicBezier(CubicBezierSegment {
                        from: cbs.to,
                        ctrl1: cbs.ctrl2,
                        ctrl2: cbs.ctrl1,
                        to: cbs.from,
                    })
                }
                DrawingCommand::QuadraticBezier(qbs) => {
                    DrawingCommand::QuadraticBezier(QuadraticBezierSegment {
                        from: qbs.to,
                        ctrl: qbs.ctrl,
                        to: qbs.from,
                    })
                }
                DrawingCommand::Comment(s) => DrawingCommand::Comment(s),
            })
            .collect();

        Stroke {
            start_point: new_start,
            commands: reversed_cmds,
        }
    }
}

/// A [Turtle] that collects drawing commands into [Stroke]s instead of emitting G-code.
#[derive(Debug, Default)]
pub struct StrokeCollectingTurtle {
    pub strokes: Vec<Stroke>,
    pending: Vec<DrawingCommand>,
    stroke_start: Point<f64>,
    current_pos: Point<f64>,
}

impl StrokeCollectingTurtle {
    fn flush(&mut self) {
        let has_geometry = self
            .pending
            .iter()
            .any(|c| !matches!(c, DrawingCommand::Comment(_)));
        if has_geometry {
            self.strokes.push(Stroke {
                start_point: self.stroke_start,
                commands: std::mem::take(&mut self.pending),
            });
        } else {
            self.pending.clear();
        }
    }
}

impl Turtle for StrokeCollectingTurtle {
    fn begin(&mut self) {}

    fn end(&mut self) {
        self.flush();
    }

    fn comment(&mut self, comment: String) {
        self.pending.push(DrawingCommand::Comment(comment));
    }

    fn move_to(&mut self, to: Point<f64>) {
        self.flush();
        self.stroke_start = to;
        self.current_pos = to;
    }

    fn line_to(&mut self, to: Point<f64>) {
        self.pending.push(DrawingCommand::LineTo(to));
        self.current_pos = to;
    }

    fn arc(&mut self, svg_arc: SvgArc<f64>) {
        self.pending.push(DrawingCommand::Arc(svg_arc));
        self.current_pos = svg_arc.to;
    }

    fn cubic_bezier(&mut self, cbs: CubicBezierSegment<f64>) {
        self.pending.push(DrawingCommand::CubicBezier(cbs));
        self.current_pos = cbs.to;
    }

    fn quadratic_bezier(&mut self, qbs: QuadraticBezierSegment<f64>) {
        self.pending.push(DrawingCommand::QuadraticBezier(qbs));
        self.current_pos = qbs.to;
    }
}
