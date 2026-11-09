use std::{
    f64::consts,
    iter,
    ops::{AddAssign, Range},
};

use lyon_geom::{LineSegment, Point, Vector};
use rstar::{
    RTree, RTreeObject,
    primitives::{GeomWithData, ObjectRef},
};
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};

use super::intersect::{Intersections, PARAM_EPSILON};
use crate::turtle::elements::{DrawCommand, FillRule, PointLocation, Shape, Stroke};

/// Minimum padding beyond bounding box `max.x` for ray casting.
const RAY_PADDING: f64 = 10.0;

/// Irrational slope factor for ray casting to avoid hitting rational vertices horizontally.
const RAY_SLOPE: f64 = consts::E * 1e-4;

/// Distance tolerance for snapping endpoints into a single topological vertex.
const VERTEX_SNAP_EPSILON: f64 = 1e-7;
const VERTEX_SNAP_EPSILON_SQ: f64 = VERTEX_SNAP_EPSILON * VERTEX_SNAP_EPSILON;

/// Minimum absolute signed area for a boundary loop to be considered non-degenerate.
const MIN_LOOP_AREA: f64 = 1e-6;

/// Fraction of segment scale used to offset midpoint samples along the normal.
const SAMPLE_OFFSET_FRACTION: f64 = 0.05;
const MIN_SAMPLE_OFFSET: f64 = 1e-4;
const MAX_SAMPLE_OFFSET: f64 = 0.5;

/// Result of evaluating a point against one or more closed non-overlapping [`Stroke`]s.
#[derive(Default)]
struct PointRelation {
    /// Number of times a ray from the point crossed a closed stroke(s).
    crossings: usize,
    /// Signed winding number based on stroke direction relative to the ray.
    winding: i32,
    /// Whether the ray origin lies directly on a stroke boundary.
    on_boundary: bool,
}

impl AddAssign for PointRelation {
    fn add_assign(&mut self, rhs: Self) {
        self.crossings += rhs.crossings;
        self.winding += rhs.winding;
        self.on_boundary |= rhs.on_boundary;
    }
}

impl PointRelation {
    /// Classifies the point relative to the shape under the given [`FillRule`].
    const fn location(&self, rule: FillRule) -> PointLocation {
        if self.on_boundary {
            PointLocation::Boundary
        } else if self.is_filled(rule) {
            PointLocation::Interior
        } else {
            PointLocation::Exterior
        }
    }

    /// Whether the point is considered filled under the given [`FillRule`].
    const fn is_filled(&self, rule: FillRule) -> bool {
        match rule {
            FillRule::EvenOdd => !self.crossings.is_multiple_of(2),
            FillRule::NonZero => self.winding != 0,
        }
    }
}

impl Stroke {
    /// Signed area of a closed [`Stroke`] using Green's theorem.
    ///
    /// Negative = clockwise, Positive = counterclockwise.
    ///
    /// <https://en.wikipedia.org/wiki/Green%27s_theorem>
    fn signed_area(&self) -> f64 {
        self.commands().iter().map(DrawCommand::area).sum::<f64>()
    }

    /// Calculates the relationship with `point`, i.e. if point lies within stroke.
    ///
    /// If `max_x` is provided, the ray extends at least to `max_x + 10.0`.
    /// If `None`, `self.bounding_box().max.x` is used.
    ///
    /// <https://en.wikipedia.org/wiki/Point_in_polygon#Ray_casting_algorithm>
    fn point_relationship(&self, point: Point<f64>) -> PointRelation {
        let bbox = self.bounding_box().inflate(PARAM_EPSILON, PARAM_EPSILON);
        if bbox.max.x + PARAM_EPSILON < point.x || bbox.max.y + PARAM_EPSILON < point.y {
            return PointRelation::default();
        }

        let dx = (bbox.max.x - point.x + RAY_PADDING).max(RAY_PADDING);
        let dy = dx * RAY_SLOPE;
        if bbox.min.y - PARAM_EPSILON > point.y + dy {
            return PointRelation::default();
        }

        let ray_vec = Vector::new(dx, dy);
        let ray = LineSegment {
            from: point,
            to: point + ray_vec,
        };

        self.commands()
            .iter()
            .fold(PointRelation::default(), |mut acc, cmd| {
                for (t_cmd, u_ray) in cmd.intersections(&ray) {
                    if u_ray <= PARAM_EPSILON {
                        acc.on_boundary = true;
                    } else {
                        let curve_tangent = cmd.tangent(t_cmd);
                        acc.crossings += 1;
                        acc.winding += if ray_vec.cross(curve_tangent).is_sign_positive() {
                            1
                        } else {
                            -1
                        };
                    }
                }
                acc
            })
    }

