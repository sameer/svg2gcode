use std::f64::consts;

use log::warn;
use lyon_geom::{LineSegment, Point, Vector};

use super::intersect::{Intersections, PARAM_EPSILON};
use crate::turtle::elements::{DrawCommand, FillPolygon, FillRule, PointLocation, Stroke};

fn cross(a: Point<f64>, b: Point<f64>) -> f64 {
    a.to_vector().cross(b.to_vector())
}

impl Stroke {
    /// Signed area of a closed [`Stroke`] using Green's theorem.
    /// Sign indicates winding, (negative = clockwise, positive = counterclockwise).
    ///
    /// <https://en.wikipedia.org/wiki/Green%27s_theorem>
    pub fn signed_area(&self) -> f64 {
        self.closed_commands().map(|cmd| cmd.area()).sum::<f64>()
    }

    /// Classifies `point` relative to `self`.
    ///
    /// <https://en.wikipedia.org/wiki/Point_in_polygon#Ray_casting_algorithm>
    pub fn contains_point(&self, point: Point<f64>) -> PointLocation {
        // Helpful intuition:
        //
        // Given a shape S a point P, we want to determine if P lies in S.
        // Let R be a ray from P going to the right horizontally to infinite x.
        // If we count the intersections of S and R, there are two cases,
        // by the Jordan Curve Theorem (https://en.wikipedia.org/wiki/Jordan_curve_theorem#Application)
        // 1. even: P lies outside S. 0 is a special case meaning the y coordinate of P does not lie
        //          in the y-range of S.
        // 2. odd: P lies inside S.
        //
        // Thinking about the JCT more literally:
        // 1. "if you are outside, you must enter and exit"
        // 2. "if you are inside you must exit (and enter and exit)"
        //
        // And since R extends infinitely, it will eventually exit S.
        let bbox = self.bounding_box();
        if !bbox.inflate(PARAM_EPSILON, PARAM_EPSILON).contains(point) {
            return PointLocation::Exterior;
        }

        // Cast a ray beyond the stroke bounding box.
        // It is perturbed slightly to prevent degenerate cases.
        let dx = bbox.max.x - point.x + 10.0;
        let dy = dx * (consts::E * 1e-4);
        let ray = LineSegment {
            from: point,
            to: point + Vector::new(dx, dy),
        };

        let mut crossings = 0usize;
        for cmd in self.closed_commands() {
            for (_t_cmd, u_ray) in cmd.intersections(&ray) {
                if u_ray <= PARAM_EPSILON {
                    return PointLocation::Boundary;
                }
                crossings += 1;
            }
        }
        if crossings.is_multiple_of(2) {
            PointLocation::Exterior
        } else {
            PointLocation::Interior
        }
    }
}

