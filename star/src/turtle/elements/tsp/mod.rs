mod moves;
mod optimize;
mod tour;
mod types;

use lyon_geom::{Point, point};

use self::{
    tour::Tour,
    types::{StrokeKNearestNeighbors, StrokePointData},
};
use crate::turtle::Stroke;

/// Reorders strokes to minimize the travel time between them.
///
/// <https://github.com/sameer/raster2svg>
/// <https://www.mdpi.com/2076-3417/9/19/3985/pdf>
/// <https://tsp-basics.blogspot.com/2017/03/using-dont-look-bits-dlb-2-opt.html>
pub fn minimize_travel_time(strokes: Vec<Stroke>, starting_point: [Option<f64>; 2]) -> Vec<Stroke> {
    let [first, _second, ..] = strokes.as_slice() else {
        return strokes;
    };

    let starting_point = starting_point[0]
        .zip(starting_point[1])
        .map(|(x, y)| point(x, y))
        .unwrap_or(first.start_point());

    let stroke_points: Vec<(Point<f64>, Point<f64>)> = strokes
        .iter()
        .map(|s| (s.start_point(), s.end_point()))
        .collect();
    let point_tree = StrokePointData::new_tree(&stroke_points);

    let mut tour = Tour::new_greedy_nearest_neighbor(&stroke_points, &point_tree, starting_point);
    let candidate_neighbors =
        StrokeKNearestNeighbors::k_nearest_neighbors(&stroke_points, &point_tree);
    drop(point_tree);

    tour.local_improvement(&candidate_neighbors, starting_point);
    tour.remove_crossings();

    tour.into_strokes(strokes)
}
