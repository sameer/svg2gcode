use std::borrow::Cow;
use std::str::FromStr;

use g_code::{command, emit::Token};
use log::{debug, warn};
use lyon_geom::{
    euclid::{default::Transform2D, Angle, Transform3D},
    point, vector, ArcFlags,
};
use roxmltree::{Document, Node};
#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
use svgtypes::{
    Length, LengthListParser, PathParser, PathSegment, TransformListParser, TransformListToken,
    ViewBox,
};

use crate::turtle::*;

#[cfg(feature = "serde")]
mod length_serde;

const SVG_TAG_NAME: &str = "svg";

/// High-level output configuration
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ConversionConfig {
    /// Curve interpolation tolerance in millimeters
    pub tolerance: f64,
    /// Feedrate in millimeters / minute
    pub feedrate: f64,
    /// Dots per inch for pixels, picas, points, etc.
    pub dpi: f64,
}

impl Default for ConversionConfig {
    fn default() -> Self {
        Self {
            tolerance: 0.002,
            feedrate: 300.0,
            dpi: 96.0,
        }
    }
}

/// Options are specific to this conversion.
///
/// This is separate from [ConversionConfig] to support bulk processing in the web interface.
#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ConversionOptions {
    /// Width and height override
    ///
    /// Useful when an SVG does not have a set width and height or you want to override it.
    #[cfg_attr(feature = "serde", serde(with = "length_serde"))]
    pub dimensions: [Option<Length>; 2],
}


