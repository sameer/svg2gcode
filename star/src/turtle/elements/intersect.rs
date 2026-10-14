use lyon_geom::{
    Angle, Arc, Box2D, CubicBezierSegment, LineSegment, Point, QuadraticBezierSegment, SvgArc,
    Transform, Vector, vector,
};
use smallvec::{SmallVec, smallvec};

use crate::turtle::elements::DrawCommand;

/// Used to exclude intersection endpoints and dedupe intersections.
pub const PARAM_EPSILON: f64 = 1e-6;

/// Semi-arbitrary floating-point error margin
const ROUNDOFF_EPSILON: f64 = 16.0 * f64::EPSILON;

/// Tolerance to snap angle offsets near 2*PI back to zero.
const ANGLE_SNAP_EPSILON: Angle<f64> = Angle {
    radians: ROUNDOFF_EPSILON,
};

/// Maximum number of iterations for Newton's method solvers.
const NEWTON_MAX_ITERATIONS: usize = 5;

/// Convergence tolerance for Newton's method solvers.
const NEWTON_EPSILON: f64 = 1e-12;

pub trait Intersections<Rhs = Self> {
    /// Returns the tuple (t, u) of intersections with respect to `self` and `rhs`.
    fn intersections(&self, rhs: &Rhs) -> SmallVec<[(f64, f64); 3]>;
}

impl Intersections<LineSegment<f64>> for LineSegment<f64> {
    fn intersections(&self, rhs: &LineSegment<f64>) -> SmallVec<[(f64, f64); 3]> {
        self.intersection_t(rhs).into_iter().collect()
    }
}

impl Intersections<LineSegment<f64>> for CubicBezierSegment<f64> {
    fn intersections(&self, line_seg: &LineSegment<f64>) -> SmallVec<[(f64, f64); 3]> {
        self.line_segment_intersections_t(line_seg)
            .into_iter()
            .collect()
    }
}

impl Intersections<LineSegment<f64>> for QuadraticBezierSegment<f64> {
    fn intersections(&self, line_seg: &LineSegment<f64>) -> SmallVec<[(f64, f64); 3]> {
        // There is a bug in `QuadraticBezierSegment::line_intersections_t`
        // https://github.com/nical/lyon/pull/975/
        self.to_cubic().intersections(line_seg)
    }
}

impl Intersections<CubicBezierSegment<f64>> for CubicBezierSegment<f64> {
    fn intersections(&self, rhs: &CubicBezierSegment<f64>) -> SmallVec<[(f64, f64); 3]> {
        self.cubic_intersections_t(rhs).into_iter().collect()
    }
}

impl Intersections<QuadraticBezierSegment<f64>> for CubicBezierSegment<f64> {
    fn intersections(&self, rhs: &QuadraticBezierSegment<f64>) -> SmallVec<[(f64, f64); 3]> {
        self.quadratic_intersections_t(rhs).into_iter().collect()
    }
}

impl Intersections<CubicBezierSegment<f64>> for QuadraticBezierSegment<f64> {
    fn intersections(&self, rhs: &CubicBezierSegment<f64>) -> SmallVec<[(f64, f64); 3]> {
        rhs.intersections(self)
            .into_iter()
            .map(|(t, u)| (u, t))
            .collect()
    }
}

impl Intersections<QuadraticBezierSegment<f64>> for QuadraticBezierSegment<f64> {
    fn intersections(&self, rhs: &QuadraticBezierSegment<f64>) -> SmallVec<[(f64, f64); 3]> {
        self.to_cubic().intersections(rhs)
    }
}

impl Intersections<SvgArc<f64>> for CubicBezierSegment<f64> {
    fn intersections(&self, svg_arc: &SvgArc<f64>) -> SmallVec<[(f64, f64); 3]> {
        svg_arc
            .intersections(self)
            .into_iter()
            .map(|(t, u)| (u, t))
            .collect()
    }
}

impl Intersections<QuadraticBezierSegment<f64>> for SvgArc<f64> {
    fn intersections(&self, qbs: &QuadraticBezierSegment<f64>) -> SmallVec<[(f64, f64); 3]> {
        self.intersections(&qbs.to_cubic())
    }
}

impl Intersections<SvgArc<f64>> for QuadraticBezierSegment<f64> {
    fn intersections(&self, svg_arc: &SvgArc<f64>) -> SmallVec<[(f64, f64); 3]> {
        svg_arc
            .intersections(self)
            .into_iter()
            .map(|(t, u)| (u, t))
            .collect()
    }
}

impl Intersections<LineSegment<f64>> for DrawCommand {
    fn intersections(&self, line: &LineSegment<f64>) -> SmallVec<[(f64, f64); 3]> {
        match self {
            DrawCommand::LineTo(l) => l.intersections(line),
            DrawCommand::CubicBezier(cbs) => cbs.intersections(line),
            DrawCommand::QuadraticBezier(qbs) => qbs.intersections(line),
            DrawCommand::Arc(arc) => arc.intersections(line),
        }
    }
}

