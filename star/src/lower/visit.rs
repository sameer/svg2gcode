use std::{collections::HashMap, iter, result::Result, str::FromStr};

use euclid::default::Transform2D;
use log::{debug, warn};
use lyon_geom::{Box2D, Point};
use roxmltree::{Document, Node};
use smallvec::{SmallVec, smallvec};
use svgtypes::{
    AspectRatio, LengthListParser, PathParser, PathSegment, PointsParser, TransformListParser,
    ViewBox,
};

use super::{
    ConversionVisitor, TemplatedExpansion,
    transform::{get_viewport_transform, svg_transform_into_euclid_transform},
    units::DimensionHint,
};
use crate::{
    lower::node_name,
    turtle::{CoordinateSystem, Turtle, elements::FillRule},
};

const SVG_TAG_NAME: &str = "svg";
const CLIP_PATH_TAG_NAME: &str = "clipPath";
const PATH_TAG_NAME: &str = "path";
const POLYLINE_TAG_NAME: &str = "polyline";
const POLYGON_TAG_NAME: &str = "polygon";
const RECT_TAG_NAME: &str = "rect";
const CIRCLE_TAG_NAME: &str = "circle";
const ELLIPSE_TAG_NAME: &str = "ellipse";
const LINE_TAG_NAME: &str = "line";
const DEFS_TAG_NAME: &str = "defs";
const USE_TAG_NAME: &str = "use";
const MARKER_TAG_NAME: &str = "marker";
const SYMBOL_TAG_NAME: &str = "symbol";
const PATTERN_TAG_NAME: &str = "pattern";
const TEXT_TAG_NAME: &str = "text";
const TEXT_PATH_TAG_NAME: &str = "textPath";
const VIEW_TAG_NAME: &str = "view";

pub trait XmlVisitor<'a, 'input> {
    fn visit_enter(&mut self, node: Node<'a, 'input>);
    fn visit_exit(&mut self, node: Node<'a, 'input>);
}

impl TemplatedExpansion {
    pub fn from_tag_name(tag_name: &str) -> Option<Self> {
        match tag_name {
            USE_TAG_NAME => Some(Self::Use),
            MARKER_TAG_NAME => Some(Self::Marker),
            PATTERN_TAG_NAME => Some(Self::Pattern),
            _ => None,
        }
    }
}

/// Returns the effective value of the given presentation attribute (i.e. stroke),
/// adhering to precedence rules and checking inheritance.
///
/// 1. Inline style attribute
/// 2. CSS class rules
/// 3. Presentation attribute.
fn calculate_presentation_attr<'input>(
    node: Node<'input, 'input>,
    name: &'input str,
    css_rules: &HashMap<&'input str, HashMap<&'input str, &'input str>>,
) -> Option<&'input str> {
    for current in iter::successors(Some(node), Node::parent) {
        if !current.is_element() {
            continue;
        }
        if let Some(val) = get_node_presentation_attr(current, name, css_rules) {
            return Some(val);
        }
        if matches!(
            current.tag_name().name(),
            SVG_TAG_NAME | DEFS_TAG_NAME | SYMBOL_TAG_NAME | PATTERN_TAG_NAME
        ) {
            break;
        }
    }
    None
}

/// Helper for [calculate_presentation_attr] that only checks the current node.
fn get_node_presentation_attr<'input>(
    node: Node<'input, 'input>,
    name: &'input str,
    css_rules: &HashMap<&'input str, HashMap<&'input str, &'input str>>,
) -> Option<&'input str> {
    node.attribute("style")
        .and_then(|style| {
            style.split(';').find_map(|decl| {
                let (k, v) = decl.split_once(':')?;
                (k.trim() == name).then(|| v.trim())
            })
        })
        .or_else(|| {
            node.attribute("class").and_then(|classes| {
                classes
                    .split_whitespace()
                    .find_map(|cls| css_rules.get(cls)?.get(name).copied())
            })
        })
        .or_else(|| node.attribute(name).map(str::trim))
}

