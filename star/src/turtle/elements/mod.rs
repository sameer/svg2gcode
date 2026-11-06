//! Atomic units operated on by a turtle.

use std::{iter, mem::swap, ops::Range};

use lyon_geom::{
    Box2D, CubicBezierSegment, LineSegment, Point, QuadraticBezierSegment, SvgArc, Vector,
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

/// SVG clipping operations.
pub(crate) mod clip;

/// Simplifies an ambiguous filled SVG path (list of [`Stroke`]s) into well-formed [`Shape`]s.
pub(crate) mod fill;

#[cfg(feature = "image")]
pub(crate) mod image_ops;

/// Defines the algorithm used to calculate how a shape is filled.
///
/// <https://www.w3.org/TR/SVG/painting.html#FillRuleProperty>
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum FillRule {
    /// A point is inside if the winding number of the path around it is non-zero (SVG default).
    #[default]
    NonZero,
    /// A point is inside if the number of path crossings with a ray from this point is odd.
    EvenOdd,
}

/// Classification of a point with respect to a shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PointLocation {
    Interior,
    Boundary,
    Exterior,
}

/// A filled region consisting of one closed outer [`Stroke`] with one
/// or more closed [`Stroke`] holes punched out of it.
///
/// It is guaranteed that `outer` is the boundary of the filled area and
/// each entry in `holes` is a region to subtract within `outer`.
#[derive(Debug, Clone)]
pub struct Shape {
    pub outer: Stroke,
    /// Regions to subtract from [`Self::outer`].
    pub holes: Vec<Stroke>,
}

impl Shape {
    pub fn bounding_box(&self) -> Box2D<f64> {
        iter::once(&self.outer)
            .chain(self.holes.iter())
            .map(Stroke::bounding_box)
            .fold(
                Box2D::new(self.outer.start_point, self.outer.start_point),
                |bbox, cmd_bbox| {
                    Box2D::from_points([bbox.min, bbox.max, cmd_bbox.min, cmd_bbox.max])
                },
            )
    }
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

#[cfg(feature = "image")]
impl RasterImage {
    pub fn bounding_box(&self) -> Box2D<f64> {
        self.dimensions
    }
}

#[cfg(feature = "image")]
impl rstar::RTreeObject for RasterImage {
    type Envelope = rstar::AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        let Box2D { min, max } = self.dimensions;
        rstar::AABB::from_corners([min.x, min.y], [max.x, max.y])
    }
}

/// Atomic unit of a [Stroke].
///
/// A backend may support native curve commands,
/// so the library does not simplify to line segments.
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

    pub fn end_point(&self) -> Point<f64> {
        match self {
            Self::LineTo(line) => line.to,
            Self::Arc(arc) => arc.to,
            Self::CubicBezier(cbs) => cbs.to,
            Self::QuadraticBezier(qbs) => qbs.to,
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

    /// Calculates the point at parameterized `t` on the curve in [0, 1].
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
                let svg_sub_arc = svg_arc.to_arc().split_range(range).to_svg_arc();
                if svg_sub_arc.is_straight_line() {
                    Self::LineTo(LineSegment {
                        from: svg_sub_arc.from,
                        to: svg_sub_arc.to,
                    })
                } else {
                    Self::Arc(svg_sub_arc)
                }
            }
            Self::CubicBezier(cbs) => Self::CubicBezier(cbs.split_range(range)),
            Self::QuadraticBezier(qbs) => Self::QuadraticBezier(qbs.split_range(range)),
        }
    }

    /// Returns the unit tangent vector at `t`.
    pub fn tangent(&self, t: f64) -> Vector<f64> {
        match self {
            Self::LineTo(line) => line.to_vector().normalize(),
            Self::Arc(svg_arc) => {
                let arc = svg_arc.to_arc();
                let tangent_vector = arc.sample_tangent(t).normalize();
                // `sample_tangent` points along increasing angle, sign must be flipped if the arc sweeps backward.
                if arc.sweep_angle.get().is_sign_negative() {
                    -tangent_vector
                } else {
                    tangent_vector
                }
            }
            Self::QuadraticBezier(qbs) => qbs.derivative(t).normalize(),
            Self::CubicBezier(cbs) => cbs.derivative(t).normalize(),
        }
    }

    /// Returns the unit normal vector at `t`, perpendicular to the tangent vector.
    pub fn normal(&self, t: f64) -> Vector<f64> {
        let tangent = self.tangent(t);
        Vector::new(-tangent.y, tangent.x)
    }

    /// Reverses the command so it runs from [`Self::end_point`] to [`Self::start_point`].
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
}

impl rstar::RTreeObject for DrawCommand {
    type Envelope = rstar::AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        let Box2D { min, max } = self.bounding_box();
        rstar::AABB::from_corners([min.x, min.y], [max.x, max.y])
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

    pub fn start_point(&self) -> Point<f64> {
        self.start_point
    }

    pub fn end_point(&self) -> Point<f64> {
        self.commands
            .last()
            .map_or(self.start_point, DrawCommand::end_point)
    }

    pub fn commands(&self) -> &[DrawCommand] {
        &self.commands
    }

    pub fn into_commands(self) -> Vec<DrawCommand> {
        self.commands
    }

    /// Whether the stroke explicitly ends at the start.
    pub fn is_closed(&self) -> bool {
        (self.start_point() - self.end_point()).square_length() < f64::EPSILON
    }

    /// Calculate the bounding box of the stroke.
    pub fn bounding_box(&self) -> Box2D<f64> {
        self.commands().iter().map(DrawCommand::bounding_box).fold(
            Box2D::new(self.start_point, self.start_point),
            |bbox, cmd_bbox| Box2D::from_points([bbox.min, bbox.max, cmd_bbox.min, cmd_bbox.max]),
        )
    }

    pub fn comment(&self) -> Option<&str> {
        self.comment.as_deref()
    }

    /// Reverses the stroke so it runs from [`Self::end_point`] to [`Self::start_point`].
    pub fn reverse(&mut self) {
        self.start_point = self.end_point();
        self.commands.reverse();
        self.commands.iter_mut().for_each(DrawCommand::reverse);
    }

    /// Makes this stroke closed if it wasn't already.
    ///
    /// Usually relevant when the spec says it is implicitly closed (i.e. fills).
    pub fn closed(&mut self) {
        if !self.commands.is_empty() && !self.is_closed() {
            self.commands.push(DrawCommand::LineTo(LineSegment {
                from: self.end_point(),
                to: self.start_point(),
            }));
        }
    }
}

impl rstar::RTreeObject for Stroke {
    type Envelope = rstar::AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        let Box2D { min, max } = self.bounding_box();
        rstar::AABB::from_corners([min.x, min.y], [max.x, max.y])
    }
}

impl rstar::RTreeObject for Shape {
    type Envelope = rstar::AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        let Box2D { min, max } = self.bounding_box();
        rstar::AABB::from_corners([min.x, min.y], [max.x, max.y])
    }
}