    /// Checks if this stroke contains `point` under the given [`FillRule`].
    fn contains_point(&self, point: Point<f64>, rule: FillRule) -> PointLocation {
        self.point_relationship(point).location(rule)
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

        let cross = |a: Point<f64>, b: Point<f64>| -> f64 { a.to_vector().cross(b.to_vector()) };

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

    /// Whether this command is negligibly small.
    fn is_degenerate(&self) -> bool {
        let eps_sq = PARAM_EPSILON.powi(2);
        (self.end_point() - self.start_point()).square_length() <= eps_sq
    }

    /// Checks whether two commands are approximately equal within [`VERTEX_SNAP_EPSILON`].
    fn approx_eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::LineTo(l1), Self::LineTo(l2)) => {
                (l1.from - l2.from).square_length() < VERTEX_SNAP_EPSILON_SQ
                    && (l1.to - l2.to).square_length() < VERTEX_SNAP_EPSILON_SQ
            }
            (Self::QuadraticBezier(q1), Self::QuadraticBezier(q2)) => {
                (q1.from - q2.from).square_length() < VERTEX_SNAP_EPSILON_SQ
                    && (q1.to - q2.to).square_length() < VERTEX_SNAP_EPSILON_SQ
                    && (q1.ctrl - q2.ctrl).square_length() < VERTEX_SNAP_EPSILON_SQ
            }
            (Self::CubicBezier(c1), Self::CubicBezier(c2)) => {
                (c1.from - c2.from).square_length() < VERTEX_SNAP_EPSILON_SQ
                    && (c1.to - c2.to).square_length() < VERTEX_SNAP_EPSILON_SQ
                    && (c1.ctrl1 - c2.ctrl1).square_length() < VERTEX_SNAP_EPSILON_SQ
                    && (c1.ctrl2 - c2.ctrl2).square_length() < VERTEX_SNAP_EPSILON_SQ
            }
            (Self::Arc(a1), Self::Arc(a2)) => {
                (a1.from - a2.from).square_length() < VERTEX_SNAP_EPSILON_SQ
                    && (a1.to - a2.to).square_length() < VERTEX_SNAP_EPSILON_SQ
                    && a1.flags == a2.flags
                    && (a1.radii - a2.radii).square_length() < VERTEX_SNAP_EPSILON_SQ
                    && (a1.x_rotation.radians - a2.x_rotation.radians).abs() < VERTEX_SNAP_EPSILON
            }
            _ => false,
        }
    }
}

