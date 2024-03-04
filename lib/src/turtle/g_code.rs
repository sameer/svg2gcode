use std::borrow::Cow;
use std::fmt::Debug;

use ::g_code::{command, emit::Token};
use lyon_geom::{CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc};

use super::Turtle;
use crate::arc::{ArcOrLineSegment, FlattenWithArcs};
use crate::machine::Machine;

/// Turtle graphics simulator for mapping path segments into g-code
#[derive(Debug)]
pub struct GCodeTurtle<'input> {
    pub machine: Machine<'input>,
    pub tolerance: f64,
    pub feedrate: f64,
    pub program: Vec<Token<'input>>,
}

impl<'input> GCodeTurtle<'input> {
    fn circular_interpolation(&self, svg_arc: SvgArc<f64>) -> Vec<Token<'input>> {
        debug_assert!((svg_arc.radii.x.abs() - svg_arc.radii.y.abs()).abs() < f64::EPSILON);
        match (svg_arc.flags.large_arc, svg_arc.flags.sweep) {
            (false, true) => command!(CounterclockwiseCircularInterpolation {
                X: svg_arc.to.x,
                Y: svg_arc.to.y,
                R: svg_arc.radii.x,
                F: self.feedrate,
            })
            .into_token_vec(),
            (false, false) => command!(ClockwiseCircularInterpolation {
                X: svg_arc.to.x,
                Y: svg_arc.to.y,
                R: svg_arc.radii.x,
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
        self.program.extend(
            self.machine
                .tool_on()
                .drain(..)
                .chain(self.machine.absolute()),
        );
    }

    fn tool_off(&mut self) {
        self.program.extend(
            self.machine
                .tool_off()
                .drain(..)
                .chain(self.machine.absolute()),
        );
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
        self.program
            .append(&mut command!(ProgramEnd {}).into_token_vec());
    }

    fn comment(&mut self, comment: String) {
        self.program.push(Token::Comment {
            is_inline: false,
            inner: Cow::Owned(comment),
        });
    }

    fn move_to(&mut self, to: Point<f64>) {
        self.tool_off();
        self.program
            .append(&mut command!(RapidPositioning { X: to.x, Y: to.y, }).into_token_vec());
    }

    fn line_to(&mut self, to: Point<f64>) {
        self.tool_on();
        self.program.append(
            &mut command!(LinearInterpolation {
                X: to.x,
                Y: to.y,
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
            FlattenWithArcs::flattened(&svg_arc, self.tolerance)
                .drain(..)
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
                .flattened(self.tolerance)
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
            FlattenWithArcs::<f64>::flattened(&cbs, self.tolerance)
                .drain(..)
                .for_each(|segment| match segment {
                    ArcOrLineSegment::Arc(arc) => {
                        self.program.append(&mut self.circular_interpolation(arc))
                    }
                    ArcOrLineSegment::Line(line) => self.line_to(line.to),
                });
        } else {
            cbs.flattened(self.tolerance)
                .for_each(|point| self.line_to(point));
        };
    }

    fn quadratic_bezier(&mut self, qbs: QuadraticBezierSegment<f64>) {
        self.cubic_bezier(qbs.to_cubic());
    }
}
