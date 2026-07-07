use std::{borrow::Cow, fmt::Debug};

use ::g_code::{command, emit::Token};
use lyon_geom::{Point, SvgArc};
use rust_decimal::{Decimal, prelude::*};
use svg2star::turtle::{
    Turtle,
    elements::{ArcOrLineSegment, DrawCommand, FillPolygon, FlattenWithArcs, Stroke},
};

use crate::machine::Machine;

/// Maps path segments into g-code operations
#[derive(Debug)]
pub struct GCodeTurtle<'input> {
    pub machine: Machine<'input>,
    pub tolerance: f64,
    pub feedrate: f64,
    pub program: Vec<Token<'input>>,
}

impl<'input> GCodeTurtle<'input> {
    /// Converts [`Self::tolerance`] to a [`Decimal`].
    fn tolerance_to_decimal(&self) -> Decimal {
        Decimal::from_f64(self.tolerance)
            .unwrap_or_default()
            .normalize()
    }

    /// Rounds `val` to the number of decimal places in [`Self::tolerance`].
    ///
    /// i.e. 3 decimal places for 0.002
    fn round(&self, val: f64) -> f64 {
        let places = self.tolerance_to_decimal().scale();
        Decimal::from_f64(val)
            .unwrap_or_default()
            .round_dp(places)
            .to_f64()
            .unwrap_or(val)
    }

    /// Tolerance passed to [`lyon_geom`] calls for line segments.
    ///
    /// Reserves some headroom so that [`Self::round`] won't take
    /// the measurement outside of the overall tolerance bounds.
    ///
    /// i.e. e.g. 0.002 & 3 dp returns 0.0015 so we have +/- 0.0005
    fn flattening_tolerance(&self) -> f64 {
        let tolerance = self.tolerance_to_decimal();
        let rounding_epsilon = Decimal::new(5, tolerance.scale() + 1);
        if rounding_epsilon < tolerance {
            (tolerance - rounding_epsilon)
                .to_f64()
                .unwrap_or(self.tolerance)
        } else {
            self.tolerance
        }
    }

    /// Tolerance passed to [`lyon_geom`] calls when circular interpolation is used.
    ///
    /// For G2/G3 arcs, X, Y, and R are all rounded independently.
    /// The worst-case combined error is:
    /// - endpoint 2D: `rounding_epsilon * sqrt(2)`
    /// - radius: `rounding_epsilon`
    /// - total: `rounding_epsilon * (sqrt(2) + 1)`
    fn arc_flattening_tolerance(&self) -> f64 {
        let tolerance = self.tolerance_to_decimal();
        let rounding_epsilon = Decimal::new(5, tolerance.scale() + 1)
            * Decimal::from_f64(std::f64::consts::SQRT_2 + 1.).unwrap();
        if rounding_epsilon < tolerance {
            (tolerance - rounding_epsilon)
                .to_f64()
                .unwrap_or(self.tolerance)
        } else {
            self.tolerance
        }
    }

    /// Computes the Z for a drawing move given a stroke's SVG width.
    ///
    /// Returns:
    /// if z_path is not configured: None
    /// if z_emphasis or emphasis_stroke_width are not configured: z_path
    /// if stroke-width = 1: z_path
    /// if stroke-width > 1: interpolate toward z_emphasis. Clamped at z_emphasis if stroke-width >= emphasis_stroke_width.
    /// if stroke-width < 1: extrapolate backward using the same slope. Clamped at z_travel.
    fn z_for_stroke_width(&self, width: f64) -> Option<f64> {
        let z_path = self.machine.z_path?;
        let emphasis = match (self.machine.z_emphasis, self.machine.emphasis_stroke_width) {
            (Some(ze), Some(esw)) if esw > 1.0 => Some((ze, esw)),
            _ => None,
        };

        if width >= 1.0 {
            match emphasis {
                Some((z_emphasis, esw)) => {
                    let t = ((width - 1.0) / (esw - 1.0)).min(1.0);
                    Some(z_path + (z_emphasis - z_path) * t)
                }
                None => Some(z_path),
            }
        } else {
            match emphasis {
                Some((z_emphasis, esw)) => {
                    let slope = (z_emphasis - z_path) / (esw - 1.0);
                    let z_raw = z_path + slope * (width.max(0.0) - 1.0);
                    Some(match self.machine.z_travel {
                        Some(z_travel) => z_raw.clamp(z_travel.min(z_path), z_travel.max(z_path)),
                        None => z_raw,
                    })
                }
                None => Some(z_path),
            }
        }
    }