impl Shape {
    /// Classifies `point` relative to this filled shape under the given [`FillRule`].
    pub fn contains_point(&self, point: Point<f64>, rule: FillRule) -> PointLocation {
        match self.outer.contains_point(point, rule) {
            loc @ (PointLocation::Exterior | PointLocation::Boundary) => loc,
            PointLocation::Interior => {
                for hole in &self.holes {
                    match hole.contains_point(point, rule) {
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
    /// Ensures this stroke has counter-clockwise or counter-clockwise winding.
    fn normalize_direction(&mut self, ccw: bool) {
        let area = self.signed_area();
        if (ccw && area.is_sign_negative()) || (!ccw && area.is_sign_positive()) {
            self.reverse();
        }
    }

    /// Given two curves that are disjoint (strictly do not intersect), we can simply check
    /// their bounding box and an arbitrary point
    fn contains_disjoint(&self, rhs: &Stroke) -> bool {
        self.bounding_box().contains_box(&rhs.bounding_box())
            && self.contains_point(rhs.start_point(), FillRule::EvenOdd) == PointLocation::Interior
    }

    /// Checks if `self` encloses `rhs` given that the two curves
    /// are non-crossing (namely, their boundaries do not cross, though they may
    /// touch at vertices).
    fn contains_non_crossing(&self, rhs: &Stroke) -> bool {
        let sample_pt = rhs
            .commands()
            .first()
            .map_or_else(|| rhs.start_point(), |c| c.sample(0.5));

        self.contains_point(sample_pt, FillRule::EvenOdd) == PointLocation::Interior
    }

    /// Checks if `self` strictly contains `rhs`.
    pub fn contains(&self, rhs: &Stroke) -> bool {
        // If the two curves do not intersect, there are three possible scenarios:
        // 1. self strictly lies in rhs
        // 2. rhs strictly lies in self
        // 3. self and rhs are strictly disjoint
        //
        // For (2) to be true:
        // - self and rhs have no intersections
        // - a point in rhs lies in self

        // Fast check first
        self.contains_disjoint(rhs)
            && self
                .commands()
                .iter()
                .flat_map(|cmd_self| {
                    rhs.commands()
                        .iter()
                        .map(move |cmd_rhs| (cmd_self, cmd_rhs))
                })
                .all(|(cmd_self, cmd_rhs)| cmd_self.intersections(cmd_rhs).is_empty())
    }
}

/// Queries the crossing count and winding number at `point` relative to `strokes`.
fn query_point(strokes: &[Stroke], point: Point<f64>) -> PointRelation {
    strokes
        .iter()
        .fold(PointRelation::default(), |mut total, stroke| {
            total += stroke.point_relationship(point);
            total
        })
}

/// A directed edge connecting two topological vertices in the planar boundary arrangement.
struct DirectedEdge {
    from: usize,
    to: usize,
    command: DrawCommand,
    tan_from: Vector<f64>,
    tan_to: Vector<f64>,
}

/// Raw input to [`strokes_to_shapes`].
struct InputStrokes<'a> {
    strokes: &'a [Stroke],
    fill_rule: FillRule,
}

impl<'a> InputStrokes<'a> {
    fn new(strokes: &'a [Stroke], fill_rule: FillRule) -> Option<Self> {
        if strokes.is_empty() {
            None
        } else {
            Some(Self { strokes, fill_rule })
        }
    }

    /// Attempts the fast path when all strokes are disjoint.
    fn try_fast_path(&self) -> Option<Vec<Shape>> {
        if self.has_intersections() {
            None
        } else {
            Some(self.to_nested_shapes())
        }
    }

    /// If there are no intersections (aside from segments touching), the fast path is valid.
    fn has_intersections(&self) -> bool {
        let commands: Vec<(&DrawCommand, usize, usize, usize)> = self
            .strokes
            .iter()
            .enumerate()
            .flat_map(|(s_idx, stroke)| {
                let s_len = stroke.commands().len();
                stroke
                    .commands()
                    .iter()
                    .enumerate()
                    .map(move |(c_idx, cmd)| (cmd, s_idx, c_idx, s_len))
            })
            .collect();

        if commands.len() < 2 {
            return false;
        }

        let tree = RTree::bulk_load(
            commands
                .iter()
                .map(|&(cmd, s_idx, c_idx, s_len)| {
                    GeomWithData::new(ObjectRef::new(cmd), (s_idx, c_idx, s_len))
                })
                .collect(),
        );

        for &(cmd_i, s_i, c_i, n_i) in &commands {
            for entry in tree.locate_in_envelope_intersecting(cmd_i.envelope()) {
                let (s_j, c_j, _) = entry.data;
                if (s_j, c_j) <= (s_i, c_i) {
                    continue;
                }

                let cmd_j: &DrawCommand = entry.geom();
                if s_i == s_j {
                    let intersections = cmd_i.intersections(cmd_j);
                    if intersections.is_empty() {
                        continue;
                    }

                    let forward_adjacent = c_i + 1 == c_j;
                    let reverse_adjacent = c_i == 0 && c_j + 1 == n_i;

                    for (t, u) in intersections {
                        let at_end1_start2 = (t - 1.0).abs() <= PARAM_EPSILON && u <= PARAM_EPSILON;
                        let at_start1_end2 = t <= PARAM_EPSILON && (u - 1.0).abs() <= PARAM_EPSILON;

                        let is_valid_touch = (forward_adjacent && at_end1_start2)
                            || (reverse_adjacent && at_start1_end2);
                        if !is_valid_touch {
                            return true;
                        }
                    }
                } else if !cmd_i.intersections(cmd_j).is_empty() {
                    return true;
                }
            }
        }

        false
    }

    /// Assuming there are no intersections, arranges the strokes down into shapes.
    fn to_nested_shapes(&self) -> Vec<Shape> {
        if let [outer] = &self.strokes {
            let mut outer = outer.clone();
            outer.normalize_direction(true);
            return vec![Shape {
                outer,
                holes: vec![],
            }];
        }

        let stroke_areas: Vec<f64> = self.strokes.iter().map(Stroke::signed_area).collect();

        let stroke_tree = RTree::bulk_load(
            self.strokes
                .iter()
                .zip(&stroke_areas)
                .enumerate()
                .map(|(idx, (stroke, area))| {
                    GeomWithData::new(ObjectRef::new(stroke), (idx, area.abs()))
                })
                .collect(),
        );

        // Because the curves are disjoint, the parent of `i` is the container with the least area.
        let parents: Vec<Option<usize>> = self
            .strokes
            .iter()
            .zip(&stroke_areas)
            .enumerate()
            .map(|(i, (sub_i, area_i))| {
                let abs_area_i = area_i.abs();

                stroke_tree
                    .locate_in_envelope_intersecting(sub_i.envelope())
                    .filter(|entry| {
                        let (j, abs_area_j) = entry.data;
                        j != i && abs_area_j > abs_area_i && entry.geom().contains_disjoint(sub_i)
                    })
                    .min_by(|a, b| a.data.1.total_cmp(&b.data.1))
                    .map(|entry| entry.data.0)
            })
            .collect();
        drop(stroke_tree);

        #[derive(Copy, Clone, PartialEq, Eq)]
        enum Role {
            Outer,
            Hole,
            Discarded,
        }

        let roles: Vec<Role> = match self.fill_rule {
            FillRule::EvenOdd => parents
                .iter()
                .map(|&parent_i| {
                    let depth =
                        iter::successors(parent_i, |&i| parents.get(i).copied().flatten()).count();
                    if depth.is_multiple_of(2) {
                        Role::Outer
                    } else {
                        Role::Hole
                    }
                })
                .collect(),
            FillRule::NonZero => stroke_areas
                .iter()
                .zip(parents.iter())
                .map(|(&area, &p_i)| {
                    let cumulative_winding =
                        iter::successors(p_i, |&i| parents.get(i).copied().flatten())
                            .map(|i| {
                                if let Some(&area) = stroke_areas.get(i) {
                                    if area.is_sign_positive() { 1 } else { -1 }
                                } else {
                                    0
                                }
                            })
                            .sum::<isize>();
                    let winding_inside =
                        cumulative_winding + if area.is_sign_positive() { 1 } else { -1 };

                    match (cumulative_winding, winding_inside) {
                        (0, _) => Role::Outer,
                        (_, 0) => Role::Hole,
                        _ => Role::Discarded,
                    }
                })
                .collect(),
        };
        drop(stroke_areas);

        // Build the top-down tree
        let mut children: Vec<Vec<usize>> = vec![Vec::new(); self.strokes.len()];
        for (i, p) in parents.iter().enumerate() {
            if let Some(p_idx) = *p
                && let Some(p_children) = children.get_mut(p_idx)
            {
                p_children.push(i);
            }
        }

        // Sort to output pre-order DFS.
        let mut ordered_outers = Vec::with_capacity(self.strokes.len());
        {
            let mut dfs_stack: Vec<usize> = parents
                .iter()
                .enumerate()
                .filter_map(|(i, p)| p.is_none().then_some(i))
                .collect();
            dfs_stack.reverse();

            while let Some(node) = dfs_stack.pop() {
                if roles.get(node).copied() == Some(Role::Outer) {
                    ordered_outers.push(node);
                }
                if let Some(node_children) = children.get(node) {
                    dfs_stack.extend(node_children.iter().rev().copied());
                }
            }
        }
        drop(parents);

        ordered_outers
            .into_iter()
            .filter_map(|i| self.strokes.get(i).map(|s| (i, s)))
            .map(|(i, sub_i)| {
                let mut outer = sub_i.clone();
                outer.normalize_direction(true);

                // Get the direct holes for this outer (e.g. not the hole in a nested donut).
                let mut hole_indices = Vec::new();
                {
                    let mut stack = children.get(i).cloned().unwrap_or_default();
                    while let Some(child_idx) = stack.pop() {
                        match roles.get(child_idx) {
                            Some(Role::Hole) => hole_indices.push(child_idx),
                            Some(Role::Discarded) => {
                                if let Some(grand_children) = children.get(child_idx) {
                                    stack.extend(grand_children);
                                }
                            }
                            Some(Role::Outer) | None => {}
                        }
                    }
                }
                hole_indices.sort_unstable();

                let holes = hole_indices
                    .into_iter()
                    .filter_map(|j| self.strokes.get(j))
                    .cloned()
                    .map(|mut sub_j| {
                        sub_j.normalize_direction(false);
                        sub_j
                    })
                    .collect();

                Shape { outer, holes }
            })
            .collect()
    }

    /// Subdivides all commands at non-endpoint intersections into [`SubdividedSegments::segments`].
    fn subdivide_intersections(self) -> SubdividedSegments<'a> {
        let commands: Vec<DrawCommand> = self
            .strokes
            .iter()
            .flat_map(|s| s.commands().iter().copied())
            .collect();

        let mut splits_by_t: Vec<SmallVec<[f64; 2]>> = vec![smallvec![0.0, 1.0]; commands.len()];

        let tree = RTree::bulk_load(
            commands
                .iter()
                .enumerate()
                .map(|(idx, cmd)| GeomWithData::new(ObjectRef::new(cmd), idx))
                .collect(),
        );

        for (i, cmd_i) in commands.iter().enumerate() {
            for entry in tree.locate_in_envelope_intersecting(cmd_i.envelope()) {
                let j = entry.data;
                if j > i {
                    let cmd_j: &DrawCommand = entry.geom();
                    for (t_i, t_j) in cmd_i.intersections(cmd_j) {
                        const NON_ENDPOINT: Range<f64> = PARAM_EPSILON..(1.0 - PARAM_EPSILON);
                        if NON_ENDPOINT.contains(&t_i)
                            && let Some(s) = splits_by_t.get_mut(i)
                        {
                            s.push(t_i);
                        }
                        if NON_ENDPOINT.contains(&t_j)
                            && let Some(s) = splits_by_t.get_mut(j)
                        {
                            s.push(t_j);
                        }
                    }
                }
            }
        }
        drop(tree);

        let mut segments = Vec::new();
        for (cmd, mut ts) in commands.into_iter().zip(splits_by_t) {
            ts.sort_unstable_by(f64::total_cmp);
            ts.dedup_by(|a, b| (*a - *b).abs() < PARAM_EPSILON);

            segments.extend(ts.iter().zip(ts.iter().skip(1)).filter_map(|(&t_a, &t_b)| {
                let sub = cmd.split_range(t_a..t_b);
                // TODO: is this check overkill?
                (!sub.is_degenerate()).then_some(sub)
            }));
        }

        SubdividedSegments {
            input_strokes: self.strokes,
            fill_rule: self.fill_rule,
            segments,
        }
    }
}

/// Strokes subdivided into segments at any non-endpoint intersections.
struct SubdividedSegments<'a> {
    input_strokes: &'a [Stroke],
    fill_rule: FillRule,
    segments: Vec<DrawCommand>,
}

impl SubdividedSegments<'_> {
    /// Builds a directed graph of boundary edges from the given subdivided segments.
    ///
    /// A segment is included in the graph if it is a boundary (namely if one side is filled, the other is not),
    /// and normalized to be CCW (facing the direction of the curve, the left side will be filled).
    ///
    /// If two segments overlap, they overlap completely by way of [InputStrokes::subdivide_intersections] and the duplicate is skipped.
    fn build_boundary_graph(self) -> BoundaryGraph {
        let mut vertex_tree: RTree<GeomWithData<[f64; 2], usize>> = RTree::new();
        let mut edges: Vec<DirectedEdge> = Vec::new();
        let mut adjacency_map: FxHashMap<usize, Vec<usize>> = FxHashMap::default();

        let mut snap_vertex = |point: Point<f64>| {
            let pt = [point.x, point.y];
            if let Some(entry) = vertex_tree
                .locate_within_distance(pt, VERTEX_SNAP_EPSILON_SQ)
                .next()
            {
                entry.data
            } else {
                let idx = vertex_tree.size();
                vertex_tree.insert(GeomWithData::new(pt, idx));
                idx
            }
        };

        for mut segment in self.segments {
            let start = segment.start_point();
            let end = segment.end_point();
            let midpoint = segment.sample(0.5);

            // Skip segments too small to even work with.
            if (end - start).square_length() < VERTEX_SNAP_EPSILON_SQ
                && (midpoint - start).square_length() < VERTEX_SNAP_EPSILON_SQ
            {
                continue;
            }

            // Sample a point on either side of the segment to classify it.
            let normal = segment.normal(0.5);
            let bbox = segment.bounding_box();
            let seg_scale = bbox.width().max(bbox.height());
            let eps =
                (seg_scale * SAMPLE_OFFSET_FRACTION).clamp(MIN_SAMPLE_OFFSET, MAX_SAMPLE_OFFSET);

            // Consider a line segment l. The line segment k through p_left and p_right
            // has length 2*eps, is perpendicular to l, and passes through the midpoint of l.
            let p_left = midpoint + normal * eps;
            let p_right = midpoint - normal * eps;

            let left_query = query_point(self.input_strokes, p_left);
            let right_query = query_point(self.input_strokes, p_right);

            let left_filled = left_query.is_filled(self.fill_rule);
            let right_filled = right_query.is_filled(self.fill_rule);

            // Not a boundary, fully within or fully outside the filled region.
            if left_filled == right_filled {
                continue;
            }

            // Reversing the segment normalizes the following logic for CCW orientation.
            // After this, left will always be filled.
            if !left_filled && right_filled {
                segment.reverse();
            }
            let from = snap_vertex(segment.start_point());
            let to = snap_vertex(segment.end_point());

            // The act of snapping could create a degenerate segment.
            if from == to && (midpoint - start).square_length() <= VERTEX_SNAP_EPSILON_SQ {
                continue;
            }

            // If two strokes shared any part of an edge, it may already exist as a segment.
            let already_exists = adjacency_map
                .get(&from)
                .into_iter()
                .flatten()
                .filter_map(|&edge_idx| edges.get(edge_idx))
                .any(|e| e.from == from && e.to == to && e.command.approx_eq(&segment));

            if already_exists {
                continue;
            }

            let edge_idx = edges.len();
            edges.push(DirectedEdge {
                from,
                to,
                command: segment,
                tan_from: segment.tangent(0.0),
                tan_to: segment.tangent(1.0),
            });
            adjacency_map.entry(from).or_default().push(edge_idx);
        }

        BoundaryGraph {
            edges,
            adjacency_map,
        }
    }
}

/// Boundary segments (edges) in a directed graph.
struct BoundaryGraph {
    edges: Vec<DirectedEdge>,
    adjacency_map: FxHashMap<usize, Vec<usize>>,
}

impl BoundaryGraph {
    /// Walks the forest of edges to build closed [`Stroke`] loops.
    ///
    /// Starting from some edge, we compare the tangent vectors at joints to find the
    /// next unvisited edge that continues the loop as sharply right as possible.
    /// Every segment is a boundary segment, so this will build a bunch of loops.
    fn extract_boundary_loops(self) -> BoundaryLoops {
        let mut visited = vec![false; self.edges.len()];
        let mut loops = Vec::new();

        for (start_edge_idx, start_edge) in self.edges.iter().enumerate() {
            if visited.get(start_edge_idx).copied() == Some(true) {
                continue;
            }
            let start_vertex = start_edge.from;

            let mut current_edge_idx = start_edge_idx;
            let mut loop_cmds = Vec::new();

            loop {
                if let Some(v) = visited.get_mut(current_edge_idx) {
                    *v = true;
                }
                let Some(current_edge) = self.edges.get(current_edge_idx) else {
                    break;
                };
                loop_cmds.push(current_edge.command);
                let next_vertex = current_edge.to;

                if next_vertex == start_vertex {
                    let start_point = loop_cmds
                        .first()
                        .map_or(Point::zero(), DrawCommand::start_point);
                    loops.push(Stroke::new(start_point, loop_cmds, None));
                    break;
                }

                let tan_to = current_edge.tan_to;
                let outgoing_candidates = self.adjacency_map.get(&next_vertex);

                // Find the unvisited outgoing edge with the tightest rightward turn
                let best_next = outgoing_candidates
                    .into_iter()
                    .flatten()
                    .copied()
                    .filter(|&next_idx| visited.get(next_idx).copied() != Some(true))
                    .filter_map(|next_idx| {
                        let tan_from = self.edges.get(next_idx)?.tan_from;
                        let angle = tan_to.angle_to(tan_from).radians;
                        Some((angle, next_idx))
                    })
                    .min_by(|(angle_a, _), (angle_b, _)| angle_a.total_cmp(angle_b))
                    .map(|(_, next_idx)| next_idx);

                match best_next {
                    Some(next_idx) => {
                        current_edge_idx = next_idx;
                    }
                    None => {
                        break;
                    }
                }
            }
        }

        BoundaryLoops::new(loops)
    }
}

/// Closed, non-crossing boundary loops partitioned into outers and holes.
struct BoundaryLoops {
    outers: Vec<(Stroke, f64)>,
    holes: Vec<(Stroke, f64)>,
}

impl BoundaryLoops {
    /// Partitions boundary loops into outers (positive area) and holes (negative area),
    /// discarding any loops smaller than [`MIN_LOOP_AREA`].
    fn new(loops: Vec<Stroke>) -> Self {
        let (outers, holes): (Vec<_>, Vec<_>) = loops
            .into_iter()
            .map(|stroke| {
                let area = stroke.signed_area();
                (stroke, area)
            })
            .filter(|(_, area)| area.abs() >= MIN_LOOP_AREA)
            .partition(|(_, area)| area.is_sign_positive());

        Self { outers, holes }
    }

