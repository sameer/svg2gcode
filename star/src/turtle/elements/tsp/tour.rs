use std::{
    num::NonZeroUsize,
    ops::{Index, RangeInclusive},
};

use lyon_geom::{LineSegment, Point};
use rstar::{RTree, primitives::GeomWithData};

use super::{
    index::{EdgeIndex, IndexedVec, StrokeIndex, TourIndex},
    moves::{LinkSwap, LinkSwapKind, Relocate, TwoOpt},
    stroke_types::{StrokeKNearestNeighbors, StrokePointData},
};
use crate::turtle::Stroke;

/// Representation of a stroke in the tour encoding its direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Node {
    stroke_index: StrokeIndex,
    /// Whether the direction of this stroke is reversed in the tour.
    reversed: bool,
}

impl Node {
    pub const fn stroke_index(self) -> StrokeIndex {
        self.stroke_index
    }

    pub fn normalized_start_neighbors(
        self,
        nearest_neighbor_pair: &StrokeKNearestNeighbors,
    ) -> &[StrokeIndex] {
        nearest_neighbor_pair.normalized_start_neighbors(self.reversed)
    }

    pub fn normalized_end_neighbors(
        self,
        nearest_neighbor_pair: &StrokeKNearestNeighbors,
    ) -> &[StrokeIndex] {
        nearest_neighbor_pair.normalized_end_neighbors(self.reversed)
    }

    pub fn neighbors(
        self,
        stroke_neighbors: &IndexedVec<StrokeIndex, StrokeKNearestNeighbors>,
    ) -> &StrokeKNearestNeighbors {
        &stroke_neighbors[self.stroke_index]
    }

    pub fn normalized_start_point(
        self,
        stroke_points: &IndexedVec<StrokeIndex, (Point<f64>, Point<f64>)>,
    ) -> Point<f64> {
        let (start, end) = stroke_points[self.stroke_index];
        if self.reversed { end } else { start }
    }

    pub fn normalized_end_point(
        self,
        stroke_points: &IndexedVec<StrokeIndex, (Point<f64>, Point<f64>)>,
    ) -> Point<f64> {
        let (start, end) = stroke_points[self.stroke_index];
        if self.reversed { start } else { end }
    }
}

/// A rapid move between two strokes.
#[derive(Debug, Clone, Copy)]
pub struct Edge {
    pub from: Point<f64>,
    pub to: Point<f64>,
    pub len: f64,
}

impl Edge {
    pub fn line_segment(&self) -> LineSegment<f64> {
        LineSegment {
            from: self.from,
            to: self.to,
        }
    }
}

impl rstar::RTreeObject for Edge {
    type Envelope = rstar::AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        rstar::AABB::from_points(&[[self.from.x, self.from.y], [self.to.x, self.to.y]])
    }
}

/// Wrapper for a TSP tour with strongly-typed node, edge, and stroke indexing.
pub struct Tour<'a> {
    inner: IndexedVec<TourIndex, Node>,
    /// Necessarily 1 shorter than `inner`.
    lengths: IndexedVec<EdgeIndex, f64>,

    /// Forward mapping to avoid modifying any pre-computed data structures.
    stroke_positions: IndexedVec<StrokeIndex, TourIndex>,
    stroke_points: &'a IndexedVec<StrokeIndex, (Point<f64>, Point<f64>)>,
}

impl Index<TourIndex> for Tour<'_> {
    type Output = Node;

    fn index(&self, index: TourIndex) -> &Self::Output {
        &self.inner[index]
    }
}

impl Index<StrokeIndex> for Tour<'_> {
    type Output = TourIndex;

    fn index(&self, index: StrokeIndex) -> &Self::Output {
        &self.stroke_positions[index]
    }
}

impl<'a> Tour<'a> {
    /// Builds an initial, poor quality tour with greedy nearest-neighbor search.
    ///
    /// Flips segments by allowing visits to stroke endpoints.
    pub fn new_greedy_nearest_neighbor(
        stroke_points: &'a IndexedVec<StrokeIndex, (Point<f64>, Point<f64>)>,
        point_tree: &RTree<GeomWithData<[f64; 2], StrokePointData>>,
        starting_point: Point<f64>,
    ) -> Self {
        let mut visited = stroke_points.filled_like(false);
        let mut inner = Vec::with_capacity(stroke_points.len());

        let mut current_point = starting_point;

        for _ in 0..stroke_points.len() {
            let Some(nearest) = point_tree
                .nearest_neighbor_iter(current_point.to_array())
                .find(|entry| !visited[entry.data.stroke_index])
            else {
                break;
            };

            visited[nearest.data.stroke_index] = true;

            let node = Node {
                stroke_index: nearest.data.stroke_index,
                reversed: nearest.data.end_point,
            };
            current_point = node.normalized_end_point(stroke_points);
            inner.push(node);
        }

        Self::from_vertices(IndexedVec::from_vec(inner), stroke_points)
    }

