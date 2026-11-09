use log::debug;
use lyon_geom::Point;
use rand::RngExt;

use super::moves::{Crossing, LinkSwapKind, LinkSwapMove, RelocateMove, TwoOptMove};
use super::neighbors::StrokeNeighbors;
use super::tour::{Tour, dist};

impl Tour<'_> {
    /// Minimum improvement in millimeters required to accept a local tour modification.
    ///
    /// Prevents infinite limit cycles caused by sub-atomic IEEE 754 floating-point rounding
    /// jitter on symmetric or duplicate geometries.
    const MIN_IMPROVEMENT: f64 = 1e-12;

    /// Returns the first crossing of two edges in the tour found.
    ///
    /// Removing crossings improves the tour.
    #[cfg(test)]
    pub(super) fn first_crossing(&self) -> Option<Crossing> {
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
    pub(super) fn disentangle_crossings(&mut self) -> usize {
        let edge_count = self.len().saturating_sub(1);
        if edge_count < 3 {
            return 0;
        }

        let mut untangled_count = 0;
        while let Some(crossing) = self.first_crossing_in(edge_count) {
            self.reverse_range(crossing.reverse_range());
            untangled_count += 1;
        }

        untangled_count
    }

    fn first_crossing_in(&self, edge_count: usize) -> Option<Crossing> {
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

    fn find_improving_relocate_block(
        &self,
        block_start: usize,
        block_len: usize,
        node_neighbors: &[StrokeNeighbors],
    ) -> Option<RelocateMove> {
        let block_end = block_start + block_len - 1;
        let prev_edge = self.edge(block_start.checked_sub(1)?)?;
        let curr_edge = self.edge(block_end)?;
        let unlink_saving = (prev_edge.dist + curr_edge.dist) - dist(prev_edge.from, curr_edge.to);
        let (first_start, last_end) = (prev_edge.to, curr_edge.from);

        let start_node = self.node(block_start)?;
        let end_node = self.node(block_end)?;
        let start_neighbors = node_neighbors.get(start_node.stroke_index)?;
        let end_neighbors = node_neighbors.get(end_node.stroke_index)?;

        let entry_candidates = if start_node.reversed {
            &start_neighbors.end_neighbors
        } else {
            &start_neighbors.start_neighbors
        };

        let exit_candidates = if end_node.reversed {
            &end_neighbors.start_neighbors
        } else {
            &end_neighbors.end_neighbors
        };

        let entry_targets = entry_candidates
            .iter()
            .filter_map(|&stroke| self.stroke_index_to_tour_index(stroke));

        let exit_targets = exit_candidates.iter().filter_map(|&stroke| {
            self.stroke_index_to_tour_index(stroke)?.checked_sub(1)
        });

        let tour_len = self.len();
        for target_index in entry_targets.chain(exit_targets) {
            if target_index + 1 >= tour_len
                || (target_index + 1 >= block_start && target_index <= block_end)
            {
                continue;
            }

            let Some(target_edge) = self.edge(target_index) else {
                continue;
            };

            let base_saving = target_edge.dist + unlink_saving;
            let cost_normal =
                dist(target_edge.from, first_start) + dist(last_end, target_edge.to);
            let cost_reversed =
                dist(target_edge.from, last_end) + dist(first_start, target_edge.to);

            let (cost, reversed) = if cost_normal <= cost_reversed {
                (cost_normal, false)
            } else {
                (cost_reversed, true)
            };

            let improvement = base_saving - cost;
            if improvement > Self::MIN_IMPROVEMENT {
                return Some(RelocateMove {
                    block_start,
                    block_len,
                    target_index,
                    reversed,
                });
            }
        }

        None
    }

    pub(super) fn find_improving_relocate_at(
        &self,
        block_start: usize,
        node_neighbors: &[StrokeNeighbors],
    ) -> Option<RelocateMove> {
        let tour_len = self.len();
        if block_start == 0 || block_start >= tour_len.saturating_sub(1) {
            return None;
        }

        let max_block_len = 3.min(tour_len.saturating_sub(block_start + 1));
        (1..=max_block_len).find_map(|block_len| {
            self.find_improving_relocate_block(block_start, block_len, node_neighbors)
        })
    }

    fn find_improving_two_opt_at(
        &self,
        first_edge_idx: usize,
        node_neighbors: &[StrokeNeighbors],
    ) -> Option<TwoOptMove> {
        let tour_len = self.len();
        if first_edge_idx + 3 > tour_len {
            return None;
        }

        let node = self.node(first_edge_idx)?;
        let neighbors = node_neighbors.get(node.stroke_index)?;
        let exit_neighbors = if node.reversed {
            &neighbors.start_neighbors
        } else {
            &neighbors.end_neighbors
        };

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

            let improvement = (first_edge.dist + second_edge.dist)
                - (dist(first_edge.from, second_edge.from) + dist(first_edge.to, second_edge.to));
            if improvement > Self::MIN_IMPROVEMENT {
                return Some(TwoOptMove {
                    reverse_start: first_edge_idx + 1,
                    reverse_end: second_edge_idx,
                });
            }
        }

        None
    }

    fn find_best_link_swap(&self, start_point: Point<f64>) -> Option<LinkSwapMove> {
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
                    .then_some((improvement, LinkSwapMove { kind, split_index }))
            })
            .max_by(|(imp_a, _), (imp_b, _)| imp_a.total_cmp(imp_b))
            .map(|(_, mov)| mov)
    }

    fn clear_dont_look_at(&self, tour_indices: &[usize], dont_look: &mut [bool]) {
        for &tour_idx in tour_indices {
            if let Some(stroke_idx) = self.stroke_index(tour_idx)
                && let Some(flag) = dont_look.get_mut(stroke_idx)
            {
                *flag = false;
            }
        }
    }

    fn try_two_opt(
        &mut self,
        tour_idx: usize,
        neighbors: &[StrokeNeighbors],
        dont_look: &mut [bool],
    ) -> bool {
        if let Some(mov) = self.find_improving_two_opt_at(tour_idx, neighbors) {
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
        neighbors: &[StrokeNeighbors],
        dont_look: &mut [bool],
    ) -> bool {
        if let Some(mov) = self.find_improving_relocate_at(tour_idx, neighbors) {
            let block_end = mov.block_start + mov.block_len - 1;
            self.clear_dont_look_at(
                &[
                    mov.block_start.saturating_sub(1),
                    mov.block_start,
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
    pub(super) fn local_improvement(&mut self, neighbors: &[StrokeNeighbors], start_point: Point<f64>) {
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
                self.total_distance(start_point)
            );

            if moves_in_sweep == 0 {
                debug!("TSP DLB: converged after {sweep} sweeps");
                break;
            }
        }
    }
}
