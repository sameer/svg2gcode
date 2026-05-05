use lyon_geom::{LineSegment, Point};

use crate::turtle::elements::{DrawCommand, FillPolygon, FillRule, Stroke};

const TOLERANCE: f64 = 0.1;

fn cross(a: Point<f64>, b: Point<f64>) -> f64 {
    a.to_vector().cross(b.to_vector())
}

/// Signed area of a closed subpath using Green's theorem.
/// A negative area means clockwise winding.
///
///
/// Lines and beziers follow kurbo's [`ParamCurveArea`] formulas;
/// the elliptical arc contribution is a direct integration of the parametric ellipse.
///
/// [`ParamCurveArea`]: https://docs.rs/kurbo/latest/kurbo/trait.ParamCurveArea.html
/// <https://en.wikipedia.org/wiki/Green%27s_theorem>
fn signed_area(stroke: &Stroke) -> f64 {
    let mut area = 0.0;

    for cmd in stroke.commands() {
        match cmd {
            DrawCommand::LineTo { from, to } => {
                area += cross(*from, *to);
            }
            DrawCommand::Arc(svg_arc) => {
                let arc = svg_arc.to_arc();
                area += arc.radii.x * arc.radii.y * arc.sweep_angle.radians
                    + arc.center.to_vector().cross(svg_arc.to - svg_arc.from);
            }
            DrawCommand::QuadraticBezier(qbs) => {
                area += (2.0 / 3.0) * cross(qbs.from, qbs.ctrl)
                    + (1.0 / 3.0) * cross(qbs.from, qbs.to)
                    + (2.0 / 3.0) * cross(qbs.ctrl, qbs.to);
            }
            DrawCommand::CubicBezier(cbs) => {
                area += (6.0 * cross(cbs.from, cbs.ctrl1)
                    + 3.0 * cross(cbs.from, cbs.ctrl2)
                    + cross(cbs.from, cbs.to)
                    + 3.0 * cross(cbs.ctrl1, cbs.ctrl2)
                    + 3.0 * cross(cbs.ctrl1, cbs.to)
                    + 6.0 * cross(cbs.ctrl2, cbs.to))
                    / 10.0;
            }
            DrawCommand::Comment(_) => {}
        }
    }

    if !stroke.is_closed() {
        area += cross(stroke.end_point(), stroke.start_point());
    }
    area * 0.5
}

/// Returns true if `from` => `to` crosses a ray cast from `point` rightwards.
///
/// Used as the per-segment primitive for ray-casting. The `>= max_y` exclusion on the upper
/// endpoint ensures a shared vertex between two segments is counted only once.
fn edge_crosses_ray(from: Point<f64>, to: Point<f64>, point: Point<f64>) -> bool {
    let (min_y, max_y) = if from.y <= to.y {
        (from.y, to.y)
    } else {
        (to.y, from.y)
    };
    if point.y < min_y || point.y >= max_y {
        return false;
    }
    let t = (point.y - from.y) / (to.y - from.y);
    from.x + t * (to.x - from.x) > point.x
}

/// Tests whether `point` lies inside the closed region bounded by `stroke` using the
/// ray-casting algorithm.
///
/// If the number of boundary crossings is odd, it is inside.
/// For the sake of simplicity, curves are flattened with a set tolerance to do the casting.
/// The closing edge (end→start) is always checked to ensure the path is treated as closed.
///
/// <https://en.wikipedia.org/wiki/Point_in_polygon#Ray_casting_algorithm>
fn stroke_contains_point(stroke: &Stroke, point: Point<f64>) -> bool {
    let mut crossings = 0u32;
    for cmd in stroke.commands() {
        match cmd {
            DrawCommand::LineTo { from, to } => {
                if edge_crosses_ray(*from, *to, point) {
                    crossings += 1;
                }
            }
            DrawCommand::Arc(arc) => {
                arc.for_each_flattened(TOLERANCE, &mut |seg: &LineSegment<f64>| {
                    if edge_crosses_ray(seg.from, seg.to, point) {
                        crossings += 1;
                    }
                });
            }
            DrawCommand::CubicBezier(cbs) => {
                let mut prev = cbs.from;
                for to in cbs.flattened(TOLERANCE) {
                    if edge_crosses_ray(prev, to, point) {
                        crossings += 1;
                    }
                    prev = to;
                }
            }
            DrawCommand::QuadraticBezier(qbs) => {
                let mut prev = qbs.from;
                for to in qbs.flattened(TOLERANCE) {
                    if edge_crosses_ray(prev, to, point) {
                        crossings += 1;
                    }
                    prev = to;
                }
            }
            DrawCommand::Comment(_) => {}
        }
    }
    if !stroke.is_closed() && edge_crosses_ray(stroke.end_point(), stroke.start_point(), point) {
        crossings += 1;
    }
    !crossings.is_multiple_of(2)
}

