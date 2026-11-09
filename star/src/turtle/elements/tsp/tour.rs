use std::ops::RangeInclusive;

use lyon_geom::{LineSegment, Point};
use rstar::{RTree, primitives::GeomWithData};

use super::moves::{LinkSwapKind, LinkSwapMove, RelocateMove, TwoOptMove};
use super::neighbors::StrokeEndpointData;
use crate::turtle::Stroke;

#[inline]
pub(super) fn dist(a: Point<f64>, b: Point<f64>) -> f64 {
    (b - a).length()
}

/// Representation of a node in the TSP graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Node {
    pub(super) stroke_index: usize,
    /// Whether the direction of this stroke is reversed in the tour.
    pub(super) reversed: bool,
}

impl Node {
    pub(super) fn normalized_start_point(
        &self,
        endpoints: &[(Point<f64>, Point<f64>)],
    ) -> Option<Point<f64>> {
        let &(start, end) = endpoints.get(self.stroke_index)?;
        Some(if self.reversed { end } else { start })
    }

    pub(super) fn normalized_end_point(
        &self,
        endpoints: &[(Point<f64>, Point<f64>)],
    ) -> Option<Point<f64>> {
        let &(start, end) = endpoints.get(self.stroke_index)?;
        Some(if self.reversed { start } else { end })
    }
}

/// An outgoing rapid move edge connecting `tour[edge_index].end` to `tour[edge_index + 1].start`.
#[derive(Debug, Clone, Copy)]
pub(super) struct TourEdge {
    pub(super) from: Point<f64>,
    pub(super) to: Point<f64>,
    pub(super) dist: f64,
}

impl TourEdge {
    pub(super) fn segment(&self) -> LineSegment<f64> {
        LineSegment {
            from: self.from,
            to: self.to,
        }
    }
}

/// High-level tour abstraction encapsulating tour nodes, incremental distance cache,
/// and inverse position lookups.
pub(super) struct Tour<'a> {
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
    pub(super) fn new_greedy_nearest_neighbor(
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

        Self::from_nodes(inner, endpoints)
    }

    fn from_nodes(inner: Vec<Node>, endpoints: &'a [(Point<f64>, Point<f64>)]) -> Self {
        let distances = Self::compute_distances(&inner, endpoints);
        let mut stroke_to_tour_indices = vec![0; endpoints.len()];
        for (pos, node) in inner.iter().enumerate() {
            if let Some(p) = stroke_to_tour_indices.get_mut(node.stroke_index) {
                *p = pos;
            }
        }
        Self {
            inner,
            distances,
            stroke_to_tour_indices,
            endpoints,
        }
    }

    #[cfg(test)]
    pub(super) fn new_for_test(inner: Vec<Node>, endpoints: &'a [(Point<f64>, Point<f64>)]) -> Self {
        Self::from_nodes(inner, endpoints)
    }

    pub(super) fn len(&self) -> usize {
        self.inner.len()
    }

    pub(super) fn node(&self, tour_index: usize) -> Option<&Node> {
        self.inner.get(tour_index)
    }

    pub(super) fn stroke_index(&self, tour_index: usize) -> Option<usize> {
        self.inner.get(tour_index).map(|n| n.stroke_index)
    }

    pub(super) fn stroke_index_to_tour_index(&self, stroke_index: usize) -> Option<usize> {
        self.stroke_to_tour_indices.get(stroke_index).copied()
    }

    pub(super) fn start_point_of(&self, tour_index: usize) -> Option<Point<f64>> {
        self.inner
            .get(tour_index)?
            .normalized_start_point(self.endpoints)
    }

    pub(super) fn end_point_of(&self, tour_index: usize) -> Option<Point<f64>> {
        self.inner
            .get(tour_index)?
            .normalized_end_point(self.endpoints)
    }

    pub(super) fn distance_at(&self, tour_index: usize) -> Option<f64> {
        self.distances.get(tour_index).copied()
    }

    pub(super) fn edge(&self, edge_index: usize) -> Option<TourEdge> {
        Some(TourEdge {
            from: self.end_point_of(edge_index)?,
            to: self.start_point_of(edge_index + 1)?,
            dist: self.distance_at(edge_index)?,
        })
    }

    pub(super) fn edge_segment(&self, edge_index: usize) -> Option<LineSegment<f64>> {
        self.edge(edge_index).map(|edge| edge.segment())
    }

    pub(super) fn total_distance(&self, start_point: Point<f64>) -> f64 {
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

    pub(super) fn apply_relocate(
        &mut self,
        RelocateMove {
            block_start,
            block_len,
            target_index,
            reversed,
        }: RelocateMove,
    ) {
        let block_end = block_start + block_len - 1;

        let (min, max, new_block_start, new_block_end) = if target_index > block_end {
            if let Some(slice) = self.inner.get_mut(block_start..=target_index) {
                slice.rotate_left(block_len);
            }
            let new_start = target_index - block_len + 1;
            (block_start, target_index, new_start, target_index)
        } else {
            if let Some(slice) = self.inner.get_mut((target_index + 1)..=block_end) {
                slice.rotate_right(block_len);
            }
            let new_start = target_index + 1;
            let new_end = target_index + block_len;
            (target_index + 1, block_end, new_start, new_end)
        };

        if reversed && let Some(slice) = self.inner.get_mut(new_block_start..=new_block_end) {
            slice.reverse();
            for node in slice.iter_mut() {
                node.reversed = !node.reversed;
            }
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
    }

    pub(super) fn reverse_range(&mut self, range: RangeInclusive<usize>) {
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

    pub(super) fn apply_two_opt(
        &mut self,
        TwoOptMove {
            reverse_start,
            reverse_end,
        }: TwoOptMove,
    ) {
        self.reverse_range(reverse_start..=reverse_end);
    }

    pub(super) fn apply_link_swap(
        &mut self,
        LinkSwapMove { kind, split_index }: LinkSwapMove,
    ) {
        if matches!(kind, LinkSwapKind::Prefix | LinkSwapKind::Both) {
            self.reverse_range(0..=split_index);
        }
        if matches!(kind, LinkSwapKind::Suffix | LinkSwapKind::Both) {
            self.reverse_range((split_index + 1)..=self.len().saturating_sub(1));
        }
    }

    /// Reconstructs reordered/reversed [`Stroke`]s from the tour.
    pub(super) fn into_strokes(self, strokes: Vec<Stroke>) -> Vec<Stroke> {
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
