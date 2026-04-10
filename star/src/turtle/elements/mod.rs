//! Atomic units operated on by a turtle.

use std::mem::swap;

pub use lyon_geom::{ArcFlags, CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc, Vector};

pub use self::{
    arc::{ArcOrLineSegment, FlattenWithArcs, Transformed},
    tsp::minimize_travel_time,
};
use crate::turtle::Turtle;

/// Approximate [Bézier curves](https://en.wikipedia.org/wiki/B%C3%A9zier_curve) with [Circular arcs](https://en.wikipedia.org/wiki/Circular_arc)
mod arc;

/// Reorders strokes to minimize pen-up travel using TSP heuristics
mod tsp;

/// Raster image decoded from an inline PNG/JPEG.
///
/// <https://www.w3.org/TR/SVG/embedded.html#ImageElement>
#[cfg(feature = "image")]
pub struct RasterImage {
    pub position: Point<f64>,
    pub dimensions: Vector<f64>,
    pub image: image::DynamicImage,
}

/// Atomic unit of a [Stroke].
#[derive(Debug, Clone)]
pub enum DrawCommand {
    LineTo { from: Point<f64>, to: Point<f64> },
    Arc(SvgArc<f64>),
    CubicBezier(CubicBezierSegment<f64>),
    QuadraticBezier(QuadraticBezierSegment<f64>),
    Comment(String),
}

impl DrawCommand {
    pub fn apply(&self, turtle: &mut impl Turtle) {
        match self {
            Self::LineTo { to, .. } => turtle.line_to(*to),
            Self::Arc(arc) => turtle.arc(*arc),
            Self::CubicBezier(cbs) => turtle.cubic_bezier(*cbs),
            Self::QuadraticBezier(qbs) => turtle.quadratic_bezier(*qbs),
            Self::Comment(s) => turtle.comment(s.clone()),
        }
    }

    fn end_point(&self) -> Option<Point<f64>> {
        match self {
            Self::LineTo { to, .. } => Some(*to),
            Self::Arc(arc) => Some(arc.to),
            Self::CubicBezier(cbs) => Some(cbs.to),
            Self::QuadraticBezier(qbs) => Some(qbs.to),
            Self::Comment(_) => None,
        }
    }

    fn reverse(&mut self) {
        match self {
            Self::LineTo { from, to } => {
                swap(from, to);
            }
            Self::Arc(arc) => {
                swap(&mut arc.to, &mut arc.from);
                arc.flags.sweep = !arc.flags.sweep;
            }
            Self::CubicBezier(cbs) => {
                swap(&mut cbs.from, &mut cbs.to);
                swap(&mut cbs.ctrl1, &mut cbs.ctrl2);
            }
            Self::QuadraticBezier(qbs) => {
                swap(&mut qbs.from, &mut qbs.to);
            }
            Self::Comment(_) => {}
        }
    }
}

/// A continuous tool-on sequence with a known [Self::start_point].
#[derive(Debug, Clone)]
pub struct Stroke {
    pub(super) start_point: Point<f64>,
    pub(super) commands: Vec<DrawCommand>,
}

impl Stroke {
    pub fn new(start_point: Point<f64>, commands: Vec<DrawCommand>) -> Self {
        Self {
            start_point,
            commands,
        }
    }

    pub fn end_point(&self) -> Point<f64> {
        self.commands
            .iter()
            .rev()
            .find_map(DrawCommand::end_point)
            .unwrap_or(self.start_point)
    }

    /// Reverses the stroke so it runs from [Self::end_point] to [Self::start_point].
    pub fn reversed(&mut self) {
        self.start_point = self.end_point();
        self.commands.reverse();
        self.commands.iter_mut().for_each(|c| c.reverse());
    }

    pub fn start_point(&self) -> Point<f64> {
        self.start_point
    }

    pub fn commands(&self) -> impl Iterator<Item = &DrawCommand> {
        self.commands.iter()
    }

    /// Whether the stroke ends at the start.
    pub fn is_closed(&self) -> bool {
        (self.start_point() - self.end_point()).length() < f64::EPSILON
    }
}
