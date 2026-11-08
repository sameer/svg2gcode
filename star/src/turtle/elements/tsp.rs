//! Solves the TSP on a graph where each [`Stroke`] is a node.
//!
//! Nodes have a start and an end which differ for distance calculations and can be reversed.
//!
//! The triangle inequality still holds (AFAICT) because it's geometric.

use std::ops::RangeInclusive;

use log::debug;
use lyon_geom::{LineSegment, Point, point};
use rand::{
    RngExt,
    distr::{Distribution, StandardUniform},
};
use rstar::{RTree, primitives::GeomWithData};
use rustc_hash::{FxBuildHasher, FxHashSet as HashSet};

use crate::turtle::elements::Stroke;

/// Minimizes total tool-off travel distance by reordering and reversing strokes.
///
/// Based off of the code in raster2svg.
///
/// <https://github.com/sameer/raster2svg>
/// <https://www.mdpi.com/2076-3417/9/19/3985/pdf>
pub fn minimize_travel_time(strokes: Vec<Stroke>, starting_point: [Option<f64>; 2]) -> Vec<Stroke> {
    if strokes.len() <= 1 {
        return strokes;
    }

    let [Some(x), Some(y)] = starting_point else {
        return strokes;
    };
    let starting_point = point(x, y);

    let endpoints: Vec<(Point<f64>, Point<f64>)> = strokes
        .iter()
        .map(|s| (s.start_point(), s.end_point()))
        .collect();

    let endpoint_tree = StrokeEndpointData::new_tree(&endpoints);
    let mut tour = Tour::new_greedy_nearest_neighbor(&endpoints, &endpoint_tree, starting_point);
    let candidate_neighbors = StrokeNeighbors::k_nearest_neighbors(&endpoints, &endpoint_tree);
    drop(endpoint_tree);

    tour.disentangle_crossings();
    tour.local_improvement(&candidate_neighbors, starting_point);
    tour.disentangle_crossings();

    tour.into_strokes(strokes)
}

#[inline]
fn dist(a: Point<f64>, b: Point<f64>) -> f64 {
    (b - a).length()
}

/// Representation of a node in the TSP graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Node {
    stroke_index: usize,
    /// Whether the direction of this stroke is reversed in the tour.
    reversed: bool,
}

impl Node {
    fn normalized_start_point(&self, endpoints: &[(Point<f64>, Point<f64>)]) -> Option<Point<f64>> {
        let &(start, end) = endpoints.get(self.stroke_index)?;
        Some(if self.reversed { end } else { start })
    }

    fn normalized_end_point(&self, endpoints: &[(Point<f64>, Point<f64>)]) -> Option<Point<f64>> {
        let &(start, end) = endpoints.get(self.stroke_index)?;
        Some(if self.reversed { start } else { end })
    }
}

/// Uniquely identifies a point in the `stroke_endpoints` array.
struct StrokeEndpointData {
    stroke_index: usize,
    end_point: bool,
}

impl StrokeEndpointData {
    /// Constructs an R-tree out of stroke start/end pairs.
    fn new_tree(
        stroke_endpoints: &[(Point<f64>, Point<f64>)],
    ) -> RTree<GeomWithData<[f64; 2], Self>> {
        RTree::bulk_load(
            stroke_endpoints
                .iter()
                .enumerate()
                .flat_map(|(stroke_index, &(start, end))| {
                    [
                        GeomWithData::new(
                            start.to_array(),
                            Self {
                                stroke_index,
                                end_point: false,
                            },
                        ),
                        GeomWithData::new(
                            end.to_array(),
                            Self {
                                stroke_index,
                                end_point: true,
                            },
                        ),
                    ]
                })
                .collect(),
        )
    }
}

struct StrokeNeighbors {
    /// Up to K nearest strokes to start_point
    start_neighbors: Vec<usize>,
    /// Up to K nearest strokes to end_point
    end_neighbors: Vec<usize>,
}

impl StrokeNeighbors {
    /// Maximum number of k-NN neighbors to evaluate for [`Operator`].
    const K: usize = 20;

