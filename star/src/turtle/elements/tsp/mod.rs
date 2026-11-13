mod crossings;
mod index;
mod local_search;
mod moves;
mod stroke_types;
mod tour;

use lyon_geom::{Point, point};

use self::{
    index::{IndexedVec, StrokeIndex},
    stroke_types::{StrokeKNearestNeighbors, StrokePointData},
    tour::Tour,
};
use crate::turtle::Stroke;

/// Reorders strokes to minimize the travel time between them.
///
/// <https://github.com/sameer/raster2svg>
/// <https://www.mdpi.com/2076-3417/9/19/3985/pdf>
/// <https://tsp-basics.blogspot.com/2017/03/using-dont-look-bits-dlb-2-opt.html>
pub fn minimize_travel_time(strokes: Vec<Stroke>, origin: [Option<f64>; 2]) -> Vec<Stroke> {
    let [first, _second, ..] = strokes.as_slice() else {
        return strokes;
    };

    let origin = origin[0]
        .zip(origin[1])
        .map_or(first.start_point(), |(x, y)| point(x, y));

    let stroke_points: IndexedVec<StrokeIndex, (Point<f64>, Point<f64>)> = strokes
        .iter()
        .map(|s| (s.start_point(), s.end_point()))
        .collect();
    let point_tree = StrokePointData::new_tree(&stroke_points);

    let mut tour = Tour::new_greedy_nearest_neighbor(&stroke_points, &point_tree, origin);
    let candidate_neighbors =
        StrokeKNearestNeighbors::k_nearest_neighbors(&stroke_points, &point_tree);
    drop(point_tree);

    while tour.local_improvement(&candidate_neighbors, origin) | (tour.remove_crossings() != 0) {}

    tour.into_strokes(strokes)
}
