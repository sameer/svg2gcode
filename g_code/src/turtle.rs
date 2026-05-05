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

    fn line_to(&self, to: Point<f64>) -> Vec<Token<'input>> {
        command!(LinearInterpolation {
            X: self.round(to.x),
            Y: self.round(to.y),
            F: self.feedrate,
        })
        .into_token_vec()
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

        self.program.append(
            &mut command!(RapidPositioning {
                X: self.round(start.x),
                Y: self.round(start.y),
            })
            .into_token_vec(),
        );
        self.tool_on();

        for command in commands {
            match command {
                DrawCommand::LineTo { from: _, to } => {
                    self.program.append(
                        &mut command!(LinearInterpolation {
                            X: self.round(to.x),
                            Y: self.round(to.y),
                            F: self.feedrate,
                        })
                        .into_token_vec(),
                    );
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
                                    self.line_to(line.to);
                                }
                            });
                    } else {
                        svg_arc
                            .to_arc()
                            .flattened(self.flattening_tolerance())
                            .for_each(|point| self.program.append(&mut self.line_to(point)));
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
                                    self.program.append(&mut self.line_to(line.to))
                                }
                            });
                    } else {
                        cbs.flattened(self.flattening_tolerance())
                            .for_each(|point| self.program.append(&mut self.line_to(point)));
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
                                self.program.append(&mut self.line_to(line.to))
                            }
                        });
                    } else {
                        qbs.flattened(self.flattening_tolerance())
                            .for_each(|point| self.program.append(&mut self.line_to(point)));
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