    /// Precomputes K-nearest candidate neighbors for each stroke's start and end points using the spatial index.
    fn k_nearest_neighbors(
        endpoints: &[(Point<f64>, Point<f64>)],
        endpoint_tree: &RTree<GeomWithData<[f64; 2], StrokeEndpointData>>,
    ) -> Vec<Self> {
        let find_neighbors = |pt: Point<f64>, self_idx: usize| {
            let mut seen = HashSet::with_capacity_and_hasher(Self::K + 1, FxBuildHasher);
            seen.insert(self_idx);
            endpoint_tree
                .nearest_neighbor_iter(pt.to_array())
                .map(|e| e.data.stroke_index)
                .filter(move |&idx| seen.insert(idx))
                .take(Self::K)
                .collect::<Vec<usize>>()
        };

        endpoints
            .iter()
            .enumerate()
            .map(|(i, &(start, end))| Self {
                start_neighbors: find_neighbors(start, i),
                end_neighbors: find_neighbors(end, i),
            })
            .collect()
    }
}

/// Local improvement operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Operator {
    /// Move a vertex to a different position.
    Relocate,
    /// Reverse a sub-sequence of vertices between two edges.
    TwoOpt,
    /// Change the beginning and/or end of the path by swapping an edge.
    LinkSwap,
}

impl Operator {
    const NUM_OPERATORS: usize = 3;
}

impl Distribution<Operator> for StandardUniform {
    fn sample<R: rand::Rng + ?Sized>(&self, rng: &mut R) -> Operator {
        match rng.random_range(0..=Operator::NUM_OPERATORS) {
            0 => Operator::Relocate,
            1 => Operator::TwoOpt,
            2 | 3 => Operator::LinkSwap,
            _ => unreachable!(),
        }
    }
}

struct RelocateMove {
    from_index: usize,
    to_index: usize,
    reversed: bool,
    improvement: f64,
}

struct TwoOptMove {
    reverse_start: usize,
    reverse_end: usize,
    improvement: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinkSwapKind {
    /// Reverse suffix `(split_index + 1)..`
    Suffix,
    /// Reverse prefix `..=split_index`
    Prefix,
    /// Reverse both prefix and suffix
    Both,
}

struct LinkSwapMove {
    kind: LinkSwapKind,
    split_index: usize,
    improvement: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Crossing {
    first_edge: usize,
    second_edge: usize,
}

impl Crossing {
    fn reverse_range(&self) -> RangeInclusive<usize> {
        (self.first_edge + 1)..=self.second_edge
    }
}

/// High-level tour abstraction encapsulating tour nodes, incremental distance cache,
/// and inverse position lookups.
struct Tour<'a> {
    inner: Vec<Node>,
    distances: Vec<f64>,
    stroke_to_tour_indices: Vec<usize>,
    endpoints: &'a [(Point<f64>, Point<f64>)],
}

impl<'a> Tour<'a> {
    /// Calculates tool-off movement distance between every consecutive stroke pair in the tour.
    fn compute_distances(inner: &[Node], endpoints: &[(Point<f64>, Point<f64>)]) -> Vec<f64> {
        inner
            .array_windows::<2>()
            .filter_map(|[a, b]| {
                Some(dist(
                    a.normalized_end_point(endpoints)?,
                    b.normalized_start_point(endpoints)?,
                ))
            })
            .collect()
    }

