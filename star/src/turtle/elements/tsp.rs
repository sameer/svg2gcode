//! Solves the TSP on a graph where each vertex is a tool-on stroke and an edge is tool-off move.
//!
//! Vertices have start/end points and are reversible. The triangle inequality still holds (AFAICT) because it's geometric.

use std::collections::VecDeque;

use log::{debug,warn};
use lyon_geom::Point;
use rand::{
    RngExt,
    distr::{Distribution, StandardUniform},
};
use rustc_hash::FxHashSet as HashSet;

use crate::turtle::elements::Stroke;

fn dist(a: Point<f64>, b: Point<f64>) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

/// Reorder (and optionally reverse) strokes to minimise total tool-off travel distance.
///
/// Uses [nearest_neighbor_greedy] for the initial ordering, then refines
/// with tabu search using the Relocate, 2-Opt, and LinkSwap operators.
///
/// Based off of the code in raster2svg.
///
/// <https://github.com/sameer/raster2svg>
/// <https://www.mdpi.com/2076-3417/9/19/3985/pdf>
pub fn minimize_travel_time(strokes: Vec<Stroke>,starting_point: [Option<f64>; 2] ) -> Vec<Stroke> {
    if strokes.len() <= 1 {
        return strokes;
    }
    let the_starting_point : Point<f64> = Point::new(starting_point[0].expect("No starting point Y"),starting_point[1].expect("No starting point Y"));

    let path = nearest_neighbor_greedy(strokes,the_starting_point);
    local_improvement_with_tabu_search(&path,the_starting_point)
}