/// Barebones CSS class rules parser.
///
/// Returns a map from class name to property + value pairs. Only simple, flat class selectors
/// (`.classname { prop: val; }`) are handled.
pub fn parse_css<'a>(doc: &'a Document) -> HashMap<&'a str, HashMap<&'a str, &'a str>> {
    let mut rules: HashMap<&str, HashMap<&str, &str>> = HashMap::new();
    for node in doc.descendants() {
        if node.tag_name().name() != "style" {
            continue;
        }
        let Some(css) = node.text() else { continue };
        for block in css.split('}') {
            let Some((selector, declarations)) = block.split_once('{') else {
                continue;
            };
            let props = declarations
                .split(';')
                .filter_map(|decl| {
                    let (k, v) = decl.split_once(':')?;
                    let k = k.trim();
                    let v = v.trim();
                    (!k.is_empty() && !v.is_empty()).then_some((k, v))
                })
                .collect::<HashMap<_, _>>();
            if props.is_empty() {
                continue;
            }
            for subselector in selector.split(',') {
                let Some(class) = subselector.trim().strip_prefix('.') else {
                    continue;
                };
                // Strip pseudo-classes and other complexity.
                let class = class
                    .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
                    .next()
                    .unwrap_or("")
                    .trim();
                if !class.is_empty() {
                    rules.entry(class).or_default().extend(props.iter());
                }
            }
        }
    }
    rules
}

/// Used to skip over SVG elements that are explicitly marked as do not render
fn should_render_node(node: Node, expanding_template: Option<TemplatedExpansion>) -> bool {
    node.is_element()
        && !node
            .attribute("style")
            .is_some_and(|style| style.split(';').any(|declaration| {
                let mut parts = declaration.splitn(2, ':').map(str::trim);
                (parts.next(), parts.next()) == (Some("display"), Some("none"))
        }))
        // Template elements are not directly rendered, unless referenced
        && (expanding_template.is_some()
            || !matches!(
                node.tag_name().name(),
                DEFS_TAG_NAME | MARKER_TAG_NAME | PATTERN_TAG_NAME | SYMBOL_TAG_NAME | CLIP_PATH_TAG_NAME
            ))
}

fn find_node_by_id<'a, 'input>(doc: &'a Document<'input>, id: &str) -> Option<Node<'a, 'input>> {
    doc.root()
        .descendants()
        .find(|n| n.attribute("id").map(str::trim) == Some(id))
}

/// Resolve `href` or `xlink:href` on a `<use>` element to a document node.
/// Only fragment references (`#id`) within the same document are supported.
fn resolve_href<'a, 'input: 'a>(
    doc: &'a Document<'input>,
    node: Node<'a, 'input>,
) -> Option<Node<'a, 'input>> {
    let href = node
        .attribute("href")
        .or_else(|| node.attribute(("http://www.w3.org/1999/xlink", "href")))?;
    let id = href.strip_prefix('#')?;
    find_node_by_id(doc, id)
}

/// When referenced, a pattern is typically `fill="url(#id)"`.
fn get_pattern_id(attr: &str) -> Option<&str> {
    let inner = attr.trim().strip_prefix("url(")?.strip_suffix(")")?.trim();
    inner.trim_matches(['\'', '"']).strip_prefix('#')
}

fn visit_node<'a, 'input, V: XmlVisitor<'a, 'input>>(
    doc: &'a Document<'input>,
    node: Node<'a, 'input>,
    visitor: &mut V,
    expanding_template: Option<TemplatedExpansion>,
) {
    if !should_render_node(node, expanding_template) {
        return;
    }
    visitor.visit_enter(node);
    if node.tag_name().name() == USE_TAG_NAME
        && let Some(referenced) = resolve_href(doc, node)
    {
        // Expand the target
        visit_node(doc, referenced, visitor, Some(TemplatedExpansion::Use));
    } else {
        node.children()
            .for_each(|child| visit_node(doc, child, visitor, expanding_template));
    }
    visitor.visit_exit(node);
}

pub fn depth_first_visit<'a, 'input, V: XmlVisitor<'a, 'input>>(
    doc: &'a Document<'input>,
    visitor: &mut V,
) {
    doc.root()
        .children()
        .for_each(|child| visit_node(doc, child, visitor, None));
}

