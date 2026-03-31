use std::fmt::Debug;

use g_code::emit::Token;
use lyon_geom::euclid::default::Transform2D;
use roxmltree::{Document, Node};
#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
use svgtypes::Length;
use uom::si::{
    f64::Length as UomLength,
    length::{inch, millimeter},
};

use self::units::CSS_DEFAULT_DPI;
use crate::{
    Machine, Turtle,
    converter::selector::SelectorList,
    tsp,
    turtle::{
        DpiConvertingTurtle, GCodeTurtle, PaintStyle, PreprocessTurtle, StrokeCollectingTurtle,
        SvgPreviewTurtle, Terrarium,
    },
};

mod cam;
#[cfg(feature = "serde")]
mod length_serde;
mod path;
mod selector;
mod transform;
mod units;
mod visit;

pub use cam::svg2program_engraving;

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
    /// Set the origin point in millimeters for this conversion
    #[cfg_attr(feature = "serde", serde(default = "zero_origin"))]
    pub origin: [Option<f64>; 2],
    /// Set extra attribute to add when printing node name
    pub extra_attribute_name: Option<String>,
    /// Reorder paths to minimize travel time
    #[cfg_attr(feature = "serde", serde(default))]
    pub optimize_path_order: bool,
    /// CSS selector to filter which SVG elements are converted.
    ///
    /// Only the `:not`, `:is`, and `:has` pseudo classes are supported.
    ///
    /// <https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Selectors>
    #[cfg_attr(feature = "serde", serde(default))]
    pub selector_filter: Option<String>,
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
            extra_attribute_name: None,
            optimize_path_order: false,
            selector_filter: None,
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

/// Maps SVG [`Node`]s and their attributes into operations on a [`Terrarium`]
#[derive(Debug)]
struct ConversionVisitor<'a, T: Turtle> {
    terrarium: Terrarium<T>,
    name_stack: Vec<String>,
    paint_stack: Vec<PaintStyle>,
    /// Used to convert percentage values
    viewport_dim_stack: Vec<[f64; 2]>,
    _config: &'a ConversionConfig,
    options: ConversionOptions,
    /// Parsed CSS include selector — only draw elements that match (or are inside a matching ancestor)
    selector_filter: Option<selector::SelectorList>,
}

impl<'a, T: Turtle> ConversionVisitor<'a, T> {
    fn comment(&mut self, node: &Node) {
        let mut comment = String::new();
        self.name_stack.iter().for_each(|name| {
            comment += name;
            comment += " > ";
        });
        comment += &node_name(node, &self._config.extra_attribute_name);

        self.terrarium.turtle.comment(comment);
    }

    fn should_draw_node(&self, node: Node) -> bool {
        self.selector_filter
            .as_ref()
            .is_none_or(|s| s.matches(node))
    }

    fn begin(&mut self) {
        // Part 1 of converting from SVG to GCode coordinates
        self.terrarium.push_transform(Transform2D::scale(1., -1.));
        self.terrarium.turtle.begin();
    }

    fn end(&mut self) {
        self.terrarium.turtle.end();
        self.terrarium.pop_transform();
    }
}

/// Top-level function for converting an SVG [`Document`] into g-code
pub fn svg2program<'a, 'input: 'a>(
    doc: &'a Document,
    config: &ConversionConfig,
    options: ConversionOptions,
    machine: Machine<'input>,
) -> Vec<Token<'input>> {
    let selector_filter = config
        .selector_filter
        .as_deref()
        .map(|s| selector::SelectorList::parse(s).expect("invalid selector_filter"));

    let bounding_box_generator = || {
        let mut visitor = ConversionVisitor {
            terrarium: Terrarium::new(DpiConvertingTurtle {
                inner: PreprocessTurtle::default(),
                dpi: config.dpi,
            }),
            _config: config,
            options: options.clone(),
            name_stack: vec![],
            paint_stack: vec![PaintStyle::default()],
            viewport_dim_stack: vec![],
            selector_filter: selector_filter.clone(),
        };

        visitor.begin();
        visit::depth_first_visit(doc, &mut visitor);
        visitor.end();

        visitor.terrarium.turtle.inner.bounding_box
    };

    // Convert from millimeters to user units
    let origin = config
        .origin
        .map(|dim| dim.map(|d| UomLength::new::<millimeter>(d).get::<inch>() * CSS_DEFAULT_DPI));

    let origin_transform = match origin {
        [None, Some(origin_y)] => {
            let bb = bounding_box_generator();
            Transform2D::translation(0., origin_y - bb.min.y)
        }
        [Some(origin_x), None] => {
            let bb = bounding_box_generator();
            Transform2D::translation(origin_x - bb.min.x, 0.)
        }
        [Some(origin_x), Some(origin_y)] => {
            let bb = bounding_box_generator();
            Transform2D::translation(origin_x - bb.min.x, origin_y - bb.min.y)
        }
        [None, None] => Transform2D::identity(),
    };

    let mut conversion_visitor = ConversionVisitor {
        terrarium: Terrarium::new(DpiConvertingTurtle {
            inner: GCodeTurtle {
                machine,
                tolerance: config.tolerance,
                feedrate: config.feedrate,
                program: vec![],
                current_z: None,
            },
            dpi: config.dpi,
        }),
        _config: config,
        options: options.clone(),
        name_stack: vec![],
        paint_stack: vec![PaintStyle::default()],
        viewport_dim_stack: vec![],
        selector_filter: selector_filter.clone(),
    };

    conversion_visitor
        .terrarium
        .push_transform(origin_transform);
    conversion_visitor.begin();

    if config.optimize_path_order {
        let strokes =
            svg2strokes_optimized(doc, config, options, origin_transform, selector_filter);
        let turtle = &mut conversion_visitor.terrarium.turtle;
        for stroke in strokes {
            turtle.move_to(stroke.start_point());
            for cmd in stroke.commands() {
                cmd.apply(turtle);
            }
        }
    } else {
        visit::depth_first_visit(doc, &mut conversion_visitor);
    }

    conversion_visitor.end();
    conversion_visitor.terrarium.pop_transform();

    conversion_visitor.terrarium.turtle.inner.program
}

