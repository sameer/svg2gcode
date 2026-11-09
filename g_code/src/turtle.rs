use std::{borrow::Cow, fmt::Debug};

use ::g_code::{command, emit::Token};
use lyon_geom::{LineSegment, Point, SvgArc};
use rust_decimal::{Decimal, prelude::*};
use svg2star::turtle::{
    Turtle,
    elements::{ArcOrLineSegment, DrawCommand, FlattenWithArcs, Shape, Stroke},
};

use crate::machine::Machine;

/// Maps path segments into g-code operations
#[derive(Debug)]
pub struct GCodeTurtle<'input> {
    pub machine: Machine<'input>,
    pub tolerance: Decimal,
    pub feedrate: Decimal,
    pub program: Vec<Token<'input>>,
}

impl<'input> GCodeTurtle<'input> {
    /// Rounds `val` to the number of decimal places in [`Self::tolerance`].
    ///
    /// i.e. 3 decimal places for 0.002
    fn round(&self, val: f64) -> Decimal {
        let places = self.tolerance.scale();
        Decimal::from_f64(val).unwrap_or_default().round_dp(places)
    }

    /// Tolerance passed to [`lyon_geom`] calls for line segments.
    ///
    /// Reserves some headroom so that [`Self::round`] won't take
    /// the measurement outside of the overall tolerance bounds.
    ///
    /// i.e. e.g. 0.002 & 3 dp returns 0.0015 so we have +/- 0.0005
    fn flattening_tolerance(&self) -> f64 {
        let rounding_epsilon = Decimal::new(5, self.tolerance.scale() + 1);
        if rounding_epsilon < self.tolerance {
            self.tolerance - rounding_epsilon
        } else {
            self.tolerance
        }
        .as_f64()
    }

    /// Tolerance passed to [`lyon_geom`] calls when circular interpolation is used.
    ///
    /// For G2/G3 arcs, X, Y, and R are all rounded independently.
    /// The worst-case combined error is:
    /// - endpoint 2D: `rounding_epsilon * sqrt(2)`
    /// - radius: `rounding_epsilon`
    /// - total: `rounding_epsilon * (sqrt(2) + 1)`
    fn arc_flattening_tolerance(&self) -> f64 {
        let rounding_epsilon = Decimal::new(5, self.tolerance.scale() + 1)
            * Decimal::from_f64(std::f64::consts::SQRT_2 + 1.).unwrap();
        if rounding_epsilon < self.tolerance {
            self.tolerance - rounding_epsilon
        } else {
            self.tolerance
        }
        .as_f64()
    }

    fn line_to(&self, to: Point<f64>) -> impl DoubleEndedIterator<Item = Token<'input>> + 'input {
        command!(LinearInterpolation {
            X: self.round(to.x),
            Y: self.round(to.y),
            F: self.feedrate,
        })
        .into_token_iter()
    }

    fn push_circular_interpolation(&mut self, svg_arc: SvgArc<f64>) {
        if svg_arc.is_straight_line() {
            self.program.extend(self.line_to(svg_arc.to));
            return;
        }

        match (svg_arc.flags.large_arc, svg_arc.flags.sweep) {
            (false, true) => {
                self.program.extend(
                    command!(CounterclockwiseCircularInterpolation {
                        X: self.round(svg_arc.to.x),
                        Y: self.round(svg_arc.to.y),
                        R: self.round(svg_arc.radii.x),
                        F: self.feedrate,
                    })
                    .into_token_iter(),
                );
            }
            (false, false) => {
                self.program.extend(
                    command!(ClockwiseCircularInterpolation {
                        X: self.round(svg_arc.to.x),
                        Y: self.round(svg_arc.to.y),
                        R: self.round(svg_arc.radii.x),
                        F: self.feedrate,
                    })
                    .into_token_iter(),
                );
            }
            (true, _) => {
                let (left, right) = svg_arc.to_arc().split(0.5);
                self.push_circular_interpolation(left.to_svg_arc());
                self.push_circular_interpolation(right.to_svg_arc());
            }
        }
    }

    fn tool_on(&mut self) {
        self.program.extend(self.machine.tool_on());
        if let Some(seq) = self.machine.absolute() {
            self.program.extend(seq);
        }
    }

