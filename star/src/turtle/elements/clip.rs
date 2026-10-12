use std::iter;

use lyon_geom::{LineSegment, Point};

use super::intersect::{Intersections, PARAM_EPSILON};
use crate::turtle::elements::{DrawCommand, FillPolygon, Stroke};

#[derive(Debug, Clone)]
struct ActiveClip {
    clip_polygons: Vec<FillPolygon>,
    boundary_commands: Vec<DrawCommand>,
}

/// Stack of active polygon clip boundaries.
#[derive(Debug, Clone, Default)]
pub struct ClipStack {
    stack: Vec<ActiveClip>,
}

impl ClipStack {
    pub fn push_clip(&mut self, clip_polygons: Vec<FillPolygon>) {
        self.stack.push(ActiveClip {
            boundary_commands: clip_polygons
                .iter()
                .flat_map(|polygon| {
                    iter::once(&polygon.outer)
                        .chain(&polygon.holes)
                        .flat_map(|stroke| {
                            stroke
                                .commands()
                                .copied()
                                .chain((!stroke.is_closed()).then_some(DrawCommand::LineTo(
                                    LineSegment {
                                        from: stroke.end_point(),
                                        to: stroke.start_point(),
                                    },
                                )))
                        })
                })
                .collect(),
            clip_polygons,
        });
    }

    pub fn pop_clip(&mut self) -> Option<Vec<FillPolygon>> {
        self.stack.pop().map(|c| c.clip_polygons)
    }

    /// Returns whether there is any clip.
    pub fn is_active(&self) -> bool {
        !self.stack.is_empty()
    }

    /// Clips the commands in `strokes` against all active clip boundaries.
    pub fn clip_strokes(
        &self,
        strokes: impl IntoIterator<Item = Stroke>,
    ) -> impl Iterator<Item = Stroke> {
        let mut current: Vec<Stroke> = strokes.into_iter().collect();
        for active in &self.stack {
            let mut next = Vec::new();
            for stroke in current {
                let mut clipped_cmds = Vec::new();
                for cmd in stroke.into_commands() {
                    Self::clip_draw_command(active, cmd, &mut clipped_cmds);
                }
                next.extend(group_commands_into_strokes(clipped_cmds));
            }
            current = next;
        }
        current.into_iter()
    }

    /// Splits `cmd` into clipped segments on the given active layer.
    fn clip_draw_command(active: &ActiveClip, cmd: DrawCommand, cmds: &mut Vec<DrawCommand>) {
        // Find all the intersections of `cmd` with the clip.
        // This creates ranges that may or may not be in a clip polygon.
        let mut ts: Vec<f64> = vec![0.0, 1.0];
        for clip_cmd in &active.boundary_commands {
            for (cmd_t, _boundary_t) in cmd.intersections(clip_cmd) {
                ts.push(cmd_t);
            }
        }
        ts.sort_by(f64::total_cmp);
        ts.dedup_by(|a, b| (*a - *b).abs() < PARAM_EPSILON);

        // Draw ranges that are active within some clipping polygon
        let is_inside = |pt: Point<f64>| active.clip_polygons.iter().any(|p| p.contains_point(pt));
        for (&t_a, &t_b) in ts.iter().zip(ts.iter().skip(1)) {
            let t_mid = f64::midpoint(t_a, t_b);
            if is_inside(cmd.sample(t_mid)) {
                cmds.push(cmd.split_range(t_a..t_b));
            }
        }
    }
}

/// Groups a sequence of clipped drawing commands into `Stroke` objects,
/// splitting into a new `Stroke` whenever consecutive commands are not contiguous.
fn group_commands_into_strokes(cmds: Vec<DrawCommand>) -> Vec<Stroke> {
    let mut strokes = Vec::new();
    let mut current_cmds = Vec::new();
    let mut current_start = None;
    let mut prev_end: Option<Point<f64>> = None;

    for cmd in cmds {
        let cmd_start = cmd.start_point();
        let cmd_end = cmd.end_point();

        if let (Some(prev), Some(start)) = (prev_end, cmd_start) {
            // If the next command does not start where the previous command ended,
            // emit the current stroke and start a new one across the rapid-travel gap.
            if (prev - start).square_length() > f64::EPSILON
                && let Some(s) = current_start.take()
            {
                strokes.push(Stroke::new(s, std::mem::take(&mut current_cmds), None));
            }
        }

        if current_start.is_none() {
            current_start = cmd_start;
        }
        prev_end = Some(cmd_end);
        current_cmds.push(cmd);
    }

    if let Some(start) = current_start {
        strokes.push(Stroke::new(start, current_cmds, None));
    }
    strokes
}

#[cfg(test)]
mod tests {
    use lyon_geom::{
        Angle, ArcFlags, CubicBezierSegment, LineSegment, QuadraticBezierSegment, SvgArc, point,
        vector,
    };

    use super::*;