    fn from_vertices(
        vertices: IndexedVec<TourIndex, Node>,
        stroke_points: &'a IndexedVec<StrokeIndex, (Point<f64>, Point<f64>)>,
    ) -> Self {
        let lengths = vertices
            .as_slice()
            .array_windows::<2>()
            .map(|[a, b]| {
                (a.normalized_end_point(stroke_points) - b.normalized_start_point(stroke_points))
                    .length()
            })
            .collect();

        let mut stroke_positions = stroke_points.filled_like(TourIndex::MIN);
        for (pos, node) in vertices.enumerate() {
            stroke_positions[node.stroke_index] = pos;
        }

        Self {
            lengths,
            stroke_positions,
            inner: vertices,
            stroke_points,
        }
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn edge_count(&self) -> usize {
        self.lengths.len()
    }

    pub fn last(&self) -> TourIndex {
        self.inner.last_index().unwrap_or(TourIndex::MIN)
    }

    pub fn filled_like<T: Clone>(&self, value: T) -> IndexedVec<TourIndex, T> {
        self.inner.filled_like(value)
    }

    pub fn rotated_node_indices_from(
        &self,
        start_offset: usize,
    ) -> impl Iterator<Item = TourIndex> + use<> {
        self.inner.rotated_indices_from(start_offset)
    }

    pub fn edge_indices(&self) -> impl Iterator<Item = EdgeIndex> + use<> {
        self.lengths.indices()
    }

    pub fn checked_add_edges(&self, edge: EdgeIndex, offset: NonZeroUsize) -> Option<EdgeIndex> {
        edge.as_usize()
            .checked_add(offset.get())
            .and_then(|i| self.lengths.index_at(i))
    }

    pub fn exiting_edge(&self, tour_index: TourIndex) -> Option<EdgeIndex> {
        self.lengths.index_at(tour_index.as_usize())
    }

    pub fn entering_edge(&self, tour_index: TourIndex) -> Option<EdgeIndex> {
        tour_index
            .as_usize()
            .checked_sub(1)
            .and_then(|i| self.lengths.index_at(i))
    }

    pub fn start_point(&self, tour_index: TourIndex) -> Point<f64> {
        self.inner[tour_index].normalized_start_point(self.stroke_points)
    }

    pub fn end_point(&self, tour_index: TourIndex) -> Point<f64> {
        self.inner[tour_index].normalized_end_point(self.stroke_points)
    }

    pub fn edge(&self, edge_index: EdgeIndex) -> Edge {
        Edge {
            from: self.end_point(edge_index.start()),
            to: self.start_point(edge_index.end()),
            len: self.lengths[edge_index],
        }
    }

    pub fn total_length(&self, start_point: Point<f64>) -> f64 {
        let from_start_point = if self.inner.is_empty() {
            0.0
        } else {
            (start_point - self.start_point(TourIndex::MIN)).length()
        };
        from_start_point + self.lengths.iter().sum::<f64>()
    }

    /// Recomputes the cached length at `edge_index`.
    fn invalidate(&mut self, edge_index: EdgeIndex) {
        let from = self.end_point(edge_index.start());
        let to = self.start_point(edge_index.end());
        self.lengths[edge_index] = (to - from).length();
    }

    pub fn apply_relocate(&mut self, relocate: Relocate) {
        let before_block = relocate.before_block();
        let after_block = relocate.after_block();
        let target_edge = relocate.target_edge();
        let block_len = after_block.as_usize() - before_block.as_usize();

        if relocate.reversed() {
            let block = &mut self.inner[before_block.end()..=after_block.start()];
            block.reverse();
            for node in block {
                node.reversed = !node.reversed;
            }
        }

        let (modified_nodes, invalidated_edges) = if target_edge > after_block {
            // Rotating both the block and elements up to `target_edge.start()` left shifts the block directly into place.
            let range = before_block.end()..=target_edge.start();
            self.inner[range.clone()].rotate_left(block_len);
            (range, before_block..=target_edge)
        } else {
            // Rotating both the block and elements from `target_edge.end()` right shifts the block directly into place.
            let range = target_edge.end()..=after_block.start();
            self.inner[range.clone()].rotate_right(block_len);
            (range, target_edge..=after_block)
        };

        for tour_idx in TourIndex::range_inclusive(*modified_nodes.start(), *modified_nodes.end()) {
            let stroke_idx = self.inner[tour_idx].stroke_index;
            self.stroke_positions[stroke_idx] = tour_idx;
        }

        // TODO: this should also be rotated and only the endpoints invalidated if not reversed.
        for edge in EdgeIndex::range_inclusive(*invalidated_edges.start(), *invalidated_edges.end())
        {
            self.invalidate(edge);
        }
    }

    fn reverse_range(&mut self, range: RangeInclusive<TourIndex>) {
        let start = *range.start();
        let end = *range.end();

        let slice = &mut self.inner[range];
        slice.reverse();
        for node in slice {
            node.reversed = !node.reversed;
        }
        for tour_idx in TourIndex::range_inclusive(start, end) {
            let stroke_idx = self.inner[tour_idx].stroke_index;
            self.stroke_positions[stroke_idx] = tour_idx;
        }

        // Internal lengths are reversed. `end` is a node so this slice will exist.
        if let Some(slice) = self
            .lengths
            .as_mut_slice()
            .get_mut(start.as_usize()..end.as_usize())
        {
            slice.reverse();
        }

        // Boundary lengths need to be updated
        if let Some(entering) = self.entering_edge(start) {
            self.invalidate(entering);
        }
        if let Some(exiting) = self.exiting_edge(end) {
            self.invalidate(exiting);
        }
    }

    pub fn apply_two_opt(&mut self, two_opt: TwoOpt) {
        self.reverse_range(two_opt.reversed_nodes());
    }

    pub fn apply_link_swap(&mut self, LinkSwap { kind, split_edge }: LinkSwap) {
        if matches!(kind, LinkSwapKind::Prefix | LinkSwapKind::Both) {
            self.reverse_range(TourIndex::MIN..=split_edge.start());
        }
        if matches!(kind, LinkSwapKind::Suffix | LinkSwapKind::Both) {
            self.reverse_range(split_edge.end()..=self.last());
        }
    }

    /// Reconstructs reordered/reversed [`Stroke`]s from the tour.
    pub fn into_strokes(self, strokes: Vec<Stroke>) -> Vec<Stroke> {
        let mut strokes_map: IndexedVec<StrokeIndex, Option<Stroke>> =
            strokes.into_iter().map(Some).collect();
        self.inner
            .into_iter()
            .filter_map(|node| {
                let mut stroke = strokes_map[node.stroke_index].take()?;
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
    use lyon_geom::{Point, point};

    use super::{EdgeIndex, LinkSwap, LinkSwapKind, Node, Relocate, Tour, TourIndex, TwoOpt};
    use crate::turtle::elements::tsp::index::{IndexedVec, StrokeIndex};

    fn sample_stroke_points() -> IndexedVec<StrokeIndex, (Point<f64>, Point<f64>)> {
        IndexedVec::from_vec(vec![
            (point(0.0, 0.0), point(1.5, 0.5)),
            (point(3.0, -1.0), point(4.2, 2.3)),
            (point(6.1, 0.7), point(5.4, -3.2)),
            (point(-2.5, 4.0), point(-0.8, 5.7)),
            (point(8.3, 3.1), point(9.9, -0.4)),
            (point(2.2, 7.4), point(0.6, 8.8)),
            (point(-4.1, -2.6), point(-3.0, 1.1)),
            (point(11.0, 5.5), point(12.7, 6.2)),
        ])
    }

    fn sample_vertices(len: usize) -> IndexedVec<TourIndex, Node> {
        (0..len)
            .map(|i| Node {
                stroke_index: StrokeIndex::new(i),
                reversed: i % 2 == 1,
            })
            .collect()
    }

    fn assert_tour_invariants(tour: &Tour<'_>, origin: Point<f64>) {
        assert_eq!(tour.edge_count(), tour.len().saturating_sub(1));

        for (tour_idx, node) in tour.inner.enumerate() {
            assert_eq!(tour[node.stroke_index], tour_idx);
            assert_eq!(tour[tour_idx].stroke_index, node.stroke_index);
        }

        for edge_idx in tour.edge_indices() {
            let edge = tour.edge(edge_idx);
            let expected_len = (edge.to - edge.from).length();
            assert!(
                (edge.len - expected_len).abs() < 1e-9,
                "edge {edge_idx:?} cached len {} != expected {expected_len}",
                edge.len
            );
        }

        let expected_internal: f64 = tour.lengths.iter().sum();
        let expected_total =
            (origin - tour.start_point(TourIndex::MIN)).length() + expected_internal;
        assert!(
            (tour.total_length(origin) - expected_total).abs() < 1e-9,
            "total_length {} != expected {expected_total}",
            tour.total_length(origin)
        );
    }

    fn naive_relocate(
        nodes: &IndexedVec<TourIndex, Node>,
        b0: usize,
        b1: usize,
        t: usize,
        reversed: bool,
    ) -> IndexedVec<TourIndex, Node> {
        let mut nodes = nodes.as_slice().to_vec();
        let mut block: Vec<Node> = nodes.drain((b0 + 1)..=b1).collect();
        if reversed {
            block.reverse();
            for node in &mut block {
                node.reversed = !node.reversed;
            }
        }
        let insert_pos = if t > b1 { t - (b1 - b0) + 1 } else { t + 1 };
        nodes.splice(insert_pos..insert_pos, block);
        IndexedVec::from_vec(nodes)
    }

    #[test]
    fn relocate_preserves_invariants_exhaustively_and_chained() {
        let stroke_points = sample_stroke_points();
        let origin = point(-1.0, -1.0);
        let base_vertices = sample_vertices(stroke_points.len());
        let edge_count = stroke_points.len() - 1;

        let mut chained_tour = Tour::from_vertices(base_vertices.clone(), &stroke_points);
        assert_tour_invariants(&chained_tour, origin);

        for b0 in 0..edge_count {
            for b1 in 0..edge_count {
                for t in 0..edge_count {
                    for reversed in [false, true] {
                        let candidate = Relocate::new(
                            EdgeIndex::new(b0),
                            EdgeIndex::new(b1),
                            EdgeIndex::new(t),
                            reversed,
                        );
                        let should_be_valid = b0 < b1 && !(b0..=b1).contains(&t);
                        assert_eq!(candidate.is_some(), should_be_valid);

                        if let Some(relocate) = candidate {
                            let mut tour =
                                Tour::from_vertices(base_vertices.clone(), &stroke_points);
                            tour.apply_relocate(relocate);
                            assert_tour_invariants(&tour, origin);
                            assert_eq!(
                                tour.inner,
                                naive_relocate(&base_vertices, b0, b1, t, reversed)
                            );

                            chained_tour.apply_relocate(relocate);
                            assert_tour_invariants(&chained_tour, origin);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn two_opt_and_link_swap_preserve_invariants() {
        let stroke_points = sample_stroke_points();
        let origin = point(2.0, -3.0);
        let base_vertices = sample_vertices(stroke_points.len());
        let edge_count = stroke_points.len() - 1;

        let mut chained_tour = Tour::from_vertices(base_vertices.clone(), &stroke_points);

        for a in 0..edge_count {
            for b in 0..edge_count {
                let candidate = TwoOpt::new(EdgeIndex::new(a), EdgeIndex::new(b));
                assert_eq!(candidate.is_some(), a.abs_diff(b) >= 2);

                if let Some(two_opt) = candidate {
                    let mut tour = Tour::from_vertices(base_vertices.clone(), &stroke_points);
                    tour.apply_two_opt(two_opt);
                    assert_tour_invariants(&tour, origin);

                    chained_tour.apply_two_opt(two_opt);
                    assert_tour_invariants(&chained_tour, origin);
                }
            }
        }

        for split in 0..edge_count {
            for kind in [
                LinkSwapKind::Prefix,
                LinkSwapKind::Suffix,
                LinkSwapKind::Both,
            ] {
                let mov = LinkSwap {
                    kind,
                    split_edge: EdgeIndex::new(split),
                };
                let mut tour = Tour::from_vertices(base_vertices.clone(), &stroke_points);
                tour.apply_link_swap(mov);
                assert_tour_invariants(&tour, origin);

                chained_tour.apply_link_swap(mov);
                assert_tour_invariants(&chained_tour, origin);
            }
        }
    }
}