impl DrawCommand {
    /// Signed area under this command.
    ///
    /// The formula for lines and beziers is derived from kurbo's [`ParamCurveArea`]
    /// implementations. Elliptical arc is derived from Green's theorem on the rotated ellipse.
    ///
    /// [`ParamCurveArea`]: https://docs.rs/kurbo/latest/kurbo/trait.ParamCurveArea.html
    ///
    /// <https://nils-olovsson.se/articles/area_of_the_polygon_and_greens_theorem/>
    fn area(&self) -> f64 {
        // Helpful math:
        //
        // Using Green's theorem, we claim that
        // for some parametric function f(t)
        // the signed area of that segment is:
        // f(t) x f't() dt
        //
        // Line segment from A to B:
        // f(t) = A + (B - A)t
        // f'(t) = B - A
        // f(t) x f'(t) = (A + (B - A)t) x (B - A)
        // = (A - At + Bt) x (B - A)
        // = A x B - A x A - At x B + A x At + Bt x B - Bt x A
        // = A x B - At x B + A x At + Bt x B - Bt x A
        // = A x B - t(A x B) + t(A x A) + t(B x B) - t(B x A)
        // = A x B - t(A x B) - t(B x A)
        // = A x B - t(A x B) + t(A x B)
        // = A x B
        //
        // Quadratic Bezier from A to B with C as the control point:
        // f(t) = (1 - t)^2 * A + 2t(1 - t) * C + t^2 * B
        // f'(t) = -2(1 - t) * A + 2(1 - 2t) C + 2t * B
        //       = 2tA - 2A + 2C - 4tC + 2tB
        //       = 2tA - 2tC - 2A + 2C - 2tC + 2tB
        //       = 2t(A - C) + 2(C - A) + 2t(B - C)
        //       = 2(1 - t)(C - A) + 2t(B - C)
        // Now let u = 1 - t.
        // f(t) = u^2 * A + 2t(u) * C + t^2 * B
        // f'(t) = 2u(C - A) + 2t(B - C)
        // f(t) x f'(t) = (u^2 * A + 2tu * C + t^2 * B) x 2u(C - A) + 2t(B - C)
        // = (Au^2 + 2Ctu + Bt^2) x (2u(C - A) + 2t(B - C))
        //
        // Distribute Au^2:
        // u^2*2u * (A x (C - A)) + u^2*2t * (A x (B - C)) = 2u^3 * (A x C - A x A) + 2tu^2 * (A x B - A x C))
        //                                                 = 2u^3 (A x C) + 2tu^2 * (A x B - A x C)
        //
        // Distribute 2Ctu:
        // 2Ctu x (2u(C - A) + 2t(B - C)) = 4tu^2 * (C x (C - A)) + 4ut^2 * (C x (B - C))
        //                                = 4tu^2 * (C x -A) + 4ut^2 * (C x B)
        //                                = 4tu^2 * (A x C) + 4ut^2 * (C x B)
        //
        // Distribute Bt^2:
        // Bt^2 x (2u(C - A) + 2t(B - C)) = 2ut^2 * (B x (C - A)) + 2t^3 (B x (B - C))
        //                                = 2ut^2 * (B x C - B x A) + 2t^3 (B x B - B x C)
        //                                = 2ut^2 * (B x C - B x A) + 2t^3 (-B x C)
        //                                = 2ut^2 * (B x C - B x A) - 2t^3 (C x B)
        //
        // Adding the results together we get:
        // 2u^3 (A x C) + 2tu^2 * (A x B - A x C)
        //      + 4tu^2 * (A x C) + 4ut^2 * (C x B)
        //      + 2ut^2 * (B x C - B x A) - 2t^3 (C x B)
        // = (2u^3 + 4tu^2) * (A x C) + (4ut^2 - 2t^3) * (C x B) + 2ut^2 * (B x C) - 2ut^2 (B x A)
        // = (2u^3 + 4tu^2) * (A x C) + (4ut^2 - 2t^3) * (C x B) - 2ut^2 * (C x B) - 2ut^2 (B x A)
        // = (2u^3 + 4tu^2) * (A x C) + (4ut^2 - 2t^3 - 2ut^2) * (C x B) - 2ut^2 (B x A)
        // to be continued...
        0.5 * match *self {
            DrawCommand::LineTo(LineSegment { from, to }) => cross(from, to),
            DrawCommand::Arc(svg_arc) => {
                let arc = svg_arc.to_arc();
                arc.radii.x * arc.radii.y * arc.sweep_angle.radians
                    + arc.center.to_vector().cross(svg_arc.to - svg_arc.from)
            }
            DrawCommand::QuadraticBezier(qbs) => {
                (2.0 / 3.0) * cross(qbs.from, qbs.ctrl)
                    + (1.0 / 3.0) * cross(qbs.from, qbs.to)
                    + (2.0 / 3.0) * cross(qbs.ctrl, qbs.to)
            }
            DrawCommand::CubicBezier(cbs) => {
                (6.0 * cross(cbs.from, cbs.ctrl1)
                    + 3.0 * cross(cbs.from, cbs.ctrl2)
                    + cross(cbs.from, cbs.to)
                    + 3.0 * cross(cbs.ctrl1, cbs.ctrl2)
                    + 3.0 * cross(cbs.ctrl1, cbs.to)
                    + 6.0 * cross(cbs.ctrl2, cbs.to))
                    / 10.0
            }
        }
    }
}

