use std::{borrow::Cow, fmt::Debug};

use ::g_code::{command, emit::Token};
use lyon_geom::{CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc};
use rust_decimal::{Decimal, prelude::*};
use svg2star::turtle::{
    Turtle,
    elements::{ArcOrLineSegment, FlattenWithArcs},
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
    /// the measurement outside of the overall tolernace bounds.
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

    fn comment(&mut self, comment: String) {
        self.program.push(Token::Comment {
            is_inline: false,
            inner: Cow::Owned(comment),
        });
    }

    fn move_to(&mut self, to: Point<f64>) {
        self.tool_off();
        self.program.append(
            &mut command!(RapidPositioning {
                X: self.round(to.x),
                Y: self.round(to.y),
            })
            .into_token_vec(),
        );
    }

    fn line_to(&mut self, to: Point<f64>) {
        self.tool_on();
        self.program.append(
            &mut command!(LinearInterpolation {
                X: self.round(to.x),
                Y: self.round(to.y),
                F: self.feedrate,
            })
            .into_token_vec(),
        );
    }

    fn arc(&mut self, svg_arc: SvgArc<f64>) {
        if svg_arc.is_straight_line() {
            self.line_to(svg_arc.to);
            return;
        }

        self.tool_on();

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
                .for_each(|point| self.line_to(point));
        };
    }

    fn cubic_bezier(&mut self, cbs: CubicBezierSegment<f64>) {
        self.tool_on();

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
                    ArcOrLineSegment::Line(line) => self.line_to(line.to),
                });
        } else {
            cbs.flattened(self.flattening_tolerance())
                .for_each(|point| self.line_to(point));
        };
    }

    fn quadratic_bezier(&mut self, qbs: QuadraticBezierSegment<f64>) {
        self.cubic_bezier(qbs.to_cubic());
    }
}
