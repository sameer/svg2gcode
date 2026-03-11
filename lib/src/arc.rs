use euclid::Angle;
use lyon_geom::{
    Arc, ArcFlags, CubicBezierSegment, Line, LineSegment, Point, Scalar, SvgArc, Transform, Vector,
};

pub enum ArcOrLineSegment<S> {
    Arc(SvgArc<S>),
    Line(LineSegment<S>),
}

/// Calcuates the distance from `p` to the nearest point on `arc`.
fn point_to_arc_dist<S: Scalar>(p: Point<S>, arc: &Arc<S>) -> S {
    let t_raw = (p - arc.center).angle_from_x_axis().radians / arc.sweep_angle.radians
        - arc.start_angle.radians / arc.sweep_angle.radians;
    let full_rev = S::TWO * S::PI() / arc.sweep_angle.radians.abs();
    let calc_dist = |t: S| (arc.sample(t.clamp(S::ZERO, S::ONE)) - p).length();

    calc_dist(t_raw)
        .min(calc_dist(t_raw + full_rev))
        .min(calc_dist(t_raw - full_rev))
}

fn arc_from_endpoints_and_tangents<S: Scalar>(
    from: Point<S>,
    from_tangent: Vector<S>,
    to: Point<S>,
    to_tangent: Vector<S>,
) -> Option<SvgArc<S>> {
    // The arc center must be perpendicular to the tangent at each endpoint.
    // Intersect the two normal lines to find it.
    let perp = |v: Vector<S>| Vector::from([-v.y, v.x]);
    let center = Line {
        point: from,
        vector: perp(from_tangent),
    }
    .intersection(&Line {
        point: to,
        vector: perp(to_tangent),
    })?;

    let radius = (from - center).length();
    if radius < S::EPSILON {
        return None;
    }

    // Use the 2D determinant + dot product to identify winding direction
    // See https://www.w3.org/TR/SVG/paths.html#PathDataEllipticalArcCommands for
    // a nice visual explanation of large arc and sweep
    let flags = {
        let from_center = (from - center).normalize();
        let to_center = (to - center).normalize();

        let det = from_center.x * to_center.y - from_center.y * to_center.x;
        let dot = from_center.dot(to_center);
        let atan2 = det.atan2(dot);
        ArcFlags {
            large_arc: atan2.abs() >= S::PI(),
            sweep: atan2.is_sign_positive(),
        }
    };

    Some(SvgArc {
        from,
        to,
        radii: Vector::splat(radius),
        // This is a circular arc
        x_rotation: Angle::zero(),
        flags,
    })
}

pub trait FlattenWithArcs<S> {
    fn flattened(&self, tolerance: S) -> Vec<ArcOrLineSegment<S>>;
}

impl<S> FlattenWithArcs<S> for CubicBezierSegment<S>
where
    S: Scalar + Copy,
{
    /// Implementation of [Modeling of Bézier Curves Using a Combination of Linear and Circular Arc Approximations](https://sci-hub.st/https://doi.org/10.1109/CGIV.2012.20)
    ///
    /// Kaewsaiha, P., & Dejdumrong, N. (2012). Modeling of Bézier Curves Using a Combination of Linear and Circular Arc Approximations. 2012 Ninth International Conference on Computer Graphics, Imaging and Visualization. doi:10.1109/cgiv.2012.20
    fn flattened(&self, tolerance: S) -> Vec<ArcOrLineSegment<S>> {
        if (self.to - self.from).square_length() < S::EPSILON {
            return vec![];
        } else if self.is_linear(tolerance) {
            return vec![ArcOrLineSegment::Line(self.baseline())];
        }
        let mut acc = vec![];

        let mut splits = Vec::with_capacity(4);
        splits.push(S::ZERO);
        self.for_each_inflection_t(&mut |t| {
            if t > S::ZERO {
                splits.push(t);
            }
        });
        splits.push(S::ONE);

        for window in splits.windows(2) {
            let inner_bezier = self.split_range(window[0]..window[1]);

            if (inner_bezier.to - inner_bezier.from).square_length() < S::EPSILON {
                continue;
            } else if inner_bezier.is_linear(tolerance) {
                acc.push(ArcOrLineSegment::Line(inner_bezier.baseline()));
                continue;
            }

            if let Some(svg_arc) = arc_from_endpoints_and_tangents(
                inner_bezier.from,
                inner_bezier.derivative(S::ZERO),
                inner_bezier.to,
                inner_bezier.derivative(S::ONE),
            )
            .filter(|svg_arc| {
                let arc = svg_arc.to_arc();
                let mut max_deviation = S::ZERO;
                for i in 1..20 {
                    let t = S::from(i).unwrap() / S::from(20).unwrap();
                    max_deviation =
                        max_deviation.max(point_to_arc_dist(inner_bezier.sample(t), &arc));
                }
                max_deviation < tolerance
            }) {
                acc.push(ArcOrLineSegment::Arc(svg_arc));
            } else {
                let (left, right) = inner_bezier.split(S::HALF);
                acc.append(&mut FlattenWithArcs::flattened(&left, tolerance));
                acc.append(&mut FlattenWithArcs::flattened(&right, tolerance));
            }
        }
        acc
    }
}

