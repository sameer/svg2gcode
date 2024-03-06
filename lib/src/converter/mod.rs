use std::fmt::Debug;
use std::str::FromStr;

use euclid::Vector2D;
use g_code::emit::Token;
use log::{debug, warn};
use lyon_geom::{
    euclid::{default::Transform2D, Angle, Transform3D},
    point, vector, ArcFlags,
};
use roxmltree::{Document, Node};
#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
use svgtypes::{
    Length, LengthListParser, PathParser, PathSegment, PointsParser, TransformListParser,
    TransformListToken, ViewBox,
};

use crate::{turtle::*, Machine};

#[cfg(feature = "serde")]
mod length_serde;
mod visit;

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
    /// Set the origin point for this conversion
    #[cfg_attr(feature = "serde", serde(default = "zero_origin"))]
    pub origin: [Option<f64>; 2],
}

const fn zero_origin() -> [Option<f64>; 2] {
    [Some(0.); 2]
}

impl Default for ConversionConfig {
    fn default() -> Self {
        Self {
            tolerance: 0.002,
            feedrate: 300.0,
            dpi: 96.0,
            origin: zero_origin(),
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

#[derive(Debug)]
struct ConversionVisitor<'a, T: Turtle> {
    terrarium: Terrarium<T>,
    name_stack: Vec<String>,
    config: &'a ConversionConfig,
    options: ConversionOptions,
}

impl<T: Turtle> ConversionVisitor<'_, T> {
    /// Push a comment with the current node name (including the stack that led to it)
    fn push_node_name_comment(&mut self, node: &Node) {
        let mut comment = String::new();
        self.name_stack.iter().for_each(|name| {
            comment += name;
            comment += " > ";
        });
        comment += &node_name(node);

        self.terrarium.turtle.comment(comment);
    }

    // Parses a SVG dimension attribute into millimeters.
    // Unit-less dimensions are assumed to be in pixels (as per the SVG spec)
    fn parse_dimension(&self, node: &Node, attribute: &str, scale: Option<f64>) -> Option<f64> {
        let mut value = LengthListParser::from(node.attribute(attribute)?)
            .next()?
            .ok()?;

        // SVG defaults to pixels, so we need adjust the found unit to reflect that.
        if value.unit == svgtypes::LengthUnit::None {
            value.unit = svgtypes::LengthUnit::Px;
        }

        Some(length_to_mm(value, self.config.dpi, scale))
    }
}

impl<'a, 'input: 'a> ConversionVisitor<'a, GCodeTurtle<'input>> {
    fn begin(&mut self) {
        // Part 1 of converting from SVG to g-code coordinates
        self.terrarium.push_transform(Transform2D::scale(1., -1.));

        self.terrarium.turtle.begin();
    }

    fn end(&mut self) {
        self.terrarium.pop_transform();
        self.terrarium.turtle.end();
    }
}

impl<'a, 'input: 'a> ConversionVisitor<'a, PreprocessTurtle> {
    fn begin(&mut self) {
        // Part 1 of converting from SVG to g-code coordinates
        self.terrarium.push_transform(Transform2D::scale(1., -1.));
    }

    fn end(&mut self) {
        self.terrarium.pop_transform();
    }
}