    /// Builds an initial, poor quality tour with greedy nearest-neighbor search.
    ///
    /// Flips segments by allowing visits to stroke endpoints.
    fn new_greedy_nearest_neighbor(
        endpoints: &'a [(Point<f64>, Point<f64>)],
        endpoint_tree: &RTree<GeomWithData<[f64; 2], StrokeEndpointData>>,
        starting_point: Point<f64>,
    ) -> Self {
        let mut visited = vec![false; endpoints.len()];
        let mut inner = Vec::with_capacity(endpoints.len());
        let mut current_point = starting_point;

        for _ in 0..endpoints.len() {
            let Some(nearest) = endpoint_tree
                .nearest_neighbor_iter(current_point.to_array())
                .find(|entry| {
                    !visited
                        .get(entry.data.stroke_index)
                        .copied()
                        .unwrap_or(true)
                })
            else {
                break;
            };

            if let Some(v) = visited.get_mut(nearest.data.stroke_index) {
                *v = true;
            }

            let node = Node {
                stroke_index: nearest.data.stroke_index,
                reversed: nearest.data.end_point,
            };
            if let Some(end) = node.normalized_end_point(endpoints) {
                current_point = end;
            }
            inner.push(node);
        }

        Self {
            distances: Self::compute_distances(&inner, endpoints),
            stroke_to_tour_indices: {
                let mut positions = vec![0; endpoints.len()];
                for (pos, node) in inner.iter().enumerate() {
                    if let Some(p) = positions.get_mut(node.stroke_index) {
                        *p = pos;
                    }
                }
                positions
            },
            inner,
            endpoints,
        }
    }

    #[cfg(test)]
    fn new_for_test(inner: Vec<Node>, endpoints: &'a [(Point<f64>, Point<f64>)]) -> Self {
        Self {
            distances: Self::compute_distances(&inner, endpoints),
            stroke_to_tour_indices: {
                let mut positions = vec![0; endpoints.len()];
                for (pos, node) in inner.iter().enumerate() {
                    if let Some(p) = positions.get_mut(node.stroke_index) {
                        *p = pos;
                    }
                }
                positions
            },
            inner,
            endpoints,
        }
    }

    fn len(&self) -> usize {
        self.inner.len()
    }

    fn node(&self, tour_index: usize) -> Option<&Node> {
        self.inner.get(tour_index)
    }

    fn stroke_index(&self, tour_index: usize) -> Option<usize> {
        self.inner.get(tour_index).map(|n| n.stroke_index)
    }

    fn stroke_index_to_tour_index(&self, stroke_index: usize) -> Option<usize> {
        self.stroke_to_tour_indices.get(stroke_index).copied()
    }

    fn start_point_of(&self, tour_index: usize) -> Option<Point<f64>> {
        self.inner
            .get(tour_index)?
            .normalized_start_point(self.endpoints)
    }

    fn end_point_of(&self, tour_index: usize) -> Option<Point<f64>> {
        self.inner
            .get(tour_index)?
            .normalized_end_point(self.endpoints)
    }

    fn distance_at(&self, tour_index: usize) -> Option<f64> {
        self.distances.get(tour_index).copied()
    }

    #[cfg(test)]
    fn total_distance(&self, start_point: Point<f64>) -> f64 {
        let from_start_point = self.start_point_of(0).map_or(0.0, |p| dist(start_point, p));
        from_start_point + self.distances.iter().sum::<f64>()
    }

    fn recalculate_distance_at(&mut self, edge_index: usize) {
        if let (Some(from), Some(to)) = (
            self.end_point_of(edge_index),
            self.start_point_of(edge_index + 1),
        ) && let Some(distance) = self.distances.get_mut(edge_index)
        {
            *distance = dist(from, to);
        }
    }

    fn apply_relocate(
        &mut self,
        RelocateMove {
            from_index,
            to_index,
            reversed,
            improvement: _,
        }: RelocateMove,
    ) -> usize {
        let insert_at = if to_index < from_index {
            to_index + 1
        } else {
            to_index
        };

        let (min, max) = if from_index < insert_at {
            if let Some(slice) = self.inner.get_mut(from_index..=insert_at) {
                slice.rotate_left(1);
            }
            (from_index, insert_at)
        } else {
            if let Some(slice) = self.inner.get_mut(insert_at..=from_index) {
                slice.rotate_right(1);
            }
            (insert_at, from_index)
        };

        if reversed && let Some(node) = self.inner.get_mut(insert_at) {
            node.reversed = !node.reversed;
        }

        // Update indices and distance after rotation
        for idx in min..=max {
            if let Some(node) = self.inner.get(idx)
                && let Some(p) = self.stroke_to_tour_indices.get_mut(node.stroke_index)
            {
                *p = idx;
            }
        }

        let dist_start = min.saturating_sub(1);
        let dist_end = max.min(self.len().saturating_sub(2));
        for k in dist_start..=dist_end {
            self.recalculate_distance_at(k);
        }

        insert_at
    }