impl<S> FlattenWithArcs<S> for SvgArc<S>
where
    S: Scalar,
{
    fn flattened(&self, tolerance: S) -> Vec<ArcOrLineSegment<S>> {
        if (self.to - self.from).square_length() < S::EPSILON {
            return vec![];
        } else if self.is_straight_line() {
            return vec![ArcOrLineSegment::Line(LineSegment {
                from: self.from,
                to: self.to,
            })];
        } else if (self.radii.x.abs() - self.radii.y.abs()).abs() < S::EPSILON {
            return vec![ArcOrLineSegment::Arc(*self)];
        }

        let self_arc = self.to_arc();
        if let Some(svg_arc) = arc_from_endpoints_and_tangents(
            self.from,
            self_arc.sample_tangent(S::ZERO),
            self.to,
            self_arc.sample_tangent(S::ONE),
        )
        .filter(|approx_svg_arc| {
            let approx_arc = approx_svg_arc.to_arc();
            let mut max_deviation = S::ZERO;
            for i in 1..20 {
                let t = S::from(i).unwrap() / S::from(20).unwrap();
                max_deviation =
                    max_deviation.max(point_to_arc_dist(self_arc.sample(t), &approx_arc));
            }
            max_deviation < tolerance
        }) {
            vec![ArcOrLineSegment::Arc(svg_arc)]
        } else {
            let (left, right) = self_arc.split(S::HALF);
            let mut acc = FlattenWithArcs::flattened(&left.to_svg_arc(), tolerance);
            acc.append(&mut FlattenWithArcs::flattened(
                &right.to_svg_arc(),
                tolerance,
            ));
            acc
        }
    }
}

pub trait Transformed<S> {
    fn transformed(&self, transform: &Transform<S>) -> Self;
}

impl<S: Scalar> Transformed<S> for SvgArc<S> {
    /// A lot of the math here is heavily borrowed from [Vitaly Putzin's svgpath](https://github.com/fontello/svgpath).
    ///
    /// The code is Rust-ified with only one or two changes, but I plan to understand the math here and
    /// merge changes upstream to lyon-geom.
    #[allow(non_snake_case)]
    fn transformed(&self, transform: &Transform<S>) -> Self {
        let from = transform.transform_point(self.from);
        let to = transform.transform_point(self.to);

        // Translation does not affect rotation, radii, or flags
        let [a, b, c, d, _tx, _ty] = transform.to_array();
        let (x_rotation, radii) = {
            let (sin, cos) = self.x_rotation.sin_cos();

            // Radii are axis-aligned -- rotate & transform
            let ma = [
                self.radii.x * (a * cos + c * sin),
                self.radii.x * (b * cos + d * sin),
                self.radii.y * (-a * sin + c * cos),
                self.radii.y * (-b * sin + d * cos),
            ];

            // ma * transpose(ma) = [ J L ]
            //                      [ L K ]
            // L is calculated later (if the image is not a circle)
            let J = ma[0].powi(2) + ma[2].powi(2);
            let K = ma[1].powi(2) + ma[3].powi(2);

            // the discriminant of the characteristic polynomial of ma * transpose(ma)
            let D = ((ma[0] - ma[3]).powi(2) + (ma[2] + ma[1]).powi(2))
                * ((ma[0] + ma[3]).powi(2) + (ma[2] - ma[1]).powi(2));

            // the "mean eigenvalue"
            let JK = (J + K) / S::TWO;

            // check if the image is (almost) a circle
            if D < S::EPSILON * JK {
                // if it is
                (Angle::zero(), Vector::splat(JK.sqrt()))
            } else {
                // if it is not a circle
                let L = ma[0] * ma[1] + ma[2] * ma[3];

                let D = D.sqrt();

                // {l1,l2} = the two eigen values of ma * transpose(ma)
                let l1 = JK + D / S::TWO;
                let l2 = JK - D / S::TWO;
                // the x - axis - rotation angle is the argument of the l1 - eigenvector
                let ax = if L.abs() < S::EPSILON && (l1 - K).abs() < S::EPSILON {
                    Angle::frac_pi_2()
                } else {
                    Angle::radians(
                        (if L.abs() > (l1 - K).abs() {
                            (l1 - J) / L
                        } else {
                            L / (l1 - K)
                        })
                        .atan(),
                    )
                };
                (ax, Vector::from([l1.sqrt(), l2.sqrt()]))
            }
        };
        // A mirror transform causes this flag to be flipped
        let invert_sweep = { (a * d) - (b * c) < S::ZERO };
        let flags = ArcFlags {
            sweep: if invert_sweep {
                !self.flags.sweep
            } else {
                self.flags.sweep
            },
            large_arc: self.flags.large_arc,
        };
        Self {
            from,
            to,
            radii,
            x_rotation,
            flags,
        }
    }
}