impl FillPolygon {
    /// Classifies `point` relative to this filled polygon (outer contour minus holes).
    pub fn contains_point(&self, point: Point<f64>) -> PointLocation {
        match self.outer.contains_point(point) {
            PointLocation::Exterior => PointLocation::Exterior,
            PointLocation::Boundary => PointLocation::Boundary,
            PointLocation::Interior => {
                for hole in &self.holes {
                    match hole.contains_point(point) {
                        PointLocation::Interior => return PointLocation::Exterior,
                        PointLocation::Boundary => return PointLocation::Boundary,
                        PointLocation::Exterior => {}
                    }
                }
                PointLocation::Interior
            }
        }
    }
}

impl Stroke {
    /// Checks if `self` strictly contains `rhs`.
    pub fn contains(&self, rhs: &Stroke) -> bool {
        // If the two curves do not intersect, there are three possible scenarios:
        // 1. self strictly lies in rhs
        // 2. rhs strictly lies in self
        // 3. self and rhs are strictly disjoint
        //
        // For (2) to be true:
        // - self and rhs have no intersections
        // - a point in rhs (i.e. start point) lies in self

        // Fast check
        self.bounding_box().contains_box(&rhs.bounding_box())
            // Swap the two conditions for speed
            && self.contains_point(rhs.start_point()) == PointLocation::Interior
            && self
                .closed_commands()
                .flat_map(|cmd_self| {
                    rhs.closed_commands()
                        .map(move |cmd_rhs| (cmd_self, cmd_rhs))
                })
                .all(|(cmd_self, cmd_rhs)| cmd_self.intersections(&cmd_rhs).is_empty())
    }
}