    fn reverse_range(&mut self, range: RangeInclusive<usize>) {
        let start = *range.start();
        let end = *range.end();

        if let Some(slice) = self.inner.get_mut(range) {
            slice.reverse();

            for (offset, node) in slice.iter_mut().enumerate() {
                node.reversed = !node.reversed;
                // Update tour index
                if let Some(tour_index) = self.stroke_to_tour_indices.get_mut(node.stroke_index) {
                    *tour_index = start + offset;
                }
            }
        }

        // Internal distances are reversed
        if let Some(slice) = self.distances.get_mut(start..end) {
            slice.reverse();
        }

        // Boundary distances need to be updated
        if let Some(prev) = start.checked_sub(1) {
            self.recalculate_distance_at(prev);
        }
        self.recalculate_distance_at(end);
    }

    fn apply_two_opt(
        &mut self,
        TwoOptMove {
            reverse_start,
            reverse_end,
            improvement: _,
        }: TwoOptMove,
    ) {
        self.reverse_range(reverse_start..=reverse_end);
    }

    fn apply_link_swap(
        &mut self,
        LinkSwapMove {
            kind,
            split_index,
            improvement: _,
        }: LinkSwapMove,
    ) {
        if matches!(kind, LinkSwapKind::Prefix | LinkSwapKind::Both) {
            self.reverse_range(0..=split_index);
        }
        if matches!(kind, LinkSwapKind::Suffix | LinkSwapKind::Both) {
            self.reverse_range((split_index + 1)..=self.len().saturating_sub(1));
        }
    }

    fn edge_segment(&self, edge_index: usize) -> Option<LineSegment<f64>> {
        Some(LineSegment {
            from: self.end_point_of(edge_index)?,
            to: self.start_point_of(edge_index + 1)?,
        })
    }

    /// Returns the first crossing of two edges in the tour found.
    ///
    /// Removing crossings improves the tour.
    fn first_crossing(&self) -> Option<Crossing> {
        let edge_count = self.len().saturating_sub(1);
        if edge_count < 3 {
            return None;
        }

        for first_edge in 0..edge_count.saturating_sub(2) {
            let Some(first_seg) = self.edge_segment(first_edge) else {
                continue;
            };
            let first_bbox = first_seg.bounding_box();

            // Two adjacent segments cannot cross, so skip 1
            for second_edge in (first_edge + 2)..edge_count {
                let Some(second_seg) = self.edge_segment(second_edge) else {
                    continue;
                };
                if first_bbox.intersects(&second_seg.bounding_box())
                    && first_seg.intersects(&second_seg)
                {
                    return Some(Crossing {
                        first_edge,
                        second_edge,
                    });
                }
            }
        }

        None
    }

    /// Removes all move crossings with 2-Opt.
    ///
    /// An optimal tour has no crossings, and this does the long-range work that local improvement cannot.
    fn disentangle_crossings(&mut self) -> usize {
        if self.len() < 4 {
            return 0;
        }

        let mut untangled_count = 0;
        while let Some(crossing) = self.first_crossing() {
            self.reverse_range(crossing.reverse_range());
            untangled_count += 1;
        }

        untangled_count
    }