/// Coordinate transformation mapping world space into the canonical unit-circle space
/// of an ellipse, coupled with the angular bounds of the arc.
struct CanonicalArcTransform {
    to_canonical: Transform<f64>,
    start_angle: Angle<f64>,
    sweep_angle: Angle<f64>,
}

impl CanonicalArcTransform {
    fn new_arc_to_unit(arc: &Arc<f64>) -> Self {
        Self {
            to_canonical: Transform::identity()
                .then_translate(-arc.center.to_vector())
                .then_rotate(-arc.x_rotation)
                .then_scale(1.0 / arc.radii.x.abs(), 1.0 / arc.radii.y.abs()),
            start_angle: arc.start_angle,
            sweep_angle: arc.sweep_angle,
        }
    }
    /// Converts a canonical-space point into a t-parameterized equivalent on the arc.
    /// Returns `None` if it does not lie on the arc.
    fn canonical_point_to_arc_t(&self, canonical_point: Point<f64>) -> Option<f64> {
        let total_sweep = Angle::radians(self.sweep_angle.radians.abs());
        let point_angle = Angle::radians(canonical_point.y.atan2(canonical_point.x));

        // Measure the angular offset from start_angle in the direction of sweep:
        let angular_offset = if self.sweep_angle.radians.is_sign_positive() {
            point_angle - self.start_angle
        } else {
            self.start_angle - point_angle
        }
        .positive();

        // Snap angular offset near 2PI back to 0 if the value was really close to 0 (i.e. -1E-10)
        let angular_offset = if angular_offset > Angle::two_pi() - ANGLE_SNAP_EPSILON {
            Angle::zero()
        } else {
            angular_offset
        };

        if angular_offset <= total_sweep + ANGLE_SNAP_EPSILON {
            Some((angular_offset / total_sweep).clamp(0.0, 1.0))
        } else {
            None
        }
    }

    /// Converts a world-space point into a t-parameterized equivalent on the arc.
    /// Returns `None` if it does not lie on the arc.
    fn world_point_to_arc_t(&self, pt: Point<f64>) -> Option<f64> {
        let canonical_point = self.to_canonical.transform_point(pt);
        self.canonical_point_to_arc_t(canonical_point)
    }

    /// Finds the t-parameterized intersections of the given world-space line segment
    /// with the arc if any, returning pairs `(t_arc, u_segment)`.
    fn world_line_intersections_t(&self, segment: &LineSegment<f64>) -> SmallVec<[(f64, f64); 2]> {
        let canonical_segment = segment.transformed(&self.to_canonical);
        Self::intersect_canonical_line(&canonical_segment)
            .into_iter()
            .filter_map(|u| {
                let canonical_point = canonical_segment.sample(u);
                self.canonical_point_to_arc_t(canonical_point)
                    .map(|t| (t, u))
            })
            .collect()
    }

    /// Find intersections of the unit circle with a line segment in canonical space.
    /// Returns the parameter values `u` along the line segment where intersections occur.
    ///
    /// Does not calculate arc t-values.
    fn intersect_canonical_line(canonical_seg: &LineSegment<f64>) -> SmallVec<[f64; 2]> {
        let line_start = canonical_seg.from;
        let line_dir = canonical_seg.to_vector();
        let seg_len_sq = canonical_seg.square_length();
        if seg_len_sq == 0.0 {
            return smallvec![];
        }

        // calculate u: the parameterized value where the line through from and to is closest to the origin
        //
        // Helpful math:
        // F = from, T = to, O = origin, M = closest point to the origin
        // |FM| = u * |FT|                  Closest point is "u" far along the line
        // |FT||FO| cos(theta) = FT . FO    Angle between line and start to origin is theta
        // |FM| / |FO| = cos(theta)         FMO is a right triangle
        //
        // |FT||FO| * |FM|/|FO| = FT . FO
        // |FT|*|FM| = FT . FO
        // |FT||FT|*u = FT . FO
        // u = (FT . FO) / (|FT|)^2
        let u_closest = {
            let to_origin = Point::origin() - line_start;
            to_origin.dot(line_dir) / seg_len_sq
        };
        let closest_pt = canonical_seg.sample(u_closest);

        let closest_point_dist_sq = (closest_pt - Point::origin()).square_length();
        // Unit circle is x^2 + y^2 = 1
        // If |MO| > 1, it cannot intersect with the unit circle
        if closest_point_dist_sq > 1.0 + ROUNDOFF_EPSILON {
            return smallvec![];
        }

        // M lies on or within the unit circle. Draw a chord through M along the line
        //
        // Helpful math:
        // O = origin, M = closest point to the origin, R = one of the two chord points on the circle
        // |MO|^2 + |MR|^2 = 1^2
        // |MR| = +/- sqrt(1 - |MO|^2)
        // |MR| = delta_u_chord * |FT|
        // delta_u_chord = |MR| / |FT| = +/- sqrt(1 - |MO|^2) / |FT|
        //
        // Now we know the u-parameterized distance from M to the chord points, which become:
        // u +/- delta_u_chord
        let half_chord_len = (1.0 - closest_point_dist_sq).max(0.0).sqrt();
        let half_chord_delta_u = half_chord_len / seg_len_sq.sqrt();

        let u_line_intersections: SmallVec<[f64; 2]> = if half_chord_delta_u < PARAM_EPSILON {
            // No chord, line is tangent
            smallvec![u_closest]
        } else {
            // Line is secant
            smallvec![
                u_closest - half_chord_delta_u,
                u_closest + half_chord_delta_u
            ]
        };

        u_line_intersections
            .into_iter()
            // We parameterized by u on the line segment FT, filter out
            // intersections on the line but not in the segment.
            .filter(|&u| (0.0..=1.0).contains(&u))
            .collect()
    }

