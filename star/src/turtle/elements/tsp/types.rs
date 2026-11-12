use lyon_geom::Point;
use rstar::{RTree, primitives::GeomWithData};
use smallvec::SmallVec;

#[derive(Debug, Clone, Copy)]
pub struct StrokePointData {
    pub stroke_index: usize,
    pub end_point: bool,
}

impl StrokePointData {
    /// Builds an R-tree containing stroke start/end points.
    pub fn new_tree(
        stroke_points: &[(Point<f64>, Point<f64>)],
    ) -> RTree<GeomWithData<[f64; 2], Self>> {
        RTree::bulk_load(
            stroke_points
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

/// Precomputed list of points nearest to either end of a stroke.
#[derive(Debug, Clone)]
pub struct StrokeKNearestNeighbors {
    /// Up to K nearest strokes to start_point
    start_neighbor_indices: SmallVec<[usize; Self::K]>,
    /// Up to K nearest strokes to end_point
    end_neighbor_indices: SmallVec<[usize; Self::K]>,
}

impl StrokeKNearestNeighbors {
    /// Number of neighbors to precompute.
    const K: usize = 20;

    /// Precomputes [`Self::K`] nearest candidate neighbors for each stroke.
    pub fn k_nearest_neighbors(
        stroke_points: &[(Point<f64>, Point<f64>)],
        point_tree: &RTree<GeomWithData<[f64; 2], StrokePointData>>,
    ) -> Vec<Self> {
        stroke_points
            .iter()
            .enumerate()
            .map(|(stroke_index, &(start, end))| Self {
                start_neighbor_indices: Self::k_nearest_excluding(start, stroke_index, point_tree),
                end_neighbor_indices: Self::k_nearest_excluding(end, stroke_index, point_tree),
            })
            .collect()
    }

    /// Excludes `excluded_index` and duplicate endpoints so a stroke's neighbors are unique and do not include itself.
    fn k_nearest_excluding(
        query_point: Point<f64>,
        excluded_index: usize,
        point_tree: &RTree<GeomWithData<[f64; 2], StrokePointData>>,
    ) -> SmallVec<[usize; Self::K]> {
        let mut neighbors = SmallVec::with_capacity(Self::K);
        for geom in point_tree.nearest_neighbor_iter([query_point.x, query_point.y]) {
            let stroke_index = geom.data.stroke_index;
            if stroke_index != excluded_index && !neighbors.contains(&stroke_index) {
                neighbors.push(stroke_index);
                if neighbors.len() == Self::K {
                    break;
                }
            }
        }
        neighbors
    }

    pub fn normalized_start_neighbors(&self, reversed: bool) -> &SmallVec<[usize; Self::K]> {
        if reversed {
            &self.end_neighbor_indices
        } else {
            &self.start_neighbor_indices
        }
    }

    pub fn normalized_end_neighbors(&self, reversed: bool) -> &SmallVec<[usize; Self::K]> {
        if reversed {
            &self.start_neighbor_indices
        } else {
            &self.end_neighbor_indices
        }
    }
}