pub fn svg2program<'input>(
    doc: &Document,
    config: &ConversionConfig,
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

    // Part 1 of converting from SVG to g-code coordinates
    turtle.push_transform(Transform2D::scale(1., -1.));

    // Depth-first SVG DOM traversal
    let mut node_stack = vec![(doc.root(), doc.root().children())];
    let mut name_stack: Vec<String> = vec![];

    while let Some((parent, mut children)) = node_stack.pop() {
        let node: Node = match children.next() {
            Some(child) => {
                node_stack.push((parent, children));
                child
            }
            // Last node in this group has been processed
            None => {
                if parent.has_attribute("viewBox")
                    || parent.has_attribute("transform")
                    || parent.has_attribute("width")
                    || parent.has_attribute("height")
                    || (parent.has_tag_name(SVG_TAG_NAME)
                        && options.dimensions.iter().any(Option::is_some))
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

        let view_box = node
            .attribute("viewBox")
            .map(ViewBox::from_str)
            .transpose()
            .expect("could not parse viewBox");
        let scale_w = view_box.map(|view_box| view_box.w);
        let scale_h = view_box.map(|view_box| view_box.h);
        let dimensions = (
            node.attribute("width")
                .map(LengthListParser::from)
                .and_then(|mut parser| parser.next())
                .transpose()
                .expect("could not parse width")
                .map(|width| length_to_mm(width, config.dpi, scale_w)),
            node.attribute("height")
                .map(LengthListParser::from)
                .and_then(|mut parser| parser.next())
                .transpose()
                .expect("could not parse height")
                .map(|height| length_to_mm(height, config.dpi, scale_h)),
        );
        let aspect_ratio = match (view_box, dimensions) {
            (_, (Some(ref width), Some(ref height))) => *width / *height,
            (Some(ref view_box), _) => view_box.w / view_box.h,
            (None, (None, _)) | (None, (_, None)) => 1.,
        };

        if let Some(ref view_box) = view_box {
            let view_box_transform = Transform2D::translation(-view_box.x, -view_box.y)
                .then_scale(1. / view_box.w, 1. / view_box.h);
            if node.has_tag_name(SVG_TAG_NAME) {
                // Part 2 of converting from SVG to g-code coordinates
                transforms.push(view_box_transform.then_translate(vector(0., -1.)));
            } else {
                transforms.push(view_box_transform);
            }
        }

        let dimensions_override = [
            options.dimensions[0].map(|dim_x| length_to_mm(dim_x, config.dpi, scale_w)),
            options.dimensions[1].map(|dim_y| length_to_mm(dim_y, config.dpi, scale_h)),
        ];

        match (dimensions_override, dimensions) {
            ([Some(dim_x), Some(dim_y)], _) if node.has_tag_name(SVG_TAG_NAME) => {
                transforms.push(Transform2D::scale(dim_x, dim_y));
            }
            ([Some(dim_x), None], _) if node.has_tag_name(SVG_TAG_NAME) => {
                transforms.push(Transform2D::scale(dim_x, dim_x / aspect_ratio));
            }
            ([None, Some(dim_y)], _) if node.has_tag_name(SVG_TAG_NAME) => {
                transforms.push(Transform2D::scale(aspect_ratio * dim_y, dim_y));
            }
            (_, (Some(width), Some(height))) => {
                transforms.push(Transform2D::scale(width, height));
            }
            (_, (Some(width), None)) => {
                transforms.push(Transform2D::scale(width, width / aspect_ratio));
            }
            (_, (None, Some(height))) => {
                transforms.push(Transform2D::scale(aspect_ratio * height, height));
            }
            (_, (None, None)) => {
                if let (Some(ViewBox { w, h, .. }), true) =
                    (view_box, node.has_tag_name(SVG_TAG_NAME))
                {
                    transforms.push(Transform2D::scale(w, h));
                    warn!("This SVG does not have width and/or height attributes! Assuming viewBox units are in millimeters");
                }
            }
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
                program.extend(apply_path(turtle, config, d));
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

fn apply_path<'input>(
    turtle: &'_ mut Turtle<'input>,
    config: &ConversionConfig,
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
                    turtle.close(config.feedrate)
                }
                LineTo { abs, x, y } => turtle.line(abs, x, y, config.feedrate),
                HorizontalLineTo { abs, x } => turtle.line(abs, x, None, config.feedrate),
                VerticalLineTo { abs, y } => turtle.line(abs, None, y, config.feedrate),
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
                    point(x1, y1),
                    point(x2, y2),
                    point(x, y),
                    config.tolerance,
                    config.feedrate,
                ),
                SmoothCurveTo { abs, x2, y2, x, y } => turtle.smooth_cubic_bezier(
                    abs,
                    point(x2, y2),
                    point(x, y),
                    config.tolerance,
                    config.feedrate,
                ),
                Quadratic { abs, x1, y1, x, y } => turtle.quadratic_bezier(
                    abs,
                    point(x1, y1),
                    point(x, y),
                    config.tolerance,
                    config.feedrate,
                ),
                SmoothQuadratic { abs, x, y } => turtle.smooth_quadratic_bezier(
                    abs,
                    point(x, y),
                    config.tolerance,
                    config.feedrate,
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
                    vector(rx, ry),
                    Angle::degrees(x_axis_rotation),
                    ArcFlags { large_arc, sweep },
                    point(x, y),
                    config.feedrate,
                    config.tolerance,
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
fn length_to_mm(l: svgtypes::Length, dpi: f64, scale: Option<f64>) -> f64 {
    const DEFAULT_SVG_DPI: f64 = 96.;
    use svgtypes::LengthUnit::*;
    use uom::si::f64::Length;
    use uom::si::length::*;

    let dpi_scaling = dpi / DEFAULT_SVG_DPI;
    let length = match l.unit {
        Cm => Length::new::<centimeter>(l.number),
        Mm => Length::new::<millimeter>(l.number),
        In => Length::new::<inch>(l.number),
        Pc => Length::new::<pica_computer>(l.number) / dpi_scaling,
        Pt => Length::new::<point_computer>(l.number) / dpi_scaling,
        Px => Length::new::<inch>(l.number / dpi_scaling),
        Em => {
            warn!("Converting from em to millimeters assumes 1em = 16px");
            Length::new::<inch>(16. * l.number / dpi_scaling)
        }
        Percent => {
            if let Some(scale) = scale {
                warn!("Converting from percent to millimeters assumes the viewBox is specified in millimeters");
                Length::new::<millimeter>(l.number / 100. * scale)
            } else {
                warn!("Converting from percent to millimeters without a viewBox is not possible, treating as millimeters");
                Length::new::<millimeter>(l.number)
            }
        }
        other => {
            warn!(
                "Converting from '{:?}' to millimeters is not supported, treating as millimeters",
                other
            );
            Length::new::<millimeter>(l.number)
        }
    };

    length.get::<millimeter>()
}

#[cfg(test)]
mod test {
    use super::*;
    #[cfg(feature = "serde")]
    use svgtypes::LengthUnit;

    #[test]
    #[cfg(feature = "serde")]
    fn serde_conversion_options_is_correct() {
        let default_struct = ConversionOptions::default();
        let default_json = "{\"dimensions\":[null,null]}";

        assert_eq!(
            serde_json::to_string(&default_struct).unwrap(),
            default_json
        );
        assert_eq!(
            serde_json::from_str::<ConversionOptions>(default_json).unwrap(),
            default_struct
        );
    }

    #[test]
    #[cfg(feature = "serde")]
    fn serde_conversion_options_with_single_dimension_is_correct() {
        let mut r#struct = ConversionOptions::default();
        r#struct.dimensions[0] = Some(Length {
            number: 4.,
            unit: LengthUnit::Mm,
        });
        let json = "{\"dimensions\":[{\"number\":4.0,\"unit\":\"Mm\"},null]}";

        assert_eq!(serde_json::to_string(&r#struct).unwrap(), json);
        assert_eq!(
            serde_json::from_str::<ConversionOptions>(json).unwrap(),
            r#struct
        );
    }

    #[test]
    #[cfg(feature = "serde")]
    fn serde_conversion_options_with_both_dimensions_is_correct() {
        let mut r#struct = ConversionOptions::default();
        r#struct.dimensions = [
            Some(Length {
                number: 4.,
                unit: LengthUnit::Mm,
            }),
            Some(Length {
                number: 10.5,
                unit: LengthUnit::In,
            }),
        ];
        let json =
            "{\"dimensions\":[{\"number\":4.0,\"unit\":\"Mm\"},{\"number\":10.5,\"unit\":\"In\"}]}";

        assert_eq!(serde_json::to_string(&r#struct).unwrap(), json);
        assert_eq!(
            serde_json::from_str::<ConversionOptions>(json).unwrap(),
            r#struct
        );
    }
}
