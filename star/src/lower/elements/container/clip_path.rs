use euclid::default::Transform2D;
use log::warn;
use lyon_geom::{Box2D, vector};
use roxmltree::Node;

use crate::{
    lower::{
        ConversionVisitor, TemplatedExpansion,
        elements::{SVG_TAG_NAME, SYMBOL_TAG_NAME, SimpleElement, USE_TAG_NAME},
        style::{calculate_presentation_attr, get_node_presentation_attr},
        transform::node_transform,
        visit::{XmlVisitor, resolve_href, resolve_url_ref},
    },
    turtle::{
        CoordinateSystem, PreprocessTurtle, StrokeCollectingTurtle, Terrarium, Turtle,
        elements::{FillRule, Shape},
    },
};

pub const CLIP_PATH_TAG_NAME: &str = "clipPath";

/// Tracks clip layers and the [`Shape`]s thy contain during visit.
#[derive(Debug, Default)]
pub struct ClipPathState {
    layer_counts: Vec<usize>,
    collecting: Option<Vec<Shape>>,
}

impl ClipPathState {
    /// Whether we are already collecting the children of a clipPath element,
    /// used to gate nested clipPath procssing.
    pub fn is_collecting(&self) -> bool {
        self.collecting.is_some()
    }
}

/// <https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/clipPath>
pub struct ClipPathElement<'a, 'input>(pub Node<'a, 'input>);

impl<'a, 'input> ClipPathElement<'a, 'input> {
    pub fn enter<T: Turtle>(
        visitor: &mut ConversionVisitor<'a, 'input, T>,
        node: Node<'a, 'input>,
    ) {
        if visitor.clip_paths.is_collecting() {
            if get_node_presentation_attr(node, "clip-path", visitor.css_rules)
                .is_some_and(|v| !v.eq_ignore_ascii_case("none"))
            {
                warn!("clip-path on a child of <clipPath> is not yet supported: {node:?}");
            }
            visitor.clip_paths.layer_counts.push(0);
            return;
        }

        let pushed_clips = push_clip_for_node(visitor, node, Some(node));
        visitor.clip_paths.layer_counts.push(pushed_clips);
    }

    pub fn exit<T: Turtle>(visitor: &mut ConversionVisitor<'_, '_, T>) {
        if let Some(pushed) = visitor.clip_paths.layer_counts.pop() {
            for _ in 0..pushed {
                visitor.terrarium.pop_clip_layer();
            }
        }
    }

    pub fn collect_node<T: Turtle>(
        visitor: &mut ConversionVisitor<'a, 'input, T>,
        node: Node<'a, 'input>,
    ) {
        let Ok(elem) = SimpleElement::new(node) else {
            return;
        };
        let is_hidden = calculate_presentation_attr(
            node,
            "visibility",
            visitor.css_rules,
            visitor.use_state.as_slice(),
        )
        .is_some_and(|v| v.eq_ignore_ascii_case("hidden") || v.eq_ignore_ascii_case("collapse"));
        if is_hidden {
            return;
        }

        let segments = match elem.segments(&visitor.viewport) {
            Ok(segments) => segments,
            Err(err) => {
                warn!("Failed to parse {node:?} inside <clipPath>, skipping: {err}");
                return;
            }
        };
        let clip_rule = calculate_presentation_attr(
            node,
            "clip-rule",
            visitor.css_rules,
            visitor.use_state.as_slice(),
        )
        .map_or(FillRule::NonZero, |v| {
            if v.eq_ignore_ascii_case("evenodd") {
                FillRule::EvenOdd
            } else {
                FillRule::NonZero
            }
        });
        let shapes = visitor.terrarium.to_shapes_unclipped(segments, clip_rule);
        if let Some(buf) = visitor.clip_paths.collecting.as_mut() {
            buf.extend(shapes);
        }
    }