impl<'a, 'input, T: Turtle> XmlVisitor<'a, 'input> for ConversionVisitor<'a, 'input, T> {
    fn visit_enter(&mut self, node: Node<'a, 'input>) {
        use PathSegment::{
            ClosePath, EllipticalArc, HorizontalLineTo, LineTo, MoveTo, VerticalLineTo,
        };

        let mut view_box_opt = None;
        let mut viewport_pos_opt = [None, None];
        let mut viewport_size_opt = [1., 1.];

        if node.tag_name().name() == CLIP_PATH_TAG_NAME {
            warn!("Clip paths are not supported: {node:?}");
        }
        if node.tag_name().name() == TEXT_TAG_NAME {
            warn!("Text is not supported: {node:?}");
        }
        if node.tag_name().name() == TEXT_PATH_TAG_NAME {
            warn!("Text paths are not supported: {node:?}");
        }
        if node.tag_name().name() == VIEW_TAG_NAME {
            warn!("SVG views are not supported: {node:?}");
        }

        let mut flattened_transform = if let Some(transform) = node.attribute("transform") {
            // https://stackoverflow.com/questions/18582935/the-applying-order-of-svg-transforms
            TransformListParser::from(transform)
                .map(|token| token.expect("could not parse a transform in a list of transforms"))
                .map(svg_transform_into_euclid_transform)
                .fold(Transform2D::identity(), |acc, t| t.then(&acc))
        } else {
            Transform2D::identity()
        };

        // https://www.w3.org/TR/css-transforms-1/#transform-origin-property
        if let Some(to_str) = node.attribute("transform-origin") {
            let mut parser = LengthListParser::from(to_str);
            let ox = parser.next().and_then(Result::ok).map_or(0., |l| {
                self.length_to_user_units(l, DimensionHint::Horizontal)
            });
            let oy = parser.next().and_then(Result::ok).map_or(0., |l| {
                self.length_to_user_units(l, DimensionHint::Vertical)
            });
            if ox != 0. || oy != 0. {
                // https://www.w3.org/TR/css-transforms-1/#transformation-matrix-computation
                // Steps 2 & 4
                flattened_transform = Transform2D::translation(-ox, -oy)
                    .then(&flattened_transform)
                    .then(&Transform2D::translation(ox, oy));
            }
        }

        // https://www.w3.org/TR/SVG/coords.html#EstablishingANewSVGViewport
        if node.has_tag_name(SVG_TAG_NAME) {
            let view_box = node
                .attribute("viewBox")
                .map(ViewBox::from_str)
                .transpose()
                .expect("could not parse viewBox")
                .filter(|view_box| {
                    if view_box.w <= 0. || view_box.h <= 0. {
                        warn!("Invalid viewBox: {view_box:?}");
                        false
                    } else {
                        true
                    }
                });
            let preserve_aspect_ratio = node.attribute("preserveAspectRatio").map(|attr| {
                AspectRatio::from_str(attr).expect("could not parse preserveAspectRatio")
            });
            let mut viewport_size =
                ["width", "height"].map(|attr| self.length_attr_to_user_units(&node, attr));

            let dimensions_override: [_; 2] = self
                .options
                .dimensions
                .map(|l| l.map(|l| self.length_to_user_units(l, DimensionHint::Horizontal)));
            for (original_dim, override_dim) in viewport_size.iter_mut().zip(dimensions_override) {
                *original_dim = override_dim.or(*original_dim);
            }

            // https://www.w3.org/TR/SVG/coords.html#SizingSVGInCSS
            // aka _natural_ aspect ratio
            let intrinsic_aspect_ratio = match (view_box, viewport_size) {
                (None, [Some(ref width), Some(ref height)]) => Some(*width / *height),
                (Some(ref view_box), _) => Some(view_box.w / view_box.h),
                (None, [None | Some(_), None] | [None, Some(_)]) => None,
            };

            // https://www.w3.org/TR/css-images-3/#default-sizing
            let viewport_size = match (viewport_size, intrinsic_aspect_ratio, view_box) {
                ([Some(w), Some(h)], _, _) => [w, h],
                ([Some(w), None], Some(ratio), _) => [w, w / ratio],
                ([None, Some(h)], Some(ratio), _) => [h * ratio, h],
                ([None, None], _, Some(view_box)) => {
                    // Fallback: if there is no width or height, assume the coordinate system is just pixels on the viewport
                    [view_box.w, view_box.h]
                }
                ([Some(d), None] | [None, Some(d)], None, None) => [d, d],
                ([None, None], _, None) => {
                    // We have no info at all, nothing can be done
                    [1., 1.]
                }
                ([None, Some(_)] | [Some(_), None], None, Some(_)) => {
                    unreachable!("intrinsic ratio necessarily exists")
                }
            };

            let viewport_pos = ["x", "y"].map(|attr| self.length_attr_to_user_units(&node, attr));

            view_box_opt = view_box;
            viewport_pos_opt = viewport_pos;
            viewport_size_opt = viewport_size;

            self.viewport_dim_stack
                .push(match (view_box.as_ref(), &viewport_size) {
                    (Some(ViewBox { w, h, .. }), _) | (None, [w, h]) => [*w, *h],
                });

            if let Some(view_box) = view_box {
                let viewport_transform = get_viewport_transform(
                    view_box,
                    preserve_aspect_ratio,
                    viewport_size,
                    viewport_pos,
                );
                flattened_transform = flattened_transform.then(&viewport_transform);
            }
            if self.coordinate_system == CoordinateSystem::YUp {
                // Part 2 of converting from SVG (Y-down) to output (Y-up) coordinates:
                // shift the origin from the top-left to the bottom-left of the viewport.
                flattened_transform = flattened_transform.then(&Transform2D::translation(
                    0.,
                    -(viewport_size[1] + viewport_pos[1].unwrap_or(0.)),
                ));
            }
        } else if node.has_tag_name(USE_TAG_NAME) {
            // Per SVG spec, <use> x/y translate is appended to the element's transform
            // https://www.w3.org/TR/SVG2/struct.html#UseLayout
            let x = self.length_attr_to_user_units(&node, "x").unwrap_or(0.);
            let y = self.length_attr_to_user_units(&node, "y").unwrap_or(0.);
            flattened_transform = flattened_transform.then(&Transform2D::translation(x, y));
        } else if node.has_tag_name(SYMBOL_TAG_NAME) {
            let view_box = node
                .attribute("viewBox")
                .map(ViewBox::from_str)
                .transpose()
                .expect("could not parse viewBox on symbol")
                .filter(|view_box| {
                    if view_box.w <= 0. || view_box.h <= 0. {
                        warn!("Invalid viewBox: {view_box:?}");
                        false
                    } else {
                        true
                    }
                });
            let preserve_aspect_ratio = node.attribute("preserveAspectRatio").map(|attr| {
                AspectRatio::from_str(attr).expect("could not parse preserveAspectRatio")
            });
            // Viewport size: symbol's own width/height, or fallback to viewBox dims, or parent viewport
            let viewport_size = match (
                self.length_attr_to_user_units(&node, "width"),
                self.length_attr_to_user_units(&node, "height"),
                &view_box,
            ) {
                (Some(w), Some(h), _) => [w, h],
                (_, _, Some(vb)) => [vb.w, vb.h],
                _ => *self.viewport_dim_stack.last().unwrap_or(&[1., 1.]),
            };
            if let Some(view_box) = view_box {
                self.viewport_dim_stack.push(viewport_size);
                let viewport_transform = get_viewport_transform(
                    view_box,
                    preserve_aspect_ratio,
                    viewport_size,
                    [None, None],
                );
                flattened_transform = flattened_transform.then(&viewport_transform);
                // Does not need Y-axis translation unlike <svg>, already in g-code coords space.
            }
            view_box_opt = view_box;
            viewport_pos_opt = [None, None];
            viewport_size_opt = viewport_size;
        } else if node.has_attribute("viewBox") {
            warn!("View box is not supported on a {}", node.tag_name().name());
        }

        self.terrarium.push_transform(flattened_transform);
        self.name_stack.push(node_name(
            &node,
            self.config.extra_attribute_name.as_deref(),
        ));

        if matches!(
            (node.tag_name().name(), node.has_attribute("viewBox")),
            (SVG_TAG_NAME, _) | (SYMBOL_TAG_NAME, true)
        ) {
            let viewport_box = if let Some(vb) = view_box_opt {
                Box2D::new(Point::new(vb.x, vb.y), Point::new(vb.x + vb.w, vb.y + vb.h))
            } else {
                let px = viewport_pos_opt[0].unwrap_or(0.);
                let py = viewport_pos_opt[1].unwrap_or(0.);
                Box2D::new(
                    Point::new(px, py),
                    Point::new(px + viewport_size_opt[0], py + viewport_size_opt[1]),
                )
            };
            self.terrarium.push_viewport_bounds(viewport_box);
            if self.is_overflow_hidden(node) {
                self.terrarium.push_viewport_clip(viewport_box);
            }
        }

        let should_draw = self.should_draw_node(node);

        if let Some(expansion) = TemplatedExpansion::from_tag_name(node.tag_name().name()) {
            self.expansion_stack.push(expansion);
        }

        if !should_draw {
            return;
        }

        let fill_attr = calculate_presentation_attr(node, "fill", &self.css_rules);
        // SVGs fill by default
        let has_fill_attr = fill_attr != Some("none");
        let fill_rule = calculate_presentation_attr(node, "fill-rule", &self.css_rules)
            .map_or_default(|v| {
                if v == "evenodd" {
                    FillRule::EvenOdd
                } else {
                    FillRule::NonZero
                }
            });

        // Default to false which is spec compliant.
        let has_stroke_attr =
            calculate_presentation_attr(node, "stroke", &self.css_rules) != Some("none");

        let segments: SmallVec<[PathSegment; 5]> = match node.tag_name().name() {
            PATH_TAG_NAME => {
                let Some(d) = node.attribute("d") else {
                    warn!("There is a path node containing no actual path: {node:?}");
                    return;
                };
                PathParser::from(d)
                    .map(|segment| segment.expect("could not parse path segment"))
                    .collect()
            }
            name @ (POLYLINE_TAG_NAME | POLYGON_TAG_NAME) => {
                let Some(points) = node.attribute("points") else {
                    warn!("There is a {name} node containing no actual path: {node:?}");
                    return;
                };
                let is_polygon = name == POLYGON_TAG_NAME;
                let mut pp = PointsParser::from(points).peekable();
                let start = pp
                    .next()
                    .map(|(x, y)| MoveTo { abs: true, x, y })
                    .into_iter();
                start
                    .chain(pp.map(|(x, y)| LineTo { abs: true, x, y }))
                    .chain(is_polygon.then_some(ClosePath { abs: true }))
                    .collect()
            }
            RECT_TAG_NAME => {
                let x = self.length_attr_to_user_units(&node, "x").unwrap_or(0.);
                let y = self.length_attr_to_user_units(&node, "y").unwrap_or(0.);
                let width = self.length_attr_to_user_units(&node, "width");
                let height = self.length_attr_to_user_units(&node, "height");
                let rx = self.length_attr_to_user_units(&node, "rx").unwrap_or(0.);
                let ry = self.length_attr_to_user_units(&node, "ry").unwrap_or(0.);
                let has_radius = rx > 0. && ry > 0.;

                let (Some(width), Some(height)) = (width, height) else {
                    warn!("Invalid rectangle node: {node:?}");
                    return;
                };
                [
                    MoveTo {
                        abs: true,
                        x: x + rx,
                        y,
                    },
                    HorizontalLineTo {
                        abs: true,
                        x: x + width - rx,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: x + width,
                        y: y + ry,
                    },
                    VerticalLineTo {
                        abs: true,
                        y: y + height - ry,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: x + width - rx,
                        y: y + height,
                    },
                    HorizontalLineTo {
                        abs: true,
                        x: x + rx,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x,
                        y: y + height - ry,
                    },
                    VerticalLineTo {
                        abs: true,
                        y: y + ry,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: x + rx,
                        y,
                    },
                    ClosePath { abs: true },
                ]
                .into_iter()
                .filter(move |p| has_radius || !matches!(p, EllipticalArc { .. }))
                .collect()
            }
            CIRCLE_TAG_NAME | ELLIPSE_TAG_NAME => {
                let cx = self.length_attr_to_user_units(&node, "cx").unwrap_or(0.);
                let cy = self.length_attr_to_user_units(&node, "cy").unwrap_or(0.);
                let r = self.length_attr_to_user_units(&node, "r").unwrap_or(0.);
                let rx = self.length_attr_to_user_units(&node, "rx").unwrap_or(r);
                let ry = self.length_attr_to_user_units(&node, "ry").unwrap_or(r);
                if rx <= 0. || ry <= 0. {
                    warn!("Invalid {} node: {node:?}", node.tag_name().name());
                    return;
                }
                smallvec![
                    MoveTo {
                        abs: true,
                        x: cx + rx,
                        y: cy,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: cx,
                        y: cy + ry,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: cx - rx,
                        y: cy,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: cx,
                        y: cy - ry,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: cx + rx,
                        y: cy,
                    },
                    ClosePath { abs: true },
                ]
            }
            LINE_TAG_NAME => {
                let (Some(x1), Some(y1), Some(x2), Some(y2)) = (
                    self.length_attr_to_user_units(&node, "x1"),
                    self.length_attr_to_user_units(&node, "y1"),
                    self.length_attr_to_user_units(&node, "x2"),
                    self.length_attr_to_user_units(&node, "y2"),
                ) else {
                    warn!("Invalid line node: {node:?}");
                    return;
                };
                smallvec![
                    MoveTo {
                        abs: true,
                        x: x1,
                        y: y1,
                    },
                    LineTo {
                        abs: true,
                        x: x2,
                        y: y2,
                    },
                ]
            }
            #[cfg(feature = "image")]
            "image" => {
                use base64::{Engine, engine::general_purpose::STANDARD};

                let Some(href) = node
                    .attribute("href")
                    .or_else(|| node.attribute(("http://www.w3.org/1999/xlink", "href")))
                else {
                    warn!("image element has no href: {node:?}");
                    return;
                };
                let Some(b64) = href
                    .strip_prefix("data:image/png;base64,")
                    .or_else(|| href.strip_prefix("data:image/jpeg;base64,"))
                else {
                    warn!("Unsupported image href {href}");
                    return;
                };

                let b64_no_whitespace: String =
                    b64.chars().filter(|c| !c.is_ascii_whitespace()).collect();
                let bytes = match STANDARD.decode(&b64_no_whitespace) {
                    Ok(bytes) => bytes,
                    Err(err) => {
                        warn!("image base64 decode failed: {err}");
                        return;
                    }
                };
                let image = match image::load_from_memory(&bytes) {
                    Ok(img) => img,
                    Err(e) => {
                        warn!("image decode failed: {e}");
                        return;
                    }
                };

                let x = self.length_attr_to_user_units(&node, "x").unwrap_or(0.);
                let y = self.length_attr_to_user_units(&node, "y").unwrap_or(0.);
                let width = self.length_attr_to_user_units(&node, "width").unwrap_or(0.);
                let height = self
                    .length_attr_to_user_units(&node, "height")
                    .unwrap_or(0.);

                let preserve_aspect_ratio = node.attribute("preserveAspectRatio").map_or(
                    svgtypes::AspectRatio {
                        defer: false,
                        align: svgtypes::Align::XMidYMid,
                        slice: false,
                    },
                    |attr| {
                        AspectRatio::from_str(attr).expect("could not parse preserveAspectRatio")
                    },
                );

                let view_box = svgtypes::ViewBox {
                    x: 0.,
                    y: 0.,
                    w: f64::from(image.width()),
                    h: f64::from(image.height()),
                };
                let image_to_user = get_viewport_transform(
                    view_box,
                    Some(preserve_aspect_ratio),
                    [width, height],
                    [Some(x), Some(y)],
                );

                self.comment();
                self.terrarium
                    .image(image, image_to_user, preserve_aspect_ratio);

                return;
            }
            other => {
                debug!("Unhandled node: {other}");
                return;
            }
        };

        if has_stroke_attr {
            self.comment();
            self.terrarium.apply_path(segments.iter().copied());
        }
        if has_fill_attr {
            self.comment();
            // TODO: no idea what a vectorized gradient fill would mean practically speaking
            if let Some(pattern_id) = fill_attr
                .and_then(get_pattern_id)
                .and_then(|id| find_node_by_id(node.document(), id))
            {
                self.visit_pattern(node, pattern_id, segments, fill_rule);
            } else {
                self.terrarium.apply_polygon(segments, fill_rule);
            }
        }
    }

