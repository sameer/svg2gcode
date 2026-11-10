use std::{convert::identity, num::NonZeroUsize};

use log::debug;
use lyon_geom::Point;
use rand::RngExt;
use rstar::{RTree, RTreeObject, primitives::GeomWithData};

use super::{
    moves::{Crossing, LinkSwap, LinkSwapKind, Relocate, TwoOpt},
    tour::Tour,
    types::StrokeKNearestNeighbors,
};

impl Tour<'_> {
    /// Minimum improvement necessary to accept a tour modification.
    ///
    /// At extremely small float values, the result of a move may not actually improve the tour.
    const MIN_IMPROVEMENT: f64 = 1E-12;

    /// Removes all non-Stroke (rapid movement) crossings with 2-Opt.
    ///
    /// An optimal tour has no crossings, and this does the long-range work that local improvement cannot.
    pub fn remove_crossings(&mut self) -> usize {
        let edge_count = self.len().saturating_sub(1);

        // TODO: is it actually possible to disentangle 2 by other means?
        if edge_count < 3 {
            return 0;
        }

        let mut crossing_count = 0;
        // TODO: more efficient don't look "range" storage.
        let mut touched = vec![false; self.len()];
        let mut queued = vec![];
        let mut edges = Vec::with_capacity(edge_count);

        loop {
            edges.extend(
                (0..edge_count)
                    .filter_map(|edge_index| Some(edge_index).zip(self.edge(edge_index))),
            );

            let edge_tree = RTree::bulk_load(
                edges
                    .iter()
                    .copied()
                    .map(|(edge_index, edge)| GeomWithData::new(edge, edge_index))
                    .collect(),
            );

            for &(first_edge_index, first_edge) in &edges {
                if touched
                    .get(first_edge_index..=first_edge_index + 1)
                    .map_or(true, |slice| slice.iter().copied().any(identity))
                {
                    continue;
                }

                for second_edge in edge_tree.locate_in_envelope_intersecting(first_edge.envelope())
                {
                    let second_edge_index = second_edge.data;
                    if touched
                        .get(second_edge_index..=second_edge_index + 1)
                        .map_or(true, |slice| slice.iter().copied().any(identity))
                    {
                        continue;
                    }

                    // Skip crossings that were already evaluated or pointless (flip 1).
                    if second_edge_index <= first_edge_index + 1 {
                        continue;
                    }

                    if first_edge
                        .line_segment()
                        .intersects(&second_edge.geom().line_segment())
                    {
                        let crossing = Crossing {
                            first_edge_index,
                            second_edge_index,
                        };
                        let Some(range) =
                            touched.get_mut(first_edge_index..=(second_edge_index + 1))
                        else {
                            continue;
                        };

                        if range.iter().copied().any(identity) {
                            continue;
                        }
                        range.fill(true);

                        // Valid candidate
                        queued.push(crossing);
                    }
                }
            }

            if queued.is_empty() {
                break;
            }

            touched.fill(false);
            crossing_count += queued.len();
            for crossing in queued.drain(..) {
                self.apply_two_opt(crossing.two_opt());
            }
            edges.clear();
        }

        crossing_count
    }

    /// Finds some improving relocate operation given a fixed block length and start.
    fn next_relocate_with_start_and_len(
        &self,
        block_start_index: NonZeroUsize,
        block_len: NonZeroUsize,
        node_neighbors: &[StrokeKNearestNeighbors],
    ) -> Option<Relocate> {
        let block_end = block_start_index.get() + (block_len.get() - 1);
        let prev_edge = self.edge(block_start_index.get() - 1)?;
        let curr_edge = self.edge(block_end)?;
        let unlink_saving = (prev_edge.len_squared + curr_edge.len_squared)
            - (prev_edge.from - curr_edge.to).square_length();
        let (first_start, last_end) = (prev_edge.to, curr_edge.from);

        let start_node = self.node(block_start_index.get())?;
        let end_node = self.node(block_end)?;
        let start_neighbors = node_neighbors.get(start_node.stroke_index)?;
        let end_neighbors = node_neighbors.get(end_node.stroke_index)?;

        let entry_indices = start_neighbors.normalized_start_neighbors(start_node.reversed);
        let exit_indices = end_neighbors.normalized_end_neighbors(end_node.reversed);

        let entry_targets = entry_indices
            .iter()
            .filter_map(|&stroke| self.stroke_index_to_tour_index(stroke));

        let exit_targets = exit_indices
            .iter()
            .filter_map(|&stroke| self.stroke_index_to_tour_index(stroke)?.checked_sub(1));

        let tour_len = self.len();
        for target_index in entry_targets.chain(exit_targets) {
            if target_index + 1 >= tour_len
                || (target_index + 1 >= block_start_index.get() && target_index <= block_end)
            {
                continue;
            }

            let Some(target_edge) = self.edge(target_index) else {
                continue;
            };

            let base_saving = target_edge.len_squared + unlink_saving;
            let cost_normal = (target_edge.from - first_start).square_length()
                + (last_end - target_edge.to).square_length();
            let cost_reversed = (target_edge.from - last_end).square_length()
                + (first_start - target_edge.to).square_length();

            let (cost, reversed) = if cost_normal <= cost_reversed {
                (cost_normal, false)
            } else {
                (cost_reversed, true)
            };

            let improvement = base_saving - cost;
            if improvement > Self::MIN_IMPROVEMENT {
                return Some(Relocate {
                    block_start_index,
                    block_len,
                    target_index,
                    reversed,
                });
            }
        }

        None
    }

    /// Finds some improving relocate at a given start.
    fn next_relocate_with_start(
        &self,
        block_start: NonZeroUsize,
        node_neighbors: &[StrokeKNearestNeighbors],
    ) -> Option<Relocate> {
        const MAX_BLOCK_LEN: NonZeroUsize = NonZeroUsize::new(3).unwrap();

        let tour_len = self.len();

        let max_block_len = MAX_BLOCK_LEN.min(NonZeroUsize::new(
            tour_len.saturating_sub(block_start.get() + 1),
        )?);

        (NonZeroUsize::MIN..=max_block_len).find_map(|block_len| {
            self.next_relocate_with_start_and_len(block_start, block_len, node_neighbors)
        })
    }

    fn next_two_opt_with_first_edge(
        &self,
        first_edge_idx: usize,
        node_neighbors: &[StrokeKNearestNeighbors],
    ) -> Option<TwoOpt> {
        let tour_len = self.len();
        if first_edge_idx + 3 > tour_len {
            return None;
        }

        let node = self.node(first_edge_idx)?;
        let neighbors = node_neighbors.get(node.stroke_index)?;
        let exit_neighbors = neighbors.normalized_end_neighbors(node.reversed);

        let first_edge = self.edge(first_edge_idx)?;

        for &neighbor in exit_neighbors {
            let Some(second_edge_idx) = self.stroke_index_to_tour_index(neighbor) else {
                continue;
            };
            if second_edge_idx < first_edge_idx + 2 || second_edge_idx + 1 >= tour_len {
                continue;
            }

            let Some(second_edge) = self.edge(second_edge_idx) else {
                continue;
            };

            let improvement = (first_edge.len_squared + second_edge.len_squared)
                - ((first_edge.from - second_edge.from).square_length()
                    + (first_edge.to - second_edge.to).square_length());
            if improvement > Self::MIN_IMPROVEMENT {
                return Some(TwoOpt {
                    range: (first_edge_idx + 1)..=second_edge_idx,
                });
            }
        }

        None
    }

    fn find_best_link_swap(&self, start_point: Point<f64>) -> Option<LinkSwap> {
        let tour_len = self.len();
        let first_start = self.start_point_of(0)?;
        let last_end = self.end_point_of(tour_len.saturating_sub(1))?;
        let start_to_first = dist(start_point, first_start);

        (1..tour_len.saturating_sub(1))
            .filter_map(|split_index| {
                let split_edge = self.edge(split_index)?;

                let start_to_split = dist(start_point, split_edge.from);
                let swap_options = [
                    (LinkSwapKind::Suffix, dist(split_edge.from, last_end)),
                    (
                        LinkSwapKind::Prefix,
                        dist(first_start, split_edge.to) + start_to_split - start_to_first,
                    ),
                    (
                        LinkSwapKind::Both,
                        dist(first_start, last_end) + start_to_split - start_to_first,
                    ),
                ];

                let (kind, best_new_dist) = swap_options
                    .into_iter()
                    .min_by(|(_, dist_a), (_, dist_b)| dist_a.total_cmp(dist_b))?;

                let improvement = split_edge.dist - best_new_dist;
                (improvement > Self::MIN_IMPROVEMENT)
                    .then_some((improvement, LinkSwap { kind, split_index }))
            })
            .max_by(|(imp_a, _), (imp_b, _)| imp_a.total_cmp(imp_b))
            .map(|(_, mov)| mov)
    }

    fn clear_dont_look_at(&self, tour_indices: &[usize], dont_look: &mut [bool]) {
        for &tour_idx in tour_indices {
            if let Some(stroke_idx) = self.tour_index_to_stroke_index(tour_idx)
                && let Some(flag) = dont_look.get_mut(stroke_idx)
            {
                *flag = false;
            }
        }
    }

    fn try_two_opt(
        &mut self,
        tour_idx: usize,
        neighbors: &[StrokeKNearestNeighbors],
        dont_look: &mut [bool],
    ) -> bool {
        if let Some(mov) = self.next_two_opt_with_first_edge(tour_idx, neighbors) {
            self.clear_dont_look_at(
                &[
                    mov.reverse_start.saturating_sub(1),
                    mov.reverse_start,
                    mov.reverse_end,
                    mov.reverse_end + 1,
                ],
                dont_look,
            );
            self.apply_two_opt(mov);
            true
        } else {
            false
        }
    }

    fn try_relocate(
        &mut self,
        tour_idx: usize,
        neighbors: &[StrokeKNearestNeighbors],
        dont_look: &mut [bool],
    ) -> bool {
        if let Some(mov) = self.next_relocate_with_start(tour_idx, neighbors) {
            let block_end = mov.block_start_index + mov.block_len - 1;
            self.clear_dont_look_at(
                &[
                    mov.block_start_index.saturating_sub(1),
                    mov.block_start_index,
                    block_end,
                    block_end + 1,
                    mov.target_index,
                    mov.target_index + 1,
                ],
                dont_look,
            );
            self.apply_relocate(mov);
            true
        } else {
            false
        }
    }

    /// Local improvement of open-loop tour using First-Improvement Sweeps with Don't-Look-Bits.
    pub fn local_improvement(
        &mut self,
        neighbors: &[StrokeKNearestNeighbors],
        start_point: Point<f64>,
    ) {
        let tour_len = self.len();
        if tour_len < 4 {
            return;
        }

        let mut dont_look = vec![false; self.len()];
        let mut rng = rand::rng();

        const MAX_SWEEPS: usize = 100;

        for sweep in 0..MAX_SWEEPS {
            let mut moves_in_sweep = 0;
            let start_offset = rng.random_range(0..tour_len);

            for step in 0..tour_len {
                let tour_idx = (start_offset + step) % tour_len;

                let stroke_idx = match self.node(tour_idx) {
                    Some(node) => node.stroke_index,
                    None => continue,
                };

                if dont_look.get(stroke_idx).copied().unwrap_or(true) {
                    continue;
                }

                #[expect(
                    clippy::if_same_then_else,
                    reason = "Short-circuiting evaluation order sets priority between 2-opt and relocate"
                )]
                let applied = if rng.random_bool(0.5) {
                    self.try_two_opt(tour_idx, neighbors, &mut dont_look)
                        || self.try_relocate(tour_idx, neighbors, &mut dont_look)
                } else {
                    self.try_relocate(tour_idx, neighbors, &mut dont_look)
                        || self.try_two_opt(tour_idx, neighbors, &mut dont_look)
                };

                if applied {
                    moves_in_sweep += 1;
                } else if let Some(flag) = dont_look.get_mut(stroke_idx) {
                    *flag = true;
                }
            }

            if let Some(mov) = self.find_best_link_swap(start_point) {
                let tour_len = self.len();
                self.clear_dont_look_at(
                    &[
                        0,
                        mov.split_index.saturating_sub(1),
                        mov.split_index,
                        mov.split_index + 1,
                        tour_len.saturating_sub(1),
                    ],
                    &mut dont_look,
                );
                self.apply_link_swap(mov);
                moves_in_sweep += 1;
            }

            debug!(
                "TSP DLB: sweep {sweep} applied {moves_in_sweep} moves, total dist: {:.6}",
                self.total_length(start_point)
            );

            if moves_in_sweep == 0 {
                debug!("TSP DLB: converged after {sweep} sweeps");
                break;
            }
        }
    }
}