    fn find_best_relocate(&self, node_neighbors: &[StrokeNeighbors]) -> Option<RelocateMove> {
        let max_index = self.len().saturating_sub(1);

        (1..max_index)
            .filter_map(|from_index| {
                let stroke_index = self.stroke_index(from_index)?;
                let prev_dist = self.distance_at(from_index - 1)?;
                let curr_dist = self.distance_at(from_index)?;
                let prev_end = self.end_point_of(from_index - 1)?;
                let next_start = self.start_point_of(from_index + 1)?;

                let unlink_saving = (prev_dist + curr_dist) - dist(prev_end, next_start);
                let neighbors = node_neighbors.get(stroke_index)?;
                Some((from_index, unlink_saving, neighbors))
            })
            .flat_map(|(from_index, unlink_saving, neighbors)| {
                neighbors
                    .start_neighbors
                    .iter()
                    .chain(&neighbors.end_neighbors)
                    .filter_map(|&neighbor| self.stroke_index_to_tour_index(neighbor))
                    .filter(move |&target_index| {
                        target_index != from_index && target_index + 1 != from_index
                    })
                    .map(move |target_index| (from_index, target_index, unlink_saving))
            })
            .filter_map(|(from_index, target_index, unlink_saving)| {
                let base_saving = self.distance_at(target_index)? + unlink_saving;
                let target_end = self.end_point_of(target_index)?;
                let target_next_start = self.start_point_of(target_index + 1)?;
                let from_start = self.start_point_of(from_index)?;
                let from_end = self.end_point_of(from_index)?;

                let cost_normal = dist(target_end, from_start) + dist(from_end, target_next_start);
                let cost_reversed =
                    dist(target_end, from_end) + dist(from_start, target_next_start);

                let (cost, reversed) = if cost_normal <= cost_reversed {
                    (cost_normal, false)
                } else {
                    (cost_reversed, true)
                };

                let improvement = base_saving - cost;
                (improvement > 0.).then_some(RelocateMove {
                    from_index,
                    to_index: target_index,
                    reversed,
                    improvement,
                })
            })
            .max_by(|a, b| a.improvement.total_cmp(&b.improvement))
    }

    fn find_best_two_opt(&self, node_neighbors: &[StrokeNeighbors]) -> Option<TwoOptMove> {
        let tour_len = self.len();
        (0..self.len().saturating_sub(3))
            .filter_map(|first_edge| {
                let node = self.node(first_edge)?;
                let neighbors = node_neighbors.get(node.stroke_index)?;
                let exit_neighbors = if node.reversed {
                    &neighbors.start_neighbors
                } else {
                    &neighbors.end_neighbors
                };
                Some((first_edge, exit_neighbors))
            })
            .flat_map(|(first_edge, exit_neighbors)| {
                exit_neighbors
                    .iter()
                    .filter_map(|&neighbor| self.stroke_index_to_tour_index(neighbor))
                    .filter(move |&second_edge| {
                        second_edge >= first_edge + 2 && second_edge + 1 < tour_len
                    })
                    .map(move |second_edge| (first_edge, second_edge))
            })
            .filter_map(|(first_edge, second_edge)| {
                let old_first_dist = self.distance_at(first_edge)?;
                let old_second_dist = self.distance_at(second_edge)?;

                let new_first_dist = dist(
                    self.end_point_of(first_edge)?,
                    self.end_point_of(second_edge)?,
                );
                let new_second_dist = dist(
                    self.start_point_of(first_edge + 1)?,
                    self.start_point_of(second_edge + 1)?,
                );

                let improvement =
                    (old_first_dist + old_second_dist) - (new_first_dist + new_second_dist);
                (improvement > 0.0).then_some(TwoOptMove {
                    reverse_start: first_edge + 1,
                    reverse_end: second_edge,
                    improvement,
                })
            })
            .max_by(|a, b| a.improvement.total_cmp(&b.improvement))
    }

    fn find_best_link_swap(&self, start_point: Point<f64>) -> Option<LinkSwapMove> {
        let tour_len = self.len();
        let first_start = self.start_point_of(0)?;
        let last_end = self.end_point_of(tour_len.saturating_sub(1))?;
        let start_to_first = dist(start_point, first_start);

        (1..tour_len.saturating_sub(1))
            .filter_map(|split_index| {
                let split_end = self.end_point_of(split_index)?;
                let next_start = self.start_point_of(split_index + 1)?;
                let current_dist = self.distance_at(split_index)?;

                let start_to_split = dist(start_point, split_end);
                let swap_options = [
                    (LinkSwapKind::Suffix, dist(split_end, last_end)),
                    (
                        LinkSwapKind::Prefix,
                        dist(first_start, next_start) + start_to_split - start_to_first,
                    ),
                    (
                        LinkSwapKind::Both,
                        dist(first_start, last_end) + start_to_split - start_to_first,
                    ),
                ];

                let (kind, best_new_dist) = swap_options
                    .into_iter()
                    .min_by(|(_, dist_a), (_, dist_b)| dist_a.total_cmp(dist_b))?;

                let improvement = current_dist - best_new_dist;
                (improvement > 0.).then_some(LinkSwapMove {
                    kind,
                    split_index,
                    improvement,
                })
            })
            .max_by(|a, b| a.improvement.total_cmp(&b.improvement))
    }

