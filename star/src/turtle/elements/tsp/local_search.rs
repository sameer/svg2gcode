use std::num::NonZeroUsize;

use log::debug;
use lyon_geom::Point;
use rand::RngExt;

use super::{
    index::{EdgeIndex, IndexedVec, StrokeIndex, TourIndex},
    moves::{LinkSwap, LinkSwapKind, Relocate, TwoOpt},
    stroke_types::StrokeKNearestNeighbors,
    tour::Tour,
};

struct DontLook(IndexedVec<StrokeIndex, bool>);

impl DontLook {
    fn new(neighbors: &IndexedVec<StrokeIndex, StrokeKNearestNeighbors>) -> Self {
        Self(neighbors.filled_like(true))
    }

    fn enabled(&self, stroke_idx: StrokeIndex) -> bool {
        self.0[stroke_idx]
    }

    fn disable(&mut self, stroke_idx: StrokeIndex) {
        self.0[stroke_idx] = false;
    }

    fn enable(&mut self, tour: &Tour, tour_index_it: impl IntoIterator<Item = TourIndex>) {
        for tour_idx in tour_index_it {
            self.0[tour[tour_idx].stroke_index()] = true;
        }
    }
}

impl Tour<'_> {
    /// Minimum improvement necessary to accept a tour modification.
    ///
    /// At extremely small float values, the result of a move may not actually improve the tour.
    const MIN_IMPROVEMENT: f64 = 1E-12;

    /// Finds some improving relocate operation given a fixed block length and entering edge, if any.
    fn next_relocate_with_len_at(
        &self,
        before_block: EdgeIndex,
        block_len: NonZeroUsize,
        stroke_neighbors: &IndexedVec<StrokeIndex, StrokeKNearestNeighbors>,
    ) -> Option<Relocate> {
        let after_block = self.checked_add_edges(before_block, block_len)?;

        // Removing the block connects before_block.from directly to after_block.to.
        let edge_to_block_start = self.edge(before_block);
        let edge_at_block_end = self.edge(after_block);
        let start = edge_to_block_start.to;
        let end = edge_at_block_end.from;
        let unlink_saving = (edge_to_block_start.len + edge_at_block_end.len)
            - (edge_to_block_start.from - edge_at_block_end.to).length();

        let incident_edges = |idx: TourIndex| {
            self.exiting_edge(idx)
                .into_iter()
                .chain(self.entering_edge(idx))
        };

        let start_node = self[before_block.end()];
        let incoming_nearest_neighbors = start_node
            .normalized_start_neighbors(start_node.neighbors(stroke_neighbors))
            .iter()
            .map(|&stroke| self[stroke])
            .flat_map(incident_edges);

        let end_node = self[after_block.start()];
        let outgoing_nearest_neighbors = end_node
            .normalized_end_neighbors(end_node.neighbors(stroke_neighbors))
            .iter()
            .map(|&stroke| self[stroke])
            .flat_map(incident_edges);

        let target_edge_candidates = incoming_nearest_neighbors.chain(outgoing_nearest_neighbors);

        for target_edge_idx in target_edge_candidates {
            // Cannot move the range into itself or its bordering edges.
            if (before_block..=after_block).contains(&target_edge_idx) {
                continue;
            }

            let target_edge = self.edge(target_edge_idx);
            let savings = target_edge.len + unlink_saving;

            // `start` will be inserted into `target_edge`, breaking it.
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
                return Relocate::new(before_block, after_block, target_edge_idx, reversed);
            }
        }

        None
    }

    /// Finds some improving relocate for a block starting immediately after `before_block`, if any.
    fn next_relocate_at(
        &self,
        before_block: EdgeIndex,
        stroke_neighbors: &IndexedVec<StrokeIndex, StrokeKNearestNeighbors>,
    ) -> Option<Relocate> {
        const MAX_BLOCK_LEN: NonZeroUsize = NonZeroUsize::new(3).unwrap();

        (NonZeroUsize::MIN..=MAX_BLOCK_LEN).find_map(|block_len| {
            self.next_relocate_with_len_at(before_block, block_len, stroke_neighbors)
        })
    }

    fn try_relocate(
        &mut self,
        tour_idx: TourIndex,
        neighbors: &IndexedVec<StrokeIndex, StrokeKNearestNeighbors>,
        dlb: &mut DontLook,
    ) -> bool {
        let Some(before_block) = self.entering_edge(tour_idx) else {
            return false;
        };
        let Some(relocate) = self.next_relocate_at(before_block, neighbors) else {
            return false;
        };

        dlb.enable(
            self,
            TourIndex::range_inclusive(
                relocate.before_block().start(),
                relocate.after_block().end(),
            )
            .chain(relocate.target_edge().nodes()),
        );
        self.apply_relocate(relocate);
        true
    }

    /// Finds some improving 2-Opt that unlinks an edge on either side of `tour_index`, if any.
    fn next_two_opt_at(
        &self,
        tour_index: TourIndex,
        stroke_neighbors: &IndexedVec<StrokeIndex, StrokeKNearestNeighbors>,
    ) -> Option<TwoOpt> {
        let node = self[tour_index];
        let neighbors = node.neighbors(stroke_neighbors);

        // Unlink the edge leaving `tour_index`.
        let exit_edge_candidates =
            self.exiting_edge(tour_index)
                .into_iter()
                .flat_map(|exit_edge| {
                    node.normalized_end_neighbors(neighbors)
                        .iter()
                        .filter_map(move |&neighbor| self.exiting_edge(self[neighbor]))
                        .map(move |neighbor_edge| (exit_edge, neighbor_edge))
                });

        // Unlink the edge entering `tour_index`.
        let entry_edge_candidates =
            self.entering_edge(tour_index)
                .into_iter()
                .flat_map(|entry_edge| {
                    node.normalized_start_neighbors(neighbors)
                        .iter()
                        .filter_map(move |&neighbor| self.entering_edge(self[neighbor]))
                        .map(move |neighbor_edge| (entry_edge, neighbor_edge))
                });

        exit_edge_candidates.chain(entry_edge_candidates).find_map(
            |(edge_index_a, edge_index_b)| {
                let two_opt = TwoOpt::new(edge_index_a, edge_index_b)?;

                let edge_a = self.edge(edge_index_a);
                let edge_b = self.edge(edge_index_b);

                // Reversing the segment between the unlinks connects from with from and to with to.
                let savings = edge_a.len + edge_b.len;
                let cost = (edge_a.from - edge_b.from).length() + (edge_a.to - edge_b.to).length();

                let improvement = savings - cost;

                (improvement > Self::MIN_IMPROVEMENT).then_some(two_opt)
            },
        )
    }

    fn try_two_opt(
        &mut self,
        tour_index: TourIndex,
        neighbors: &IndexedVec<StrokeIndex, StrokeKNearestNeighbors>,
        dlb: &mut DontLook,
    ) -> bool {
        let Some(two_opt) = self.next_two_opt_at(tour_index, neighbors) else {
            return false;
        };

        dlb.enable(self, two_opt.modified());
        self.apply_two_opt(two_opt);
        true
    }

    fn find_best_link_swap(&self, origin: Point<f64>) -> Option<LinkSwap> {
        let tour_start = self.start_point(TourIndex::MIN);
        let tour_end = self.end_point(self.last());
        let initial_origin_travel = (origin - tour_start).length();

        self.edge_indices()
            .skip(1)
            .filter_map(|split_edge_idx| {
                let split_edge = self.edge(split_edge_idx);

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
                    // Reversing both starts the tour at split_edge.from and connects tour_start -> tour_end.
                    (
                        LinkSwapKind::Both,
                        split_edge.len - ((tour_start - tour_end).length() + delta_origin_travel),
                    ),
                ]
                .into_iter()
                .max_by(|(_, a), (_, b)| a.total_cmp(b))?;

                (best_improvement > Self::MIN_IMPROVEMENT).then_some((
                    best_improvement,
                    LinkSwap {
                        kind,
                        split_edge: split_edge_idx,
                    },
                ))
            })
            .max_by(|(imp_a, _), (imp_b, _)| imp_a.total_cmp(imp_b))
            .map(|(_, mov)| mov)
    }

    fn try_link_swap(&mut self, origin: Point<f64>, dlb: &mut DontLook) -> bool {
        let Some(link_swap) = self.find_best_link_swap(origin) else {
            return false;
        };

        if matches!(link_swap.kind, LinkSwapKind::Prefix | LinkSwapKind::Both) {
            dlb.enable(
                self,
                TourIndex::range_inclusive(TourIndex::MIN, link_swap.split_edge.start()),
            );
        }
        if matches!(link_swap.kind, LinkSwapKind::Suffix | LinkSwapKind::Both) {
            dlb.enable(
                self,
                TourIndex::range_inclusive(link_swap.split_edge.end(), self.last()),
            );
        }
        dlb.enable(self, link_swap.split_edge.nodes());
        self.apply_link_swap(link_swap);
        true
    }

    /// Local improvement of open-loop tour by repeatedly applying the first improvement found.
    ///
    /// Uses don't look bits to detect when a node with no known improvement may suddenly be able to change.
    pub fn local_improvement(
        &mut self,
        neighbors: &IndexedVec<StrokeIndex, StrokeKNearestNeighbors>,
        origin: Point<f64>,
    ) -> bool {
        let tour_len = self.len();
        if tour_len < 4 {
            return false;
        }

        let mut dont_look = DontLook::new(neighbors);
        let mut rng = rand::rng();

        let mut moves = 0;
        for iteration in 0.. {
            let start_offset = rng.random_range(0..tour_len);
            let mut moves_in_iteration = 0;

            for tour_idx in self.rotated_node_indices_from(start_offset) {
                let stroke_idx = self[tour_idx].stroke_index();

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
