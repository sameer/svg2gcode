use std::ops::RangeInclusive;

use lyon_geom::{LineSegment, Point};
use rstar::{RTree, primitives::GeomWithData};

use super::{
    moves::{LinkSwap, LinkSwapKind, Relocate, TwoOpt},
    types::StrokePointData,
};
use crate::turtle::Stroke;

/// Representation of a stroke encoding its direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Node {
    pub stroke_index: usize,
    /// Whether the direction of this stroke is reversed in the tour.
    pub reversed: bool,
}

impl Node {
    pub fn normalized_start_point(
        &self,
        stroke_points: &[(Point<f64>, Point<f64>)],
    ) -> Option<Point<f64>> {
        let &(start, end) = stroke_points.get(self.stroke_index)?;
        Some(if self.reversed { end } else { start })
    }

    pub fn normalized_end_point(
        &self,
        stroke_points: &[(Point<f64>, Point<f64>)],
    ) -> Option<Point<f64>> {
        let &(start, end) = stroke_points.get(self.stroke_index)?;
        Some(if self.reversed { start } else { end })
    }
}

/// A move between two strokes.
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

/// Wrapper for a TSP tour with some useful methods.
pub struct Tour<'a> {
    inner: Vec<Node>,
    /// Necessarily 1 shorter than `inner`.
    lengths: Vec<f64>,

    /// Forward mapping to avoid modifying any pre-computed data structures.
    stroke_index_to_tour_index: Vec<usize>,
    stroke_points: &'a [(Point<f64>, Point<f64>)],
}

impl<'a> Tour<'a> {
    /// Builds an initial, poor quality tour with greedy nearest-neighbor search.
    ///
    /// Flips segments by allowing visits to stroke stroke_points.
    pub fn new_greedy_nearest_neighbor(
        stroke_points: &'a [(Point<f64>, Point<f64>)],
        point_tree: &RTree<GeomWithData<[f64; 2], StrokePointData>>,
        starting_point: Point<f64>,
    ) -> Self {
        let mut visited = vec![false; stroke_points.len()];
        let mut inner = Vec::with_capacity(stroke_points.len());

        let mut current_point = starting_point;

        for _ in 0..stroke_points.len() {
            let Some(nearest) = point_tree
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
            if let Some(end) = node.normalized_end_point(stroke_points) {
                current_point = end;
            }

            inner.push(node);
        }

        Self::from_vertices(inner, stroke_points)
    }