    /// Local improvement of open-loop tour by repeatedly applying [`Operator`] until no further improvement is found.
    fn local_improvement(&mut self, neighbors: &[StrokeNeighbors], start_point: Point<f64>) {
        const MAX_ITERATIONS: usize = 20_000;

        let mut stuck_operators: HashSet<Operator> =
            HashSet::with_capacity_and_hasher(3, FxBuildHasher);
        let mut rng = rand::rng();

        for idx in 0..MAX_ITERATIONS {
            if stuck_operators.len() == Operator::NUM_OPERATORS {
                debug!("TSP: converged after {idx} iterations, no more local improvements");
                break;
            }

            let operator: Operator = rng.random();

            match operator {
                Operator::Relocate => {
                    if let Some(mov) = self.find_best_relocate(neighbors) {
                        stuck_operators.clear();
                        self.apply_relocate(mov);
                    } else {
                        stuck_operators.insert(operator);
                    }
                }
                Operator::TwoOpt => {
                    if let Some(mov) = self.find_best_two_opt(neighbors) {
                        stuck_operators.clear();
                        self.apply_two_opt(mov);
                    } else {
                        stuck_operators.insert(operator);
                    }
                }
                Operator::LinkSwap => {
                    if let Some(mov) = self.find_best_link_swap(start_point) {
                        stuck_operators.clear();
                        self.apply_link_swap(mov);
                    } else {
                        stuck_operators.insert(operator);
                    }
                }
            }
        }
    }