    /// Collects the shapes defined by this `<clipPath>` and pushes the resulting
    /// clip layer(s) onto `visitor.terrarium`.
    ///
    /// Returns the number of clip layers pushed (0 if invalid or cyclic).
    fn push_layers<T: Turtle>(
        &self,
        visitor: &mut ConversionVisitor<'a, 'input, T>,
        target_node: Option<Node<'a, 'input>>,
    ) -> usize {
        let clip_node = self.0;
        let clip_id = clip_node.id();
        if visitor.visiting.contains(&clip_id) {
            warn!("Cyclic <clipPath> reference detected: {clip_node:?}");
            return 0;
        }

        let units_transform = match clip_node.attribute("clipPathUnits") {
            Some("userSpaceOnUse") | None => Transform2D::identity(),
            Some("objectBoundingBox") => {
                let Some(bbox) = target_node.and_then(|n| local_element_bbox(visitor, n)) else {
                    warn!("Could not compute objectBoundingBox for {clip_node:?}");
                    return 0;
                };
                // Completely excluded.
                if bbox.width() <= 0. || bbox.height() <= 0. {
                    visitor.terrarium.push_clip_layer(vec![]);
                    return 1;
                }
                Transform2D::scale(bbox.width(), bbox.height())
                    .then_translate(vector(bbox.min.x, bbox.min.y))
            }
            Some(other) => {
                warn!("Invalid clipPathUnits attribute value: {other}");
                return 0;
            }
        };

        let clip_transform = node_transform(clip_node, &visitor.viewport);
        visitor
            .terrarium
            .push_transform(units_transform.then(&clip_transform));
        visitor.visiting.push(clip_id);

        let pushed_layers = push_clip_for_node(visitor, clip_node, None);

        visitor.clip_paths.collecting = Some(Vec::new());
        visitor.expansions.push(TemplatedExpansion::ClipPath);
        for child in clip_node.children() {
            visitor.visit_dfs(child, Some(TemplatedExpansion::ClipPath));
        }
        visitor
            .expansions
            .pop_expected(TemplatedExpansion::ClipPath);
        let shapes = visitor.clip_paths.collecting.take().unwrap_or_default();

        visitor.visiting.pop();
        visitor.terrarium.pop_transform();

        visitor.terrarium.push_clip_layer(shapes);
        pushed_layers + 1
    }
}

fn push_clip_for_node<'a, 'input, T: Turtle>(
    visitor: &mut ConversionVisitor<'a, 'input, T>,
    node: Node<'a, 'input>,
    target_node: Option<Node<'a, 'input>>,
) -> usize {
    let Some(clip_attr) = get_node_presentation_attr(node, "clip-path", visitor.css_rules) else {
        return 0;
    };
    if clip_attr.eq_ignore_ascii_case("none") {
        return 0;
    }
    let Some(clip_node) = resolve_url_ref(node.document(), clip_attr) else {
        warn!("Could not resolve clip-path reference: {clip_attr}");
        return 0;
    };
    if !clip_node.has_tag_name(CLIP_PATH_TAG_NAME) {
        warn!("clip-path target is not a <clipPath>: {clip_node:?}");
        return 0;
    }
    ClipPathElement(clip_node).push_layers(visitor, target_node)
}

fn local_element_bbox<'a, 'input, T: Turtle>(
    visitor: &ConversionVisitor<'a, 'input, T>,
    node: Node<'a, 'input>,
) -> Option<Box2D<f64>> {
    if let Ok(elem) = SimpleElement::new(node) {
        let segments = elem.segments(&visitor.viewport).ok()?;
        let mut sub = Terrarium::new(StrokeCollectingTurtle::default());
        sub.apply_path(segments);
        let strokes = sub.finish().into_strokes();
        return strokes
            .into_iter()
            .map(|s| s.bounding_box())
            .reduce(|a, b| Box2D::from_points([a.min, a.max, b.min, b.max]));
    }

    #[cfg(feature = "image")]
    if node.has_tag_name("image") {
        let [x, y, width, height] = ["x", "y", "width", "height"].map(|a| {
            visitor
                .viewport
                .length_attr_to_user_units(node, a)
                .unwrap_or(0.)
        });
        return (width > 0. && height > 0.).then(|| {
            Box2D::new(
                lyon_geom::point(x, y),
                lyon_geom::point(x + width, y + height),
            )
        });
    }

    let mut bbox_visitor = ConversionVisitor {
        terrarium: Terrarium::new(PreprocessTurtle::default()),
        coordinate_system: CoordinateSystem::YDown,
        name_stack: vec![],
        config: visitor.config,
        options: visitor.options.clone(),
        selector_filter: None,
        css_rules: visitor.css_rules,
        viewport: visitor.viewport.clone(),
        expansions: visitor.expansions.clone(),
        use_state: visitor.use_state.clone(),
        visiting: visitor.visiting.clone(),
        clip_paths: ClipPathState::default(),
    };

    if node.has_tag_name(USE_TAG_NAME) {
        let referenced = resolve_href(node.document(), node)?;
        if !bbox_visitor.visiting.contains(&referenced.id()) {
            bbox_visitor.visit_dfs(referenced, Some(TemplatedExpansion::Use));
        }
    } else if matches!(node.tag_name().name(), "g" | SVG_TAG_NAME | SYMBOL_TAG_NAME) {
        for child in node.children() {
            bbox_visitor.visit_dfs(child, None);
        }
    } else {
        return None;
    }

    bbox_visitor.terrarium.finish().into_inner()
}