    /// Given a good initial approximation `u` of a Bezier's intersection with the unit circle,
    /// refines the approximation to an actual intersection.
    fn refine_bezier_intersection(&self, cbs: &CubicBezierSegment<f64>, mut u: f64) -> f64 {
        // Given some parameterized `u` on the cubic bezier segment that is close to the arc,
        // we want to move it to be exactly intersecting with the arc.
        //
        // In canonical space, we can treat the arc as a unit circle.
        // Let b(u) be a function that returns the coordinates in canonical space.
        // Let b'(u) be a function that returns the bezier derivative vector in canonical space.
        //
        // The unit circle is x^2 + y^2 = 1.
        // Treating coordinates like vectors, this is |v|^2 = 1.
        //
        // We want the coordinate to lie on the unit circle in canonical space, which can be
        // formulated as a Newton's method approximation.
        // Newton's method finds roots so we want |v|^2 - 1 = 0.
        // Substituting our bezier function, we get a root finding problem:
        // f(u) = |b(u)|^2 - 1
        // The derivative of the magnitude of a vector:
        // |b(u)|' = (b(u) . b'(u)) / |b(u)|
        //
        // The derivative of the squared magnitude by chain + power rules:
        // (|b(u)|^2)' = 2 |b(u)| * |b(u)|'
        //             = 2 |b(u)| * ((b(u) . b'(u)) / |b(u)|)
        //             = 2 (b(u) . b'(u))
        //
        // So we repeatedly calculate
        // u_{n+1} = u_n - (|b(u)|^2 - 1) / (2 (b(u) . b'(u)))
        for _ in 0..NEWTON_MAX_ITERATIONS {
            let point = self.to_canonical.transform_point(cbs.sample(u));
            let derivative = self.to_canonical.transform_vector(cbs.derivative(u));

            let f_u = point.to_vector().square_length() - 1.0;
            let f_u_deriv = 2.0 * point.to_vector().dot(derivative);

            if f_u.abs() < NEWTON_EPSILON || f_u_deriv.abs() < NEWTON_EPSILON {
                break;
            }

            let step = f_u / f_u_deriv;
            u = (u - step).clamp(0.0, 1.0);
            if step.abs() < NEWTON_EPSILON {
                break;
            }
        }
        u
    }
}

impl Intersections<LineSegment<f64>> for SvgArc<f64> {
    fn intersections(&self, line_seg: &LineSegment<f64>) -> SmallVec<[(f64, f64); 3]> {
        let arc = self.to_arc();
        let to_canonical = CanonicalArcTransform::new_arc_to_unit(&arc);
        to_canonical
            .world_line_intersections_t(line_seg)
            .into_iter()
            .collect()
    }
}

impl Intersections<CubicBezierSegment<f64>> for SvgArc<f64> {
    fn intersections(&self, cbs: &CubicBezierSegment<f64>) -> SmallVec<[(f64, f64); 3]> {
        let arc = self.to_arc();
        let to_canonical = CanonicalArcTransform::new_arc_to_unit(&arc);
        let mut results: SmallVec<[(f64, f64); 3]> = SmallVec::new();

        arc.for_each_cubic_bezier(&mut |arc_sub| {
            for (u_cbs, _t_sub) in cbs.cubic_intersections_t(arc_sub) {
                let u = to_canonical.refine_bezier_intersection(cbs, u_cbs);
                let pt = cbs.sample(u);
                if let Some(t_arc) = to_canonical.world_point_to_arc_t(pt)
                // This could happen if the intersection is at the joint of two bezier approximations
                    && !results
                        .iter()
                        .any(|(_, existing_u)| (*existing_u - u).abs() < PARAM_EPSILON)
                {
                    results.push((t_arc, u));
                }
            }
        });

        results
    }
}

/// Determines if an arc has circular radii
fn is_circular(radii: Vector<f64>) -> bool {
    let rx = radii.x.abs();
    let ry = radii.y.abs();
    (rx - ry).abs() <= ROUNDOFF_EPSILON * rx
}

