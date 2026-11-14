use std::convert::identity;

use rstar::{RTree, RTreeObject, primitives::GeomWithData};

use super::{moves::TwoOpt, tour::Tour};

impl Tour<'_> {
    /// Removes all non-Stroke (rapid movement) crossings with 2-Opt.
    ///
    /// An optimal tour has no crossings, and this does the long-range work that k-NN local improvement cannot.
    pub fn remove_crossings(&mut self) -> usize {
        let edge_count = self.edge_count();

        // TODO: is it actually possible to disentangle 2 by other means?
        if edge_count < 3 {
            return 0;
        }

        let mut crossing_count = 0;
        // TODO: more efficient range storage.
        let mut to_modify = self.filled_like(false);
        let mut crossings = vec![];
        let mut edges = Vec::with_capacity(edge_count);

        loop {
            edges.extend(
                self.edge_indices()
                    .map(|edge_index| (edge_index, self.edge(edge_index))),
            );

            let edge_tree = RTree::bulk_load(
                edges
                    .iter()
                    .copied()
                    .map(|(edge_index, edge)| GeomWithData::new(edge, edge_index))
                    .collect(),
            );

            for &(index_a, edge_a) in &edges {
                if to_modify[index_a.node_range()]
                    .iter()
                    .copied()
                    .any(identity)
                {
                    continue;
                }

                for edge_b in edge_tree.locate_in_envelope_intersecting(edge_a.envelope()) {
                    let index_b = edge_b.data;
                    if to_modify[index_b.node_range()]
                        .iter()
                        .copied()
                        .any(identity)
                    {
                        continue;
                    }

                    // Skip crossings that were already evaluated or pointless (flip 1).
                    if index_b <= index_a {
                        continue;
                    }
                    let Some(two_opt) = TwoOpt::new(index_a, index_b) else {
                        continue;
                    };

                    if edge_a
                        .line_segment()
                        .intersects(&edge_b.geom().line_segment())
                    {
                        let range = &mut to_modify[index_a.start()..=index_b.end()];
                        if range.iter().copied().any(identity) {
                            continue;
                        }
                        range.fill(true);

                        // Valid candidate
                        crossings.push(two_opt);
                    }
                }
            }

            if crossings.is_empty() {
                break;
            }

            to_modify.as_mut_slice().fill(false);
            crossing_count += crossings.len();
            for two_opt in crossings.drain(..) {
                self.apply_two_opt(two_opt);
            }
            edges.clear();
        }

        crossing_count
    }
}
