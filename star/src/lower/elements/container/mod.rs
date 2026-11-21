//! SVG elements with complex container behavior.

use std::str::FromStr;

use euclid::default::Transform2D;
use log::warn;
use lyon_geom::{Box2D, Point, vector};
use roxmltree::Node;
use smallvec::SmallVec;
use svgtypes::{AspectRatio, ViewBox};

use crate::{
    lower::{
        ConversionVisitor,
        style::{CssRules, calculate_presentation_attr},
        transform::get_viewport_transform,
        units::DimensionHint,
        visit::parse_view_box,
    },
    turtle::{CoordinateSystem, Turtle},
};

pub const SVG_TAG_NAME: &str = "svg";
pub const USE_TAG_NAME: &str = "use";
pub const SYMBOL_TAG_NAME: &str = "symbol";

pub use clip_path::*;
pub use pattern::*;

mod clip_path;
mod pattern;

/// State of the viewport when rendering
///
/// <https://www.w3.org/TR/SVG/coords.html>
#[derive(Debug, Default)]
pub struct ViewportState {
    /// Tracks width/height for percentage conversions.
    dim_stack: Vec<[f64; 2]>,
}

impl ViewportState {
    pub fn current_dims(&self) -> Option<[f64; 2]> {
        self.dim_stack.last().copied()
    }

    fn push_dims(&mut self, dims: [f64; 2]) {
        self.dim_stack.push(dims);
    }

    fn pop_dims(&mut self) {
        self.dim_stack.pop();
    }
}

#[derive(Debug, Default)]
pub struct UseState {
    /// Tracks use node IDs and any width/height override.
    stack: SmallVec<[(roxmltree::NodeId, [Option<f64>; 2]); Self::EXPECTED_MAX_DEPTH]>,
}

impl UseState {
    const EXPECTED_MAX_DEPTH: usize = 3;

    fn push(&mut self, id: roxmltree::NodeId, size: [Option<f64>; 2]) {
        self.stack.push((id, size));
    }

    fn pop(&mut self) {
        self.stack.pop();
    }

    fn current_size(&self) -> [Option<f64>; 2] {
        self.stack.last().map_or([None, None], |&(_, size)| size)
    }

    pub fn as_slice(&self) -> &[(roxmltree::NodeId, [Option<f64>; 2])] {
        &self.stack
    }
}

pub struct ContainerElement<'a, 'input> {
    kind: Kind,
    node: Node<'a, 'input>,
}

enum Kind {
    Svg,
    Use,
    Symbol,
}

impl Kind {
    fn parse(node: Node) -> Option<Self> {
        Some(match node.tag_name().name() {
            SVG_TAG_NAME => Self::Svg,
            USE_TAG_NAME => Self::Use,
            SYMBOL_TAG_NAME => Self::Symbol,
            _ => return None,
        })
    }
}

impl<'a, 'input> ContainerElement<'a, 'input> {
    pub fn new(node: Node<'a, 'input>) -> Option<Self> {
        Some(Self {
            kind: Kind::parse(node)?,
            node,
        })
    }

    pub fn enter<T: Turtle>(
        &self,
        visitor: &mut ConversionVisitor<'a, 'input, T>,
        flattened_transform: &mut Transform2D<f64>,
    ) {
        match self.kind {
            Kind::Svg => enter_svg(self.node, visitor, flattened_transform),
            Kind::Use => enter_use(
                self.node,
                &visitor.viewport,
                &mut visitor.use_state,
                flattened_transform,
            ),
            Kind::Symbol => enter_symbol(self.node, visitor, flattened_transform),
        }
    }

    pub fn exit<T: Turtle>(&self, visitor: &mut ConversionVisitor<'a, 'input, T>) {
        match self.kind {
            Kind::Svg | Kind::Symbol => exit_viewport(self.node, visitor),
            Kind::Use => {
                visitor.use_state.pop();
            }
        }
    }
}

fn enter_svg<'a, 'input, T: Turtle>(
    node: Node<'a, 'input>,
    visitor: &mut ConversionVisitor<'a, 'input, T>,
    flattened_transform: &mut Transform2D<f64>,
) {
    let view_box = parse_view_box(node);
    let preserve_aspect_ratio = node
        .attribute("preserveAspectRatio")
        .map(|attr| AspectRatio::from_str(attr).expect("could not parse preserveAspectRatio"));
    let viewport_size =
        svg_explicit_dimensions(node, &visitor.viewport, visitor.options.dimensions);

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

    let viewport_pos =
        ["x", "y"].map(|attr| visitor.viewport.length_attr_to_user_units(node, attr));

    visitor
        .viewport
        .push_dims(match (view_box.as_ref(), &viewport_size) {
            (Some(ViewBox { w, h, .. }), _) | (None, [w, h]) => [*w, *h],
        });

    if let Some(view_box) = view_box {
        let viewport_transform =
            get_viewport_transform(view_box, preserve_aspect_ratio, viewport_size, viewport_pos);
        *flattened_transform = viewport_transform.then(flattened_transform);
    } else {
        let [px, py] = viewport_pos.map(Option::unwrap_or_default);
        if px != 0. || py != 0. {
            *flattened_transform = flattened_transform.pre_translate(vector(px, py));
        }
    }
    if visitor.coordinate_system == CoordinateSystem::YUp && node.parent_element().is_none() {
        // Part 2 of converting from SVG (Y-down) to output (Y-up) coordinates:
        // shift the origin from the top-left to the bottom-left of the viewport.
        *flattened_transform = flattened_transform.then(&Transform2D::translation(
            0.,
            -(viewport_size[1] + viewport_pos[1].unwrap_or(0.)),
        ));
    }

    push_viewport_bounds_and_clip(visitor, node, view_box, viewport_pos, viewport_size);
}

