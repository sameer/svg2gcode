use std::{collections::HashMap, iter, result::Result, str::FromStr};

use euclid::default::Transform2D;
use log::warn;
use roxmltree::{Document, Node};
use svgtypes::{LengthListParser, TransformListParser, ViewBox};

use super::{
    ConversionVisitor, TemplatedExpansion, transform::svg_transform_into_euclid_transform,
    units::DimensionHint,
};
use crate::{
    lower::{
        elements::{
            ContainerElement, PATTERN_TAG_NAME, PatternElement, SVG_TAG_NAME, SYMBOL_TAG_NAME,
            SimpleElement, USE_TAG_NAME, get_pattern_id,
        },
        node_name,
    },
    turtle::{Turtle, elements::FillRule},
};

const CLIP_PATH_TAG_NAME: &str = "clipPath";
const LINE_TAG_NAME: &str = "line";
const DEFS_TAG_NAME: &str = "defs";
const MARKER_TAG_NAME: &str = "marker";
const TEXT_TAG_NAME: &str = "text";
const TEXT_PATH_TAG_NAME: &str = "textPath";
const VIEW_TAG_NAME: &str = "view";
const MASK_TAG_NAME: &str = "mask";
#[cfg(feature = "image")]
use crate::lower::elements::{IMAGE_TAG_NAME, ImageElement};

pub trait XmlVisitor<'a, 'input> {
    fn visit_dfs(
        &mut self,
        start: Node<'a, 'input>,
        expanding_template: Option<TemplatedExpansion>,
        active_nodes: &mut Vec<roxmltree::NodeId>,
    ) {
        let doc = start.document();
        let mut stack = vec![(start, true)];

        while let Some((node, entering)) = stack.pop() {
            if !entering {
                self.visit_exit(node);
                active_nodes.pop();
                continue;
            }
            if !self.should_visit(node, expanding_template) {
                continue;
            }

            let expand_use = node.tag_name().name() == USE_TAG_NAME && self.should_draw_node(node);
            active_nodes.push(node.id());
            self.visit_enter(node);
            if expand_use && let Some(referenced) = resolve_href(doc, node) {
                if active_nodes.contains(&referenced.id()) {
                    warn!("Cyclic <use> detected: {node:?}");
                } else {
                    // Expand the target
                    self.visit_dfs(referenced, Some(TemplatedExpansion::Use), active_nodes);
                }
                self.visit_exit(node);
                active_nodes.pop();
            } else {
                stack.extend(
                    iter::once((node, false)).chain(node.children().rev().map(|n| (n, true))),
                );
            }
        }
    }

    fn should_visit(
        &self,
        node: Node<'a, 'input>,
        expanding_template: Option<TemplatedExpansion>,
    ) -> bool;
    fn should_draw_node(&self, node: Node<'a, 'input>) -> bool;
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

pub(crate) type CssRules<'a> = HashMap<&'a str, HashMap<&'a str, (usize, &'a str)>>;

/// Returns the effective value of the given presentation attribute (i.e. stroke),
/// adhering to precedence rules and checking inheritance.
///
/// 1. Inline style attribute
/// 2. CSS class rules
/// 3. Presentation attribute.
fn calculate_presentation_attr<'a, 'input: 'a>(
    node: Node<'a, 'input>,
    name: &str,
    css_rules: &'a CssRules<'input>,
    use_stack: &[(roxmltree::NodeId, [Option<f64>; 2])],
) -> Option<&'a str> {
    let find_in_ancestors = |start: Node<'a, 'input>| {
        for current in iter::successors(Some(start), Node::parent) {
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
    };

    find_in_ancestors(node).or_else(|| {
        let doc = node.document();
        use_stack
            .iter()
            .rev()
            .filter_map(|&(id, _)| doc.get_node(id))
            .find_map(find_in_ancestors)
    })
}

/// Helper for [calculate_presentation_attr] that only checks the current node.
fn get_node_presentation_attr<'a, 'input: 'a>(
    node: Node<'a, 'input>,
    name: &str,
    css_rules: &'a CssRules<'input>,
) -> Option<&'a str> {
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
                    .filter_map(|cls| css_rules.get(cls)?.get(name))
                    .max_by_key(|(order, _)| *order)
                    .map(|(_, val)| *val)
            })
        })
        .or_else(|| node.attribute(name).map(str::trim))
}

