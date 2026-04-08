use std::fmt::Debug;

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
    lower::selector::SelectorList,
    turtle::{
        DpiConvertingTurtle, PreprocessTurtle, StrokeCollectingTurtle, Terrarium, Turtle,
        elements::{Stroke, minimize_travel_time},
    },
};

#[cfg(feature = "serde")]
mod length_serde;
mod path;
mod selector;
mod transform;
mod units;
mod visit;

/// High-level output configuration
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ConversionConfig {
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

/// Drives any [`Turtle`] implementation through the full SVG conversion pipeline.
///
/// This is the generic entry point for custom backends. The turtle receives resolved,
/// absolute, world-space geometry in millimeters after all SVG transforms, DPI conversion,
/// and optional origin alignment have been applied.
///
/// Path optimization (TSP reordering) is applied automatically when
/// [`ConversionConfig::optimize_path_order`] is `true`.
///
/// The turtle is returned so callers can extract its internal state (e.g. generated output).
pub fn svg_to_turtle<T: Turtle>(
    doc: &Document,
    config: &ConversionConfig,
    options: ConversionOptions,
    turtle: T,
) -> T {
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
            inner: turtle,
            dpi: config.dpi,
        }),
        _config: config,
        options: options.clone(),
        name_stack: vec![],
        viewport_dim_stack: vec![],
        selector_filter: selector_filter.clone(),
    };

    conversion_visitor
        .terrarium
        .push_transform(origin_transform);
    conversion_visitor.begin();

    if config.optimize_path_order {
        let strokes =
            svg_to_optimized_strokes(doc, config, options, origin_transform, selector_filter);
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

    conversion_visitor.terrarium.turtle.inner
}

fn svg_to_optimized_strokes(
    doc: &Document,
    config: &ConversionConfig,
    options: ConversionOptions,
    origin_transform: Transform2D<f64>,
    selector_filter: Option<SelectorList>,
) -> Vec<Stroke> {
    let mut collect_visitor = ConversionVisitor {
        terrarium: Terrarium::new(StrokeCollectingTurtle::default()),
        _config: config,
        options,
        name_stack: vec![],
        viewport_dim_stack: vec![],
        selector_filter,
    };
    collect_visitor.terrarium.push_transform(origin_transform);
    collect_visitor.begin();
    visit::depth_first_visit(doc, &mut collect_visitor);
    collect_visitor.end();
    collect_visitor.terrarium.pop_transform();
    let strokes = collect_visitor.terrarium.turtle.into_strokes();
    minimize_travel_time(strokes)
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