impl<'a, T: Turtle> visit::XmlVisitor for ConversionVisitor<'a, T> {
    fn visit_enter(&mut self, node: Node) {
        if node.tag_name().name() == "clipPath" {
            warn!("Clip paths are not supported: {:?}", node);
        }

        let mut transforms = vec![Transform2D::identity()];

        if node.tag_name().name() == "svg" {
            // First check if we've received overridden dimensions for the canvas. These are not relative to anything yet,
            // so percentages won't work.
            let dimensions_override = [
                self.options.dimensions[0].map(|dim_x| length_to_mm(dim_x, self.config.dpi, None)),
                self.options.dimensions[1].map(|dim_y| length_to_mm(dim_y, self.config.dpi, None)),
            ];

            // Find document dimensions, use overridden dimensions to help interpret percentages.
            // If the document does not specify dimensions, use the overridden dimensions.
            let dimensions = (
                node.attribute("width")
                    .map(parse_length)
                    .map(|width| length_to_mm(width, self.config.dpi, dimensions_override[0]))
                    .or(dimensions_override[0])
                    .unwrap_or_else(|| {
                        warn!("This SVG does not have width, or is a override specified. Assuming 100mm");
                        100.
                    }),
                node.attribute("height")
                    .map(parse_length)
                    .map(|height| length_to_mm(height, self.config.dpi, dimensions_override[1]))
                    .or(dimensions_override[1])
                    .unwrap_or_else(|| {
                        warn!("This SVG does not have height, or is a override specified. Assuming 100mm");
                        100.
                    }),
            );

            // Find the viewbox for the document.
            // The viewbox determines how many 'pixels' are in the document, and where the origin is.
            let view_box = node
                .attribute("viewBox")
                .map(ViewBox::from_str)
                .transpose()
                .expect("could not parse viewBox")
                .unwrap_or_else(|| {
                    // SVG does not have a viewbox. Determine the viewbox from the dimensions.
                    let mm_to_px = |mm: f64| mm * self.config.dpi / 25.4;

                    ViewBox {
                        x: 0.,
                        y: 0.,
                        w: mm_to_px(dimensions.0),
                        h: mm_to_px(dimensions.1),
                    }
                });

            // Adjust the origin to the top left corner of the viewbox
            transforms.push(
                Transform2D::identity()
                // Scale pixels to millimeters.
                .then_translate(Vector2D::new(-view_box.x, -view_box.y))
                .then_translate(Vector2D::new(0.0, -view_box.h))
                .then_scale(
                    dimensions.0 / view_box.w,
                    dimensions.1 / view_box.h,
                )
            );
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

        self.terrarium.push_transform(
            transforms
                .iter()
                .fold(Transform2D::identity(), |acc, t| acc.then(t)),
        );

        match node.tag_name().name() {
            "path" => {
                if let Some(d) = node.attribute("d") {
                    self.terrarium.reset();
                    self.push_node_name_comment(&node);
                    apply_path(&mut self.terrarium, d);
                } else {
                    warn!("There is a path node containing no actual path: {:?}", node);
                }
            }
            "polyline" => {
                if let Some(points) = node.attribute("points") {
                    self.terrarium.reset();
                    self.push_node_name_comment(&node);
                    let mut pp = PointsParser::from(points);

                    if let Some((x, y)) = pp.next() {
                        self.terrarium.move_to(true, x, y);
                    }
                    for (x, y) in pp {
                        self.terrarium.line(true, x, y);
                    }
                } else {
                    warn!(
                        "There is a polyline node containing no actual path: {:?}",
                        node
                    );
                }
            }
            "polygon" => {
                if let Some(points) = node.attribute("points") {
                    self.terrarium.reset();
                    self.push_node_name_comment(&node);
                    let mut pp = PointsParser::from(points);

                    let first_point = pp.next();

                    if let Some((x, y)) = first_point {
                        self.terrarium.move_to(true, x, y);
                    }

                    for point in pp {
                        self.terrarium.line(true, point.0, point.1);
                    }

                    if let Some((x, y)) = first_point {
                        self.terrarium.line(true, x, y);
                    }
                } else {
                    warn!(
                        "There is a polyline node containing no actual path: {:?}",
                        node
                    );
                }
            }
            "rect" => {
                let dimensions = (
                    self.parse_dimension(&node, "width", None),
                    self.parse_dimension(&node, "height", None),
                );

                let origin = (
                    self.parse_dimension(&node, "x", None),
                    self.parse_dimension(&node, "y", None),
                );

                let radii = (
                    self.parse_dimension(&node, "rx", None).unwrap_or(0.),
                    self.parse_dimension(&node, "ry", None).unwrap_or(0.),
                );

                if origin.0.is_none() || origin.1.is_none() {
                    warn!("Rectangles without an origin are not supported: {:?}", node);
                } else if dimensions.0.is_none() || dimensions.1.is_none() {
                    warn!(
                        "Rectangles without dimensions are not supported: {:?}",
                        node
                    );
                } else {
                    self.terrarium.reset();
                    self.push_node_name_comment(&node);
                    apply_rect(
                        &mut self.terrarium,
                        (origin.0.unwrap(), origin.1.unwrap()),
                        (dimensions.0.unwrap(), dimensions.1.unwrap()),
                        radii,
                    );
                }
            }
            "circle" => {
                let origin = (
                    self.parse_dimension(&node, "cx", None),
                    self.parse_dimension(&node, "cy", None),
                );

                let radius = self.parse_dimension(&node, "r", None);

                if origin.0.is_none() || origin.1.is_none() {
                    warn!("Circles without an origin are not supported: {:?}", node);
                } else if radius.is_none() {
                    warn!("Circles without radius are not supported: {:?}", node);
                } else {
                    self.terrarium.reset();
                    self.push_node_name_comment(&node);
                    apply_ellipse(
                        &mut self.terrarium,
                        (origin.0.unwrap(), origin.1.unwrap()),
                        (radius.unwrap(), radius.unwrap()),
                    );
                }
            }
            "ellipse" => {
                let origin = (
                    self.parse_dimension(&node, "cx", None),
                    self.parse_dimension(&node, "cy", None),
                );

                let radii = (
                    self.parse_dimension(&node, "rx", None),
                    self.parse_dimension(&node, "ry", None),
                );

                if origin.0.is_none() || origin.1.is_none() {
                    warn!("Circles without an origin are not supported: {:?}", node);
                } else if radii.0.is_none() || radii.1.is_none() {
                    warn!("Circles without radius are not supported: {:?}", node);
                } else {
                    self.terrarium.reset();
                    self.push_node_name_comment(&node);
                    apply_ellipse(
                        &mut self.terrarium,
                        (origin.0.unwrap(), origin.1.unwrap()),
                        (radii.0.unwrap(), radii.1.unwrap()),
                    );
                }
            }
            "line" => {
                let start = (
                    self.parse_dimension(&node, "x1", None),
                    self.parse_dimension(&node, "y1", None),
                );

                let end = (
                    self.parse_dimension(&node, "x2", None),
                    self.parse_dimension(&node, "y2", None),
                );

                if start.0.is_none() || start.1.is_none() {
                    warn!("Circles without an origin are not supported: {:?}", node);
                } else if end.0.is_none() || end.1.is_none() {
                    warn!("Circles without radius are not supported: {:?}", node);
                } else {
                    self.terrarium.reset();
                    self.push_node_name_comment(&node);
                    self.terrarium
                        .move_to(true, start.0.unwrap(), start.1.unwrap());
                    self.terrarium.line(true, end.0.unwrap(), end.1.unwrap());
                }
            }
            "g" | "style" | "svg" | "desc" | "metadata" => {}
            _ => {
                warn!("Node not implemented: {:?}", node);
            }
        }

        self.name_stack.push(node_name(&node));
    }

    fn visit_exit(&mut self, _node: Node) {
        self.terrarium.pop_transform();
        self.name_stack.pop();
    }
}

pub fn svg2program<'a, 'input: 'a>(
    doc: &'a Document,
    config: &ConversionConfig,
    options: ConversionOptions,
    machine: Machine<'input>,
) -> Vec<Token<'input>> {
    let bounding_box = {
        let mut visitor = ConversionVisitor {
            terrarium: Terrarium::new(PreprocessTurtle::default()),
            config,
            options: options.clone(),
            name_stack: vec![],
        };

        visitor.begin();
        visit::depth_first_visit(doc, &mut visitor);
        visitor.end();

        visitor.terrarium.turtle.bounding_box
    };

    let origin_transform = {
        let mut transform = Transform2D::identity();
        if let Some(origin_x) = config.origin[0] {
            transform = transform.then_translate(vector(origin_x - bounding_box.min.x, 0.));
        }
        if let Some(origin_y) = config.origin[1] {
            transform = transform.then_translate(vector(0., origin_y - bounding_box.min.y));
        }
        transform
    };

    let mut conversion_visitor = ConversionVisitor {
        terrarium: Terrarium::new(GCodeTurtle {
            machine,
            tolerance: config.tolerance,
            feedrate: config.feedrate,
            program: vec![],
        }),
        config,
        options,
        name_stack: vec![],
    };

    conversion_visitor
        .terrarium
        .push_transform(origin_transform);
    conversion_visitor.begin();
    visit::depth_first_visit(doc, &mut conversion_visitor);
    conversion_visitor.end();
    conversion_visitor.terrarium.pop_transform();

    conversion_visitor.terrarium.turtle.program
}

