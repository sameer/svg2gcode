//! Atomic units operated on by a turtle.

use std::mem::swap;

use lyon_geom::Box2D;
pub use lyon_geom::{ArcFlags, CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc, Vector};

pub use self::{
    arc::{ArcOrLineSegment, FlattenWithArcs, Transformed},
    tsp::minimize_travel_time,
};

/// Approximate [Bézier curves](https://en.wikipedia.org/wiki/B%C3%A9zier_curve) with [Circular arcs](https://en.wikipedia.org/wiki/Circular_arc)
mod arc;

/// Reorders strokes to minimize pen-up travel using TSP heuristics
mod tsp;

pub(crate) mod fill;

/// Defines the algorithm used to calculate how a polygon is filled.
///
/// <https://www.w3.org/TR/SVG/painting.html#FillRuleProperty>
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum FillRule {
    /// A point is inside if the winding number of the path around it is non-zero (SVG default).
    #[default]
    NonZero,
    /// A point is inside if the number of path crossings is odd.
    EvenOdd,
}

/// A filled region: one outer closed contour and zero or more hole contours punched out of it.
///
/// The SVG fill rule is resolved such that `outer` is the boundary of the filled area and
/// each entry in `holes` is a region to subtract.
#[derive(Debug, Clone)]
pub struct FillPolygon {
    pub outer: Stroke,
    /// Regions to subtract from [`Self::outer`].
    pub holes: Vec<Stroke>,
}

/// Raster image decoded from an inline PNG/JPEG.
///
/// <https://www.w3.org/TR/SVG/embedded.html#ImageElement>
#[cfg(feature = "image")]
#[derive(Debug, Clone)]
pub struct RasterImage {
    pub dimensions: lyon_geom::Box2D<f64>,
    pub image: image::DynamicImage,
}

/// Atomic unit of a [Stroke].
#[derive(Debug, Clone)]
pub enum DrawCommand {
    LineTo {
        from: Point<f64>,
        to: Point<f64>,
    },
    Arc(SvgArc<f64>),
    CubicBezier(CubicBezierSegment<f64>),
    QuadraticBezier(QuadraticBezierSegment<f64>),
    /// Largely for debugging purposes.
    Comment(String),
}

impl DrawCommand {
    pub fn start_point(&self) -> Option<Point<f64>> {
        match self {
            Self::LineTo { from, .. } => Some(*from),
            Self::Arc(arc) => Some(arc.from),
            Self::CubicBezier(cbs) => Some(cbs.from),
            Self::QuadraticBezier(qbs) => Some(qbs.from),
            Self::Comment(_) => None,
        }
    }

    pub fn end_point(&self) -> Option<Point<f64>> {
        match self {
            Self::LineTo { to, .. } => Some(*to),
            Self::Arc(arc) => Some(arc.to),
            Self::CubicBezier(cbs) => Some(cbs.to),
            Self::QuadraticBezier(qbs) => Some(qbs.to),
            Self::Comment(_) => None,
        }
    }

    pub fn bounding_box(&self) -> Option<Box2D<f64>> {
        match self {
            Self::LineTo { from, to } => Some(Box2D::from_points([*from, *to])),
            Self::Arc(arc) => Some(arc.to_arc().bounding_box()),
            Self::CubicBezier(cbs) => Some(cbs.bounding_box()),
            Self::QuadraticBezier(qbs) => Some(qbs.bounding_box()),
            Self::Comment(_) => None,
        }
    }

    pub fn reverse(&mut self) {
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

/// A continuous path composed of individual commands with a known start point.
#[derive(Debug, Clone)]
pub struct Stroke {
    start_point: Point<f64>,
    commands: Vec<DrawCommand>,
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

    pub fn into_commands(self) -> impl Iterator<Item = DrawCommand> {
        self.commands.into_iter()
    }

    /// Whether the stroke explicitly ends at the start.
    pub fn is_closed(&self) -> bool {
        (self.start_point() - self.end_point()).square_length() < f64::EPSILON
    }
}