/// Converts an SVG [`Document`] into a preview SVG showing expected toolpath moves.
///
/// - red: tool-on moves (G1/G2/G3)
/// - green: rapid tool-off moves (G0)
pub fn svg2preview(
    doc: &Document,
    config: &ConversionConfig,
    options: ConversionOptions,
    selector_filter: Option<SelectorList>,
) -> String {
    let mut conversion_visitor = ConversionVisitor {
        terrarium: Terrarium::new(DpiConvertingTurtle {
            inner: SvgPreviewTurtle::default(),
            dpi: config.dpi,
        }),
        _config: config,
        options: options.clone(),
        name_stack: vec![],
        paint_stack: vec![PaintStyle::default()],
        viewport_dim_stack: vec![],
        selector_filter: selector_filter.clone(),
    };

    conversion_visitor
        .terrarium
        .push_transform(Transform2D::identity());
    conversion_visitor.begin();

    if config.optimize_path_order {
        let strokes = svg2strokes_optimized(
            doc,
            config,
            options,
            Transform2D::identity(),
            selector_filter,
        );
        let turtle = &mut conversion_visitor.terrarium.turtle;
        for stroke in strokes {
            turtle.move_to(stroke.start_point());
            for cmd in stroke.commands() {
                cmd.apply(turtle);
            }
        }
    } else {
        visit::depth_first_visit(doc, &mut conversion_visitor);
    }

    conversion_visitor.end();
    conversion_visitor.terrarium.pop_transform();
    conversion_visitor.terrarium.turtle.inner.into_preview()
}

fn svg2strokes_optimized(
    doc: &Document,
    config: &ConversionConfig,
    options: ConversionOptions,
    origin_transform: Transform2D<f64>,
    selector_filter: Option<SelectorList>,
) -> Vec<crate::turtle::Stroke> {
    let mut collect_visitor = ConversionVisitor {
        terrarium: Terrarium::new(StrokeCollectingTurtle::default()),
        _config: config,
        options,
        name_stack: vec![],
        paint_stack: vec![PaintStyle::default()],
        viewport_dim_stack: vec![],
        selector_filter,
    };
    collect_visitor.terrarium.push_transform(origin_transform);
    collect_visitor.begin();
    visit::depth_first_visit(doc, &mut collect_visitor);
    collect_visitor.end();
    collect_visitor.terrarium.pop_transform();
    let strokes = collect_visitor.terrarium.turtle.into_strokes();
    tsp::minimize_travel_time(strokes)
}

fn node_name(node: &Node, attr_to_print: &Option<String>) -> String {
    let mut name = node.tag_name().name().to_string();
    if let Some(id) = node.attribute("id") {
        name += "#";
        name += id;
        if let Some(extra_attr_to_print) = attr_to_print {
            for a_attr in node.attributes() {
                if a_attr.name() == extra_attr_to_print {
                    name += " ( ";
                    name += a_attr.value();
                    name += " ) ";
                }
            }
        }
    }
    name
}

#[cfg(all(test, feature = "serde"))]
mod test {
    use svgtypes::LengthUnit;

    use super::*;

    #[test]
    fn serde_conversion_options_is_correct() {
        let default_struct = ConversionOptions::default();
        let default_json = r#"{"dimensions":[null,null]}"#;

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
    fn serde_conversion_options_with_single_dimension_is_correct() {
        let mut r#struct = ConversionOptions::default();
        r#struct.dimensions[0] = Some(Length {
            number: 4.,
            unit: LengthUnit::Mm,
        });
        let json = r#"{"dimensions":[{"number":4.0,"unit":"Mm"},null]}"#;

        assert_eq!(serde_json::to_string(&r#struct).unwrap(), json);
        assert_eq!(
            serde_json::from_str::<ConversionOptions>(json).unwrap(),
            r#struct
        );
    }

    #[test]
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
        let json = r#"{"dimensions":[{"number":4.0,"unit":"Mm"},{"number":10.5,"unit":"In"}]}"#;

        assert_eq!(serde_json::to_string(&r#struct).unwrap(), json);
        assert_eq!(
            serde_json::from_str::<ConversionOptions>(json).unwrap(),
            r#struct
        );
    }
}