    fn from_vertices(vertices: Vec<Node>, stroke_points: &'a [(Point<f64>, Point<f64>)]) -> Self {
        Self {
            lengths: vertices
                .array_windows::<2>()
                .filter_map(|[a, b]| {
                    Some(
                        (a.normalized_end_point(stroke_points)?
                            - b.normalized_start_point(stroke_points)?)
                        .length(),
                    )
                })
                .collect(),
            stroke_index_to_tour_index: {
                let mut stroke_index_to_tour_index = vec![0; stroke_points.len()];
                for (pos, node) in vertices.iter().enumerate() {
                    if let Some(p) = stroke_index_to_tour_index.get_mut(node.stroke_index) {
                        *p = pos;
                    }
                }
                stroke_index_to_tour_index
            },
            inner: vertices,
            stroke_points,
        }
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn node(&self, tour_index: usize) -> Option<&Node> {
        self.inner.get(tour_index)
    }

    pub fn tour_index_to_stroke_index(&self, tour_index: usize) -> Option<usize> {
        self.inner.get(tour_index).map(|n| n.stroke_index)
    }

    pub fn stroke_index_to_tour_index(&self, stroke_index: usize) -> Option<usize> {
        self.stroke_index_to_tour_index.get(stroke_index).copied()
    }

    pub fn start_point_of(&self, tour_index: usize) -> Option<Point<f64>> {
        self.inner
            .get(tour_index)?
            .normalized_start_point(self.stroke_points)
    }

    pub fn end_point_of(&self, tour_index: usize) -> Option<Point<f64>> {
        self.inner
            .get(tour_index)?
            .normalized_end_point(self.stroke_points)
    }

    pub fn length_at(&self, edge_index: usize) -> Option<f64> {
        self.lengths.get(edge_index).copied()
    }

    pub fn edge(&self, edge_index: usize) -> Option<Edge> {
        Some(Edge {
            from: self.end_point_of(edge_index)?,
            to: self.start_point_of(edge_index + 1)?,
            len: self.length_at(edge_index)?,
        })
    }

    pub fn total_length(&self, start_point: Point<f64>) -> f64 {
        let from_start_point = self
            .start_point_of(0)
            .map_or(0.0, |p| (start_point - p).length());
        from_start_point + self.lengths.iter().sum::<f64>()
    }

    /// Any cached calculations at `tour_index` need to be redone.
    fn invalidate(&mut self, tour_index: usize) {
        if let (Some(from), Some(to)) = (
            self.end_point_of(tour_index),
            self.start_point_of(tour_index + 1),
        ) && let Some(len) = self.lengths.get_mut(tour_index)
        {
            *len = (to - from).length();
        }
    }

    pub fn apply_relocate(
        &mut self,
        Relocate {
            block_start_index,
            block_len,
            target_index,
            reversed,
        }: Relocate,
    ) {
        let block_end = block_start_index.get() + (block_len.get() - 1);

        let (min, max, new_block_start, new_block_end) = if target_index > block_end {
            // Rotating both the block and any elements including `target_index` left shifts the block directly into place.
            if let Some(slice) = self.inner.get_mut(block_start_index.get()..=target_index) {
                slice.rotate_left(block_len.get());
            }
            let new_start = target_index - block_len.get() + 1;
            (
                block_start_index.get(),
                target_index,
                new_start,
                target_index,
            )
        } else {
            // Rotating both the block and any elements behind including `target_index + 1` right shifts the block directly into place.
            if let Some(slice) = self.inner.get_mut((target_index + 1)..=block_end) {
                slice.rotate_right(block_len.get());
            }
            let new_start = target_index + 1;
            let new_end = target_index + block_len.get();
            (target_index + 1, block_end, new_start, new_end)
        };

        if reversed && let Some(slice) = self.inner.get_mut(new_block_start..=new_block_end) {
            slice.reverse();
            for node in slice.iter_mut() {
                node.reversed = !node.reversed;
            }
        }

        // Update indices after rotation
        for idx in min..=max {
            if let Some(node) = self.inner.get(idx)
                && let Some(p) = self.stroke_index_to_tour_index.get_mut(node.stroke_index)
            {
                *p = idx;
            }
        }

        let dist_start = min.saturating_sub(1);
        let dist_end = max.min(self.len().saturating_sub(2));
        // TODO: this should also be rotated and only the endpoints invalidated if not reversed.
        for k in dist_start..=dist_end {
            self.invalidate(k);
        }
    }

    fn reverse_range(&mut self, range: RangeInclusive<usize>) {
        let start = *range.start();
        let end = *range.end();

        if let Some(slice) = self.inner.get_mut(range) {
            slice.reverse();

            for (offset, node) in slice.iter_mut().enumerate() {
                node.reversed = !node.reversed;

                // Update reverse mapping
                if let Some(tour_index) = self.stroke_index_to_tour_index.get_mut(node.stroke_index)
                {
                    *tour_index = start + offset;
                }
            }
        }

        // Internal lengths are reversed. `end` is a node so this slice will exist.
        if let Some(slice) = self.lengths.get_mut(start..end) {
            slice.reverse();
        }

        // Boundary lengths need to be updated
        if let Some(prev) = start.checked_sub(1) {
            self.invalidate(prev);
        }
        self.invalidate(end);
    }

    pub fn apply_two_opt(&mut self, two_opt: TwoOpt) {
        self.reverse_range(two_opt.range);
    }

    pub fn apply_link_swap(&mut self, LinkSwap { kind, split_index }: LinkSwap) {
        if matches!(kind, LinkSwapKind::Prefix | LinkSwapKind::Both) {
            self.reverse_range(0..=split_index);
        }
        if matches!(kind, LinkSwapKind::Suffix | LinkSwapKind::Both) {
            self.reverse_range((split_index + 1)..=self.len().saturating_sub(1));
        }
    }

    /// Reconstructs reordered/reversed [`Stroke`]s from the tour.
    pub fn into_strokes(self, strokes: Vec<Stroke>) -> Vec<Stroke> {
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