fn node_name(node: &Node) -> String {
    let mut name = node.tag_name().name().to_string();
    if let Some(id) = node.attribute("id") {
        name += "#";
        name += id;
    }
    name
}

fn apply_path<T: Turtle + Debug>(terrarium: &mut Terrarium<T>, path: &str) {
    use PathSegment::*;
    PathParser::from(path)
        .map(|segment| segment.expect("could not parse path segment"))
        .for_each(|segment| {
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
                SmoothQuadratic { abs, x, y } => {
                    terrarium.smooth_quadratic_bezier(abs, point(x, y))
                }
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

fn apply_rect<T: Turtle>(
    terrarium: &mut Terrarium<T>,
    origin: (f64, f64),
    dimensions: (f64, f64),
    radii: (f64, f64),
) {
    let have_radius = radii.0 > 0.0 && radii.1 > 0.0;

    terrarium.move_to(true, origin.0 + radii.0, origin.1);

    // Top line
    terrarium.line(true, origin.0 + dimensions.0 - radii.0, None);
    // Top right corner
    if have_radius {
        terrarium.elliptical(
            true,
            vector(radii.0, radii.1),
            Angle::zero(),
            ArcFlags {
                large_arc: false,
                sweep: true,
            },
            point(origin.0 + dimensions.0, origin.1 + radii.1),
        );
    }
    // Right line
    terrarium.line(true, None, origin.1 + dimensions.1 - radii.1);
    // Bottom right corner
    if have_radius {
        terrarium.elliptical(
            true,
            vector(radii.0, radii.1),
            Angle::zero(),
            ArcFlags {
                large_arc: false,
                sweep: true,
            },
            point(origin.0 + dimensions.0 - radii.0, origin.1 + dimensions.1),
        );
    }
    // Bottom line
    terrarium.line(true, origin.0 + radii.0, None);
    // Bottom left corner
    if have_radius {
        terrarium.elliptical(
            true,
            vector(radii.0, radii.1),
            Angle::zero(),
            ArcFlags {
                large_arc: false,
                sweep: true,
            },
            point(origin.0, origin.1 + dimensions.1 - radii.1),
        );
    }
    // Left line
    terrarium.line(true, None, origin.1 + radii.1);
    // Top left corner
    if have_radius {
        terrarium.elliptical(
            true,
            vector(radii.0, radii.1),
            Angle::zero(),
            ArcFlags {
                large_arc: false,
                sweep: true,
            },
            point(origin.0 + radii.0, origin.1),
        );
    }
}

fn apply_ellipse<T: Turtle>(terrarium: &mut Terrarium<T>, origin: (f64, f64), radii: (f64, f64)) {
    terrarium.move_to(true, origin.0 + radii.0, origin.1);

    // Top half
    terrarium.elliptical(
        true,
        vector(radii.0, radii.1),
        Angle::zero(),
        ArcFlags {
            large_arc: true,
            sweep: true,
        },
        point(origin.0 + radii.0, origin.1),
    );
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

/// Convenience function to parse a length
/// Maps empty string to a unit-less length of 0. The SVG spec doesn't actually
/// allow empty strings, but this behavior is consistent with Chrome, Firefox and Inkscape.
fn parse_length(s: &str) -> svgtypes::Length {
    LengthListParser::from(s)
        .next()
        .unwrap_or(Ok(svgtypes::Length::new(0.0, svgtypes::LengthUnit::None)))
        .expect("Could not parse length")
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
        Px => Length::new::<inch>(l.number / dpi),
        Em => {
            warn!("Converting from em to millimeters assumes 1em = 16px");
            Length::new::<inch>(16. * l.number / dpi)
        }
        Percent => {
            if let Some(scale) = scale {
                warn!("Converting from percent to millimeters assumes the viewBox is specified in millimeters");
                Length::new::<millimeter>(l.number / 100. * scale)
            } else {
                warn!("Converting from percent to millimeters without a viewBox is not possible, treating percentage as millimeters");
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
