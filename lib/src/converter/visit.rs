use std::str::FromStr;

use euclid::default::Transform2D;
use log::{debug, warn};
use roxmltree::{Document, Node};
use svgtypes::{AspectRatio, PathParser, PathSegment, PointsParser, TransformListParser, ViewBox};

use super::{
    path::apply_path,
    transform::{get_viewport_transform, svg_transform_into_euclid_transform},
    units::DimensionHint,
    ConversionVisitor,
};
use crate::{converter::node_name, Turtle};

const SVG_TAG_NAME: &str = "svg";
const CLIP_PATH_TAG_NAME: &str = "clipPath";
const PATH_TAG_NAME: &str = "path";
const POLYLINE_TAG_NAME: &str = "polyline";
const POLYGON_TAG_NAME: &str = "polygon";
const RECT_TAG_NAME: &str = "rect";
const CIRCLE_TAG_NAME: &str = "circle";
const ELLIPSE_TAG_NAME: &str = "ellipse";
const LINE_TAG_NAME: &str = "line";
const GROUP_TAG_NAME: &str = "g";

pub trait XmlVisitor {
    fn visit_enter(&mut self, node: Node);
    fn visit_exit(&mut self, node: Node);
}

/// Used to skip over SVG elements that are explicitly marked as do not render
fn is_valid_node(node: Node) -> bool {
    return node.is_element()
        && !node
            .attribute("style")
            .map_or(false, |style| style.contains("display:none"));
}

pub fn depth_first_visit(doc: &Document, visitor: &mut impl XmlVisitor) {
    fn visit_node(node: Node, visitor: &mut impl XmlVisitor) {
        if !is_valid_node(node) {
            return;
        }
        visitor.visit_enter(node);
        node.children().for_each(|child| visit_node(child, visitor));
        visitor.visit_exit(node);
    }

    doc.root()
        .children()
        .for_each(|child| visit_node(child, visitor));
}