/// Greedy nearest-neighbour ordering with flips.
///
/// Repeatedly chooses the [Stroke] or [Stroke::reversed] closest to the current point until none remain.
fn nearest_neighbor_greedy(mut remaining: Vec<Stroke>,the_starting_point: Point<f64> ) -> Vec<Stroke> {
    let mut result = Vec::with_capacity(remaining.len());
    // TODO: this assumption may be incorrect? depends on the GCode begin sequence, which this can't account for.
    let mut pos : Point<f64> = the_starting_point ;

    while !remaining.is_empty() {
        let mut best_idx = 0;
        let mut best_distance = f64::MAX;
        let mut best_is_reversed = false;

        for (i, stroke) in remaining.iter().enumerate() {
            let normal_distance = dist(pos, stroke.start_point());
            let reversed_distance = dist(pos, stroke.end_point());
            if normal_distance < best_distance {
                best_distance = normal_distance;
                best_idx = i;
                best_is_reversed = false;
            }
            if reversed_distance < best_distance {
                best_distance = reversed_distance;
                best_idx = i;
                best_is_reversed = true;
            }
        }

        let mut stroke = remaining.swap_remove(best_idx);
        if best_is_reversed {
            stroke.reversed();
        }
        pos = stroke.end_point();
        result.push(stroke);
    }

    result
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Operator {
    /// Move a vertex to a different position.
    Relocate,
    /// Reverse a sub-sequence of vertices between two edges.
    TwoOpt,
    /// Change the beginning and/or end of the path by swapping an edge.
    ///
    /// In the words of the paper:
    /// > Link swap is a special case of 3–opt and relocate operator, but as the size of the neighborhood is linear,
    /// > it is a faster operation than both 3–opt and relocate operator.
    LinkSwap,
}

impl Operator {
    const NUM_OPERATORS: usize = 3;
}

impl Distribution<Operator> for StandardUniform {
    /// Based on productivity results in the paper, link swap is given a chance of 50%
    /// while relocate and 2-opt have 25% each.
    fn sample<R: rand::Rng + ?Sized>(&self, rng: &mut R) -> Operator {
        match rng.random_range(0..=Operator::NUM_OPERATORS) {
            0 => Operator::Relocate,
            1 => Operator::TwoOpt,
            2 | 3 => Operator::LinkSwap,
            _ => unreachable!(),
        }
    }
}

/// `current_distances[i]` = tool-off distance from stroke `i`'s end to stroke `i+1`'s start.
/// Length is `n-1` for `n` strokes.
fn stroke_distances(path: &[Stroke]) -> Vec<f64> {
    path.windows(2)
        .map(|w| dist(w[0].end_point(), w[1].start_point()))
        .collect()
}

/// Reverse a series of strokes in-place and also calls [Stroke::reversed] on each [Stroke] to preserve the path.
fn reverse_and_flip(strokes: &mut [Stroke]) {
    strokes.reverse();
    for s in strokes.iter_mut() {
        s.reversed();
    }
}

/// Local improvement of an open-loop TSP solution using Relocate, 2-Opt, and LinkSwap.
/// Tabu search is used to avoid getting stuck early in local minima.
///
/// Ported from raster2svg's implementation of:
/// <https://www.mdpi.com/2076-3417/9/19/3985/pdf>
///
/// Differences from the point-based version in raster2svg:
/// - Distances use stroke endpoints (`end_point()` → `start_point`) rather than single vertices.
/// - TwoOpt and LinkSwap reversals also flip each stroke in the reversed range.
/// - Relocate tries both the normal and reversed orientation of the moved stroke.
/// - Distances are `f64` Euclidean rather than squared integers.
fn local_improvement_with_tabu_search(path: &[Stroke],the_starting_point: Point<f64> ) -> Vec<Stroke> {
    let mut best = path.to_owned();
    let mut best_sum: f64 = stroke_distances(&best).iter().sum::<f64>() + dist(the_starting_point,best[0].start_point()) ;

    let mut current = best.clone();
    let mut current_distances = stroke_distances(&current);
    let mut current_sum ;

    const ITERATIONS: usize = 20000;
    let mut rng = rand::rng();

    /// 10% of the past moves are considered tabu.
    const TABU_FRACTION: f64 = 0.1;
    let tabu_capacity = (current.len() as f64 * TABU_FRACTION) as usize;
    let mut tabu: VecDeque<usize> = VecDeque::with_capacity(tabu_capacity);
    let mut tabu_set: HashSet<usize> = HashSet::default();
    tabu_set.reserve(tabu_capacity);

    let mut stuck_operators: HashSet<Operator> = HashSet::default();

    for idx in 0..ITERATIONS {
        if stuck_operators.len() == Operator::NUM_OPERATORS {
            if tabu.is_empty() {
                debug!("TSP: stuck after {idx} iterations, no more local improvements");
                break;
            } else {
                // Try to unstick by clearing tabu.
                tabu.clear();
                tabu_set.clear();
                stuck_operators.clear();
            }
        }

        let operator: Operator = rng.random();

        match operator {
            // O(n^2): move stroke i to between j and j+1, trying both orientations.
            Operator::Relocate => {
                let best_move = (1..current.len().saturating_sub(1))
                    .filter(|&i| !tabu_set.contains(&i))
                    .flat_map(|i| {
                        // Improvement from removing stroke i from between i-1 and i+1.
                        let unlink_improvement = (current_distances[i - 1] + current_distances[i])
                            - dist(current[i - 1].end_point(), current[i + 1].start_point());

                        (0..i.saturating_sub(1))
                            .chain(i.saturating_add(1)..current.len().saturating_sub(1))
                            .map(move |j| (i, j, unlink_improvement))
                    })
                    .map(|(i, j, unlink_improvement)| {
                        let positive_diff = current_distances[j] + unlink_improvement;

                        // Cost of inserting stroke i between j and j+1 (normal orientation).
                        let neg_normal = dist(current[j].end_point(), current[i].start_point())
                            + dist(current[i].end_point(), current[j + 1].start_point());

                        // Cost of inserting stroke i reversed between j and j+1.
                        let neg_reversed = dist(current[j].end_point(), current[i].end_point())
                            + dist(current[i].start_point(), current[j + 1].start_point());

                        if neg_normal <= neg_reversed {
                            (i, j, false, positive_diff - neg_normal)
                        } else {
                            (i, j, true, positive_diff - neg_reversed)
                        }
                    })
                    .max_by(|a, b| a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal));

                if let Some((i, j, reversed, diff)) = best_move {
                    if diff <= 0.0 {
                        stuck_operators.insert(operator);
                        continue;
                    } else {
                        stuck_operators.clear();
                    }
                    let mut stroke = current.remove(i);
                    if reversed {
                        stroke.reversed();
                    }
                    let insert_at = if j < i { j + 1 } else { j };
                    current.insert(insert_at, stroke);
                    tabu.push_back(insert_at);
                    tabu_set.insert(insert_at);
                } else {
                    stuck_operators.insert(operator);
                    continue;
                }
            }

            // O(n^2): reverse the sub-sequence between two non-adjacent edges.
            // Each stroke in the reversed range is also reversed.
            Operator::TwoOpt => {
                let best_move = (0..current.len().saturating_sub(1))
                    .map(|i| (i, i + 1))
                    .flat_map(|(i, j)| {
                        (j.saturating_add(2)..current.len())
                            .map(move |other_j| ((i, j), (other_j - 1, other_j)))
                    })
                    .filter(|(this, other)| {
                        !tabu_set.contains(&this.1) && !tabu_set.contains(&other.0)
                    })
                    .map(|(this, other)| {
                        // Lose edge this.0→this.1 and other.0→other.1.
                        // Gain edge this.0→other.0 and this.1→other.1
                        // (after reversing [this.1..=other.0] and flipping each stroke).
                        let diff = (current_distances[this.0] + current_distances[other.0])
                            - (dist(current[this.0].end_point(), current[other.0].end_point())
                                + dist(
                                    current[this.1].start_point(),
                                    current[other.1].start_point(),
                                ));
                        (this, other, diff)
                    })
                    .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));

                if let Some((this, other, diff)) = best_move {
                    if diff <= 0.0 {
                        stuck_operators.insert(operator);
                        continue;
                    } else {
                        stuck_operators.clear();
                    }
                    tabu.extend([this.1, other.0]);
                    tabu_set.extend([this.1, other.0]);
                    reverse_and_flip(&mut current[this.1..=other.0]);
                } else {
                    stuck_operators.insert(operator);
                    continue;
                }
            }

            // O(n): for each interior edge, try replacing it with an edge to/from an endpoint.
            Operator::LinkSwap => {
                let first_start = current.first().unwrap().start_point();
                let last_end = current.last().unwrap().end_point();

                let best_move = (2..current.len().saturating_sub(1))
                    .map(|j| (j - 1, j))
                    .filter(|(i, j)| !tabu_set.contains(i) && !tabu_set.contains(j))
                    .map(|(i, j)| {
                        let from = current[i].end_point();
                        let to = current[j].start_point();

                        // Three candidate replacements for edge from→to, as in raster2svg.
                        // Option index encodes which endpoint(s) change:
                        //   0 = [from, last_end]: suffix [j..] reversed
                        //   1 = [first_start, to]: prefix [..=i] reversed
                        //   2 = [first_start, last_end]: both
                        let candidates = [
                            (0usize, dist(from, last_end)),
                            (1usize, dist(first_start, to)      +dist(the_starting_point,to)-dist(the_starting_point,first_start)),
                            (2usize, dist(first_start, last_end)+dist(the_starting_point,last_end)-dist(the_starting_point,first_start)),
                        ];
                        let (opt, best_new_dist) = candidates
                            .into_iter()
                            .min_by(|a, b| {
                                a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)
                            })
                            .unwrap();
                        (i, j, current_distances[i] - best_new_dist, opt)
                    })
                    .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));

                if let Some((i, j, diff, opt)) = best_move {
                    if diff <= 0.0 {
                        stuck_operators.insert(operator);
                        continue;
                    } else {
                        stuck_operators.clear();
                    }

                    // Apply prefix reversal (options 1 and 2).
                    if opt != 0 {
                        tabu.push_back(i);
                        tabu_set.insert(i);
                        reverse_and_flip(&mut current[..=i]);
                    }
                    // Apply suffix reversal (options 0 and 2).
                    if opt != 1 {
                        tabu.push_back(j);
                        tabu_set.insert(j);
                        reverse_and_flip(&mut current[j..]);
                    }
                } else {
                    stuck_operators.insert(operator);
                    continue;
                }
            }
        }

        current_distances = stroke_distances(&current);
        current_sum = current_distances.iter().sum::<f64>() +dist(the_starting_point,current[0].start_point()) ;

        if current_sum < best_sum {
            best = current.clone();
            best_sum = current_sum;
        }

        debug!(
            "TSP iteration {}/{} (best: {:.3}, tabu: {}/{}, strokes: {})",
            idx,
            ITERATIONS,
            best_sum,
            tabu.len(),
            tabu_capacity,
            current.len(),
        );

        while tabu.len() > tabu_capacity {
            tabu_set.remove(&tabu.pop_front().unwrap());
        }
    }

    best
}
