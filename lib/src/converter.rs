use std::borrow::Cow;
use std::str::FromStr;

use g_code::{command, emit::Token};
use log::{debug, warn};
use lyon_geom::{
    euclid::{default::Transform2D, Angle, Transform3D},
    vector,
};
use roxmltree::{Document, Node};
use svgtypes::{
    LengthListParser, PathParser, PathSegment, TransformListParser, TransformListToken, ViewBox,
};

use crate::turtle::*;

/// High-level output options
#[derive(Debug)]
pub struct ConversionOptions {
    /// Curve interpolation tolerance in millimeters
    pub tolerance: f64,
    /// Feedrate in millimeters / minute
    pub feedrate: f64,
    /// Dots per inch for pixels, picas, points, etc.
    pub dpi: f64,
}

impl Default for ConversionOptions {
    fn default() -> Self {
        Self {
            tolerance: 0.002,
            feedrate: 300.0,
            dpi: 96.0,
        }
    }
}

pub fn svg2program<'input>(
    doc: &Document,
    options: ConversionOptions,
    turtle: &'input mut Turtle<'input>,
) -> Vec<Token<'input>> {
    let mut program = command!(UnitsMillimeters {})
        .into_token_vec()
        .drain(..)
        .collect::<Vec<_>>();
    program.extend(turtle.machine.absolute());
    program.extend(turtle.machine.program_begin());
    program.extend(turtle.machine.absolute());

    // Depth-first SVG DOM traversal
    let mut node_stack = vec![(doc.root(), doc.root().children())];
    let mut name_stack: Vec<String> = vec![];

    while let Some((parent, mut children)) = node_stack.pop() {
        let node: Node = match children.next() {
            Some(child) => {
                node_stack.push((parent, children));
                child
            }
            None => {
                if parent.has_attribute("viewBox")
                    || parent.has_attribute("transform")
                    || parent.has_attribute("width")
                    || parent.has_attribute("height")
                {
                    turtle.pop_transform();
                }
                name_stack.pop();
                continue;
            }
        };

        if node.node_type() != roxmltree::NodeType::Element {
            debug!("Encountered a non-element: {:?}", node);
            continue;
        }

        if node.tag_name().name() == "clipPath" {
            warn!("Clip paths are not supported: {:?}", node);
            continue;
        }

        let mut transforms = vec![];
        if let Some(view_box) = node.attribute("viewBox") {
            let view_box = ViewBox::from_str(view_box).expect("could not parse viewBox");
            transforms.push(
                Transform2D::translation(-view_box.x, -view_box.y)
                    .then_scale(1. / view_box.w, 1. / view_box.h),
            );
        }

        if let Some(transform) = width_and_height_into_transform(&options, &node) {
            transforms.push(transform);
        }

        if let Some(transform) = node.attribute("transform") {
            let parser = TransformListParser::from(transform);
            transforms.extend(
                parser
                    .map(|token| {
                        token.expect("could not parse a transform in a list of transforms")
                    })
                    .map(svg_transform_into_euclid_transform)
                    .collect::<Vec<_>>()
                    .iter()
                    .rev(),
            )
        }

        if !transforms.is_empty() {
            let transform = transforms
                .iter()
                .fold(Transform2D::identity(), |acc, t| acc.then(t));
            turtle.push_transform(transform);
        }

        if node.tag_name().name() == "path" {
            if let Some(d) = node.attribute("d") {
                turtle.reset();
                let mut comment = String::new();
                name_stack.iter().for_each(|name| {
                    comment += name;
                    comment += " > ";
                });
                comment += &node_name(&node);
                program.push(Token::Comment {
                    is_inline: false,
                    inner: Cow::Owned(comment),
                });
                program.extend(apply_path(turtle, &options, d));
            } else {
                warn!("There is a path node containing no actual path: {:?}", node);
            }
        }

        if node.has_children() {
            node_stack.push((node, node.children()));
            name_stack.push(node_name(&node));
        } else if !transforms.is_empty() {
            // Pop transform early, since this is the only element that has it
            turtle.pop_transform();
        }
    }

    // Critical step for actually moving the machine back to the origin, just in case SVG is malformed
    turtle.pop_all_transforms();
    program.extend(turtle.machine.tool_off());
    program.extend(turtle.machine.absolute());
    program.extend(turtle.machine.program_end());
    program.append(&mut command!(ProgramEnd {}).into_token_vec());

    program
}

fn node_name(node: &Node) -> String {
    let mut name = node.tag_name().name().to_string();
    if let Some(id) = node.attribute("id") {
        name += "#";
        name += id;
    }
    name
}

fn width_and_height_into_transform(
    options: &ConversionOptions,
    node: &Node,
) -> Option<Transform2D<f64>> {
    if let (Some(mut width), Some(mut height)) = (
        node.attribute("width").map(LengthListParser::from),
        node.attribute("height").map(LengthListParser::from),
    ) {
        let width = width
            .next()
            .expect("no width in width property")
            .expect("cannot parse width");
        let height = height
            .next()
            .expect("no height in height property")
            .expect("cannot parse height");
        let width_in_mm = length_to_mm(width, options.dpi);
        let height_in_mm = length_to_mm(height, options.dpi);

        // SVGs have 0,0 in upper left
        // g-code has 0,0 in lower left
        Some(
            Transform2D::scale(width_in_mm, -height_in_mm)
                .then_translate(vector(0f64, height_in_mm)),
        )
    } else {
        None
    }
}