#[cfg(test)]
mod tests {
    use roxmltree::Document;

    use crate::{
        lower::{ConversionConfig, ConversionOptions, svg_to_turtle},
        turtle::{CoordinateSystem, StrokeCollectingTurtle, elements::Stroke},
    };

    fn collect_strokes(svg: &str) -> Vec<Stroke> {
        let doc = Document::parse(svg).unwrap();
        let config = ConversionConfig {
            dpi: 25.4, // 1 user unit = 1 mm
            origin: [None, None],
            ..Default::default()
        };
        svg_to_turtle(
            &doc,
            &config,
            ConversionOptions::default(),
            StrokeCollectingTurtle::default(),
            CoordinateSystem::YDown,
        )
        .into_strokes()
    }

    fn stroke_endpoints(s: &Stroke) -> ((f64, f64), (f64, f64)) {
        let start = s.start_point();
        let last = s
            .commands()
            .last()
            .map_or(start, crate::turtle::elements::DrawCommand::end_point);
        ((start.x, start.y), (last.x, last.y))
    }

    fn assert_approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-6, "expected {a} ~= {b}");
    }

    #[test]
    fn basic_user_space_on_use_clips_stroke() {
        let svg = r#"
            <svg width="100" height="100" viewBox="0 0 100 100">
                <defs>
                    <clipPath id="c">
                        <rect x="20" y="0" width="30" height="100"/>
                    </clipPath>
                </defs>
                <line x1="0" y1="50" x2="100" y2="50" stroke="black" clip-path="url(#c)"/>
            </svg>
        "#;
        let strokes = collect_strokes(svg);
        assert_eq!(strokes.len(), 1);
        let ((sx, sy), (ex, ey)) = stroke_endpoints(&strokes[0]);
        assert_approx(sx, 20.0);
        assert_approx(sy, 50.0);
        assert_approx(ex, 50.0);
        assert_approx(ey, 50.0);
    }

    #[test]
    fn multiple_children_in_clip_path_act_as_union() {
        let svg = r#"
            <svg width="100" height="100" viewBox="0 0 100 100">
                <defs>
                    <clipPath id="c">
                        <rect x="10" y="0" width="20" height="100"/>
                        <rect x="60" y="0" width="20" height="100"/>
                    </clipPath>
                </defs>
                <line x1="0" y1="50" x2="100" y2="50" stroke="black" clip-path="url(#c)"/>
            </svg>
        "#;
        let strokes = collect_strokes(svg);
        assert_eq!(strokes.len(), 2);
        let ((s0x, _), (e0x, _)) = stroke_endpoints(&strokes[0]);
        let ((s1x, _), (e1x, _)) = stroke_endpoints(&strokes[1]);
        assert_approx(s0x, 10.0);
        assert_approx(e0x, 30.0);
        assert_approx(s1x, 60.0);
        assert_approx(e1x, 80.0);
    }

    #[test]
    fn nested_clip_paths_act_as_intersection() {
        let svg = r#"
            <svg width="100" height="100" viewBox="0 0 100 100">
                <defs>
                    <clipPath id="outer">
                        <rect x="10" y="0" width="50" height="100"/>
                    </clipPath>
                    <clipPath id="inner">
                        <rect x="30" y="0" width="50" height="100"/>
                    </clipPath>
                </defs>
                <g clip-path="url(#outer)">
                    <line x1="0" y1="50" x2="100" y2="50" stroke="black" clip-path="url(#inner)"/>
                </g>
            </svg>
        "#;
        let strokes = collect_strokes(svg);
        assert_eq!(strokes.len(), 1);
        let ((sx, _), (ex, _)) = stroke_endpoints(&strokes[0]);
        assert_approx(sx, 30.0);
        assert_approx(ex, 60.0);
    }

    #[test]
    fn clip_path_transform_and_use_child() {
        let svg = r##"
            <svg width="100" height="100" viewBox="0 0 100 100">
                <defs>
                    <rect id="r" x="0" y="0" width="20" height="100"/>
                    <clipPath id="c" transform="translate(15, 0)">
                        <use href="#r" x="5"/>
                    </clipPath>
                </defs>
                <line x1="0" y1="50" x2="100" y2="50" stroke="black" clip-path="url(#c)"/>
            </svg>
        "##;
        let strokes = collect_strokes(svg);
        assert_eq!(strokes.len(), 1);
        let ((sx, _), (ex, _)) = stroke_endpoints(&strokes[0]);
        assert_approx(sx, 20.0);
        assert_approx(ex, 40.0);
    }

    #[test]
    fn clip_rule_evenodd_vs_nonzero() {
        // Two concentric squares wound in the same direction (clockwise in Y-down)
        let compound_d = "M 10 10 H 90 V 90 H 10 Z M 30 30 H 70 V 70 H 30 Z";
        let svg_nonzero = format!(
            r#"
            <svg width="100" height="100" viewBox="0 0 100 100">
                <defs>
                    <clipPath id="c">
                        <path d="{compound_d}" clip-rule="nonzero"/>
                    </clipPath>
                </defs>
                <line x1="0" y1="50" x2="100" y2="50" stroke="black" clip-path="url(#c)"/>
            </svg>
            "#
        );
        let nonzero_strokes = collect_strokes(&svg_nonzero);
        assert_eq!(nonzero_strokes.len(), 1);
        let ((sx, _), (ex, _)) = stroke_endpoints(&nonzero_strokes[0]);
        assert_approx(sx, 10.0);
        assert_approx(ex, 90.0);

        let svg_evenodd = format!(
            r#"
            <svg width="100" height="100" viewBox="0 0 100 100">
                <defs>
                    <clipPath id="c">
                        <path d="{compound_d}" clip-rule="evenodd"/>
                    </clipPath>
                </defs>
                <line x1="0" y1="50" x2="100" y2="50" stroke="black" clip-path="url(#c)"/>
            </svg>
            "#
        );
        let evenodd_strokes = collect_strokes(&svg_evenodd);
        assert_eq!(evenodd_strokes.len(), 2);
        let ((s0x, _), (e0x, _)) = stroke_endpoints(&evenodd_strokes[0]);
        let ((s1x, _), (e1x, _)) = stroke_endpoints(&evenodd_strokes[1]);
        assert_approx(s0x, 10.0);
        assert_approx(e0x, 30.0);
        assert_approx(s1x, 70.0);
        assert_approx(e1x, 90.0);
    }

    #[test]
    fn object_bounding_box_on_leaf_shape() {
        let svg = r#"
            <svg width="100" height="100" viewBox="0 0 100 100">
                <defs>
                    <clipPath id="c" clipPathUnits="objectBoundingBox">
                        <rect x="0.25" y="-0.1" width="0.5" height="1.2"/>
                    </clipPath>
                </defs>
                <rect x="20" y="20" width="40" height="20" fill="none" stroke="black" clip-path="url(#c)"/>
            </svg>
        "#;
        let strokes = collect_strokes(svg);
        assert!(!strokes.is_empty());
        for s in &strokes {
            let bb = s.bounding_box();
            assert!(bb.min.x >= 30.0 - 1e-6, "min.x {} < 30", bb.min.x);
            assert!(bb.max.x <= 50.0 + 1e-6, "max.x {} > 50", bb.max.x);
        }
    }

    #[test]
    fn object_bounding_box_on_group_container() {
        // Group bbox in local coords: x in [10, 50] (width 40), y in [20, 40] (height 20),
        // then translated by (10, 0) -> world x in [20, 60].
        // Clip rect [0.25, 0.75] of local x -> local [20, 40] -> world [30, 50].
        let svg = r#"
            <svg width="100" height="100" viewBox="0 0 100 100">
                <defs>
                    <clipPath id="c" clipPathUnits="objectBoundingBox">
                        <rect x="0.25" y="-0.1" width="0.5" height="1.2"/>
                    </clipPath>
                </defs>
                <g transform="translate(10, 0)" clip-path="url(#c)">
                    <rect x="10" y="20" width="20" height="20" fill="black" stroke="none"/>
                    <line x1="10" y1="30" x2="50" y2="30" stroke="black"/>
                </g>
            </svg>
        "#;
        let strokes = collect_strokes(svg);
        assert_eq!(strokes.len(), 1);
        let ((sx, sy), (ex, ey)) = stroke_endpoints(&strokes[0]);
        assert_approx(sx, 30.0);
        assert_approx(sy, 30.0);
        assert_approx(ex, 50.0);
        assert_approx(ey, 30.0);
    }

    #[test]
    fn object_bounding_box_on_use() {
        let svg = r##"
            <svg width="100" height="100" viewBox="0 0 100 100">
                <defs>
                    <path id="p" d="M 0 40 H 40 V 60 H 0 Z" fill="none" stroke="black"/>
                    <clipPath id="c" clipPathUnits="objectBoundingBox">
                        <rect x="0.25" y="-0.1" width="0.5" height="1.2"/>
                    </clipPath>
                </defs>
                <use href="#p" x="20" clip-path="url(#c)"/>
            </svg>
        "##;
        let strokes = collect_strokes(svg);
        assert!(!strokes.is_empty());
        for s in &strokes {
            let bb = s.bounding_box();
            assert!(bb.min.x >= 30.0 - 1e-6, "min.x {} < 30", bb.min.x);
            assert!(bb.max.x <= 50.0 + 1e-6, "max.x {} > 50", bb.max.x);
        }
    }

    #[test]
    fn cyclic_clip_path_does_not_infinite_loop() {
        let svg = r#"
            <svg width="100" height="100" viewBox="0 0 100 100">
                <defs>
                    <clipPath id="a" clip-path="url(#b)">
                        <rect x="10" y="0" width="80" height="100"/>
                    </clipPath>
                    <clipPath id="b" clip-path="url(#a)">
                        <rect x="20" y="0" width="60" height="100"/>
                    </clipPath>
                </defs>
                <line x1="0" y1="50" x2="100" y2="50" stroke="black" clip-path="url(#a)"/>
            </svg>
        "#;
        let strokes = collect_strokes(svg);
        assert_eq!(strokes.len(), 1);
    }

    #[test]
    fn clip_path_does_not_leak_to_siblings() {
        let svg = r#"
            <svg width="100" height="100" viewBox="0 0 100 100">
                <defs>
                    <clipPath id="c">
                        <rect x="20" y="0" width="30" height="100"/>
                    </clipPath>
                </defs>
                <line x1="0" y1="25" x2="100" y2="25" stroke="black" clip-path="url(#c)"/>
                <line x1="0" y1="75" x2="100" y2="75" stroke="black"/>
            </svg>
        "#;
        let strokes = collect_strokes(svg);
        assert_eq!(strokes.len(), 2);
        let ((s0x, _), (e0x, _)) = stroke_endpoints(&strokes[0]);
        let ((s1x, _), (e1x, _)) = stroke_endpoints(&strokes[1]);
        assert_approx(s0x, 20.0);
        assert_approx(e0x, 50.0);
        assert_approx(s1x, 0.0);
        assert_approx(e1x, 100.0);
    }
}