    fn line_to(&self, to: Point<f64>, z: Option<f64>) -> Vec<Token<'input>> {
        if let Some(z) = z {
            command!(LinearInterpolation {
                X: self.round(to.x),
                Y: self.round(to.y),
                Z: z,
                F: self.feedrate,
            })
            .into_token_vec()
        } else {
            command!(LinearInterpolation {
                X: self.round(to.x),
                Y: self.round(to.y),
                F: self.feedrate,
            })
            .into_token_vec()
        }
    }

    fn circular_interpolation(&self, svg_arc: SvgArc<f64>) -> Vec<Token<'input>> {
        debug_assert!((svg_arc.radii.x.abs() - svg_arc.radii.y.abs()).abs() < f64::EPSILON);
        match (svg_arc.flags.large_arc, svg_arc.flags.sweep) {
            (false, true) => command!(CounterclockwiseCircularInterpolation {
                X: self.round(svg_arc.to.x),
                Y: self.round(svg_arc.to.y),
                R: self.round(svg_arc.radii.x),
                F: self.feedrate,
            })
            .into_token_vec(),
            (false, false) => command!(ClockwiseCircularInterpolation {
                X: self.round(svg_arc.to.x),
                Y: self.round(svg_arc.to.y),
                R: self.round(svg_arc.radii.x),
                F: self.feedrate,
            })
            .into_token_vec(),
            (true, _) => {
                let (left, right) = svg_arc.to_arc().split(0.5);
                let mut token_vec = self.circular_interpolation(left.to_svg_arc());
                token_vec.append(&mut self.circular_interpolation(right.to_svg_arc()));
                token_vec
            }
        }
    }

    fn tool_on(&mut self) {
        self.program.extend(self.machine.tool_on());
        self.program.extend(self.machine.absolute());
    }

    fn tool_off(&mut self) {
        self.program.extend(self.machine.tool_off());
        self.program.extend(self.machine.absolute());
    }
}

impl<'input> Turtle for GCodeTurtle<'input> {
    fn begin(&mut self) {
        self.program
            .append(&mut command!(UnitsMillimeters {}).into_token_vec());
        self.program.extend(self.machine.absolute());
        self.program.extend(self.machine.program_begin());
        self.program.extend(self.machine.absolute());
    }

    fn end(&mut self) {
        self.program.extend(self.machine.tool_off());
        self.program.extend(self.machine.absolute());
        self.program.extend(self.machine.program_end());
    }