    fn visit_exit(&mut self, node: Node<'a, 'input>) {
        self.terrarium.pop_transform();
        self.name_stack.pop();
        if let Some(expected) = TemplatedExpansion::from_tag_name(node.tag_name().name()) {
            let popped = self.expansion_stack.pop();
            debug_assert_eq!(popped, Some(expected));
        }
        if matches!(
            (node.tag_name().name(), node.has_attribute("viewBox")),
            (SVG_TAG_NAME, _) | (SYMBOL_TAG_NAME, true)
        ) {
            if self.is_overflow_hidden(node) {
                self.terrarium.pop_clip_layer();
            }
            self.viewport_dim_stack.pop();
            self.terrarium.pop_bounds();
        }
    }
}

impl<'a, 'input, T: Turtle> ConversionVisitor<'a, 'input, T> {
    fn is_overflow_hidden(&self, node: Node<'a, 'input>) -> bool {
        match calculate_presentation_attr(node, "overflow", &self.css_rules) {
            Some("hidden" | "scroll") => true,
            Some(_) => false,
            None => {
                let is_root =
                    node.parent_element().is_none() && node.tag_name().name() == SVG_TAG_NAME;
                !is_root
            }
        }
    }
    /// Helper function because the logic for patterns is quite complex
    fn visit_pattern(
        &mut self,
        container: Node<'a, 'input>,
        pattern_node: Node<'a, 'input>,
        container_segments: impl IntoIterator<Item = PathSegment>,
        fill_rule: FillRule,
    ) {
        let doc = container.document();
        let container_polygons = self
            .terrarium
            .to_fill_polygons(container_segments, fill_rule);
        let [first, ..] = container_polygons.as_slice() else {
            return;
        };
        let container_bbox =
            container_polygons
                .iter()
                .skip(1)
                .fold(first.outer.bounding_box(), |bbox, fp| {
                    Box2D::from_points([
                        bbox.min,
                        bbox.max,
                        fp.outer.bounding_box().min,
                        fp.outer.bounding_box().max,
                    ])
                });

        // TODO: does this handle xlink:href on a pattern correctly?
        // seems like we need some kind of recursion here
        let href_pattern_node = resolve_href(doc, pattern_node);

        let [Some(width), Some(height), x, y] = ["width", "height", "x", "y"].map(|attr| {
            self.length_attr_to_user_units(&pattern_node, attr)
                .or_else(|| {
                    href_pattern_node
                        .and_then(|href_node| self.length_attr_to_user_units(&href_node, attr))
                })
        }) else {
            // width or height of 0 means do not render
            return;
        };
        if width == 0. || height == 0. {
            return;
        }

        let pattern_origin_transform = Transform2D::translation(x.unwrap_or(0.), y.unwrap_or(0.));

        let pattern_transform = pattern_node
            .attribute("patternTransform")
            .or_else(|| {
                href_pattern_node
                    .as_ref()
                    .and_then(|n| n.attribute("patternTransform"))
            })
            .map_or_else(Transform2D::identity, |transform| {
                TransformListParser::from(transform)
                    .map(|token| token.expect("could not parse patternTransform"))
                    .map(svg_transform_into_euclid_transform)
                    .fold(Transform2D::identity(), |acc, t| t.then(&acc))
            });

        let target_pattern_node = if pattern_node.children().any(|c| c.is_element()) {
            // TODO: unclear what it would mean if there is an href element but the pattern also has its own children
            pattern_node
        } else if let Some(ref href) = href_pattern_node {
            *href
        } else {
            return;
        };

        let inv_transform = (pattern_origin_transform.then(&pattern_transform))
            .inverse()
            .expect("pattern transform is invertible");

        let (min_col, max_col, min_row, max_row) = {
            let inverse_container_bbox = inv_transform.outer_transformed_box(&container_bbox);
            (
                (inverse_container_bbox.min.x / width).floor() as i32 - 1,
                (inverse_container_bbox.max.x / width).ceil() as i32 + 1,
                (inverse_container_bbox.min.y / height).floor() as i32 - 1,
                (inverse_container_bbox.max.y / height).ceil() as i32 + 1,
            )
        };

        self.terrarium.push_clip_layer(container_polygons);

        // Apply the pattern by repeated translation. Clipping crops the border patterns to the container.
        for col in min_col..=max_col {
            for row in min_row..=max_row {
                // TODO: use a fast container checks to verify that some point in the pattern bbox is even
                // in the container. This is probably wasteful for a polygon with holes.
                let offset_transform =
                    Transform2D::translation(f64::from(col) * width, f64::from(row) * height);
                let combined = pattern_origin_transform
                    .then(&offset_transform)
                    .then(&pattern_transform);

                self.terrarium.push_transform(combined);
                visit_node(
                    doc,
                    target_pattern_node,
                    self,
                    Some(TemplatedExpansion::Pattern),
                );
                self.terrarium.pop_transform();
            }
        }

        self.terrarium.pop_clip_layer();
    }
}
