use lyon_geom::Point;
use rstar::{RTree, primitives::GeomWithData};

#[derive(Debug, Clone, Copy)]
pub(super) struct StrokeEndpointData {
    pub(super) stroke_index: usize,
    pub(super) end_point: bool,
}

impl StrokeEndpointData {
    /// Constructs an R-tree out of stroke start/end pairs.
    pub(super) fn new_tree(
        stroke_endpoints: &[(Point<f64>, Point<f64>)],
    ) -> RTree<GeomWithData<[f64; 2], Self>> {
        RTree::bulk_load(
            stroke_endpoints
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

#[derive(Debug, Clone)]
pub(super) struct StrokeNeighbors {
    /// Up to K nearest strokes to start_point
    pub(super) start_neighbors: Vec<usize>,
    /// Up to K nearest strokes to end_point
    pub(super) end_neighbors: Vec<usize>,
}

impl StrokeNeighbors {
    /// Maximum number of k-NN neighbors to evaluate.
    const K: usize = 20;

    /// Precomputes K-nearest candidate neighbors for each stroke's start and end points using the spatial index.
    pub(super) fn k_nearest_neighbors(
        endpoints: &[(Point<f64>, Point<f64>)],
        endpoint_tree: &RTree<GeomWithData<[f64; 2], StrokeEndpointData>>,
    ) -> Vec<Self> {
        endpoints
            .iter()
            .enumerate()
            .map(|(stroke_index, &(start, end))| {
                let start_neighbors =
                    Self::k_nearest_excluding(start, stroke_index, endpoint_tree);
                let end_neighbors = Self::k_nearest_excluding(end, stroke_index, endpoint_tree);
                Self {
                    start_neighbors,
                    end_neighbors,
                }
            })
            .collect()
    }

    fn k_nearest_excluding(
        query_point: Point<f64>,
        exclude_stroke_index: usize,
        endpoint_tree: &RTree<GeomWithData<[f64; 2], StrokeEndpointData>>,
    ) -> Vec<usize> {
        endpoint_tree
            .nearest_neighbor_iter([query_point.x, query_point.y])
            .filter_map(|geom_with_data| {
                let stroke = geom_with_data.data.stroke_index;
                (stroke != exclude_stroke_index).then_some(stroke)
            })
            .take(Self::K)
            .collect()
    }
}