/// Partitions raw SVG subpaths into [`FillPolygon`]s — one per outer contour — with holes
/// assigned to their closest enclosing outer.
///
/// The SVG `fill-rule` is consumed here: for `EvenOdd`, nesting depth determines outer vs. hole
/// (even depth → outer); for `NonZero`, the cumulative signed winding of enclosing subpaths
/// determines it (zero cumulative winding before entering → outer).
pub(crate) fn into_fill_polygons(subpaths: Vec<Stroke>, fill_rule: FillRule) -> Vec<FillPolygon> {
    if subpaths.is_empty() {
        return vec![];
    }

    let areas: Vec<f64> = subpaths.iter().map(signed_area).collect();
    let starts: Vec<Point<f64>> = subpaths.iter().map(|s| s.start_point()).collect();

    // For each subpath, the indices of all other subpaths that contain its start point.
    let containers: Vec<Vec<usize>> = (0..subpaths.len())
        .map(|i| {
            (0..subpaths.len())
                .filter(|&j| j != i)
                .filter(|&j| stroke_contains_point(&subpaths[j], starts[i]))
                .collect()
        })
        .collect();

    // Classify each subpath as outer (contributes filled area) or hole (removes it).
    let mut is_outer = vec![false; subpaths.len()];
    let mut is_hole = vec![false; subpaths.len()];

    for i in 0..subpaths.len() {
        match fill_rule {
            FillRule::EvenOdd => {
                if containers[i].len().is_multiple_of(2) {
                    is_outer[i] = true;
                } else {
                    is_hole[i] = true;
                }
            }
            FillRule::NonZero => {
                let cumulative_winding: i32 = containers[i]
                    .iter()
                    .map(|&j| if areas[j] > 0.0 { 1i32 } else { -1i32 })
                    .sum();

                if cumulative_winding == 0 {
                    is_outer[i] = true;
                } else {
                    let winding_inside = cumulative_winding + if areas[i] > 0.0 { 1 } else { -1 };
                    if winding_inside == 0 {
                        is_hole[i] = true;
                    }
                }
            }
        }
    }

    // For each outer, collect its direct holes — holes for which this outer is the innermost
    // enclosing outer (no other outer sits between them).
    (0..subpaths.len())
        .filter(|&i| is_outer[i])
        .map(|i| {
            let holes = (0..subpaths.len())
                .filter(|&j| is_hole[j] && stroke_contains_point(&subpaths[i], starts[j]))
                .filter(|&j| {
                    // No other outer k is strictly between outer i and hole j.
                    !containers[j]
                        .iter()
                        .any(|&k| k != i && is_outer[k] && containers[k].contains(&i))
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
    use lyon_geom::Point;

    use super::*;
    use crate::turtle::elements::{DrawCommand, FillRule, Stroke};

    #[test]
    fn test_nonzero_nested_ccw() {
        // Subpath 0: CCW square (0,0) to (10,10)
        let s0 = Stroke::new(
            Point::new(0.0, 0.0),
            vec![
                DrawCommand::LineTo {
                    from: Point::new(0.0, 0.0),
                    to: Point::new(10.0, 0.0),
                },
                DrawCommand::LineTo {
                    from: Point::new(10.0, 0.0),
                    to: Point::new(10.0, 10.0),
                },
                DrawCommand::LineTo {
                    from: Point::new(10.0, 10.0),
                    to: Point::new(0.0, 10.0),
                },
                DrawCommand::LineTo {
                    from: Point::new(0.0, 10.0),
                    to: Point::new(0.0, 0.0),
                },
            ],
        );

        // Subpath 1: CCW square (2,2) to (8,8)
        let s1 = Stroke::new(
            Point::new(2.0, 2.0),
            vec![
                DrawCommand::LineTo {
                    from: Point::new(2.0, 2.0),
                    to: Point::new(8.0, 2.0),
                },
                DrawCommand::LineTo {
                    from: Point::new(8.0, 2.0),
                    to: Point::new(8.0, 8.0),
                },
                DrawCommand::LineTo {
                    from: Point::new(8.0, 8.0),
                    to: Point::new(2.0, 8.0),
                },
                DrawCommand::LineTo {
                    from: Point::new(2.0, 8.0),
                    to: Point::new(2.0, 2.0),
                },
            ],
        );

        // Subpath 2: CCW square (4,4) to (6,6)
        let s2 = Stroke::new(
            Point::new(4.0, 4.0),
            vec![
                DrawCommand::LineTo {
                    from: Point::new(4.0, 4.0),
                    to: Point::new(6.0, 4.0),
                },
                DrawCommand::LineTo {
                    from: Point::new(6.0, 4.0),
                    to: Point::new(6.0, 6.0),
                },
                DrawCommand::LineTo {
                    from: Point::new(6.0, 6.0),
                    to: Point::new(4.0, 6.0),
                },
                DrawCommand::LineTo {
                    from: Point::new(4.0, 6.0),
                    to: Point::new(4.0, 4.0),
                },
            ],
        );

        let polygons =
            into_fill_polygons(vec![s0.clone(), s1.clone(), s2.clone()], FillRule::NonZero);

        // For NonZero, since all are CCW, the winding numbers are 1, 2, and 3.
        // All are non-zero, so the whole area should be filled.
        // In terms of FillPolygon, it should be one outer (s0) with no holes.
        assert_eq!(polygons.len(), 1);
        assert_eq!(polygons[0].outer.start_point(), s0.start_point());
        assert_eq!(polygons[0].holes.len(), 0);
    }
}