    fn make_rect_clip(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> ClipStack {
        let outer = Stroke::new(
            point(min_x, min_y),
            [
                LineSegment {
                    from: point(min_x, min_y),
                    to: point(max_x, min_y),
                },
                LineSegment {
                    from: point(max_x, min_y),
                    to: point(max_x, max_y),
                },
                LineSegment {
                    from: point(max_x, max_y),
                    to: point(min_x, max_y),
                },
                LineSegment {
                    from: point(min_x, max_y),
                    to: point(min_x, min_y),
                },
            ]
            .map(DrawCommand::LineTo)
            .to_vec(),
            None,
        );
        let poly = FillPolygon {
            outer,
            holes: vec![],
        };
        let mut cs = ClipStack::default();
        cs.push_clip(vec![poly]);
        cs
    }

    #[test]
    fn test_clip_cubic_bezier_preserves_cubic() {
        let cs = make_rect_clip(0.0, 0.0, 10.0, 10.0);
        let cbs = CubicBezierSegment {
            from: point(-5.0, 5.0),
            ctrl1: point(-2.0, 8.0),
            ctrl2: point(2.0, 8.0),
            to: point(5.0, 5.0),
        };

        let mut cmds = Vec::new();
        ClipStack::clip_draw_command(
            cs.stack.last().unwrap(),
            DrawCommand::CubicBezier(cbs),
            &mut cmds,
        );

        assert!(!cmds.is_empty(), "Should output clipped commands");
        assert!(
            matches!(cmds[0], DrawCommand::CubicBezier(_)),
            "Clipped cubic curve must remain a native DrawCommand::CubicBezier"
        );
    }

    #[test]
    fn test_clip_quadratic_bezier_preserves_quadratic() {
        let cs = make_rect_clip(0.0, 0.0, 10.0, 10.0);
        let qbs = QuadraticBezierSegment {
            from: point(-5.0, 5.0),
            ctrl: point(0.0, 10.0),
            to: point(5.0, 5.0),
        };

        let mut cmds = Vec::new();
        ClipStack::clip_draw_command(
            cs.stack.last().unwrap(),
            DrawCommand::QuadraticBezier(qbs),
            &mut cmds,
        );

        assert!(!cmds.is_empty(), "Should output clipped commands");
        assert!(
            matches!(cmds[0], DrawCommand::QuadraticBezier(_)),
            "Clipped quadratic curve must remain a native DrawCommand::QuadraticBezier"
        );
    }

    #[test]
    fn test_clip_cubic_bezier_multiple_intersections() {
        let cs = make_rect_clip(0.0, 0.0, 10.0, 10.0);
        // An S-shaped cubic curve that starts inside, loops outside right, comes back inside, loops outside left, and ends inside.
        let cbs = CubicBezierSegment {
            from: point(5.0, 1.0),
            ctrl1: point(25.0, 3.0),
            ctrl2: point(-15.0, 7.0),
            to: point(5.0, 9.0),
        };

        let mut cmds = Vec::new();
        ClipStack::clip_draw_command(
            cs.stack.last().unwrap(),
            DrawCommand::CubicBezier(cbs),
            &mut cmds,
        );

        // Curve must yield multiple native CubicBezier sub-segments for the portions inside [0, 10] x [0, 10]
        assert!(
            cmds.len() >= 2,
            "Multiple boundary crossings should produce multiple sub-curves: got {}",
            cmds.len()
        );
        for cmd in &cmds {
            assert!(
                matches!(cmd, DrawCommand::CubicBezier(_)),
                "All clipped sub-curves must be native DrawCommand::CubicBezier"
            );
        }
    }

    #[test]
    fn test_clip_arc_against_rect() {
        let cs = make_rect_clip(0.0, 0.0, 10.0, 10.0);
        // Arc starting outside at (-5, 5) and curving inside to (5, 5)
        let svg_arc = SvgArc {
            from: point(-5.0, 5.0),
            to: point(5.0, 5.0),
            radii: vector(5.0, 5.0),
            x_rotation: Angle::zero(),
            flags: ArcFlags {
                large_arc: false,
                sweep: true,
            },
        };

        let mut cmds = Vec::new();
        ClipStack::clip_draw_command(
            cs.stack.last().unwrap(),
            DrawCommand::Arc(svg_arc),
            &mut cmds,
        );

        assert!(!cmds.is_empty(), "Should output clipped arc commands");
        assert!(
            matches!(cmds[0], DrawCommand::Arc(_)),
            "Clipped arc must remain a native DrawCommand::Arc"
        );
    }

    #[test]
    fn test_clip_strokes_splits_on_discontinuity() {
        let r1 = make_rect_clip(0.0, 0.0, 2.0, 10.0);
        let r2 = make_rect_clip(8.0, 0.0, 10.0, 10.0);
        let mut cs = ClipStack::default();
        cs.push_clip(vec![
            r1.stack
                .into_iter()
                .next()
                .unwrap()
                .clip_polygons
                .into_iter()
                .next()
                .unwrap(),
            r2.stack
                .into_iter()
                .next()
                .unwrap()
                .clip_polygons
                .into_iter()
                .next()
                .unwrap(),
        ]);

        let stroke = Stroke::new(
            point(-1.0, 5.0),
            vec![DrawCommand::LineTo(LineSegment {
                from: point(-1.0, 5.0),
                to: point(11.0, 5.0),
            })],
            None,
        );

        let clipped = cs.clip_strokes(vec![stroke]).collect::<Vec<_>>();
        assert_eq!(
            clipped.len(),
            2,
            "Clipped stroke crossing two disconnected regions must produce 2 distinct strokes"
        );
        assert!((clipped[0].start_point().x - 0.0).abs() < 1e-5);
        assert!((clipped[0].end_point().x - 2.0).abs() < 1e-5);
        assert!((clipped[1].start_point().x - 8.0).abs() < 1e-5);
        assert!((clipped[1].end_point().x - 10.0).abs() < 1e-5);
    }
}