impl<'a, T: Turtle> XmlVisitor for ConversionVisitor<'a, T> {
    fn visit_enter(&mut self, node: Node) {
        use PathSegment::*;

        if node.tag_name().name() == CLIP_PATH_TAG_NAME {
            warn!("Clip paths are not supported: {:?}", node);
        }

        // TODO: https://www.w3.org/TR/css-transforms-1/#transform-origin-property
        if let Some(mut origin) = node.attribute("transform-origin").map(PointsParser::from) {
            let _origin = origin.next();
            warn!("transform-origin not supported yet");
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
            for (original_dim, override_dim) in viewport_size
                .iter_mut()
                .zip(dimensions_override.into_iter())
            {
                *original_dim = override_dim.or(*original_dim);
            }

            // https://www.w3.org/TR/SVG/coords.html#SizingSVGInCSS
            // aka _natural_ aspect ratio
            let intrinsic_aspect_ratio = match (view_box, viewport_size) {
                (None, [Some(ref width), Some(ref height)]) => Some(*width / *height),
                (Some(ref view_box), _) => Some(view_box.w / view_box.h),
                (None, [None, None] | [None, Some(_)] | [Some(_), None]) => None,
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

            self.viewport_dim_stack
                .push(match (view_box.as_ref(), &viewport_size) {
                    (Some(ViewBox { w, h, .. }), _) => [*w, *h],
                    (None, [w, h]) => [*w, *h],
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
            // Part 2 of converting from SVG to GCode coordinates
            flattened_transform = flattened_transform.then(&Transform2D::translation(
                0.,
                -(viewport_size[1] + viewport_pos[1].unwrap_or(0.)),
            ));
        } else if node.has_attribute("viewBox") {
            warn!("View box is not supported on a {}", node.tag_name().name());
        }

        self.terrarium.push_transform(flattened_transform);

        match node.tag_name().name() {
            PATH_TAG_NAME => {
                if let Some(d) = node.attribute("d") {
                    self.comment(&node);
                    apply_path(
                        &mut self.terrarium,
                        PathParser::from(d)
                            .map(|segment| segment.expect("could not parse path segment")),
                    );
                } else {
                    warn!("There is a path node containing no actual path: {node:?}");
                }
            }
            name @ (POLYLINE_TAG_NAME | POLYGON_TAG_NAME) => {
                if let Some(points) = node.attribute("points") {
                    self.comment(&node);

                    let mut pp = PointsParser::from(points).peekable();
                    let path = pp
                        .peek()
                        .copied()
                        .map(|(x, y)| MoveTo { abs: true, x, y })
                        .into_iter()
                        .chain(pp.map(|(x, y)| LineTo { abs: true, x, y }))
                        .chain(
                            // Path must be closed if this is a polygon
                            if name == POLYGON_TAG_NAME {
                                Some(ClosePath { abs: true })
                            } else {
                                None
                            },
                        );

                    apply_path(&mut self.terrarium, path);
                } else {
                    warn!("There is a {name} node containing no actual path: {node:?}");
                }
            }
            RECT_TAG_NAME => {
                let x = self.length_attr_to_user_units(&node, "x").unwrap_or(0.);
                let y = self.length_attr_to_user_units(&node, "y").unwrap_or(0.);
                let width = self.length_attr_to_user_units(&node, "width");
                let height = self.length_attr_to_user_units(&node, "height");
                let rx = self.length_attr_to_user_units(&node, "rx").unwrap_or(0.);
                let ry = self.length_attr_to_user_units(&node, "ry").unwrap_or(0.);
                let has_radius = rx > 0. && ry > 0.;

                match (width, height) {
                    (Some(width), Some(height)) => {
                        self.comment(&node);
                        apply_path(
                            &mut self.terrarium,
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
                            .filter(|p| has_radius || !matches!(p, EllipticalArc { .. })),
                        )
                    }
                    _other => {
                        warn!("Invalid rectangle node: {node:?}");
                    }
                }
            }
            CIRCLE_TAG_NAME | ELLIPSE_TAG_NAME => {
                let cx = self.length_attr_to_user_units(&node, "cx").unwrap_or(0.);
                let cy = self.length_attr_to_user_units(&node, "cy").unwrap_or(0.);
                let r = self.length_attr_to_user_units(&node, "r").unwrap_or(0.);
                let rx = self.length_attr_to_user_units(&node, "rx").unwrap_or(r);
                let ry = self.length_attr_to_user_units(&node, "ry").unwrap_or(r);
                if rx > 0. && ry > 0. {
                    self.comment(&node);
                    apply_path(
                        &mut self.terrarium,
                        std::iter::once(MoveTo {
                            abs: true,
                            x: cx + rx,
                            y: cy,
                        })
                        .chain(
                            [(cx, cy + ry), (cx - rx, cy), (cx, cy - ry), (cx + rx, cy)].map(
                                |(x, y)| EllipticalArc {
                                    abs: true,
                                    rx,
                                    ry,
                                    x_axis_rotation: 0.,
                                    large_arc: false,
                                    sweep: true,
                                    x,
                                    y,
                                },
                            ),
                        )
                        .chain(std::iter::once(ClosePath { abs: true })),
                    );
                } else {
                    warn!("Invalid {} node: {node:?}", node.tag_name().name());
                }
            }
            LINE_TAG_NAME => {
                let x1 = self.length_attr_to_user_units(&node, "x1");
                let y1 = self.length_attr_to_user_units(&node, "y1");
                let x2 = self.length_attr_to_user_units(&node, "x2");
                let y2 = self.length_attr_to_user_units(&node, "y2");
                match (x1, y1, x2, y2) {
                    (Some(x1), Some(y1), Some(x2), Some(y2)) => {
                        self.comment(&node);
                        apply_path(
                            &mut self.terrarium,
                            [
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
                            ],
                        );
                    }
                    _other => {
                        warn!("Invalid line node: {node:?}");
                    }
                }
            }
            // No-op tags
            SVG_TAG_NAME | GROUP_TAG_NAME => {}
            _ => {
                debug!("Unknown node: {}", node.tag_name().name());
            }
        }

        self.name_stack.push(node_name(&node));
    }

    fn visit_exit(&mut self, node: Node) {
        self.terrarium.pop_transform();
        self.name_stack.pop();
        if node.tag_name().name() == SVG_TAG_NAME {
            self.viewport_dim_stack.pop();
        }
    }
}
