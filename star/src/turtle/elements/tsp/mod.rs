mod moves;
mod neighbors;
mod optimize;
mod tour;

use lyon_geom::{Point, point};

use self::neighbors::{StrokeEndpointData, StrokeNeighbors};
use self::tour::Tour;
use crate::turtle::Stroke;

/// Minimizes rapid movement travel time using a 2D planar TSP solver.
///
/// Combines spatial-index accelerated greedy nearest-neighbor construction,
/// First-Improvement Don't-Look-Bit sweeps (2-Opt, Relocate, and Link-Swap),
/// and deterministic planar crossing disentanglement.
///
/// <https://github.com/sameer/raster2svg>
/// <https://www.mdpi.com/2076-3417/9/19/3985/pdf>
pub fn minimize_travel_time(strokes: Vec<Stroke>, starting_point: [Option<f64>; 2]) -> Vec<Stroke> {
    if strokes.len() <= 1 {
        return strokes;
    }

    let [Some(x), Some(y)] = starting_point else {
        return strokes;
    };
    let starting_point = point(x, y);

    let endpoints: Vec<(Point<f64>, Point<f64>)> = strokes
        .iter()
        .map(|s| (s.start_point(), s.end_point()))
        .collect();

    let endpoint_tree = StrokeEndpointData::new_tree(&endpoints);
    let mut tour = Tour::new_greedy_nearest_neighbor(&endpoints, &endpoint_tree, starting_point);
    let candidate_neighbors = StrokeNeighbors::k_nearest_neighbors(&endpoints, &endpoint_tree);
    drop(endpoint_tree);

    tour.local_improvement(&candidate_neighbors, starting_point);
    tour.disentangle_crossings();

    tour.into_strokes(strokes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::tour::Node;
    use crate::turtle::elements::DrawCommand;
    use lyon_geom::LineSegment;

    fn make_line_stroke(from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> Stroke {
        Stroke::new(
            point(from_x, from_y),
            vec![DrawCommand::LineTo(LineSegment {
                from: point(from_x, from_y),
                to: point(to_x, to_y),
            })],
            None,
        )
    }

    #[test]
    fn test_nearest_neighbor_greedy_reordering() {
        let s1 = make_line_stroke(0.0, 0.0, 1.0, 0.0);
        let s2 = make_line_stroke(10.0, 0.0, 11.0, 0.0);
        let s3 = make_line_stroke(2.0, 0.0, 3.0, 0.0);

        let ordered = minimize_travel_time(vec![s2, s1, s3], [Some(0.0), Some(0.0)]);
        assert_eq!(ordered.len(), 3);
        assert!((ordered.first().unwrap().start_point() - point(0.0, 0.0)).length() < 1e-6);
        assert!((ordered.get(1).unwrap().start_point() - point(2.0, 0.0)).length() < 1e-6);
        assert!((ordered.get(2).unwrap().start_point() - point(10.0, 0.0)).length() < 1e-6);
    }

    #[test]
    fn test_nearest_neighbor_greedy_flips_stroke() {
        let backwards = make_line_stroke(5.0, 0.0, 1.0, 0.0);
        let endpoints = [(backwards.start_point(), backwards.end_point())];
        let tree = StrokeEndpointData::new_tree(&endpoints);
        let tour = Tour::new_greedy_nearest_neighbor(&endpoints, &tree, point(0.0, 0.0));
        assert_eq!(tour.len(), 1);
        let node = tour.node(0).unwrap();
        assert!(
            node.reversed,
            "Backward stroke must be marked reversed to enter at (1, 0)"
        );
    }

    #[test]
    fn test_minimize_travel_time_empty_and_single() {
        assert!(minimize_travel_time(vec![], [Some(0.0), Some(0.0)]).is_empty());

        let single = make_line_stroke(1.0, 2.0, 3.0, 4.0);
        let result = minimize_travel_time(vec![single], [Some(0.0), Some(0.0)]);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_minimize_travel_time_closed_loops() {
        let loop_stroke = Stroke::new(
            point(5.0, 5.0),
            vec![
                DrawCommand::LineTo(LineSegment {
                    from: point(5.0, 5.0),
                    to: point(10.0, 5.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(10.0, 5.0),
                    to: point(5.0, 5.0),
                }),
            ],
            None,
        );
        let s2 = make_line_stroke(0.0, 0.0, 1.0, 0.0);
        let result = minimize_travel_time(vec![loop_stroke, s2], [Some(0.0), Some(0.0)]);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_disentangle_bridges_distant_clusters() {
        // Cluster A: 25 strokes near (0, 0)
        // Cluster B: 25 strokes near (1000, 1000)
        let mut strokes = Vec::with_capacity(50);
        for i in 0..25 {
            let x = f64::from(i);
            strokes.push(make_line_stroke(x, 0.0, x + 0.5, 0.0));
        }
        for i in 0..25 {
            let x = 1000.0 + f64::from(i);
            strokes.push(make_line_stroke(x, 1000.0, x + 0.5, 1000.0));
        }

        let endpoints: Vec<(Point<f64>, Point<f64>)> = strokes
            .iter()
            .map(|s| (s.start_point(), s.end_point()))
            .collect();

        let endpoint_tree = StrokeEndpointData::new_tree(&endpoints);
        let candidate_neighbors = StrokeNeighbors::k_nearest_neighbors(&endpoints, &endpoint_tree);
        drop(endpoint_tree);

        // Verify mathematical saturation: K=20 candidate lists contain ZERO cross-cluster strokes.
        for c in candidate_neighbors.iter().take(25) {
            assert!(c.start_neighbors.iter().all(|&idx| idx < 25));
            assert!(c.end_neighbors.iter().all(|&idx| idx < 25));
        }
        for c in candidate_neighbors.iter().skip(25) {
            assert!(c.start_neighbors.iter().all(|&idx| idx >= 25));
            assert!(c.end_neighbors.iter().all(|&idx| idx >= 25));
        }

        // Intentionally create a crossed initial tour between Cluster A and Cluster B:
        // A[0..12] -> B[12..25] -> A[12..25] -> B[0..12]
        // This has multiple cross-cluster transitions (A->B and B->A, then A->B again).
        let mut initial_nodes = Vec::with_capacity(50);
        for i in 0..12 {
            initial_nodes.push(Node {
                stroke_index: i,
                reversed: false,
            });
        }
        for i in 37..50 {
            initial_nodes.push(Node {
                stroke_index: i,
                reversed: false,
            });
        }
        for i in 12..25 {
            initial_nodes.push(Node {
                stroke_index: i,
                reversed: false,
            });
        }
        for i in 25..37 {
            initial_nodes.push(Node {
                stroke_index: i,
                reversed: false,
            });
        }

        let mut tour = Tour::new_for_test(initial_nodes, &endpoints);
        assert!(tour.total_distance(point(0.0, 0.0)) > 4000.0);

        // Deterministic planar disentanglement eliminates crossing rapid traverses upfront.
        let untangled_count = tour.disentangle_crossings();
        assert!(
            untangled_count > 0,
            "Expected crossing cross-cluster edges to be untangled upfront"
        );

        tour.local_improvement(&candidate_neighbors, point(0.0, 0.0));

        let optimized_dist = tour.total_distance(point(0.0, 0.0));
        // A tour with untangled clusters needs only ONE cross-cluster jump (~1414) + intra-cluster travel (~50).
        // Total optimized travel should be < 2000.
        assert!(
            optimized_dist < 2000.0,
            "Expected distance < 2000 after untangling crossed clusters, got {optimized_dist}"
        );
    }

    #[test]
    fn test_two_opt_unzips_adjacent_crossings() {
        // Construct an entangled tour with adjacent crossing edges:
        // S0: (0, 0) -> (1, 0)
        // S1: (10, 10) -> (11, 10)
        // S2: (1, 1) -> (0, 1)
        // S3: (11, 11) -> (10, 11)
        // S4: (20, 0) -> (21, 0)
        let s0 = make_line_stroke(0.0, 0.0, 1.0, 0.0);
        let s1 = make_line_stroke(10.0, 10.0, 11.0, 10.0);
        let s2 = make_line_stroke(1.0, 1.0, 0.0, 1.0);
        let s3 = make_line_stroke(11.0, 11.0, 10.0, 11.0);
        let s4 = make_line_stroke(20.0, 0.0, 21.0, 0.0);

        let strokes = [s0, s1, s2, s3, s4];
        let endpoints: Vec<(Point<f64>, Point<f64>)> = strokes
            .iter()
            .map(|s| (s.start_point(), s.end_point()))
            .collect();

        let endpoint_tree = StrokeEndpointData::new_tree(&endpoints);
        let candidate_neighbors = StrokeNeighbors::k_nearest_neighbors(&endpoints, &endpoint_tree);
        drop(endpoint_tree);

        // Initial tour in the crossed order [0, 1, 2, 3, 4]
        let initial_nodes: Vec<Node> = (0..5)
            .map(|i| Node {
                stroke_index: i,
                reversed: false,
            })
            .collect();

        let mut tour = Tour::new_for_test(initial_nodes, &endpoints);
        assert!(tour.total_distance(point(0.0, 0.0)) > 50.0);

        tour.local_improvement(&candidate_neighbors, point(0.0, 0.0));

        let optimized_dist = tour.total_distance(point(0.0, 0.0));
        assert!(
            optimized_dist < 40.0,
            "Expected distance < 40 after unzipping, got {optimized_dist}"
        );
    }

    #[test]
    fn test_disentangle_planar_crossings_deterministic() {
        let s0 = make_line_stroke(-1.0, 0.0, 0.0, 0.0);
        let s1 = make_line_stroke(10.0, 10.0, 11.0, 10.0);
        let s2 = make_line_stroke(0.0, 11.0, 0.0, 10.0);
        let s3 = make_line_stroke(10.0, 0.0, 11.0, 0.0);

        let strokes = [s0, s1, s2, s3];
        let endpoints: Vec<(Point<f64>, Point<f64>)> = strokes
            .iter()
            .map(|s| (s.start_point(), s.end_point()))
            .collect();

        // Deliberately crossed tour: S0 -> S1 -> S2 -> S3
        // Edge 0: S0.end (0, 0) -> S1.start (10, 10)
        // Edge 2: S2.end (0, 10) -> S3.start (10, 0)
        // Edge 0 and Edge 2 form a clean 'X' crossing at (5, 5)
        let nodes = vec![
            Node {
                stroke_index: 0,
                reversed: false,
            },
            Node {
                stroke_index: 1,
                reversed: false,
            },
            Node {
                stroke_index: 2,
                reversed: false,
            },
            Node {
                stroke_index: 3,
                reversed: false,
            },
        ];

        let mut tour = Tour::new_for_test(nodes, &endpoints);
        let count = tour.disentangle_crossings();
        assert_eq!(count, 1, "Expected exactly 1 crossing to be untangled");

        // After untangling, zero crossings should remain
        assert_eq!(tour.first_crossing(), None);

        // Tour order should now be unzipped: S0 -> S2_reversed -> S1_reversed -> S3
        assert_eq!(tour.stroke_index(0), Some(0));
        assert_eq!(tour.stroke_index(1), Some(2));
        assert_eq!(tour.node(1).map(|n| n.reversed), Some(true));
        assert_eq!(tour.stroke_index(2), Some(1));
        assert_eq!(tour.node(2).map(|n| n.reversed), Some(true));
        assert_eq!(tour.stroke_index(3), Some(3));
    }

    #[test]
    fn test_block_relocate_moves_multi_stroke_block() {
        let s0 = make_line_stroke(-1.0, 0.0, 0.0, 0.0);
        let s1 = make_line_stroke(0.0, 0.5, 0.0, 1.5);
        let s2 = make_line_stroke(0.0, 2.0, -1.0, 2.0);
        let s3 = make_line_stroke(100.0, 0.0, 101.0, 0.0);
        let s4 = make_line_stroke(101.0, 0.5, 100.0, 0.5);
        let s5 = make_line_stroke(100.0, 2.0, 101.0, 2.0);

        let strokes = [s0, s1, s2, s3, s4, s5];
        let endpoints: Vec<(Point<f64>, Point<f64>)> = strokes
            .iter()
            .map(|s| (s.start_point(), s.end_point()))
            .collect();

        let endpoint_tree = StrokeEndpointData::new_tree(&endpoints);
        let candidate_neighbors = StrokeNeighbors::k_nearest_neighbors(&endpoints, &endpoint_tree);
        drop(endpoint_tree);

        // Tour: S0 -> S3 -> S4 -> S1 -> S2 -> S5
        let nodes = vec![
            Node {
                stroke_index: 0,
                reversed: false,
            },
            Node {
                stroke_index: 3,
                reversed: false,
            },
            Node {
                stroke_index: 4,
                reversed: false,
            },
            Node {
                stroke_index: 1,
                reversed: false,
            },
            Node {
                stroke_index: 2,
                reversed: false,
            },
            Node {
                stroke_index: 5,
                reversed: false,
            },
        ];

        let mut tour = Tour::new_for_test(nodes, &endpoints);
        let initial_dist = tour.total_distance(point(-1.0, 0.0));
        assert!(
            initial_dist > 200.0,
            "Initial tour traverses between clusters twice: {initial_dist}"
        );

        let mov = tour
            .find_improving_relocate_at(1, &candidate_neighbors)
            .expect("Expected relocate move");
        assert_eq!(mov.block_len, 2, "Expected 2-stroke block relocate");
        tour.apply_relocate(mov);

        let optimized_dist = tour.total_distance(point(-1.0, 0.0));
        assert!(
            optimized_dist < 150.0,
            "Expected distance < 150 after block relocate, got {optimized_dist}"
        );
    }
}