    /// Classifies holes into their parent outers, then builds [`Shape`]s from them.
    fn into_shapes(self) -> Vec<Shape> {
        if self.holes.is_empty() || self.outers.is_empty() {
            return self
                .outers
                .into_iter()
                .map(|(outer, _)| Shape {
                    outer,
                    holes: Vec::new(),
                })
                .collect();
        }

        let outer_tree = RTree::bulk_load(
            self.outers
                .iter()
                .enumerate()
                .map(|(idx, (outer, area))| GeomWithData::new(ObjectRef::new(outer), (idx, *area)))
                .collect(),
        );

        let mut holes_by_outer: Vec<Vec<Stroke>> = vec![Vec::new(); self.outers.len()];

        for (hole, hole_area) in self.holes {
            let hole_area_abs = hole_area.abs();

            let containing_outer = outer_tree
                .locate_in_envelope_intersecting(hole.envelope())
                .filter(|entry| {
                    let (_, outer_area) = entry.data;
                    outer_area >= hole_area_abs && entry.geom().contains_non_crossing(&hole)
                })
                .min_by(|a, b| a.data.1.total_cmp(&b.data.1));

            if let Some(entry) = containing_outer
                && let Some(holes) = holes_by_outer.get_mut(entry.data.0)
            {
                holes.push(hole);
            }
        }
        drop(outer_tree);

        self.outers
            .into_iter()
            .zip(holes_by_outer)
            .map(|((outer, _), holes)| Shape { outer, holes })
            .collect()
    }
}

/// Simplifies closed paths into [`Shape`]s.
pub fn strokes_to_shapes(closed_paths: &[Stroke], fill_rule: FillRule) -> Vec<Shape> {
    let Some(input) = InputStrokes::new(closed_paths, fill_rule) else {
        return vec![];
    };

    if let Some(shapes) = input.try_fast_path() {
        return shapes;
    }

    // Staged native curve planar arrangement pipeline for intersecting geometry.
    input
        .subdivide_intersections()
        .build_boundary_graph()
        .extract_boundary_loops()
        .into_shapes()
}

#[cfg(test)]
mod tests {
    use std::slice;