/// Barebones CSS class rules parser.
///
/// Returns a map from class name to property + `(rule_order, value)` pairs. Only simple, flat
/// class selectors (`.classname { prop: val; }`) are handled.
pub(crate) fn parse_css<'a>(doc: &'a Document) -> CssRules<'a> {
    let mut rules: CssRules<'a> = HashMap::new();
    let mut rule_order = 0usize;
    for node in doc.descendants() {
        if node.tag_name().name() != "style" {
            continue;
        }
        let Some(css) = node.text() else { continue };
        for block in css.split('}') {
            let Some((selector, declarations)) = block.split_once('{') else {
                continue;
            };
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
                if class.is_empty() {
                    continue;
                }
                let class_rules = rules.entry(class).or_default();
                for decl in declarations.split(';') {
                    if let Some((k, v)) = decl.split_once(':') {
                        let k = k.trim();
                        let v = v.trim();
                        if !k.is_empty() && !v.is_empty() {
                            class_rules.insert(k, (rule_order, v));
                            rule_order += 1;
                        }
                    }
                }
            }
        }
    }
    rules
}

/// Used to skip over non-element nodes and unreferenced template elements.
fn is_renderable(node: Node, expanding_template: Option<TemplatedExpansion>) -> bool {
    let tag_name = node.tag_name().name();
    node.is_element()
        && !matches!(tag_name, DEFS_TAG_NAME | CLIP_PATH_TAG_NAME | MASK_TAG_NAME)
        // Template elements are not directly rendered, unless referenced
        && (expanding_template.is_some()
            || !matches!(tag_name, MARKER_TAG_NAME | PATTERN_TAG_NAME | SYMBOL_TAG_NAME))
}

fn find_node_by_id<'a, 'input>(doc: &'a Document<'input>, id: &str) -> Option<Node<'a, 'input>> {
    doc.root()
        .descendants()
        .find(|n| n.attribute("id").map(str::trim) == Some(id))
}

/// Resolve `href` or `xlink:href` on a `<use>` element to a document node.
/// Only fragment references (`#id`) within the same document are supported.
pub fn resolve_href<'a, 'input: 'a>(
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
pub fn parse_view_box(node: Node) -> Option<ViewBox> {
    let attr = node.attribute("viewBox")?;
    match ViewBox::from_str(attr) {
        Ok(vb) if vb.w > 0. && vb.h > 0. => Some(vb),
        Ok(vb) => {
            warn!("Invalid viewBox: {vb:?}");
            None
        }
        Err(err) => {
            warn!("Invalid viewBox {attr:?}: {err}");
            None
        }
    }
}

pub fn depth_first_visit<'a, 'input, V: XmlVisitor<'a, 'input>>(
    doc: &'a Document<'input>,
    visitor: &mut V,
) {
    for c in doc.root().children() {
        let mut active_nodes = vec![];
        visitor.visit_dfs(c, None, &mut active_nodes);
    }
}

impl<'a, 'input, T: Turtle> XmlVisitor<'a, 'input> for ConversionVisitor<'a, 'input, T> {
    fn should_visit(
        &self,
        node: Node<'a, 'input>,
        expanding_template: Option<TemplatedExpansion>,
    ) -> bool {
        is_renderable(node, expanding_template)
            && get_node_presentation_attr(node, "display", self.css_rules)
                .is_none_or(|v| !v.eq_ignore_ascii_case("none"))
            && (!node.has_tag_name(SVG_TAG_NAME)
                || self
                    .svg_explicit_dimensions(node)
                    .into_iter()
                    .flatten()
                    .all(|d| d > 0.))
    }

    fn should_draw_node(&self, node: Node<'a, 'input>) -> bool {
        !self.expansion_stack.is_empty()
            || self
                .selector_filter
                .as_ref()
                .is_none_or(|s| s.matches(node))
    }

