use std::convert::identity;

use rstar::{RTree, RTreeObject, primitives::GeomWithData};

use crate::turtle::elements::tsp::{moves::TwoOpt, tour::Tour};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Crossing {
    first_edge_index: usize,
    second_edge_index: usize,
}

impl Crossing {
    fn two_opt(&self) -> TwoOpt {
        TwoOpt {
            range: (self.first_edge_index + 1)..=self.second_edge_index,
        }
    }
}

impl Tour<'_> {
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
        // TODO: more efficient range storage.
        let mut to_modify = vec![false; self.len()];
        let mut crossings = vec![];
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
                if to_modify
                    .get(first_edge_index..=first_edge_index + 1)
                    .is_none_or(|slice| slice.iter().copied().any(identity))
                {
                    continue;
                }

                for second_edge in edge_tree.locate_in_envelope_intersecting(first_edge.envelope())
                {
                    let second_edge_index = second_edge.data;
                    if to_modify
                        .get(second_edge_index..=second_edge_index + 1)
                        .is_none_or(|slice| slice.iter().copied().any(identity))
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
                            to_modify.get_mut(first_edge_index..=(second_edge_index + 1))
                        else {
                            continue;
                        };

                        if range.iter().copied().any(identity) {
                            continue;
                        }
                        range.fill(true);

                        // Valid candidate
                        crossings.push(crossing);
                    }
                }
            }

            if crossings.is_empty() {
                break;
            }

            to_modify.fill(false);
            crossing_count += crossings.len();
            for crossing in crossings.drain(..) {
                self.apply_two_opt(crossing.two_opt());
            }
            edges.clear();
        }

        crossing_count
    }
}