fn exit_viewport<'a, 'input, T: Turtle>(
    node: Node<'a, 'input>,
    visitor: &mut ConversionVisitor<'a, 'input, T>,
) {
    if node.has_tag_name(SVG_TAG_NAME) || parse_view_box(node).is_some() {
        if is_overflow_hidden(node, visitor.css_rules, &visitor.use_state) {
            visitor.terrarium.pop_clip_layer();
        }
        visitor.viewport.pop_dims();
        visitor.terrarium.pop_bounds();
    }
}

fn enter_use(
    node: Node,
    viewport: &ViewportState,
    use_state: &mut UseState,
    flattened_transform: &mut Transform2D<f64>,
) {
    if node.has_attribute("viewBox") {
        warn!("View box is not supported on a {}", node.tag_name().name());
    }
    // Per SVG spec, <use> x/y translate is appended to the element's transform
    // https://www.w3.org/TR/SVG2/struct.html#UseLayout
    let [x, y] = ["x", "y"].map(|a| viewport.length_attr_to_user_units(node, a).unwrap_or(0.));
    *flattened_transform = flattened_transform.then(&Transform2D::translation(x, y));
    use_state.push(
        node.id(),
        ["width", "height"].map(|a| viewport.length_attr_to_user_units(node, a)),
    );
}

fn enter_symbol<'a, 'input, T: Turtle>(
    node: Node<'a, 'input>,
    visitor: &mut ConversionVisitor<'a, 'input, T>,
    flattened_transform: &mut Transform2D<f64>,
) {
    let view_box = parse_view_box(node);
    let preserve_aspect_ratio = node
        .attribute("preserveAspectRatio")
        .map(|attr| AspectRatio::from_str(attr).expect("could not parse preserveAspectRatio"));
    let use_size = visitor.use_state.current_size();
    // Viewport size: <use> override, symbol's own width/height, viewBox dims, or parent viewport
    let viewport_size = match (
        use_size[0].or_else(|| visitor.viewport.length_attr_to_user_units(node, "width")),
        use_size[1].or_else(|| visitor.viewport.length_attr_to_user_units(node, "height")),
        &view_box,
    ) {
        (Some(w), Some(h), _) => [w, h],
        (Some(w), None, Some(vb)) => [w, w * vb.h / vb.w],
        (None, Some(h), Some(vb)) => [h * vb.w / vb.h, h],
        (_, _, Some(vb)) => [vb.w, vb.h],
        _ => visitor.viewport.current_dims().unwrap_or([1., 1.]),
    };
    if let Some(view_box) = view_box {
        visitor.viewport.push_dims([view_box.w, view_box.h]);
        let viewport_transform =
            get_viewport_transform(view_box, preserve_aspect_ratio, viewport_size, [None, None]);
        *flattened_transform = viewport_transform.then(flattened_transform);
        // Does not need Y-axis translation unlike <svg>, already in g-code coords space.
    }
    if view_box.is_some() {
        push_viewport_bounds_and_clip(visitor, node, view_box, [None, None], viewport_size);
    }
}

fn push_viewport_bounds_and_clip<'a, 'input, T: Turtle>(
    visitor: &mut ConversionVisitor<'a, 'input, T>,
    node: Node<'a, 'input>,
    view_box_opt: Option<ViewBox>,
    viewport_pos_opt: [Option<f64>; 2],
    viewport_size_opt: [f64; 2],
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
    visitor.terrarium.push_viewport_bounds(viewport_box);
    if is_overflow_hidden(node, visitor.css_rules, &visitor.use_state) {
        visitor.terrarium.push_viewport_clip(viewport_box);
    }
}

pub fn svg_explicit_dimensions(
    node: Node,
    viewport: &ViewportState,
    dimensions: [Option<svgtypes::Length>; 2],
) -> [Option<f64>; 2] {
    let mut size = ["width", "height"].map(|attr| viewport.length_attr_to_user_units(node, attr));
    // SVG root only
    if node.parent_element().is_none() {
        let overrides = [
            dimensions[0].map(|l| viewport.length_to_user_units(l, DimensionHint::Horizontal)),
            dimensions[1].map(|l| viewport.length_to_user_units(l, DimensionHint::Vertical)),
        ];
        for (orig, ovr) in size.iter_mut().zip(overrides) {
            *orig = ovr.or(*orig);
        }
    }
    size
}

fn is_overflow_hidden<'input>(
    node: Node<'_, 'input>,
    css_rules: &CssRules<'input>,
    use_state: &UseState,
) -> bool {
    match calculate_presentation_attr(node, "overflow", css_rules, use_state.as_slice()) {
        Some("hidden" | "scroll") => true,
        Some(_) => false,
        None => {
            let is_root = node.parent_element().is_none() && node.tag_name().name() == SVG_TAG_NAME;
            !is_root
        }
    }
}