/// Finds the parameterized intersections of two world space circular arcs.
fn intersect_circles(circle1: &Arc<f64>, circle2: &Arc<f64>) -> SmallVec<[(f64, f64); 3]> {
    // Helpful math:
    // Consider two circles that intersect at points A, B.
    // The line AB is a chord of both circles with midpoint M.
    //
    // C1 = center of circle 1, C2 = center of circle 2
    // r1 = radius of circle 1, r2 = radius of circle 2
    // A = chord endpoint, M = chord midpoint
    //
    // A rhombus is formed by connecting C1AC2B,
    // but we focus on the triangle C1AC2 formed by drawing the
    // segment C1C2 perpendicular to the chord.
    //
    // The triangle C1AM has side lengths:
    // |C1A| = r1, |AM| = f, |MC1| = d
    // The triangle AC2M has side lengths:
    // |AC2| = r2, |C2M| = l - d, |MA| = f
    //
    // r1^2 = d^2 + f^2
    // f^2 = r1^2 - d^2
    //
    // r2^2 = (l - d)^2 + f^2
    // r2^2 = (l - d)^2 + r1^2 - d^2
    // r2^2 - r1^2 = (l - d)^2 - d^2
    // r2^2 - r1^2 = l^2 - 2dl + d^2 - d^2
    // r2^2 - r1^2 = l^2 - 2dl
    // 2dl = l^2 + r1^2 - r2^2
    // d = (l^2 + r1^2 - r2^2) / 2l
    //
    // |C1M| = d and M lies along C1C2.
    // So we can take the unit vector for C1C2 and scale it by
    // d to get the coordinates of M.
    // M = C1 + d * C1C2/|C1C2|
    //
    // Now we know d, we can find the coordinates of A and B.
    // |AM| = f
    // f^2 = r1^2 - d^2
    // f = sqrt(r1^2 - d^2)
    // |AM| = sqrt(r1^2 - d^2)
    // and since it's a rhombus, |BM| = sqrt(r1^2 - d^2)
    //
    // A = M + f * perpendicular(C1C2/|C1C2|)
    // B = M - f * perependicular(C1C2/|C1C2|)
    let center1 = circle1.center;
    let center2 = circle2.center;
    let r1 = circle1.radii.x.abs();
    let r2 = circle2.radii.x.abs();

    // C1C2
    let baseline = center2 - center1;
    // |C1C2|
    let center_dist_sq = baseline.square_length();
    if center_dist_sq <= ROUNDOFF_EPSILON {
        // Circles are concentric or identical
        return smallvec![];
    }

    let r1_sq = r1.powi(2);
    let r2_sq = r2.powi(2);

    let center_dist = center_dist_sq.sqrt();

    if center_dist - r1 - r2 > ROUNDOFF_EPSILON * (r1 + r2) {
        // |C1C2| = r1 + r2 when externally tangent
        // |C1C2| < r1 + r2 maybe secant
        // |C1C2| > r1 + r2 when externally disjoint
        return smallvec![];
    } else if center_dist - (r1 - r2).abs() < -ROUNDOFF_EPSILON * (r1 + r2) {
        // if r1 >= r2
        //  |C1C2| = r1 - r2 when internally tangent
        //  |C1C2| < r1 - r2 when internally disjoint
        //  |C1C2| > r1 - r2 maybe secant
        // if r1 < r2
        //  |C1C2| = r2 - r1 ""
        //  |C1C2| < r2 - r1 ""
        //  |C1C2| > r1 - r2 ""
        return smallvec![];
    }

    // d
    let chord_midpoint_dist_from_c1 = (center_dist_sq + r1_sq - r2_sq) / (2.0 * center_dist);
    // f^2
    let half_chord_sq = r1_sq - chord_midpoint_dist_from_c1.powi(2);
    // f
    let half_chord_len = half_chord_sq.max(0.0).sqrt();
    // C1C2 / |C1C2|
    let baseline_unit_vector = baseline / center_dist;
    // M
    let chord_midpoint = center1 + baseline_unit_vector * chord_midpoint_dist_from_c1;
    // AM unit vector
    let chord_norm_unit_vector = vector(-baseline_unit_vector.y, baseline_unit_vector.x);

    let candidate_points: SmallVec<[Point<f64>; 2]> = if half_chord_len == 0.0 {
        // Tangent when the chord has no length, the intersection points are coincident.
        smallvec![chord_midpoint]
    } else {
        // Circles intersect at two points (secant)
        smallvec![
            // A = M + AM
            chord_midpoint + chord_norm_unit_vector * half_chord_len,
            // B = M - AM
            chord_midpoint - chord_norm_unit_vector * half_chord_len,
        ]
    };

    let to_canonical1 = CanonicalArcTransform::new_arc_to_unit(circle1);
    let to_canonical2 = CanonicalArcTransform::new_arc_to_unit(circle2);

    candidate_points
        .into_iter()
        // Validate that the arcs themselves intersect, not just the circles
        .filter_map(|p| {
            if let (Some(t), Some(u)) = (
                to_canonical1.world_point_to_arc_t(p),
                to_canonical2.world_point_to_arc_t(p),
            ) {
                Some((t, u))
            } else {
                None
            }
        })
        .collect()
}