    fn tool_off(&mut self) {
        self.program.extend(self.machine.tool_off());
        if let Some(seq) = self.machine.absolute() {
            self.program.extend(seq);
        }
    }
}

impl Turtle for GCodeTurtle<'_> {
    fn begin(&mut self) {
        self.program
            .extend(command!(UnitsMillimeters {}).into_token_iter());
        if let Some(seq) = self.machine.absolute() {
            self.program.extend(seq);
        }
        self.program.extend(self.machine.program_begin());
        if let Some(seq) = self.machine.absolute() {
            self.program.extend(seq);
        }
    }

    fn end(&mut self) {
        self.program.extend(self.machine.tool_off());
        if let Some(seq) = self.machine.absolute() {
            self.program.extend(seq);
        }
        self.program.extend(self.machine.program_end());
    }

    fn stroke(&mut self, stroke: Stroke) {
        let start = stroke.start_point();

        self.tool_off();

        // Comments should be inline after tool_off but before a rapid move.
        if let Some(comment) = stroke.comment() {
            self.program.push(Token::Comment {
                is_inline: false,
                inner: Cow::Owned(comment.to_owned()),
            });
        }

        self.program.extend(
            command!(RapidPositioning {
                X: self.round(start.x),
                Y: self.round(start.y),
            })
            .into_token_iter(),
        );
        self.tool_on();

        for command in stroke.into_commands() {
            match command {
                DrawCommand::LineTo(LineSegment { from: _, to }) => {
                    self.program.extend(
                        command!(LinearInterpolation {
                            X: self.round(to.x),
                            Y: self.round(to.y),
                            F: self.feedrate,
                        })
                        .into_token_iter(),
                    );
                }
                DrawCommand::Arc(svg_arc) => {
                    if self
                        .machine
                        .supported_functionality()
                        .circular_interpolation
                    {
                        for segment in
                            FlattenWithArcs::flattened(&svg_arc, self.arc_flattening_tolerance())
                        {
                            match segment {
                                ArcOrLineSegment::Arc(arc) => {
                                    self.push_circular_interpolation(arc);
                                }
                                ArcOrLineSegment::Line(line) => {
                                    self.program.extend(self.line_to(line.to));
                                }
                            }
                        }
                    } else {
                        for point in svg_arc.to_arc().flattened(self.flattening_tolerance()) {
                            self.program.extend(self.line_to(point));
                        }
                    }
                }
                DrawCommand::CubicBezier(cbs) => {
                    if self
                        .machine
                        .supported_functionality()
                        .circular_interpolation
                    {
                        for segment in
                            FlattenWithArcs::<f64>::flattened(&cbs, self.arc_flattening_tolerance())
                        {
                            match segment {
                                ArcOrLineSegment::Arc(arc) => {
                                    self.push_circular_interpolation(arc);
                                }
                                ArcOrLineSegment::Line(line) => {
                                    self.program.extend(self.line_to(line.to));
                                }
                            }
                        }
                    } else {
                        for point in cbs.flattened(self.flattening_tolerance()) {
                            self.program.extend(self.line_to(point));
                        }
                    }
                }
                DrawCommand::QuadraticBezier(qbs) => {
                    if self
                        .machine
                        .supported_functionality()
                        .circular_interpolation
                    {
                        for segment in FlattenWithArcs::<f64>::flattened(
                            &qbs.to_cubic(),
                            self.arc_flattening_tolerance(),
                        ) {
                            match segment {
                                ArcOrLineSegment::Arc(arc) => {
                                    self.push_circular_interpolation(arc);
                                }
                                ArcOrLineSegment::Line(line) => {
                                    self.program.extend(self.line_to(line.to));
                                }
                            }
                        }
                    } else {
                        for point in qbs.flattened(self.flattening_tolerance()) {
                            self.program.extend(self.line_to(point));
                        }
                    }
                }
            }
        }
    }

    #[cfg(feature = "image")]
    fn image(&mut self, _image: svg2star::turtle::elements::RasterImage) {
        // TODO (?)
    }

    fn fill(&mut self, _shape: Shape) {
        // TODO
    }
}