    fn visit_enter(&mut self, node: Node<'a, 'input>) {
        if let tag @ (CLIP_PATH_TAG_NAME | TEXT_TAG_NAME | TEXT_PATH_TAG_NAME | VIEW_TAG_NAME) =
            node.tag_name().name()
        {
            warn!("Tag {tag} is not supported: {node:?}");
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
        if let Some(container) = ContainerElement::new(node) {
            container.enter(self, &mut flattened_transform);
        } else if node.has_attribute("viewBox") {
            warn!("View box is not supported on a {}", node.tag_name().name());
        }

        self.terrarium.push_transform(flattened_transform);
        self.name_stack
            .push(node_name(node, self.config.extra_attribute_name.as_deref()));

        let should_draw = self.should_draw_node(node);

        if let Some(expansion) = TemplatedExpansion::from_tag_name(node.tag_name().name()) {
            self.expansion_stack.push(expansion);
        }

        if !should_draw {
            return;
        }

        let fill_attr = calculate_presentation_attr(node, "fill", self.css_rules, &self.use_stack);
        // SVGs fill by default
        let has_fill_attr = fill_attr != Some("none");
        let fill_rule =
            calculate_presentation_attr(node, "fill-rule", self.css_rules, &self.use_stack)
                .map_or_default(|v| {
                    if v == "evenodd" {
                        FillRule::EvenOdd
                    } else {
                        FillRule::NonZero
                    }
                });

        // Default to false which is spec compliant.
        let has_stroke_attr =
            calculate_presentation_attr(node, "stroke", self.css_rules, &self.use_stack)
                .is_some_and(|attr| attr != "none");

        if !(has_stroke_attr || has_fill_attr || node.tag_name().name() == "image") {
            return;
        }

        #[cfg(feature = "image")]
        if node.tag_name().name() == IMAGE_TAG_NAME {
            ImageElement(node).render(self);
            return;
        }

        let elem = match SimpleElement::new(node) {
            Ok(elem) => elem,
            Err(err) => {
                warn!("Skipping unknown tag: {err}");
                return;
            }
        };
        let segments = match elem.segments(self) {
            Ok(segments) => segments,
            Err(err) => {
                warn!("Failed to parse {node:?}, skipping: {err}");
                return;
            }
        };

        let pattern_id = fill_attr
            .and_then(get_pattern_id)
            .filter(|_| has_fill_attr)
            .and_then(|id| find_node_by_id(node.document(), id));

        if has_stroke_attr {
            self.comment();
            self.terrarium.apply_path(segments.iter().copied());
        }
        if has_fill_attr && !node.has_tag_name(LINE_TAG_NAME) {
            self.comment();
            // TODO: no idea what a vectorized gradient fill would mean practically speaking
            if let Some(pattern_id) = pattern_id {
                PatternElement(pattern_id).render(self, node, segments, fill_rule);
            } else {
                self.terrarium.apply_fill(segments, fill_rule);
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
        if let Some(container) = ContainerElement::new(node) {
            container.exit(self);
        }
    }
}

impl<'a, 'input, T: Turtle> ConversionVisitor<'a, 'input, T> {
    pub fn svg_explicit_dimensions(&self, node: Node<'a, 'input>) -> [Option<f64>; 2] {
        let mut size = ["width", "height"].map(|attr| self.length_attr_to_user_units(node, attr));
        // SVG root only
        if node.parent_element().is_none() {
            let overrides = [
                self.options.dimensions[0]
                    .map(|l| self.length_to_user_units(l, DimensionHint::Horizontal)),
                self.options.dimensions[1]
                    .map(|l| self.length_to_user_units(l, DimensionHint::Vertical)),
            ];
            for (orig, ovr) in size.iter_mut().zip(overrides) {
                *orig = ovr.or(*orig);
            }
        }
        size
    }

    pub fn is_overflow_hidden(&self, node: Node<'a, 'input>) -> bool {
        match calculate_presentation_attr(node, "overflow", self.css_rules, &self.use_stack) {
            Some("hidden" | "scroll") => true,
            Some(_) => false,
            None => {
                let is_root =
                    node.parent_element().is_none() && node.tag_name().name() == SVG_TAG_NAME;
                !is_root
            }
        }
    }
}
