//! Atomic units operated on by a turtle.

use std::{mem::swap, ops::Range};

use lyon_geom::{
    ArcFlags, Box2D, CubicBezierSegment, LineSegment, Point, QuadraticBezierSegment, SvgArc,
};

pub use self::{
    arc::{ArcOrLineSegment, FlattenWithArcs, Transformed},
    tsp::minimize_travel_time,
};

/// Approximate [Bézier curves](https://en.wikipedia.org/wiki/B%C3%A9zier_curve) with [Circular arcs](https://en.wikipedia.org/wiki/Circular_arc)
mod arc;

/// Reorders strokes to minimize pen-up travel using TSP heuristics
mod tsp;

/// Find intersections between curves and lines in parameterized (t, u) form.
mod intersect;

pub(crate) mod clip;
pub(crate) mod fill;

#[cfg(feature = "image")]
pub(crate) mod image_ops;

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

/// Classification of a point with respect to a shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PointLocation {
    Interior,
    Boundary,
    Exterior,
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
#[derive(Debug, Clone, Copy)]
pub enum DrawCommand {
    LineTo(LineSegment<f64>),
    Arc(SvgArc<f64>),
    CubicBezier(CubicBezierSegment<f64>),
    QuadraticBezier(QuadraticBezierSegment<f64>),
}

impl DrawCommand {
    pub fn start_point(&self) -> Point<f64> {
        match self {
            Self::LineTo(line) => line.from,
            Self::Arc(arc) => arc.from,
            Self::CubicBezier(cbs) => cbs.from,
            Self::QuadraticBezier(qbs) => qbs.from,
        }
    }

    pub fn set_start_point(&mut self, pt: Point<f64>) {
        match self {
            Self::LineTo(line) => line.from = pt,
            Self::Arc(arc) => arc.from = pt,
            Self::CubicBezier(cbs) => cbs.from = pt,
            Self::QuadraticBezier(qbs) => qbs.from = pt,
        }
    }

    pub fn end_point(&self) -> Point<f64> {
        match self {
            Self::LineTo(line) => line.to,
            Self::Arc(arc) => arc.to,
            Self::CubicBezier(cbs) => cbs.to,
            Self::QuadraticBezier(qbs) => qbs.to,
        }
    }

    pub fn set_end_point(&mut self, pt: Point<f64>) {
        match self {
            Self::LineTo(line) => line.to = pt,
            Self::Arc(arc) => arc.to = pt,
            Self::CubicBezier(cbs) => cbs.to = pt,
            Self::QuadraticBezier(qbs) => qbs.to = pt,
        }
    }

    pub fn bounding_box(&self) -> Box2D<f64> {
        match self {
            Self::LineTo(line) => line.bounding_box(),
            Self::Arc(arc) => arc.to_arc().bounding_box(),
            Self::CubicBezier(cbs) => cbs.bounding_box(),
            Self::QuadraticBezier(qbs) => qbs.bounding_box(),
        }
    }

    pub fn reverse(&mut self) {
        match self {
            Self::LineTo(line) => {
                swap(&mut line.from, &mut line.to);
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
        }
    }

    pub fn sample(&self, t: f64) -> Point<f64> {
        match self {
            Self::LineTo(line) => line.sample(t),
            Self::Arc(arc) => arc.to_arc().sample(t),
            Self::CubicBezier(cbs) => cbs.sample(t),
            Self::QuadraticBezier(qbs) => qbs.sample(t),
        }
    }

    /// Returns a sub-curve within the given t-range.
    pub fn split_range(&self, range: Range<f64>) -> Self {
        match self {
            Self::LineTo(line) => Self::LineTo(line.split_range(range)),
            Self::Arc(svg_arc) => {
                let sub_arc = svg_arc.to_arc().split_range(range);
                Self::Arc(SvgArc {
                    from: sub_arc.from(),
                    to: sub_arc.to(),
                    radii: svg_arc.radii,
                    x_rotation: svg_arc.x_rotation,
                    flags: ArcFlags {
                        large_arc: sub_arc.sweep_angle.radians.abs() >= std::f64::consts::PI,
                        sweep: sub_arc.sweep_angle.radians.is_sign_positive(),
                    },
                })
            }
            Self::CubicBezier(cbs) => Self::CubicBezier(cbs.split_range(range)),
            Self::QuadraticBezier(qbs) => Self::QuadraticBezier(qbs.split_range(range)),
        }
    }
}

/// A continuous path composed of individual commands with a known start point.
#[derive(Debug, Clone)]
pub struct Stroke {
    start_point: Point<f64>,
    commands: Vec<DrawCommand>,
    /// Largely for debugging purposes.
    comment: Option<String>,
}

impl Stroke {
    pub fn new(
        start_point: Point<f64>,
        commands: Vec<DrawCommand>,
        comment: Option<String>,
    ) -> Self {
        Self {
            start_point,
            commands,
            comment,
        }
    }

    pub fn end_point(&self) -> Point<f64> {
        self.commands
            .last()
            .map_or(self.start_point, DrawCommand::end_point)
    }

    /// Reverses the stroke so it runs from [`Self::end_point`] to [`Self::start_point`].
    pub fn reversed(&mut self) {
        self.start_point = self.end_point();
        self.commands.reverse();
        self.commands.iter_mut().for_each(DrawCommand::reverse);
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

    /// Same as [`Self::commands`] but with an explicit closing line segment if unclosed.
    ///
    /// Usually relevant when the spec says it is implicitly closed (i.e. fills).
    pub fn closed_commands(&self) -> impl Iterator<Item = DrawCommand> + '_ {
        self.commands()
            .copied()
            .chain(
                (!self.commands.is_empty() && !self.is_closed()).then_some(DrawCommand::LineTo(
                    LineSegment {
                        from: self.end_point(),
                        to: self.start_point(),
                    },
                )),
            )
    }

    /// Whether the stroke explicitly ends at the start.
    pub fn is_closed(&self) -> bool {
        (self.start_point() - self.end_point()).square_length() < f64::EPSILON
    }

    /// Calculate the bounding box of the stroke.
    pub fn bounding_box(&self) -> Box2D<f64> {
        self.commands().map(DrawCommand::bounding_box).fold(
            Box2D::new(self.start_point, self.start_point),
            |bbox, cmd_bbox| Box2D::from_points([bbox.min, bbox.max, cmd_bbox.min, cmd_bbox.max]),
        )
    }

    pub fn comment(&self) -> Option<&str> {
        self.comment.as_deref()
    }
}