/// Partitions raw SVG subpaths into [`FillPolygon`]s, one per outer contour, with holes
/// assigned to their closest enclosing outer.
///
/// `fill_rule` is flattened here:
/// - `EvenOdd`: even = outer
/// - `NonZero`: 0 cumulative winding = outer
pub(crate) fn into_fill_polygons(subpaths: &[Stroke], fill_rule: FillRule) -> Vec<FillPolygon> {
    if subpaths.is_empty() {
        return vec![];
    }

    // For each subpath, the indices of all other subpaths that enclose it.
    let containers: Vec<Vec<_>> = (0..subpaths.len())
        .map(|i| {
            (0..subpaths.len())
                .filter(|&j| j != i)
                .filter(|&j| subpaths[j].contains(&subpaths[i]))
                .collect()
        })
        .collect();

    // TODO: EvenOdd fill for overlapping but non-nested subpaths isn't handled.
    // We need to XOR without flattening somehow.
    if fill_rule == FillRule::EvenOdd {
        let bboxes: Vec<_> = subpaths.iter().map(super::Stroke::bounding_box).collect();
        for i in 0..subpaths.len() {
            for j in (i + 1)..subpaths.len() {
                let boxes_overlap = bboxes[i].intersects(&bboxes[j]);
                let neither_contains_the_other =
                    !containers[i].contains(&j) && !containers[j].contains(&i);
                if boxes_overlap && neither_contains_the_other {
                    warn!(
                        "`even-odd` fill rule with overlapping (non-nested) subpaths is not implemented! this won't be drawn correctly"
                    );
                    break;
                }
            }
        }
    }

    // Classify each subpath as outer (contributes filled area) or hole (removes it).
    let is_outer: Vec<Option<bool>> = match fill_rule {
        FillRule::EvenOdd => containers
            .iter()
            .map(|containing| Some(containing.len().is_multiple_of(2)))
            .collect(),
        FillRule::NonZero => {
            let areas: Vec<f64> = subpaths.iter().map(Stroke::signed_area).collect();

            containers
                .iter()
                .zip(areas.iter())
                .map(|(container, &area)| {
                    let cumulative_winding: i32 = container
                        .iter()
                        .map(|&j| if areas[j] > 0.0 { 1i32 } else { -1i32 })
                        .sum();

                    if cumulative_winding == 0 {
                        Some(true)
                    } else {
                        let winding_inside = cumulative_winding + if area > 0.0 { 1 } else { -1 };
                        if winding_inside == 0 {
                            Some(false)
                        } else {
                            // Attempting to fill a region inside an already-filled region.
                            // If `winding_inside` was zero, it would be a hole.
                            None
                        }
                    }
                })
                .collect()
        }
    };

    // For each outer, collect its immediate holes — holes for which this outer is the innermost
    // enclosing outer (no other outer sits between them).
    (0..subpaths.len())
        .filter(|&i| is_outer[i] == Some(true))
        .map(|i| {
            let holes = (0..subpaths.len())
                .filter(|&j| is_outer[j] == Some(false) && subpaths[i].contains(&subpaths[j]))
                .filter(|&j| {
                    // No other outer k is strictly between outer i and hole j.
                    !containers[j]
                        .iter()
                        .any(|&k| k != i && is_outer[k] == Some(true) && containers[k].contains(&i))
                })
                .map(|j| subpaths[j].clone())
                .collect();
            FillPolygon {
                outer: subpaths[i].clone(),
                holes,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::slice;

    use lyon_geom::Point;

    use super::*;
    use crate::turtle::elements::{DrawCommand, FillRule, Stroke};

    #[test]
    fn test_nonzero_nested_ccw() {
        // Subpath 0: CCW square (0,0) to (10,10)
        let s0 = Stroke::new(
            Point::new(0.0, 0.0),
            vec![
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(0.0, 0.0),
                    to: Point::new(10.0, 0.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(10.0, 0.0),
                    to: Point::new(10.0, 10.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(10.0, 10.0),
                    to: Point::new(0.0, 10.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(0.0, 10.0),
                    to: Point::new(0.0, 0.0),
                }),
            ],
            None,
        );

        // Subpath 1: CCW square (2,2) to (8,8)
        let s1 = Stroke::new(
            Point::new(2.0, 2.0),
            vec![
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(2.0, 2.0),
                    to: Point::new(8.0, 2.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(8.0, 2.0),
                    to: Point::new(8.0, 8.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(8.0, 8.0),
                    to: Point::new(2.0, 8.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(2.0, 8.0),
                    to: Point::new(2.0, 2.0),
                }),
            ],
            None,
        );

        // Subpath 2: CCW square (4,4) to (6,6)
        let s2 = Stroke::new(
            Point::new(4.0, 4.0),
            vec![
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(4.0, 4.0),
                    to: Point::new(6.0, 4.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(6.0, 4.0),
                    to: Point::new(6.0, 6.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(6.0, 6.0),
                    to: Point::new(4.0, 6.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(4.0, 6.0),
                    to: Point::new(4.0, 4.0),
                }),
            ],
            None,
        );

        let polygons = into_fill_polygons(&[s0.clone(), s1.clone(), s2.clone()], FillRule::NonZero);

        // For NonZero, since all are CCW, the winding numbers are 1, 2, and 3.
        // All are non-zero, so the whole area should be filled.
        // In terms of FillPolygon, it should be one outer (s0) with no holes.
        assert_eq!(polygons.len(), 1);
        assert_eq!(polygons[0].outer.start_point(), s0.start_point());
        assert_eq!(polygons[0].holes.len(), 0);
    }

    #[test]
    fn test_nonzero_overlapping_not_nested() {
        // Subpath 0: CCW square from (0,0) to (10,10)
        let s0 = Stroke::new(
            Point::new(0.0, 0.0),
            vec![
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(0.0, 0.0),
                    to: Point::new(10.0, 0.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(10.0, 0.0),
                    to: Point::new(10.0, 10.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(10.0, 10.0),
                    to: Point::new(0.0, 10.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(0.0, 10.0),
                    to: Point::new(0.0, 0.0),
                }),
            ],
            None,
        );

        // Subpath 1: CCW square from (5,5) to (15,15) - overlapping but not nested
        let s1 = Stroke::new(
            Point::new(5.0, 5.0),
            vec![
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(5.0, 5.0),
                    to: Point::new(15.0, 5.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(15.0, 5.0),
                    to: Point::new(15.0, 15.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(15.0, 15.0),
                    to: Point::new(5.0, 15.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(5.0, 15.0),
                    to: Point::new(5.0, 5.0),
                }),
            ],
            None,
        );

        let polygons = into_fill_polygons(&[s0.clone(), s1.clone()], FillRule::NonZero);

        // Since they overlap but are not nested (neither bbox is inside the other),
        // they should be classified as two independent outer contours.
        assert_eq!(polygons.len(), 2);
    }

    /// Pentagram (5-pointed star) drawn as a single self-intersecting M…Z subpath
    ///
    /// The path visits the five outer tips in "skip-one" order, crossing itself five times
    /// and enclosing an inner pentagon whose fill depends on the fill rule:
    ///
    ///  - `EvenOdd`: hole in the center (incorrect currently)
    ///  - `NonZero`: filled
    #[test]
    #[ignore = "self-intersecting single subpaths are not yet handled"]
    fn test_self_intersecting_pentagram() {
        let star = Stroke::new(
            Point::new(110.0, 45.0),
            vec![
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(110.0, 45.0),
                    to: Point::new(162.0, 195.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(162.0, 195.0),
                    to: Point::new(24.0, 100.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(24.0, 100.0),
                    to: Point::new(196.0, 100.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(196.0, 100.0),
                    to: Point::new(58.0, 195.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(58.0, 195.0),
                    to: Point::new(110.0, 45.0),
                }),
            ],
            None,
        );

        let evenodd = into_fill_polygons(slice::from_ref(&star), FillRule::EvenOdd);
        assert_eq!(evenodd.len(), 1, "EvenOdd: expected one outer contour");
        assert_eq!(
            evenodd[0].holes.len(),
            1,
            "EvenOdd: expected one hole (the inner pentagon)"
        );

        let nonzero = into_fill_polygons(&[star], FillRule::NonZero);
        assert_eq!(nonzero.len(), 1, "NonZero: expected one outer contour");
        assert_eq!(
            nonzero[0].holes.len(),
            0,
            "NonZero: expected no holes (inner pentagon is filled)"
        );
    }

    #[test]
    fn test_contains_point_circle_tangency() {
        use lyon_geom::{Angle, ArcFlags, SvgArc, point, vector};

        let top_arc = SvgArc {
            from: point(5.0, 0.0),
            to: point(-5.0, 0.0),
            radii: vector(5.0, 5.0),
            x_rotation: Angle::zero(),
            flags: ArcFlags {
                large_arc: false,
                sweep: true,
            },
        };
        let bottom_arc = SvgArc {
            from: point(-5.0, 0.0),
            to: point(5.0, 0.0),
            radii: vector(5.0, 5.0),
            x_rotation: Angle::zero(),
            flags: ArcFlags {
                large_arc: false,
                sweep: true,
            },
        };

        let circle = Stroke::new(
            point(5.0, 0.0),
            vec![DrawCommand::Arc(top_arc), DrawCommand::Arc(bottom_arc)],
            None,
        );

        assert_eq!(
            circle.contains_point(point(0.0, 0.0)),
            PointLocation::Interior
        );
        assert_eq!(
            circle.contains_point(point(0.0, 2.0)),
            PointLocation::Interior
        );
        assert_eq!(
            circle.contains_point(point(10.0, 0.0)),
            PointLocation::Exterior
        );
        assert_eq!(
            circle.contains_point(point(-10.0, 0.0)),
            PointLocation::Exterior
        );
        // Point at same height as top apex (y = 5.0), but to the left (x = -8.0):
        // Horizontal ray along y = 5.0 touches the top of the circle tangentially.
        // It must not count as a crossing, so the point must be classified as OUTSIDE.
        assert_eq!(
            circle.contains_point(point(-8.0, 5.0)),
            PointLocation::Exterior
        );
    }

    #[test]
    fn test_stroke_contains_stroke_catches_bulging_curves() {
        use lyon_geom::{CubicBezierSegment, point};

        let outer = Stroke::new(
            point(0.0, 0.0),
            vec![
                DrawCommand::LineTo(LineSegment {
                    from: point(0.0, 0.0),
                    to: point(10.0, 0.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(10.0, 0.0),
                    to: point(10.0, 10.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(10.0, 10.0),
                    to: point(0.0, 10.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(0.0, 10.0),
                    to: point(0.0, 0.0),
                }),
            ],
            None,
        );

        let inner_nested = Stroke::new(
            point(2.0, 2.0),
            vec![
                DrawCommand::LineTo(LineSegment {
                    from: point(2.0, 2.0),
                    to: point(8.0, 2.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(8.0, 2.0),
                    to: point(8.0, 8.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(8.0, 8.0),
                    to: point(2.0, 8.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(2.0, 8.0),
                    to: point(2.0, 2.0),
                }),
            ],
            None,
        );
        assert!(outer.contains(&inner_nested));

        let inner_bulging = Stroke::new(
            point(2.0, 5.0),
            vec![
                DrawCommand::CubicBezier(CubicBezierSegment {
                    from: point(2.0, 5.0),
                    ctrl1: point(3.0, 15.0),
                    ctrl2: point(7.0, 15.0),
                    to: point(8.0, 5.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(8.0, 5.0),
                    to: point(2.0, 5.0),
                }),
            ],
            None,
        );
        assert!(!outer.contains(&inner_bulging));
    }

    #[test]
    fn test_contains_point_polygon_and_bezier() {
        use lyon_geom::{QuadraticBezierSegment, point};

        let rect = Stroke::new(
            point(0.0, 0.0),
            vec![
                DrawCommand::LineTo(LineSegment {
                    from: point(0.0, 0.0),
                    to: point(10.0, 0.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(10.0, 0.0),
                    to: point(10.0, 10.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(10.0, 10.0),
                    to: point(0.0, 10.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(0.0, 10.0),
                    to: point(0.0, 0.0),
                }),
            ],
            None,
        );

        assert_eq!(
            rect.contains_point(point(5.0, 5.0)),
            PointLocation::Interior
        );
        assert_eq!(
            rect.contains_point(point(-5.0, 5.0)),
            PointLocation::Exterior
        );
        assert_eq!(
            rect.contains_point(point(15.0, 5.0)),
            PointLocation::Exterior
        );
        assert_eq!(
            rect.contains_point(point(5.0, -5.0)),
            PointLocation::Exterior
        );
        assert_eq!(
            rect.contains_point(point(5.0, 15.0)),
            PointLocation::Exterior
        );
        // Test point horizontally aligned with bottom edge/vertices
        assert_eq!(
            rect.contains_point(point(-2.0, 0.0)),
            PointLocation::Exterior
        );
        // Test boundary points on different edges
        assert_eq!(
            rect.contains_point(point(0.0, 5.0)),
            PointLocation::Boundary
        );
        assert_eq!(
            rect.contains_point(point(10.0, 5.0)),
            PointLocation::Boundary
        );
        assert_eq!(
            rect.contains_point(point(5.0, 0.0)),
            PointLocation::Boundary
        );
        assert_eq!(
            rect.contains_point(point(5.0, 10.0)),
            PointLocation::Boundary
        );

        // Heart-like / arched shape using quadratic bezier
        let arch = Stroke::new(
            point(0.0, 0.0),
            vec![
                DrawCommand::QuadraticBezier(QuadraticBezierSegment {
                    from: point(0.0, 0.0),
                    ctrl: point(5.0, 10.0),
                    to: point(10.0, 0.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(10.0, 0.0),
                    to: point(0.0, 0.0),
                }),
            ],
            None,
        );

        assert_eq!(
            arch.contains_point(point(5.0, 2.0)),
            PointLocation::Interior
        );
        assert_eq!(
            arch.contains_point(point(5.0, 8.0)),
            PointLocation::Exterior
        );
        assert_eq!(
            arch.contains_point(point(-1.0, 2.0)),
            PointLocation::Exterior
        );
        assert_eq!(
            arch.contains_point(point(5.0, 0.0)),
            PointLocation::Boundary
        );
    }
}