    fn stroke(&mut self, stroke: Stroke) {
        let stroke_width = stroke.width;
        let z_draw = self.z_for_stroke_width(stroke_width);
        let start = stroke.start_point();
        let mut commands = stroke.into_commands().peekable();

        self.tool_off();

        // Comments should be inline after tool_off but before a rapid move.
        while matches!(commands.peek(), Some(DrawCommand::Comment(_))) {
            if let Some(DrawCommand::Comment(comment)) = commands.next() {
                self.program.push(Token::Comment {
                    is_inline: false,
                    inner: Cow::Owned(comment),
                });
            }
        }

        if let Some(z_travel) = self.machine.z_travel {
            self.program.append(
                &mut command!(RapidPositioning {
                    Z: z_travel,
                })
                .into_token_vec(),
            );
            self.program.append(
                &mut command!(RapidPositioning {
                    X: self.round(start.x),
                    Y: self.round(start.y),
                    Z: z_travel,
                })
                .into_token_vec(),
            );
        } else {
            self.program.append(
                &mut command!(RapidPositioning {
                    X: self.round(start.x),
                    Y: self.round(start.y),
                })
                .into_token_vec(),
            );
        }

        if let Some(z) = z_draw {
            self.program.append(
                &mut command!(RapidPositioning {
                    Z: z,
                })
                .into_token_vec(),
            );
        }

        self.tool_on();

        for command in commands {
            match command {
                DrawCommand::LineTo { from: _, to } => {
                    self.program.append(&mut self.line_to(to, z_draw));
                }
                DrawCommand::Arc(svg_arc) => {
                    if self
                        .machine
                        .supported_functionality()
                        .circular_interpolation
                    {
                        FlattenWithArcs::flattened(&svg_arc, self.arc_flattening_tolerance())
                            .into_iter()
                            .for_each(|segment| match segment {
                                ArcOrLineSegment::Arc(arc) => {
                                    self.program.append(&mut self.circular_interpolation(arc))
                                }
                                ArcOrLineSegment::Line(line) => {
                                    self.program.append(&mut self.line_to(line.to, z_draw));
                                }
                            });
                    } else {
                        svg_arc
                            .to_arc()
                            .flattened(self.flattening_tolerance())
                            .for_each(|point| self.program.append(&mut self.line_to(point, z_draw)));
                    };
                }
                DrawCommand::CubicBezier(cbs) => {
                    if self
                        .machine
                        .supported_functionality()
                        .circular_interpolation
                    {
                        FlattenWithArcs::<f64>::flattened(&cbs, self.arc_flattening_tolerance())
                            .into_iter()
                            .for_each(|segment| match segment {
                                ArcOrLineSegment::Arc(arc) => {
                                    self.program.append(&mut self.circular_interpolation(arc))
                                }
                                ArcOrLineSegment::Line(line) => {
                                    self.program.append(&mut self.line_to(line.to, z_draw))
                                }
                            });
                    } else {
                        cbs.flattened(self.flattening_tolerance())
                            .for_each(|point| self.program.append(&mut self.line_to(point, z_draw)));
                    };
                }
                DrawCommand::QuadraticBezier(qbs) => {
                    if self
                        .machine
                        .supported_functionality()
                        .circular_interpolation
                    {
                        FlattenWithArcs::<f64>::flattened(
                            &qbs.to_cubic(),
                            self.arc_flattening_tolerance(),
                        )
                        .into_iter()
                        .for_each(|segment| match segment {
                            ArcOrLineSegment::Arc(arc) => {
                                self.program.append(&mut self.circular_interpolation(arc))
                            }
                            ArcOrLineSegment::Line(line) => {
                                self.program.append(&mut self.line_to(line.to, z_draw))
                            }
                        });
                    } else {
                        qbs.flattened(self.flattening_tolerance())
                            .for_each(|point| self.program.append(&mut self.line_to(point, z_draw)));
                    };
                }
                DrawCommand::Comment(comment) => {
                    self.program.push(Token::Comment {
                        is_inline: false,
                        inner: Cow::Owned(comment),
                    });
                }
            }
        }
    }

    #[cfg(feature = "image")]
    fn image(&mut self, _image: svg2star::turtle::elements::RasterImage) {
        // TODO (?)
    }

    fn fill_polygon(&mut self, _polygon: FillPolygon) {
        // TODO
    }
}

#[cfg(test)]
mod tests {
    use crate::config::SupportedFunctionality;

    use super::*;