    /// Reconstructs reordered/reversed [`Stroke`]s from the tour.
    fn into_strokes(self, strokes: Vec<Stroke>) -> Vec<Stroke> {
        let mut strokes_map: Vec<Option<Stroke>> = strokes.into_iter().map(Some).collect();
        self.inner
            .into_iter()
            .filter_map(|node| {
                let mut stroke = strokes_map
                    .get_mut(node.stroke_index)
                    .and_then(Option::take)?;
                if node.reversed {
                    stroke.reverse();
                }
                Some(stroke)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::turtle::elements::DrawCommand;

    fn make_line_stroke(from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> Stroke {
        Stroke::new(
            point(from_x, from_y),
            vec![DrawCommand::LineTo(LineSegment {
                from: point(from_x, from_y),
                to: point(to_x, to_y),
            })],
            None,
        )
    }

    #[test]
    fn test_nearest_neighbor_greedy_reordering() {
        let s1 = make_line_stroke(0.0, 0.0, 1.0, 0.0);
        let s2 = make_line_stroke(10.0, 0.0, 11.0, 0.0);
        let s3 = make_line_stroke(2.0, 0.0, 3.0, 0.0);

        let ordered = minimize_travel_time(vec![s2, s1, s3], [Some(0.0), Some(0.0)]);
        assert_eq!(ordered.len(), 3);
        assert!((ordered.first().unwrap().start_point() - point(0.0, 0.0)).length() < 1e-6);
        assert!((ordered.get(1).unwrap().start_point() - point(2.0, 0.0)).length() < 1e-6);
        assert!((ordered.get(2).unwrap().start_point() - point(10.0, 0.0)).length() < 1e-6);
    }

    #[test]
    fn test_nearest_neighbor_greedy_flips_stroke() {
        let backwards = make_line_stroke(5.0, 0.0, 1.0, 0.0);
        let endpoints = [(backwards.start_point(), backwards.end_point())];
        let tree = StrokeEndpointData::new_tree(&endpoints);
        let tour = Tour::new_greedy_nearest_neighbor(&endpoints, &tree, point(0.0, 0.0));
        assert_eq!(tour.len(), 1);
        let node = tour.node(0).unwrap();
        assert!(
            node.reversed,
            "Backward stroke must be marked reversed to enter at (1, 0)"
        );
    }

    #[test]
    fn test_minimize_travel_time_empty_and_single() {
        assert!(minimize_travel_time(vec![], [Some(0.0), Some(0.0)]).is_empty());

        let single = make_line_stroke(1.0, 2.0, 3.0, 4.0);
        let result = minimize_travel_time(vec![single], [Some(0.0), Some(0.0)]);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_minimize_travel_time_closed_loops() {
        let loop_stroke = Stroke::new(
            point(5.0, 5.0),
            vec![
                DrawCommand::LineTo(LineSegment {
                    from: point(5.0, 5.0),
                    to: point(10.0, 5.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(10.0, 5.0),
                    to: point(5.0, 5.0),
                }),
            ],
            None,
        );
        let s2 = make_line_stroke(0.0, 0.0, 1.0, 0.0);
        let result = minimize_travel_time(vec![loop_stroke, s2], [Some(0.0), Some(0.0)]);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_disentangle_bridges_distant_clusters() {
        // Cluster A: 25 strokes near (0, 0)
        // Cluster B: 25 strokes near (1000, 1000)
        let mut strokes = Vec::with_capacity(50);
        for i in 0..25 {
            let x = f64::from(i);
            strokes.push(make_line_stroke(x, 0.0, x + 0.5, 0.0));
        }
        for i in 0..25 {
            let x = 1000.0 + f64::from(i);
            strokes.push(make_line_stroke(x, 1000.0, x + 0.5, 1000.0));
        }

        let endpoints: Vec<(Point<f64>, Point<f64>)> = strokes
            .iter()
            .map(|s| (s.start_point(), s.end_point()))
            .collect();

        let endpoint_tree = StrokeEndpointData::new_tree(&endpoints);
        let candidate_neighbors = StrokeNeighbors::k_nearest_neighbors(&endpoints, &endpoint_tree);
        drop(endpoint_tree);

        // Verify mathematical saturation: K=20 candidate lists contain ZERO cross-cluster strokes.
        for c in candidate_neighbors.iter().take(25) {
            assert!(c.start_neighbors.iter().all(|&idx| idx < 25));
            assert!(c.end_neighbors.iter().all(|&idx| idx < 25));
        }
        for c in candidate_neighbors.iter().skip(25) {
            assert!(c.start_neighbors.iter().all(|&idx| idx >= 25));
            assert!(c.end_neighbors.iter().all(|&idx| idx >= 25));
        }

        // Intentionally create a crossed initial tour between Cluster A and Cluster B:
        // A[0..12] -> B[12..25] -> A[12..25] -> B[0..12]
        // This has multiple cross-cluster transitions (A->B and B->A, then A->B again).
        let mut initial_nodes = Vec::with_capacity(50);
        for i in 0..12 {
            initial_nodes.push(Node {
                stroke_index: i,
                reversed: false,
            });
        }
        for i in 37..50 {
            initial_nodes.push(Node {
                stroke_index: i,
                reversed: false,
            });
        }
        for i in 12..25 {
            initial_nodes.push(Node {
                stroke_index: i,
                reversed: false,
            });
        }
        for i in 25..37 {
            initial_nodes.push(Node {
                stroke_index: i,
                reversed: false,
            });
        }

        let mut tour = Tour::new_for_test(initial_nodes, &endpoints);
        assert!(tour.total_distance(point(0.0, 0.0)) > 4000.0);

        // Deterministic planar disentanglement eliminates crossing rapid traverses upfront.
        let untangled_count = tour.disentangle_crossings();
        assert!(
            untangled_count > 0,
            "Expected crossing cross-cluster edges to be untangled upfront"
        );

        tour.local_improvement(&candidate_neighbors, point(0.0, 0.0));

        let optimized_dist = tour.total_distance(point(0.0, 0.0));
        // A tour with untangled clusters needs only ONE cross-cluster jump (~1414) + intra-cluster travel (~50).
        // Total optimized travel should be < 2000.
        assert!(
            optimized_dist < 2000.0,
            "Expected distance < 2000 after untangling crossed clusters, got {optimized_dist}"
        );
    }

    #[test]
    fn test_two_opt_unzips_adjacent_crossings() {
        // Construct an entangled tour with adjacent crossing edges:
        // S0: (0, 0) -> (1, 0)
        // S1: (10, 10) -> (11, 10)
        // S2: (1, 1) -> (0, 1)
        // S3: (11, 11) -> (10, 11)
        // S4: (20, 0) -> (21, 0)
        let s0 = make_line_stroke(0.0, 0.0, 1.0, 0.0);
        let s1 = make_line_stroke(10.0, 10.0, 11.0, 10.0);
        let s2 = make_line_stroke(1.0, 1.0, 0.0, 1.0);
        let s3 = make_line_stroke(11.0, 11.0, 10.0, 11.0);
        let s4 = make_line_stroke(20.0, 0.0, 21.0, 0.0);

        let strokes = [s0, s1, s2, s3, s4];
        let endpoints: Vec<(Point<f64>, Point<f64>)> = strokes
            .iter()
            .map(|s| (s.start_point(), s.end_point()))
            .collect();

        let endpoint_tree = StrokeEndpointData::new_tree(&endpoints);
        let candidate_neighbors = StrokeNeighbors::k_nearest_neighbors(&endpoints, &endpoint_tree);
        drop(endpoint_tree);

        // Initial tour in the crossed order [0, 1, 2, 3, 4]
        let initial_nodes: Vec<Node> = (0..5)
            .map(|i| Node {
                stroke_index: i,
                reversed: false,
            })
            .collect();

        let mut tour = Tour::new_for_test(initial_nodes, &endpoints);
        assert!(tour.total_distance(point(0.0, 0.0)) > 50.0);

        tour.local_improvement(&candidate_neighbors, point(0.0, 0.0));

        let optimized_dist = tour.total_distance(point(0.0, 0.0));
        assert!(
            optimized_dist < 40.0,
            "Expected distance < 40 after unzipping, got {optimized_dist}"
        );
    }

    #[test]
    fn test_disentangle_planar_crossings_deterministic() {
        let s0 = make_line_stroke(-1.0, 0.0, 0.0, 0.0);
        let s1 = make_line_stroke(10.0, 10.0, 11.0, 10.0);
        let s2 = make_line_stroke(0.0, 11.0, 0.0, 10.0);
        let s3 = make_line_stroke(10.0, 0.0, 11.0, 0.0);

        let strokes = [s0, s1, s2, s3];
        let endpoints: Vec<(Point<f64>, Point<f64>)> = strokes
            .iter()
            .map(|s| (s.start_point(), s.end_point()))
            .collect();

        // Deliberately crossed tour: S0 -> S1 -> S2 -> S3
        // Edge 0: S0.end (0, 0) -> S1.start (10, 10)
        // Edge 2: S2.end (0, 10) -> S3.start (10, 0)
        // Edge 0 and Edge 2 form a clean 'X' crossing at (5, 5)
        let nodes = vec![
            Node {
                stroke_index: 0,
                reversed: false,
            },
            Node {
                stroke_index: 1,
                reversed: false,
            },
            Node {
                stroke_index: 2,
                reversed: false,
            },
            Node {
                stroke_index: 3,
                reversed: false,
            },
        ];

        let mut tour = Tour::new_for_test(nodes, &endpoints);
        let count = tour.disentangle_crossings();
        assert_eq!(count, 1, "Expected exactly 1 crossing to be untangled");

        // After untangling, zero crossings should remain
        assert_eq!(tour.first_crossing(), None);

        // Tour order should now be unzipped: S0 -> S2_reversed -> S1_reversed -> S3
        assert_eq!(tour.stroke_index(0), Some(0));
        assert_eq!(tour.stroke_index(1), Some(2));
        assert_eq!(tour.node(1).map(|n| n.reversed), Some(true));
        assert_eq!(tour.stroke_index(2), Some(1));
        assert_eq!(tour.node(2).map(|n| n.reversed), Some(true));
        assert_eq!(tour.stroke_index(3), Some(3));
    }
}
