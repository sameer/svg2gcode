use std::{iter, num::NonZeroUsize};

use log::debug;
use lyon_geom::Point;
use rand::RngExt;

use super::{
    moves::{LinkSwap, LinkSwapKind, Relocate, TwoOpt},
    tour::Tour,
    types::StrokeKNearestNeighbors,
};

struct DontLook {
    bits: Vec<bool>,
}

impl DontLook {
    fn new(tour_len: usize) -> Self {
        Self {
            bits: vec![true; tour_len],
        }
    }

    fn enabled(&self, stroke_idx: usize) -> bool {
        self.bits.get(stroke_idx).copied().unwrap_or(false)
    }

    fn disable(&mut self, stroke_idx: usize) {
        if let Some(state) = self.bits.get_mut(stroke_idx) {
            *state = false;
        }
    }

    fn enable(&mut self, tour: &Tour, tour_index_it: impl IntoIterator<Item = usize>) {
        for tour_idx in tour_index_it {
            if let Some(stroke_idx) = tour.tour_index_to_stroke_index(tour_idx)
                && let Some(state) = self.bits.get_mut(stroke_idx)
            {
                *state = true;
            }
        }
    }
}

impl Tour<'_> {
    /// Minimum improvement necessary to accept a tour modification.
    ///
    /// At extremely small float values, the result of a move may not actually improve the tour.
    const MIN_IMPROVEMENT: f64 = 1E-12;

    /// Finds some improving relocate operation given a fixed block length and start, if any.
    fn next_relocate_with_start_and_len(
        &self,
        block_start_index: NonZeroUsize,
        block_len: NonZeroUsize,
        node_neighbors: &[StrokeKNearestNeighbors],
    ) -> Option<Relocate> {
        let block_end = block_start_index.saturating_add(block_len.get() - 1);

        // Removing the nodes at block start/end connects the nodes on either side.
        let (start, end, unlink_saving) = {
            let edge_to_block_start = self.edge(block_start_index.get() - 1)?;
            let edge_at_block_end = self.edge(block_end.get())?;
            let unlink_saving = (edge_to_block_start.len + edge_at_block_end.len)
                - (edge_to_block_start.from - edge_at_block_end.to).length();

            (
                edge_to_block_start.to,
                edge_at_block_end.from,
                unlink_saving,
            )
        };

        let incoming_nearest_neighbors = {
            let start_node = self.node(block_start_index.get())?;
            let start_neighbors = node_neighbors.get(start_node.stroke_index)?;
            start_neighbors
                .normalized_start_neighbors(start_node.reversed)
                .iter()
                .filter_map(|&stroke| self.stroke_index_to_tour_index(stroke))
                .flat_map(|idx| iter::once(idx).chain(idx.checked_sub(1)))
        };

        let outgoing_nearest_neighbors = {
            let end_node = self.node(block_end.get())?;
            let end_neighbors = node_neighbors.get(end_node.stroke_index)?;
            end_neighbors
                .normalized_end_neighbors(end_node.reversed)
                .iter()
                .filter_map(|&stroke| self.stroke_index_to_tour_index(stroke))
                .flat_map(|idx| iter::once(idx).chain(idx.checked_sub(1)))
        };

        let target_index_candidates = incoming_nearest_neighbors.chain(outgoing_nearest_neighbors);

        let tour_len = self.len();
        for target_index in target_index_candidates {
            // Cannot move the range into itself
            let invalid_targets = (block_start_index.get() - 1)..=block_end.get();
            if target_index + 1 == tour_len || invalid_targets.contains(&target_index) {
                continue;
            }

            let Some(target_edge) = self.edge(target_index) else {
                continue;
            };

            let savings = target_edge.len + unlink_saving;

            // `start` will be inserted immediately after `target_index`, breaking `target_edge`.
            let cost_normal = (target_edge.from - start).length() + (end - target_edge.to).length();
            let cost_reversed =
                (target_edge.from - end).length() + (start - target_edge.to).length();

            // Picking the better move here is cheap
            let (cost, reversed) = if cost_normal <= cost_reversed {
                (cost_normal, false)
            } else {
                (cost_reversed, true)
            };

            let improvement = savings - cost;
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

    /// Finds some improving relocate at a given block start, if any.
    fn next_relocate_with_start(
        &self,
        block_start: NonZeroUsize,
        node_neighbors: &[StrokeKNearestNeighbors],
    ) -> Option<Relocate> {
        const MAX_BLOCK_LEN: NonZeroUsize = NonZeroUsize::new(3).unwrap();

        // Block must be strictly smaller than the tour to be able to move it.
        let max_block_len = MAX_BLOCK_LEN.min(NonZeroUsize::new(
            self.len().saturating_sub(block_start.get() + 1),
        )?);

        (NonZeroUsize::MIN..=max_block_len).find_map(|block_len| {
            self.next_relocate_with_start_and_len(block_start, block_len, node_neighbors)
        })
    }

    fn try_relocate(
        &mut self,
        tour_idx: usize,
        neighbors: &[StrokeKNearestNeighbors],
        dlb: &mut DontLook,
    ) -> bool {
        let Some(block_start) = NonZeroUsize::new(tour_idx) else {
            return false;
        };
        let Some(relocate) = self.next_relocate_with_start(block_start, neighbors) else {
            return false;
        };

        let start = relocate.block_start_index.get();
        let end = start + (relocate.block_len.get() - 1);

        dlb.enable(
            self,
            ((start - 1)..=(end + 1)).chain([
                relocate.target_index,
                (relocate.target_index + 1).min(self.len().saturating_sub(1)),
            ]),
        );
        self.apply_relocate(relocate);
        true
    }

    /// Finds some improving 2-Opt with one fixed unlink index, if any.
    fn next_two_opt_with_split_index(
        &self,
        unlink_index: usize,
        node_neighbors: &[StrokeKNearestNeighbors],
    ) -> Option<TwoOpt> {
        let unlink_edge = self.edge(unlink_index)?;
        let node = self.node(unlink_index)?;
        let neighbors = node_neighbors.get(node.stroke_index)?;
        let forward_neighbors = neighbors.normalized_end_neighbors(node.reversed);

        for &neighbor in forward_neighbors {
            let Some(neighbor_tour_index) = self.stroke_index_to_tour_index(neighbor) else {
                continue;
            };

            // The two edges to unlink cannot be identical or adjacent in the tour.
            if unlink_index.abs_diff(neighbor_tour_index) < 2 {
                continue;
            }

            let Some(neighbor_edge) = self.edge(neighbor_tour_index) else {
                continue;
            };

            // Reversing the segment between the unlinks connects from with from and to with to.
            let savings = unlink_edge.len + neighbor_edge.len;
            let cost = (unlink_edge.from - neighbor_edge.from).length()
                + (unlink_edge.to - neighbor_edge.to).length();

            let improvement = savings - cost;
            if improvement > Self::MIN_IMPROVEMENT {
                let start = unlink_index.min(neighbor_tour_index) + 1;
                let end = unlink_index.max(neighbor_tour_index);
                return Some(TwoOpt { range: start..=end });
            }
        }

        None
    }

    fn try_two_opt(
        &mut self,
        tour_idx: usize,
        neighbors: &[StrokeKNearestNeighbors],
        dlb: &mut DontLook,
    ) -> bool {
        let Some(two_opt) = self.next_two_opt_with_split_index(tour_idx, neighbors) else {
            return false;
        };

        let start = *two_opt.range.start();
        let end = *two_opt.range.end();
        let tour_len = self.len();
        dlb.enable(
            self,
            start.saturating_sub(1)..=((end + 1).min(tour_len.saturating_sub(1))),
        );
        self.apply_two_opt(two_opt);
        true
    }

    fn find_best_link_swap(&self, origin: Point<f64>) -> Option<LinkSwap> {
        let tour_start = self.start_point_of(0)?;
        let tour_end_idx = self.len().saturating_sub(1);
        let tour_end = self.end_point_of(tour_end_idx)?;
        let initial_origin_travel = (origin - tour_start).length();

        (1..tour_end_idx)
            .filter_map(|split_index| {
                let split_edge = self.edge(split_index)?;

                // Change in travel from origin if the tour starts at `split_edge.from` instead of `tour_start`
                let delta_origin_travel =
                    (origin - split_edge.from).length() - initial_origin_travel;

                let (kind, best_improvement) = [
                    // Suffix reversal connects split_edge.from -> tour_end.
                    (
                        LinkSwapKind::Suffix,
                        split_edge.len - (split_edge.from - tour_end).length(),
                    ),
                    // Prefix reversal starts the tour at split_edge.from and connects tour_start -> split_edge.to.
                    (
                        LinkSwapKind::Prefix,
                        split_edge.len
                            - ((tour_start - split_edge.to).length() + delta_origin_travel),
                    ),
                    // Reversing both starts the tour at at split_edge.from and connects tour_start -> tour_end.
                    (
                        LinkSwapKind::Both,
                        split_edge.len - ((tour_start - tour_end).length() + delta_origin_travel),
                    ),
                ]
                .into_iter()
                .max_by(|(_, a), (_, b)| a.total_cmp(b))?;

                (best_improvement > Self::MIN_IMPROVEMENT)
                    .then_some((best_improvement, LinkSwap { kind, split_index }))
            })
            .max_by(|(imp_a, _), (imp_b, _)| imp_a.total_cmp(imp_b))
            .map(|(_, mov)| mov)
    }

    fn try_link_swap(&mut self, origin: Point<f64>, dlb: &mut DontLook) -> bool {
        let Some(link_swap) = self.find_best_link_swap(origin) else {
            return false;
        };

        let tour_end_idx = self.len().saturating_sub(1);
        if matches!(link_swap.kind, LinkSwapKind::Prefix | LinkSwapKind::Both) {
            dlb.enable(self, 0..=link_swap.split_index);
        }
        if matches!(link_swap.kind, LinkSwapKind::Suffix | LinkSwapKind::Both) {
            dlb.enable(self, (link_swap.split_index + 1)..=tour_end_idx);
        }
        dlb.enable(
            self,
            [
                link_swap.split_index.saturating_sub(1),
                (link_swap.split_index + 1).min(tour_end_idx),
            ],
        );
        self.apply_link_swap(link_swap);
        true
    }

    /// Local improvement of open-loop tour by repeatedly applying the first improvement found.
    ///
    /// Uses don't look bits to detect when a node with no known improvement may suddenly be able to change.
    pub fn local_improvement(
        &mut self,
        neighbors: &[StrokeKNearestNeighbors],
        origin: Point<f64>,
    ) -> bool {
        let tour_len = self.len();
        if tour_len < 4 {
            return false;
        }

        let mut dont_look = DontLook::new(tour_len);
        let mut rng = rand::rng();

        let mut moves = 0;
        for iteration in 0.. {
            let start_offset = rng.random_range(0..tour_len);
            let mut moves_in_iteration = 0;

            for tour_idx in (start_offset..tour_len).chain(0..start_offset) {
                let Some(stroke_idx) = self.tour_index_to_stroke_index(tour_idx) else {
                    continue;
                };

                if !dont_look.enabled(stroke_idx) {
                    continue;
                }

                #[expect(
                    clippy::if_same_then_else,
                    reason = "Intentionally short-circuiting in different orders to set priority"
                )]
                let applied = if rng.random_bool(0.5) {
                    self.try_two_opt(tour_idx, neighbors, &mut dont_look)
                        || self.try_relocate(tour_idx, neighbors, &mut dont_look)
                } else {
                    self.try_relocate(tour_idx, neighbors, &mut dont_look)
                        || self.try_two_opt(tour_idx, neighbors, &mut dont_look)
                };

                if applied {
                    moves_in_iteration += 1;
                } else {
                    dont_look.disable(stroke_idx);
                }
            }

            if self.try_link_swap(origin, &mut dont_look) {
                moves_in_iteration += 1;
            }

            debug!(
                "TSP DLB: iteration {iteration} applied {moves_in_iteration} moves, total dist: {:.6}",
                self.total_length(origin)
            );

            if moves_in_iteration == 0 {
                debug!("TSP DLB: converged after {iteration} iterations");
                break;
            }

            moves += moves_in_iteration;
        }

        moves != 0
    }
}