    fn machine_with_z(
        z_travel: Option<f64>,
        z_path: Option<f64>,
        z_emphasis: Option<f64>,
        emphasis_stroke_width: Option<f64>,
    ) -> Machine<'static> {
        Machine::new(
            SupportedFunctionality::default(),
            None, None, None, None,
            z_travel, z_path, z_emphasis, emphasis_stroke_width,
        )
    }

    fn turtle_with_z(
        z_travel: Option<f64>,
        z_path: Option<f64>,
        z_emphasis: Option<f64>,
        emphasis_stroke_width: Option<f64>,
    ) -> GCodeTurtle<'static> {
        GCodeTurtle {
            machine: machine_with_z(z_travel, z_path, z_emphasis, emphasis_stroke_width),
            tolerance: 0.1,
            feedrate: 300.0,
            program: vec![],
        }
    }

    #[test]
    fn z_for_stroke_width_none_when_z_path_unset() {
        let t = turtle_with_z(Some(5.0), None, Some(-2.0), Some(3.0));
        assert_eq!(t.z_for_stroke_width(0.5), None);
        assert_eq!(t.z_for_stroke_width(1.0), None);
        assert_eq!(t.z_for_stroke_width(2.0), None);
    }

    #[test]
    fn z_for_stroke_width_one_is_z_path() {
        // width=1 is always z_path regardless of emphasis config
        let t = turtle_with_z(Some(5.0), Some(0.0), Some(-2.0), Some(3.0));
        assert_eq!(t.z_for_stroke_width(1.0), Some(0.0));
    }

    #[test]
    fn z_for_stroke_width_returns_z_path_when_z_emphasis_unset() {
        // z_emphasis unset → z_path for all widths including sub-1
        let t = turtle_with_z(Some(5.0), Some(0.0), None, None);
        assert_eq!(t.z_for_stroke_width(0.01), Some(0.0));
        assert_eq!(t.z_for_stroke_width(0.5), Some(0.0));
        assert_eq!(t.z_for_stroke_width(1.0), Some(0.0));
        assert_eq!(t.z_for_stroke_width(5.0), Some(0.0));
    }

    #[test]
    fn z_for_stroke_width_interpolates_above_one() {
        // z_path=0, z_emphasis=-2, esw=3: slope=-1/unit above 1
        // width=1→0, width=2→-1, width=3→-2, width=4→-2 (clamped)
        let t = turtle_with_z(None, Some(0.0), Some(-2.0), Some(3.0));
        assert_eq!(t.z_for_stroke_width(1.0), Some(0.0));
        assert_eq!(t.z_for_stroke_width(2.0), Some(-1.0));
        assert_eq!(t.z_for_stroke_width(3.0), Some(-2.0));
        assert_eq!(t.z_for_stroke_width(4.0), Some(-2.0));
    }

    #[test]
    fn z_for_stroke_width_extrapolates_below_one() {
        // Same slope as above-1 region, extended backward from z_path at width=1
        // z_path=0, z_emphasis=-2, esw=3: slope=-1/unit
        // width=0.5 → z_raw = 0 + (-1)*(0.5-1) = 0.5, no z_travel → 0.5
        // width=0.01 → z_raw = 0 + (-1)*(0.01-1) = 0.99
        let t = turtle_with_z(None, Some(0.0), Some(-2.0), Some(3.0));
        assert!((t.z_for_stroke_width(0.5).unwrap() - 0.5).abs() < 1e-9);
        assert!((t.z_for_stroke_width(0.01).unwrap() - 0.99).abs() < 1e-9);
    }

    #[test]
    fn z_for_stroke_width_sub_one_clamped_at_z_travel() {
        // z_path=0, z_emphasis=-10, esw=2: slope=-10/unit
        // width=0.5 → z_raw = 0 + (-10)*(0.5-1) = 5 → clamped at z_travel=3
        // clamp triggers at width > 0.7 (z_raw=3 exactly when width=0.7)
        let t = turtle_with_z(Some(3.0), Some(0.0), Some(-10.0), Some(2.0));
        assert_eq!(t.z_for_stroke_width(0.5), Some(3.0));
        assert!((t.z_for_stroke_width(0.7).unwrap() - 3.0).abs() < 1e-9);
        assert!((t.z_for_stroke_width(0.9).unwrap() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn z_for_stroke_width_returns_z_path_when_esw_at_or_below_one() {
        // esw ≤ 1.0 makes no sense for this model; falls back to z_path for all widths
        let t = turtle_with_z(None, Some(0.0), Some(-2.0), Some(1.0));
        assert_eq!(t.z_for_stroke_width(0.5), Some(0.0));
        assert_eq!(t.z_for_stroke_width(1.0), Some(0.0));
        assert_eq!(t.z_for_stroke_width(2.0), Some(0.0));
        let t = turtle_with_z(None, Some(0.0), Some(-2.0), Some(0.5));
        assert_eq!(t.z_for_stroke_width(0.5), Some(0.0));
        assert_eq!(t.z_for_stroke_width(1.0), Some(0.0));
    }
}
