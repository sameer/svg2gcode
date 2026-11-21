use std::str::FromStr;

use euclid::default::Transform2D;
use log::warn;
use lyon_geom::Box2D;
use roxmltree::Node;
use svgtypes::{AspectRatio, PathSegment};

use crate::{
    lower::{
        ConversionVisitor, TemplatedExpansion,
        transform::{get_viewport_transform, parse_transform_list},
        visit::{XmlVisitor, parse_view_box, resolve_href},
    },
    turtle::{Turtle, elements::FillRule},
};

pub const PATTERN_TAG_NAME: &str = "pattern";

pub fn get_pattern_id(attr: &str) -> Option<&str> {
    let inner = attr.trim().strip_prefix("url(")?.strip_suffix(")")?.trim();
    inner.trim_matches(['\'', '"']).strip_prefix('#')
}

/// <https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/pattern>
pub struct PatternElement<'a, 'input>(pub Node<'a, 'input>);

impl<'a, 'input> PatternElement<'a, 'input> {
    pub fn render<T: Turtle>(
        &self,
        visitor: &mut ConversionVisitor<'a, 'input, T>,
        container: Node<'a, 'input>,
        container_segments: impl IntoIterator<Item = PathSegment>,
        fill_rule: FillRule,
    ) {
        let pattern_node = self.0;
        let pattern_id = pattern_node.id();
        if visitor.visiting.contains(&pattern_id) {
            warn!("Cyclic <pattern> reference detected: {pattern_node:?}");
            return;
        }
        let doc = container.document();
        let container_shapes = visitor.terrarium.to_shapes(container_segments, fill_rule);
        let [first, rest @ ..] = container_shapes.as_slice() else {
            return;
        };
        let container_bbox = rest.iter().fold(first.outer.bounding_box(), |bbox, fp| {
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
        let pattern_attr = |attr: &str| {
            pattern_node
                .attribute(attr)
                .or_else(|| href_pattern_node.and_then(|n| n.attribute(attr)))
        };

        let pattern_length_attr = |visitor: &ConversionVisitor<'a, 'input, T>, attr: &str| {
            visitor
                .viewport
                .length_attr_to_user_units(pattern_node, attr)
                .or_else(|| {
                    href_pattern_node.and_then(|href_node| {
                        visitor.viewport.length_attr_to_user_units(href_node, attr)
                    })
                })
        };

        let local_bbox = || {
            let Some(world_to_local) = visitor.terrarium.current_transform_inverse() else {
                warn!("Non-invertible transform for objectBoundingBox pattern");
                return None;
            };
            Some(world_to_local.outer_transformed_box(&container_bbox))
        };

        let [width, height, x, y] = match pattern_attr("patternUnits") {
            Some("objectBoundingBox") | None => {
                let Some(local_bbox) = local_bbox() else {
                    return;
                };
                visitor.viewport.push_dims([1., 1.]);
                let [w, h, x, y] =
                    ["width", "height", "x", "y"].map(|a| pattern_length_attr(visitor, a));
                visitor.viewport.pop_dims();
                [
                    w.map(|f| f * local_bbox.width()),
                    h.map(|f| f * local_bbox.height()),
                    Some(local_bbox.min.x + x.unwrap_or(0.) * local_bbox.width()),
                    Some(local_bbox.min.y + y.unwrap_or(0.) * local_bbox.height()),
                ]
            }
            Some("userSpaceOnUse") => {
                ["width", "height", "x", "y"].map(|a| pattern_length_attr(visitor, a))
            }
            Some(other) => {
                warn!("Invalid patternUnits attribute value: {other}");
                return;
            }
        };

        // width or height missing means do not render
        let (Some(width), Some(height)) = (width, height) else {
            return;
        };

        if width <= 0. || height <= 0. {
            return;
        }

        let pattern_origin_transform = Transform2D::translation(x.unwrap_or(0.), y.unwrap_or(0.));

        let pattern_transform = pattern_attr("patternTransform")
            .map_or_else(Transform2D::identity, parse_transform_list);

        let view_box =
            parse_view_box(pattern_node).or_else(|| href_pattern_node.and_then(parse_view_box));
        let preserve_aspect_ratio = pattern_attr("preserveAspectRatio")
            .map(|attr| AspectRatio::from_str(attr).expect("could not parse preserveAspectRatio"));
        let (content_transform, pattern_viewport_dims) =
            match (view_box, pattern_attr("patternContentUnits")) {
                (Some(vb), _) => (
                    get_viewport_transform(
                        vb,
                        preserve_aspect_ratio,
                        [width, height],
                        [None, None],
                    ),
                    [vb.w, vb.h],
                ),
                (None, Some("objectBoundingBox")) => {
                    let Some(local_bbox) = local_bbox() else {
                        return;
                    };
                    (
                        Transform2D::scale(local_bbox.width(), local_bbox.height()),
                        [1., 1.],
                    )
                }
                (None, Some("userSpaceOnUse") | None) => (Transform2D::identity(), [width, height]),
                (None, Some(other)) => {
                    warn!("Invalid patternContentUnits attribute value: {other}");
                    return;
                }
            };

        let target_pattern_node = if pattern_node.children().any(|c| c.is_element()) {
            // TODO: unclear what it would mean if there is an href element but the pattern also has its own children
            pattern_node
        } else if let Some(ref href) = href_pattern_node {
            *href
        } else {
            return;
        };

        let Some(inv_transform) = pattern_origin_transform
            .then(&pattern_transform)
            .then(&visitor.terrarium.current_transform())
            .inverse()
        else {
            warn!("Non-invertible pattern transform");
            return;
        };

        let (min_col, max_col, min_row, max_row) = {
            let inverse_container_bbox = inv_transform.outer_transformed_box(&container_bbox);
            (
                (inverse_container_bbox.min.x / width).floor() as i32 - 1,
                (inverse_container_bbox.max.x / width).ceil() as i32 + 1,
                (inverse_container_bbox.min.y / height).floor() as i32 - 1,
                (inverse_container_bbox.max.y / height).ceil() as i32 + 1,
            )
        };

        visitor.terrarium.push_clip_layer(container_shapes);
        visitor.viewport.push_dims(pattern_viewport_dims);

        // Apply the pattern by repeated translation. Clipping crops the border patterns to the container.
        visitor.visiting.push(pattern_id);
        for col in min_col..=max_col {
            for row in min_row..=max_row {
                // TODO: use a fast container checks to verify that some point in the pattern bbox is even
                // in the container. This is probably wasteful for a shape with holes.
                let offset_transform =
                    Transform2D::translation(f64::from(col) * width, f64::from(row) * height);
                let combined = content_transform
                    .then(&pattern_origin_transform)
                    .then(&offset_transform)
                    .then(&pattern_transform);

                visitor.terrarium.push_transform(combined);
                for child in target_pattern_node.children() {
                    visitor.visit_dfs(child, Some(TemplatedExpansion::Pattern));
                }
                visitor.terrarium.pop_transform();
            }
        }

        visitor.visiting.pop();
        visitor.viewport.pop_dims();
        visitor.terrarium.pop_clip_layer();
    }
}