#[cfg(test)]
mod tests {
    use lyon_geom::{CubicBezierSegment, point};

    use crate::arc::{ArcOrLineSegment, FlattenWithArcs};

    /// Magic constant for cubic Bézier approximation of a quarter circle: 4(√2-1)/3
    const KAPPA: f64 = 4.0 * (std::f64::consts::SQRT_2 - 1.0) / 3.0;

    /// Approximate one-sided Hausdorff distance: for each of `samples` on the Bézier,
    /// find the closest point on any flattened segment and return the maximum deviation.
    fn approx_max_bezier_deviation(
        curve: &CubicBezierSegment<f64>,
        segments: &[ArcOrLineSegment<f64>],
        samples: usize,
    ) -> f64 {
        (0..=samples)
            .map(|i| {
                let t = i as f64 / samples as f64;
                let p = curve.sample(t);
                segments
                    .iter()
                    .map(|seg| match seg {
                        ArcOrLineSegment::Arc(svg_arc) => {
                            let arc = svg_arc.to_arc();
                            let q_angle = (p - arc.center).angle_from_x_axis().radians;
                            let start = arc.start_angle.radians;
                            let sweep = arc.sweep_angle.radians;
                            let t_raw = (q_angle - start) / sweep;
                            let full_rev = std::f64::consts::TAU / sweep.abs();
                            // Try t_raw and ±one full revolution to handle angle wrapping
                            [t_raw, t_raw + full_rev, t_raw - full_rev]
                                .iter()
                                .map(|&t| arc.sample(t.clamp(0.0, 1.0)))
                                .map(|pt| (p - pt).length())
                                .fold(f64::INFINITY, f64::min)
                        }
                        ArcOrLineSegment::Line(line) => (line.closest_point(p) - p).length(),
                    })
                    .fold(f64::INFINITY, f64::min)
            })
            .fold(0.0_f64, f64::max)
    }

    #[test]
    fn flattened_arcs_within_hausdorff_tolerance() {
        let curves: &[CubicBezierSegment<f64>] = &[
            // Quarter circle approximation
            CubicBezierSegment {
                from: point(1.0, 0.0),
                ctrl1: point(1.0, KAPPA),
                ctrl2: point(KAPPA, 1.0),
                to: point(0.0, 1.0),
            },
            // S-curve with inflection
            CubicBezierSegment {
                from: point(0.0, 0.0),
                ctrl1: point(1.0, 0.0),
                ctrl2: point(0.0, 1.0),
                to: point(1.0, 1.0),
            },
            // Highly asymmetric curve
            CubicBezierSegment {
                from: point(0.0, 0.0),
                ctrl1: point(0.1, 1.0),
                ctrl2: point(0.9, 1.0),
                to: point(1.0, 0.0),
            },
            // Near-straight curve
            CubicBezierSegment {
                from: point(0.0, 0.0),
                ctrl1: point(0.33, 0.01),
                ctrl2: point(0.66, 0.01),
                to: point(1.0, 0.0),
            },
        ];
        let tolerance = 0.002;
        for (i, curve) in curves.iter().enumerate() {
            let segments = FlattenWithArcs::flattened(curve, tolerance);
            let dist = approx_max_bezier_deviation(curve, &segments, 1_000);
            assert!(
                dist < tolerance,
                "curve {i}: Hausdorff distance {dist} exceeds tolerance {tolerance}"
            );
        }
    }
}