/// Given a good initial approximation (t, u) of the intersection between two arcs,
/// refine it with 2D Newton's method.
fn refine_arc_arc(arc1: &Arc<f64>, arc2: &Arc<f64>, mut t: f64, mut u: f64) -> Option<(f64, f64)> {
    // Helpful math:
    // The overall goal is to find (t, u) such that F1(t) = F2(u), where F is the arc sampling function.
    // We are given an approximation done with cubic bezier curves to be refined, because
    // F1(t) does not equal F2(u).
    //
    // Geometrically, F' is the tangent function of the arc.
    // Drawing lines from F1(t) and F2(u) with tangent slope respectively, they have an intersection X,
    // the linear approximation of refining both t and u.
    // X = F1(t) + delta_t * F1'(t)
    // X = F2(u) + delta_u * F2'(u)
    //
    // F1(t) + delta_t * F1'(t) = F2(u) + delta_u * F2'(u)
    // F2(u) - F1(t) = delta_t * F1'(t) - delta_u * F2'(u)
    // (F2(u) - F1(t)) x F2'(u) = delta_t * F1'(t) x F2'(u)
    // delta_t = ((F2(u) - F1(t)) x F2'(u)) / (F1'(t) x F2'(u))
    //
    // (F2(u) - F1(t)) x F1'(t) = - delta_u * F2'(u) x F1'(t)
    // delta_u = -((F2(u) - F1(t)) x F1'(t)) / (F2'(u) x F1'(t))
    // delta_u = ((F2(u) - F1(t)) x F1'(t)) / (F1'(t) x F2'(u))
    //
    // We can repeatedly apply delta_t and delta_u as Newton's method.
    let r_max = arc1
        .radii
        .x
        .abs()
        .max(arc1.radii.y.abs())
        .max(arc2.radii.x.abs())
        .max(arc2.radii.y.abs());
    let linear_tolerance = (r_max * ROUNDOFF_EPSILON).max(NEWTON_EPSILON);
    let tolerance_sq = linear_tolerance.powi(2);

    for _ in 0..NEWTON_MAX_ITERATIONS {
        let f1_t = arc1.sample(t);
        let f2_u = arc2.sample(u);
        let error = f2_u - f1_t;
        if error.square_length() <= tolerance_sq {
            return Some((t, u));
        }

        // sample_tangent returns in dF/dtheta, need to scale to dF/dt
        let f1_prime = arc1.sample_tangent(t) * arc1.sweep_angle.radians;
        let f2_prime = arc2.sample_tangent(u) * arc2.sweep_angle.radians;
        let cross = f1_prime.cross(f2_prime);

        if cross.abs() < NEWTON_EPSILON {
            break; // Tangent or parallel contact
        }

        let dt = error.cross(f2_prime) / cross;
        let du = error.cross(f1_prime) / cross;

        t = (t + dt).clamp(0.0, 1.0);
        u = (u + du).clamp(0.0, 1.0);

        if dt.abs() < NEWTON_EPSILON && du.abs() < NEWTON_EPSILON {
            break;
        }
    }

    let p1 = arc1.sample(t);
    let p2 = arc2.sample(u);
    if (p1 - p2).square_length() <= tolerance_sq {
        Some((t, u))
    } else {
        None
    }
}

impl Intersections<SvgArc<f64>> for SvgArc<f64> {
    fn intersections(&self, rhs: &SvgArc<f64>) -> SmallVec<[(f64, f64); 3]> {
        let arc1 = self.to_arc();
        let arc2 = rhs.to_arc();

        if is_circular(arc1.radii) && is_circular(arc2.radii) {
            return intersect_circles(&arc1, &arc2);
        }

        let to_canonical1 = CanonicalArcTransform::new_arc_to_unit(&arc1);
        let to_canonical2 = CanonicalArcTransform::new_arc_to_unit(&arc2);

        let mut results: SmallVec<[(f64, f64); 3]> = SmallVec::new();
        arc1.for_each_cubic_bezier(&mut |sub1| {
            arc2.for_each_cubic_bezier(&mut |sub2| {
                for (t_sub1, _t_sub2) in sub1.cubic_intersections_t(sub2) {
                    let pt = sub1.sample(t_sub1);
                    if let (Some(seed_t1), Some(seed_t2)) = (
                        to_canonical1.world_point_to_arc_t(pt),
                        to_canonical2.world_point_to_arc_t(pt),
                    ) && let Some((t1, t2)) = refine_arc_arc(&arc1, &arc2, seed_t1, seed_t2)
                        && !results
                            .iter()
                            .any(|(existing_t1, _)| (*existing_t1 - t1).abs() < PARAM_EPSILON)
                    {
                        results.push((t1, t2));
                    }
                }
            });
        });

        results
    }
}