    use lyon_geom::{
        Angle, ArcFlags, CubicBezierSegment, LineSegment, Point, QuadraticBezierSegment, SvgArc,
        Vector,
    };

    use super::*;
    use crate::turtle::elements::{DrawCommand, FillRule, Stroke};

    /// Helper to construct a closed polygonal stroke from 2D points.
    fn poly_stroke(pts: &[(f64, f64)]) -> Stroke {
        let first = pts
            .first()
            .copied()
            .map_or_default(|(x, y)| Point::new(x, y));

        let commands = pts
            .iter()
            .zip(pts.iter().cycle().skip(1))
            .take(pts.len())
            .map(|(&(x1, y1), &(x2, y2))| {
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(x1, y1),
                    to: Point::new(x2, y2),
                })
            })
            .collect();
        Stroke::new(first, commands, None)
    }

    /// Helper for a CCW axis-aligned rectangle.
    fn rect(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Stroke {
        poly_stroke(&[
            (min_x, min_y),
            (max_x, min_y),
            (max_x, max_y),
            (min_x, max_y),
        ])
    }

    /// Helper for a CCW axis-aligned square.
    fn square(min: f64, max: f64) -> Stroke {
        rect(min, min, max, max)
    }

    /// Helper for a circular stroke centered at origin.
    fn circle_stroke(r: f64) -> Stroke {
        let top_arc = SvgArc {
            from: Point::new(r, 0.0),
            to: Point::new(-r, 0.0),
            radii: Vector::new(r, r),
            x_rotation: Angle::zero(),
            flags: ArcFlags {
                large_arc: false,
                sweep: true,
            },
        };
        let bottom_arc = SvgArc {
            from: Point::new(-r, 0.0),
            to: Point::new(r, 0.0),
            radii: Vector::new(r, r),
            x_rotation: Angle::zero(),
            flags: ArcFlags {
                large_arc: false,
                sweep: true,
            },
        };
        Stroke::new(
            Point::new(r, 0.0),
            vec![DrawCommand::Arc(top_arc), DrawCommand::Arc(bottom_arc)],
            None,
        )
    }

    #[test]
    fn test_nonzero_nested_ccw() {
        let s0 = square(0.0, 10.0);
        let s1 = square(2.0, 8.0);
        let s2 = square(4.0, 6.0);

        let shapes = strokes_to_shapes(&[s0.clone(), s1, s2], FillRule::NonZero);

        // For NonZero, since all are CCW, the winding numbers are 1, 2, and 3.
        // All are non-zero, so the whole area should be filled.
        // In terms of Shape, it should be one outer (s0) with no holes.
        assert_eq!(shapes.len(), 1);
        let first = shapes.first().unwrap();
        assert_eq!(first.outer.start_point(), s0.start_point());
        assert_eq!(first.holes.len(), 0);
    }

    #[test]
    fn test_nonzero_overlapping_not_nested() {
        let s0 = square(0.0, 10.0);
        let s1 = square(5.0, 15.0);

        let shapes = strokes_to_shapes(&[s0, s1], FillRule::NonZero);

        // Overlapping strokes under NonZero are unified into 1 outer contour (geometric union)
        assert_eq!(shapes.len(), 1);
        let first = shapes.first().unwrap();
        assert_eq!(first.holes.len(), 0);
        assert!((first.outer.signed_area() - 175.0).abs() < 1e-4);
    }

    /// Pentagram (5-pointed star) drawn as a single self-intersecting M…Z stroke
    ///
    /// The path visits the five outer tips in "skip-one" order, crossing itself five times
    /// and enclosing an inner pentagon whose fill depends on the fill rule:
    ///
    ///  - `EvenOdd`: hole in the center
    ///  - `NonZero`: filled
    #[test]
    fn test_self_intersecting_pentagram() {
        let star = poly_stroke(&[
            (110.0, 45.0),
            (162.0, 195.0),
            (24.0, 100.0),
            (196.0, 100.0),
            (58.0, 195.0),
        ]);

        let evenodd = strokes_to_shapes(slice::from_ref(&star), FillRule::EvenOdd);
        assert_eq!(evenodd.len(), 1, "EvenOdd: expected one outer contour");
        assert_eq!(
            evenodd.first().map(|s| s.holes.len()),
            Some(1),
            "EvenOdd: expected one hole (the inner pentagon)"
        );

        let nonzero = strokes_to_shapes(&[star], FillRule::NonZero);
        assert_eq!(nonzero.len(), 1, "NonZero: expected one outer contour");
        assert_eq!(
            nonzero.first().map(|s| s.holes.len()),
            Some(0),
            "NonZero: expected no holes (inner pentagon is filled)"
        );
    }

    #[test]
    fn test_contains_point_circle_tangency() {
        let circle = circle_stroke(5.0);

        assert_eq!(
            circle.contains_point(Point::new(0.0, 0.0), FillRule::EvenOdd),
            PointLocation::Interior
        );
        assert_eq!(
            circle.contains_point(Point::new(0.0, 2.0), FillRule::EvenOdd),
            PointLocation::Interior
        );
        assert_eq!(
            circle.contains_point(Point::new(10.0, 0.0), FillRule::EvenOdd),
            PointLocation::Exterior
        );
        assert_eq!(
            circle.contains_point(Point::new(-10.0, 0.0), FillRule::EvenOdd),
            PointLocation::Exterior
        );
        // Point at same height as top apex (y = 5.0), but to the left (x = -8.0):
        // Horizontal ray along y = 5.0 touches the top of the circle tangentially.
        // It must not count as a crossing, so the point must be classified as OUTSIDE.
        assert_eq!(
            circle.contains_point(Point::new(-8.0, 5.0), FillRule::EvenOdd),
            PointLocation::Exterior
        );
    }

    #[test]
    fn test_stroke_contains_stroke_catches_bulging_curves() {
        let outer = square(0.0, 10.0);
        let inner_nested = square(2.0, 8.0);
        assert!(outer.contains(&inner_nested));

        let inner_bulging = Stroke::new(
            Point::new(2.0, 5.0),
            vec![
                DrawCommand::CubicBezier(CubicBezierSegment {
                    from: Point::new(2.0, 5.0),
                    ctrl1: Point::new(3.0, 15.0),
                    ctrl2: Point::new(7.0, 15.0),
                    to: Point::new(8.0, 5.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(8.0, 5.0),
                    to: Point::new(2.0, 5.0),
                }),
            ],
            None,
        );
        assert!(!outer.contains(&inner_bulging));
    }

    #[test]
    fn test_contains_point_polygon_and_bezier() {
        let r = square(0.0, 10.0);

        assert_eq!(
            r.contains_point(Point::new(5.0, 5.0), FillRule::EvenOdd),
            PointLocation::Interior
        );
        assert_eq!(
            r.contains_point(Point::new(-5.0, 5.0), FillRule::EvenOdd),
            PointLocation::Exterior
        );
        assert_eq!(
            r.contains_point(Point::new(15.0, 5.0), FillRule::EvenOdd),
            PointLocation::Exterior
        );
        assert_eq!(
            r.contains_point(Point::new(5.0, -5.0), FillRule::EvenOdd),
            PointLocation::Exterior
        );
        assert_eq!(
            r.contains_point(Point::new(5.0, 15.0), FillRule::EvenOdd),
            PointLocation::Exterior
        );
        assert_eq!(
            r.contains_point(Point::new(-2.0, 0.0), FillRule::EvenOdd),
            PointLocation::Exterior
        );
        assert_eq!(
            r.contains_point(Point::new(0.0, 5.0), FillRule::EvenOdd),
            PointLocation::Boundary
        );
        assert_eq!(
            r.contains_point(Point::new(10.0, 5.0), FillRule::EvenOdd),
            PointLocation::Boundary
        );
        assert_eq!(
            r.contains_point(Point::new(5.0, 0.0), FillRule::EvenOdd),
            PointLocation::Boundary
        );
        assert_eq!(
            r.contains_point(Point::new(5.0, 10.0), FillRule::EvenOdd),
            PointLocation::Boundary
        );

        let arch = Stroke::new(
            Point::new(0.0, 0.0),
            vec![
                DrawCommand::QuadraticBezier(QuadraticBezierSegment {
                    from: Point::new(0.0, 0.0),
                    ctrl: Point::new(5.0, 10.0),
                    to: Point::new(10.0, 0.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: Point::new(10.0, 0.0),
                    to: Point::new(0.0, 0.0),
                }),
            ],
            None,
        );

        assert_eq!(
            arch.contains_point(Point::new(5.0, 2.0), FillRule::EvenOdd),
            PointLocation::Interior
        );
        assert_eq!(
            arch.contains_point(Point::new(5.0, 8.0), FillRule::EvenOdd),
            PointLocation::Exterior
        );
        assert_eq!(
            arch.contains_point(Point::new(-1.0, 2.0), FillRule::EvenOdd),
            PointLocation::Exterior
        );
        assert_eq!(
            arch.contains_point(Point::new(5.0, 0.0), FillRule::EvenOdd),
            PointLocation::Boundary
        );
    }

    #[test]
    fn test_contains_point_with_rule() {
        // An hourglass / bow-tie stroke: (0,0) -> (10,10) -> (0,10) -> (10,0) -> (0,0)
        let hourglass = poly_stroke(&[(0.0, 0.0), (10.0, 10.0), (0.0, 10.0), (10.0, 0.0)]);

        let pt_top = Point::new(5.0, 8.0);
        let hit_top = hourglass.point_relationship(pt_top);
        assert!(!hit_top.on_boundary);
        assert_eq!(
            hourglass.contains_point(pt_top, FillRule::EvenOdd),
            PointLocation::Interior
        );
        assert_eq!(
            hourglass.contains_point(pt_top, FillRule::NonZero),
            PointLocation::Interior
        );

        let pt_out = Point::new(15.0, 5.0);
        assert_eq!(
            hourglass.contains_point(pt_out, FillRule::EvenOdd),
            PointLocation::Exterior
        );
        assert_eq!(
            hourglass.contains_point(pt_out, FillRule::NonZero),
            PointLocation::Exterior
        );
    }

    #[test]
    fn test_fast_path_donut_evenodd() {
        let outer = square(0.0, 10.0);
        let inner = square(2.0, 8.0);

        let strokes = [outer, inner];
        let input = InputStrokes::new(&strokes, FillRule::EvenOdd).unwrap();
        assert!(!input.has_intersections());

        let shapes = input.try_fast_path().expect("fast path should succeed");
        assert_eq!(shapes.len(), 1);
        let first = shapes.first().unwrap();
        assert_eq!(first.holes.len(), 1);
        assert!(first.outer.signed_area() > 0.0);
        assert!(first.holes.first().unwrap().signed_area() < 0.0);
    }

    #[test]
    fn test_fast_path_disjoint_strokes() {
        let s0 = square(0.0, 10.0);
        let s1 = square(20.0, 30.0);

        let strokes = [s0, s1];
        let input = InputStrokes::new(&strokes, FillRule::NonZero).unwrap();
        assert!(!input.has_intersections());

        let shapes = input.try_fast_path().expect("fast path should succeed");
        assert_eq!(shapes.len(), 2);
        assert_eq!(shapes.first().unwrap().holes.len(), 0);
        assert_eq!(shapes.get(1).unwrap().holes.len(), 0);
    }

    #[test]
    fn test_inner_island_does_not_steal_enclosing_hole() {
        let outer = square(0.0, 100.0);
        let mut hole = square(10.0, 90.0);
        hole.reverse();
        let island = square(40.0, 60.0);

        // Verify BoundaryLoops::into_shapes assigns the hole to the large outer, not the small island
        let shapes = BoundaryLoops::new(vec![outer, hole, island]).into_shapes();

        assert_eq!(shapes.len(), 2);
        // Preserves loop extraction order: first is large outer (0..100), second is island (40..60)
        assert_eq!(shapes.first().map(|s| s.holes.len()), Some(1));
        assert_eq!(shapes.get(1).map(|s| s.holes.len()), Some(0));
    }

    #[test]
    fn test_fast_path_dfs_preorder_traversal() {
        // Outer A (0..100), Hole A (10..90), Island A (40..60)
        let outer_a = square(0.0, 100.0);
        let hole_a = square(10.0, 90.0);
        let island_a = square(40.0, 60.0);
        // Separate Outer B (200..300)
        let outer_b = square(200.0, 300.0);

        // Intentionally provide strokes in interleaved order: Outer A, Outer B, Hole A, Island A
        let strokes = [outer_a, outer_b, hole_a, island_a];
        let input = InputStrokes::new(&strokes, FillRule::EvenOdd).unwrap();
        let shapes = input.try_fast_path().expect("fast path succeeds");

        assert_eq!(shapes.len(), 3);
        // Top-down Pre-order DFS: Outer A (0..100) -> its child Island A (40..60) -> Outer B (200..300)
        let first = shapes.first().unwrap();
        assert_eq!(first.outer.bounding_box().min, Point::new(0.0, 0.0));
        assert_eq!(first.holes.len(), 1);

        let second = shapes.get(1).unwrap();
        assert_eq!(second.outer.bounding_box().min, Point::new(40.0, 40.0));
        assert_eq!(second.holes.len(), 0);

        let third = shapes.get(2).unwrap();
        assert_eq!(third.outer.bounding_box().min, Point::new(200.0, 200.0));
        assert_eq!(third.holes.len(), 0);
    }
}
