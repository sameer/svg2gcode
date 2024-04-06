use euclid::Angle;
use log::debug;
use lyon_geom::{point, vector, ArcFlags};
use svgtypes::PathSegment;

use crate::Turtle;

use super::Terrarium;

/// Maps [`PathSegment`]s into concrete operations on the [`Terrarium`]
///
/// Performs a [`Terrarium::reset`] on each call
pub fn apply_path<T: Turtle>(
    terrarium: &mut Terrarium<T>,
    path: impl IntoIterator<Item = PathSegment>,
) {
    use PathSegment::*;

    terrarium.reset();
    path.into_iter().for_each(|segment| {
        debug!("Drawing {:?}", &segment);
        match segment {
            MoveTo { abs, x, y } => terrarium.move_to(abs, x, y),
            ClosePath { abs: _ } => {
                // Ignore abs, should have identical effect: [9.3.4. The "closepath" command]("https://www.w3.org/TR/SVG/paths.html#PathDataClosePathCommand)
                terrarium.close()
            }
            LineTo { abs, x, y } => terrarium.line(abs, x, y),
            HorizontalLineTo { abs, x } => terrarium.line(abs, x, None),
            VerticalLineTo { abs, y } => terrarium.line(abs, None, y),
            CurveTo {
                abs,
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => terrarium.cubic_bezier(abs, point(x1, y1), point(x2, y2), point(x, y)),
            SmoothCurveTo { abs, x2, y2, x, y } => {
                terrarium.smooth_cubic_bezier(abs, point(x2, y2), point(x, y))
            }
            Quadratic { abs, x1, y1, x, y } => {
                terrarium.quadratic_bezier(abs, point(x1, y1), point(x, y))
            }
            SmoothQuadratic { abs, x, y } => terrarium.smooth_quadratic_bezier(abs, point(x, y)),
            EllipticalArc {
                abs,
                rx,
                ry,
                x_axis_rotation,
                large_arc,
                sweep,
                x,
                y,
            } => terrarium.elliptical(
                abs,
                vector(rx, ry),
                Angle::degrees(x_axis_rotation),
                ArcFlags { large_arc, sweep },
                point(x, y),
            ),
        }
    });
}