/// Returns true if two bounding boxes overlap with allowance for tangents.
const fn bounding_boxes_overlap(b1: &Box2D<f64>, b2: &Box2D<f64>) -> bool {
    b1.min.x <= b2.max.x + ROUNDOFF_EPSILON
        && b2.min.x <= b1.max.x + ROUNDOFF_EPSILON
        && b1.min.y <= b2.max.y + ROUNDOFF_EPSILON
        && b2.min.y <= b1.max.y + ROUNDOFF_EPSILON
}

impl Intersections<DrawCommand> for DrawCommand {
    fn intersections(&self, clip_cmd: &DrawCommand) -> SmallVec<[(f64, f64); 3]> {
        // Fast check
        if !bounding_boxes_overlap(&self.bounding_box(), &clip_cmd.bounding_box()) {
            return smallvec![];
        }

        match (self, clip_cmd) {
            (DrawCommand::CubicBezier(c1), DrawCommand::CubicBezier(c2)) => c1.intersections(c2),
            (DrawCommand::CubicBezier(c), DrawCommand::QuadraticBezier(q)) => c.intersections(q),
            (DrawCommand::QuadraticBezier(q), DrawCommand::CubicBezier(c)) => q.intersections(c),
            (DrawCommand::QuadraticBezier(q1), DrawCommand::QuadraticBezier(q2)) => {
                q1.intersections(q2)
            }
            (DrawCommand::Arc(a1), DrawCommand::Arc(a2)) => a1.intersections(a2),
            (DrawCommand::Arc(a), DrawCommand::CubicBezier(c)) => a.intersections(c),
            (DrawCommand::CubicBezier(c), DrawCommand::Arc(a)) => c.intersections(a),
            (DrawCommand::Arc(a), DrawCommand::QuadraticBezier(q)) => a.intersections(q),
            (DrawCommand::QuadraticBezier(q), DrawCommand::Arc(a)) => q.intersections(a),
            (d1, DrawCommand::LineTo(l2)) => d1.intersections(l2),
            (DrawCommand::LineTo(l1), d2) => d2
                .intersections(l1)
                .into_iter()
                .map(|(t, u)| (u, t))
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use lyon_geom::{
        Angle, ArcFlags, CubicBezierSegment, LineSegment, QuadraticBezierSegment, SvgArc, point,
        vector,
    };

    use super::*;

    #[test]
    fn test_arc_line_intersections() {
        let rot30 = Angle::degrees(30.0);
        let (sin_rot30, cos_rot30) = rot30.sin_cos();
        let large_r = 1e7;

        let cases = [
            (
                "circle_top_half_vertical_crossing",
                SvgArc {
                    from: point(5.0, 0.0),
                    to: point(-5.0, 0.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true, // CCW: top half
                    },
                },
                LineSegment {
                    from: point(0.0, 10.0),
                    to: point(0.0, -10.0),
                },
                1,
            ),
            (
                "rotated_ellipse_crossing",
                SvgArc {
                    from: point(10.0 + 8.0 * cos_rot30, 20.0 + 8.0 * sin_rot30),
                    to: point(10.0 - 8.0 * cos_rot30, 20.0 - 8.0 * sin_rot30),
                    radii: vector(8.0, 4.0),
                    x_rotation: rot30,
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                LineSegment {
                    from: point(5.0, 15.0),
                    to: point(18.0, 26.0),
                },
                1,
            ),
            (
                "endpoints_on_circle_boundary_catastrophic_cancellation",
                SvgArc {
                    from: point(5.0, 0.0),
                    to: point(0.0, 5.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                LineSegment {
                    from: point(5.0, 0.0),
                    to: point(0.0, 5.0),
                },
                2,
            ),
            (
                "clockwise_sweep_endpoint_contact",
                SvgArc {
                    from: point(-10.0, 0.0),
                    to: point(10.0, 0.0),
                    radii: vector(10.0, 5.0),
                    x_rotation: Angle::degrees(45.0),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: false, // Clockwise
                    },
                },
                LineSegment {
                    from: point(-10.0, 0.0),
                    to: point(10.0, 0.0),
                },
                1,
            ),
            (
                "distant_line_miss",
                SvgArc {
                    from: point(5.0, 0.0),
                    to: point(-5.0, 0.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                LineSegment {
                    from: point(10.0, 10.0),
                    to: point(10.0, -10.0),
                },
                0,
            ),
            (
                "tangent_line_contact",
                SvgArc {
                    from: point(5.0, 0.0),
                    to: point(-5.0, 0.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                LineSegment {
                    from: point(-5.0, 5.0),
                    to: point(5.0, 5.0),
                },
                1,
            ),
            (
                "large_radius_flat_arc_perpendicular_crossing",
                SvgArc {
                    from: point(large_r, -100.0),
                    to: point(large_r, 100.0),
                    radii: vector(large_r, large_r),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                LineSegment {
                    from: point(large_r - 5.0, 0.0),
                    to: point(large_r + 5.0, 0.0),
                },
                1,
            ),
            (
                "zero_length_world_segment_rejected",
                SvgArc {
                    from: point(5.0, 0.0),
                    to: point(-5.0, 0.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                LineSegment {
                    from: point(0.0, 5.0),
                    to: point(0.0, 5.0),
                },
                0,
            ),
            (
                "large_radius_parallel_outside_line_miss",
                SvgArc {
                    from: point(large_r, -100.0),
                    to: point(large_r, 100.0),
                    radii: vector(large_r, large_r),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                LineSegment {
                    from: point(large_r + 1.0, -10.0),
                    to: point(large_r + 1.0, 10.0),
                },
                0,
            ),
        ];

        for (name, arc, line, expected_count) in cases {
            let isects = arc.intersections(&line);
            assert_eq!(
                isects.len(),
                expected_count,
                "[{name}] Expected count {expected_count}, got {}",
                isects.len()
            );

            for (t, u) in isects {
                let p_arc = arc.to_arc().sample(t);
                let p_line = line.sample(u);
                assert!(
                    (p_arc - p_line).square_length() < 1e-10,
                    "[{name}] Curves do not meet at ({t}, {u}): p_arc={p_arc:?}, p_line={p_line:?}"
                );
            }
        }
    }

    #[test]
    fn test_bezier_intersections() {
        let cases = [
            (
                "cubic_cubic_perpendicular_crossing",
                DrawCommand::CubicBezier(CubicBezierSegment {
                    from: point(0.0, 5.0),
                    ctrl1: point(3.0, 8.0),
                    ctrl2: point(7.0, 8.0),
                    to: point(10.0, 5.0),
                }),
                DrawCommand::CubicBezier(CubicBezierSegment {
                    from: point(5.0, 0.0),
                    ctrl1: point(5.0, 3.0),
                    ctrl2: point(5.0, 7.0),
                    to: point(5.0, 10.0),
                }),
                1,
            ),
            (
                "quadratic_cubic_crossing",
                DrawCommand::QuadraticBezier(QuadraticBezierSegment {
                    from: point(0.0, 5.0),
                    ctrl: point(5.0, 10.0),
                    to: point(10.0, 5.0),
                }),
                DrawCommand::CubicBezier(CubicBezierSegment {
                    from: point(5.0, 0.0),
                    ctrl1: point(5.0, 3.0),
                    ctrl2: point(5.0, 7.0),
                    to: point(5.0, 10.0),
                }),
                1,
            ),
            (
                "quadratic_quadratic_crossing",
                DrawCommand::QuadraticBezier(QuadraticBezierSegment {
                    from: point(0.0, 5.0),
                    ctrl: point(5.0, 10.0),
                    to: point(10.0, 5.0),
                }),
                DrawCommand::QuadraticBezier(QuadraticBezierSegment {
                    from: point(5.0, 0.0),
                    ctrl: point(5.0, 5.0),
                    to: point(5.0, 10.0),
                }),
                1,
            ),
        ];

        for (name, cmd1, cmd2, expected_count) in cases {
            let isects = cmd1.intersections(&cmd2);
            assert_eq!(
                isects.len(),
                expected_count,
                "[{name}] Expected count {expected_count}, got {}",
                isects.len()
            );

            for &(t, u) in &isects {
                let p1 = cmd1.sample(t);
                let p2 = cmd2.sample(u);
                assert!(
                    (p1 - p2).square_length() < 1e-10,
                    "[{name}] Curves do not meet at ({t}, {u}): p1={p1:?}, p2={p2:?}"
                );
            }

            // Test symmetric reverse dispatch
            let isects_rev = cmd2.intersections(&cmd1);
            assert_eq!(
                isects_rev.len(),
                expected_count,
                "[{name}] Reverse symmetry count mismatch"
            );
        }
    }

    #[test]
    fn test_arc_arc_intersections() {
        let cases = [
            (
                "two_circles_secant_two_points",
                SvgArc {
                    from: point(0.0, -5.0),
                    to: point(0.0, 5.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                SvgArc {
                    from: point(6.0, 5.0),
                    to: point(6.0, -5.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                2,
            ),
            (
                "two_circles_externally_tangent",
                SvgArc {
                    from: point(3.0, 0.0),
                    to: point(-3.0, 0.0),
                    radii: vector(3.0, 3.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                SvgArc {
                    from: point(3.0, 0.0),
                    to: point(11.0, 0.0),
                    radii: vector(4.0, 4.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                1,
            ),
            (
                "concentric_circles_disjoint",
                SvgArc {
                    from: point(5.0, 0.0),
                    to: point(-5.0, 0.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                SvgArc {
                    from: point(2.0, 0.0),
                    to: point(-2.0, 0.0),
                    radii: vector(2.0, 2.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                0,
            ),
            (
                "eccentric_nested_circles_disjoint",
                SvgArc {
                    from: point(5.0, 0.0),
                    to: point(-5.0, 0.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                SvgArc {
                    from: point(3.0, 0.0),
                    to: point(-1.0, 0.0),
                    radii: vector(2.0, 2.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                0,
            ),
            (
                "far_apart_circles_disjoint",
                SvgArc {
                    from: point(5.0, 0.0),
                    to: point(-5.0, 0.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                SvgArc {
                    from: point(55.0, 0.0),
                    to: point(45.0, 0.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                0,
            ),
            (
                "ellipse_ellipse_2d_newton_refinement",
                SvgArc {
                    from: point(10.0, 0.0),
                    to: point(-10.0, 0.0),
                    radii: vector(10.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                SvgArc {
                    from: point(5.0, 0.0),
                    to: point(-5.0, 0.0),
                    radii: vector(5.0, 10.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                2,
            ),
        ];

        for (name, arc1, arc2, expected_count) in cases {
            let isects = DrawCommand::Arc(arc1).intersections(&DrawCommand::Arc(arc2));
            assert_eq!(
                isects.len(),
                expected_count,
                "[{name}] Expected count {expected_count}, got {}",
                isects.len()
            );

            for (t, u) in &isects {
                let p1 = arc1.to_arc().sample(*t);
                let p2 = arc2.to_arc().sample(*u);
                assert!(
                    (p1 - p2).square_length() < 1e-10,
                    "[{name}] Arcs do not meet at ({t}, {u}): p1={p1:?}, p2={p2:?}"
                );
            }

            let isects_rev = DrawCommand::Arc(arc2).intersections(&DrawCommand::Arc(arc1));
            assert_eq!(
                isects_rev.len(),
                expected_count,
                "[{name}] Reverse symmetry count mismatch"
            );
        }
    }

    #[test]
    fn test_arc_bezier_intersections() {
        let cases = [
            (
                "arc_cubic_s_curve_crossing",
                SvgArc {
                    from: point(5.0, 0.0),
                    to: point(-5.0, 0.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                CubicBezierSegment {
                    from: point(0.0, 0.0),
                    ctrl1: point(0.5, 3.0),
                    ctrl2: point(-0.5, 7.0),
                    to: point(0.0, 10.0),
                },
                1,
            ),
            (
                "arc_curved_cubic_crossing",
                SvgArc {
                    from: point(5.0, 0.0),
                    to: point(-5.0, 0.0),
                    radii: vector(5.0, 5.0),
                    x_rotation: Angle::zero(),
                    flags: ArcFlags {
                        large_arc: false,
                        sweep: true,
                    },
                },
                CubicBezierSegment {
                    from: point(0.0, 0.0),
                    ctrl1: point(1.0, 4.0),
                    ctrl2: point(3.0, 7.0),
                    to: point(6.0, 8.0),
                },
                1,
            ),
        ];

        for (name, arc, cbs, expected_count) in cases {
            let isects = DrawCommand::Arc(arc).intersections(&DrawCommand::CubicBezier(cbs));
            assert_eq!(
                isects.len(),
                expected_count,
                "[{name}] Expected count {expected_count}, got {}",
                isects.len()
            );

            for (t, u) in &isects {
                let p1 = arc.to_arc().sample(*t);
                let p2 = cbs.sample(*u);
                assert!(
                    (p1 - p2).square_length() < 1e-10,
                    "[{name}] Curves do not meet at ({t}, {u}): p1={p1:?}, p2={p2:?}"
                );
            }

            let isects_rev = DrawCommand::CubicBezier(cbs).intersections(&DrawCommand::Arc(arc));
            assert_eq!(
                isects_rev.len(),
                expected_count,
                "[{name}] Reverse symmetry count mismatch"
            );
        }
    }

    #[test]
    fn test_draw_command_bounding_box_filter() {
        let cases = [
            (
                "disjoint_lines_early_reject",
                DrawCommand::LineTo(LineSegment {
                    from: point(0.0, 0.0),
                    to: point(1.0, 1.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(10.0, 10.0),
                    to: point(11.0, 11.0),
                }),
                0,
            ),
            (
                "flat_zero_thickness_lines_crossing_not_rejected",
                DrawCommand::LineTo(LineSegment {
                    from: point(0.0, 0.0),
                    to: point(10.0, 0.0),
                }),
                DrawCommand::LineTo(LineSegment {
                    from: point(5.0, -5.0),
                    to: point(5.0, 5.0),
                }),
                1,
            ),
        ];

        for (name, cmd1, cmd2, expected_count) in cases {
            let isects = cmd1.intersections(&cmd2);
            assert_eq!(
                isects.len(),
                expected_count,
                "[{name}] Expected count {expected_count}, got {}",
                isects.len()
            );

            for (t, u) in &isects {
                let p1 = cmd1.sample(*t);
                let p2 = cmd2.sample(*u);
                assert!(
                    (p1 - p2).square_length() < 1e-10,
                    "[{name}] Commands do not meet at ({t}, {u}): p1={p1:?}, p2={p2:?}"
                );
            }
        }
    }
}