fn apply_path<'a, 'input>(
    turtle: &'a mut Turtle<'input>,
    options: &ConversionOptions,
    path: &str,
) -> Vec<Token<'input>> {
    use PathSegment::*;
    PathParser::from(path)
        .map(|segment| segment.expect("could not parse path segment"))
        .flat_map(|segment| {
            debug!("Drawing {:?}", &segment);
            match segment {
                MoveTo { abs, x, y } => turtle.move_to(abs, x, y),
                ClosePath { abs: _ } => {
                    // Ignore abs, should have identical effect: [9.3.4. The "closepath" command]("https://www.w3.org/TR/SVG/paths.html#PathDataClosePathCommand)
                    turtle.close(None, options.feedrate)
                }
                LineTo { abs, x, y } => turtle.line(abs, x, y, None, options.feedrate),
                HorizontalLineTo { abs, x } => turtle.line(abs, x, None, None, options.feedrate),
                VerticalLineTo { abs, y } => turtle.line(abs, None, y, None, options.feedrate),
                CurveTo {
                    abs,
                    x1,
                    y1,
                    x2,
                    y2,
                    x,
                    y,
                } => turtle.cubic_bezier(
                    abs,
                    x1,
                    y1,
                    x2,
                    y2,
                    x,
                    y,
                    options.tolerance,
                    None,
                    options.feedrate,
                ),
                SmoothCurveTo { abs, x2, y2, x, y } => turtle.smooth_cubic_bezier(
                    abs,
                    x2,
                    y2,
                    x,
                    y,
                    options.tolerance,
                    None,
                    options.feedrate,
                ),
                Quadratic { abs, x1, y1, x, y } => turtle.quadratic_bezier(
                    abs,
                    x1,
                    y1,
                    x,
                    y,
                    options.tolerance,
                    None,
                    options.feedrate,
                ),
                SmoothQuadratic { abs, x, y } => turtle.smooth_quadratic_bezier(
                    abs,
                    x,
                    y,
                    options.tolerance,
                    None,
                    options.feedrate,
                ),
                EllipticalArc {
                    abs,
                    rx,
                    ry,
                    x_axis_rotation,
                    large_arc,
                    sweep,
                    x,
                    y,
                } => turtle.elliptical(
                    abs,
                    rx,
                    ry,
                    x_axis_rotation,
                    large_arc,
                    sweep,
                    x,
                    y,
                    None,
                    options.feedrate,
                    options.tolerance,
                ),
            }
        })
        .collect()
}

fn svg_transform_into_euclid_transform(svg_transform: TransformListToken) -> Transform2D<f64> {
    use TransformListToken::*;
    match svg_transform {
        Matrix { a, b, c, d, e, f } => Transform2D::new(a, b, c, d, e, f),
        Translate { tx, ty } => Transform2D::translation(tx, ty),
        Scale { sx, sy } => Transform2D::scale(sx, sy),
        Rotate { angle } => Transform2D::rotation(Angle::degrees(angle)),
        // https://drafts.csswg.org/css-transforms/#SkewXDefined
        SkewX { angle } => Transform3D::skew(Angle::degrees(angle), Angle::zero()).to_2d(),
        // https://drafts.csswg.org/css-transforms/#SkewYDefined
        SkewY { angle } => Transform3D::skew(Angle::zero(), Angle::degrees(angle)).to_2d(),
    }
}

/// Convenience function for converting absolute lengths to millimeters
///
/// Absolute lengths are listed in [CSS 4 §6.2](https://www.w3.org/TR/css-values/#absolute-lengths).
/// Relative lengths in [CSS 4 §6.1](https://www.w3.org/TR/css-values/#relative-lengths) are not supported and will simply be interpreted as millimeters.
///
/// A default DPI of 96 is used as per [CSS 4 §7.4](https://www.w3.org/TR/css-values/#resolution), which you can adjust with --dpi.
/// Increasing DPI reduces the scale of an SVG.
fn length_to_mm(l: svgtypes::Length, dpi: f64) -> f64 {
    use svgtypes::LengthUnit::*;
    use uom::si::f64::Length;
    use uom::si::length::*;

    let dpi_scaling = dpi / 96.0;
    let length = match l.unit {
        Cm => Length::new::<centimeter>(l.num),
        Mm => Length::new::<millimeter>(l.num),
        In => Length::new::<inch>(l.num),
        Pc => Length::new::<pica_computer>(l.num) / dpi_scaling,
        Pt => Length::new::<point_computer>(l.num) / dpi_scaling,
        Px => Length::new::<inch>(l.num / dpi_scaling),
        other => {
            warn!(
                "Converting from '{:?}' to millimeters is not supported, treating as millimeters",
                other
            );
            Length::new::<millimeter>(l.num)
        }
    };

    length.get::<millimeter>()
}
