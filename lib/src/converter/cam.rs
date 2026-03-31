use std::{borrow::Cow, collections::BTreeMap};

use g_code::{command, emit::Token};
use i_overlay::{
    core::fill_rule::FillRule as OverlayFillRule,
    float::simplify::SimplifyShape,
    mesh::{
        outline::offset::OutlineOffset,
        style::{LineJoin, OutlineStyle},
    },
};
use lyon_geom::{
    CubicBezierSegment, Point, QuadraticBezierSegment, SvgArc, euclid::default::Transform2D,
};
use roxmltree::Document;
use svgtypes::{Length, LengthUnit};
use uom::si::{
    f64::Length as UomLength,
    length::{inch, millimeter},
};

use super::{ConversionConfig, ConversionOptions, ConversionVisitor, visit};
use crate::{
    EngravingConfig, EngravingOperation, FillMode, GenerationWarning, Machine, Turtle,
    converter::{selector::SelectorList, units::CSS_DEFAULT_DPI},
    turtle::{PaintStyle, SvgFillRule},
};

type Contour = Vec<[f64; 2]>;
type Shape = Vec<Contour>;

#[derive(Debug, Clone)]
struct FillNode {
    fill_rule: SvgFillRule,
    contours: Vec<Contour>,
}

#[derive(Debug, Clone)]
struct PolylinePath {
    points: Vec<Point<f64>>,
}

#[derive(Debug, Clone)]
struct Toolpath {
    points: Vec<Point<f64>>,
    depth: f64,
}

#[derive(Debug, Clone)]
struct OperationGroup {
    paths: Vec<Toolpath>,
    reversible: bool,
}

#[derive(Debug)]
struct CamTurtle {
    tolerance: f64,
    current_paint: PaintStyle,
    current_points: Vec<Point<f64>>,
    pending_fill_contours: Vec<Contour>,
    fill_nodes: Vec<FillNode>,
    stroke_paths: Vec<PolylinePath>,
}

impl CamTurtle {
    fn new(tolerance: f64) -> Self {
        Self {
            tolerance,
            current_paint: PaintStyle::default(),
            current_points: vec![],
            pending_fill_contours: vec![],
            fill_nodes: vec![],
            stroke_paths: vec![],
        }
    }

    fn push_point(&mut self, point: Point<f64>) {
        if self.current_points.last().copied() != Some(point) {
            self.current_points.push(point);
        }
    }

    fn flush_subpath(&mut self) {
        if self.current_points.len() < 2 {
            self.current_points.clear();
            return;
        }

        let closed = self
            .current_points
            .first()
            .zip(self.current_points.last())
            .is_some_and(|(first, last)| (*first - *last).square_length() < 1.0e-9);

        if self.current_paint.stroke {
            self.stroke_paths.push(PolylinePath {
                points: self.current_points.clone(),
            });
        }

        if self.current_paint.fill && closed {
            let mut contour = self
                .current_points
                .iter()
                .map(|point| [point.x, point.y])
                .collect::<Contour>();
            contour.pop();
            if contour.len() >= 3 {
                self.pending_fill_contours.push(contour);
            }
        }

        self.current_points.clear();
    }

    fn flush_fill_node(&mut self) {
        if self.current_paint.fill && !self.pending_fill_contours.is_empty() {
            self.fill_nodes.push(FillNode {
                fill_rule: self.current_paint.fill_rule,
                contours: std::mem::take(&mut self.pending_fill_contours),
            });
        } else {
            self.pending_fill_contours.clear();
        }
    }
}

impl Turtle for CamTurtle {
    fn begin(&mut self) {}

    fn end(&mut self) {
        self.flush_subpath();
        self.flush_fill_node();
    }

    fn set_paint_style(&mut self, style: PaintStyle) {
        self.current_paint = style;
    }

    fn comment(&mut self, _comment: String) {
        self.flush_subpath();
        self.flush_fill_node();
    }

    fn move_to(&mut self, to: Point<f64>) {
        self.flush_subpath();
        self.current_points.push(to);
    }

    fn line_to(&mut self, to: Point<f64>) {
        self.push_point(to);
    }

    fn arc(&mut self, svg_arc: SvgArc<f64>) {
        if svg_arc.is_straight_line() {
            self.line_to(svg_arc.to);
            return;
        }
        svg_arc
            .to_arc()
            .flattened(self.tolerance)
            .for_each(|point| self.push_point(point));
    }

    fn cubic_bezier(&mut self, cbs: CubicBezierSegment<f64>) {
        cbs.flattened(self.tolerance)
            .for_each(|point| self.push_point(point));
    }

    fn quadratic_bezier(&mut self, qbs: QuadraticBezierSegment<f64>) {
        qbs.flattened(self.tolerance)
            .for_each(|point| self.push_point(point));
    }
}

fn overlay_fill_rule(fill_rule: SvgFillRule) -> OverlayFillRule {
    match fill_rule {
        SvgFillRule::EvenOdd => OverlayFillRule::EvenOdd,
        SvgFillRule::NonZero => OverlayFillRule::NonZero,
    }
}

fn simplify_fill_nodes(nodes: Vec<FillNode>) -> Vec<Shape> {
    let mut grouped = BTreeMap::<SvgFillRule, Vec<Contour>>::new();
    for node in nodes {
        grouped
            .entry(node.fill_rule)
            .or_default()
            .extend(node.contours);
    }

    let mut shapes = vec![];
    for (fill_rule, contours) in grouped {
        shapes.extend(contours.simplify_shape(overlay_fill_rule(fill_rule)));
    }
    shapes
}

fn inset_shapes(shapes: &[Shape], delta: f64) -> Vec<Shape> {
    let style = OutlineStyle::new(-delta).line_join(LineJoin::Miter(2.0));
    let mut inset = vec![];
    for shape in shapes {
        inset.extend(shape.outline(&style));
    }
    inset
}

fn contour_to_points(contour: &Contour) -> Vec<Point<f64>> {
    contour.iter().map(|p| Point::new(p[0], p[1])).collect()
}

fn contour_toolpath(contour: &Contour, depth: f64) -> Option<Toolpath> {
    let mut points = contour_to_points(contour);
    if points.len() < 3 {
        return None;
    }
    points.push(points[0]);
    Some(Toolpath { points, depth })
}

fn depth_passes(target_depth: f64, max_stepdown: f64) -> Vec<f64> {
    let mut depths = vec![];
    let mut current = 0.0;
    while current < target_depth {
        current = (current + max_stepdown).min(target_depth);
        depths.push(-current);
    }
    depths
}

fn count_contours(shapes: &[Shape]) -> usize {
    shapes.iter().map(Vec::len).sum()
}

fn fill_shape_loses_detail(shape: &Shape, tool_radius: f64) -> bool {
    let inset = inset_shapes(std::slice::from_ref(shape), tool_radius);
    if inset.is_empty() {
        return false;
    }

    inset.len() != 1 || count_contours(&inset) != shape.len()
}

fn translate_toolpaths(groups: &mut [OperationGroup], offset: Point<f64>) {
    for group in groups {
        for path in &mut group.paths {
            for point in &mut path.points {
                point.x += offset.x;
                point.y += offset.y;
            }
        }
    }
}

fn build_stroke_groups(paths: Vec<PolylinePath>, depths: &[f64]) -> Vec<OperationGroup> {
    paths
        .into_iter()
        .filter(|path| path.points.len() >= 2)
        .map(|path| OperationGroup {
            paths: depths
                .iter()
                .copied()
                .map(|depth| Toolpath {
                    points: path.points.clone(),
                    depth,
                })
                .collect(),
            reversible: true,
        })
        .collect()
}

fn build_fill_groups(
    fill_shapes: &[Shape],
    depths: &[f64],
    tool_radius: f64,
    stepover: f64,
    warnings: &mut Vec<GenerationWarning>,
) -> Vec<OperationGroup> {
    let mut groups = vec![];
    for shape in fill_shapes {
        let mut paths = vec![];
        let mut had_any_paths = false;

        for depth in depths.iter().copied() {
            let mut current = inset_shapes(std::slice::from_ref(shape), tool_radius);
            if current.is_empty() {
                if !had_any_paths {
                    warnings.push(GenerationWarning::ToolTooLargeForFill);
                }
                break;
            }

            had_any_paths = true;
            while !current.is_empty() {
                for inset_shape in &current {
                    for contour in inset_shape {
                        if let Some(path) = contour_toolpath(contour, depth) {
                            paths.push(path);
                        }
                    }
                }
                current = inset_shapes(&current, stepover);
            }
        }

        if !paths.is_empty() {
            groups.push(OperationGroup {
                paths,
                reversible: false,
            });
        }
    }
    groups
}

fn build_fill_contour_groups(fill_shapes: &[Shape], depths: &[f64]) -> Vec<OperationGroup> {
    let mut groups = vec![];

    for shape in fill_shapes {
        let mut paths = vec![];
        for depth in depths.iter().copied() {
            for contour in shape {
                if let Some(path) = contour_toolpath(contour, depth) {
                    paths.push(path);
                }
            }
        }

        if !paths.is_empty() {
            groups.push(OperationGroup {
                paths,
                reversible: false,
            });
        }
    }

    groups
}

fn distance(a: Point<f64>, b: Point<f64>) -> f64 {
    (a - b).length()
}

fn optimize_operation_groups(mut groups: Vec<OperationGroup>) -> Vec<OperationGroup> {
    if groups.len() <= 1 {
        return groups;
    }

    let mut ordered = Vec::with_capacity(groups.len());
    let mut current = Point::new(0.0, 0.0);

    while !groups.is_empty() {
        let mut best_index = 0usize;
        let mut best_reversed = false;
        let mut best_distance = f64::INFINITY;

        for (index, group) in groups.iter().enumerate() {
            let start = group.paths[0].points[0];
            let start_distance = distance(current, start);
            if start_distance < best_distance {
                best_distance = start_distance;
                best_index = index;
                best_reversed = false;
            }

            if group.reversible {
                let end = *group.paths[0].points.last().unwrap();
                let end_distance = distance(current, end);
                if end_distance < best_distance {
                    best_distance = end_distance;
                    best_index = index;
                    best_reversed = true;
                }
            }
        }

        let mut group = groups.swap_remove(best_index);
        if best_reversed {
            for path in &mut group.paths {
                path.points.reverse();
            }
        }
        current = *group.paths.last().unwrap().points.last().unwrap();
        ordered.push(group);
    }

    ordered
}

fn collect_warnings(
    warnings: impl IntoIterator<Item = GenerationWarning>,
) -> Vec<GenerationWarning> {
    let mut deduped = BTreeMap::<GenerationWarning, ()>::new();
    for warning in warnings {
        deduped.insert(warning, ());
    }
    deduped.into_keys().collect()
}

fn toolpath_bounds(groups: &[OperationGroup]) -> Option<(f64, f64, f64, f64)> {
    let mut iter = groups
        .iter()
        .flat_map(|group| group.paths.iter())
        .flat_map(|path| path.points.iter());
    let first = iter.next()?;
    let mut min_x = first.x;
    let mut min_y = first.y;
    let mut max_x = first.x;
    let mut max_y = first.y;

    for point in iter {
        min_x = min_x.min(point.x);
        min_y = min_y.min(point.y);
        max_x = max_x.max(point.x);
        max_y = max_y.max(point.y);
    }

    Some((min_x, min_y, max_x, max_y))
}

fn comment_token<'input>(text: impl Into<String>) -> Token<'input> {
    Token::Comment {
        is_inline: false,
        inner: Cow::Owned(text.into()),
    }
}

fn append_rapid_z<'input>(program: &mut Vec<Token<'input>>, z: f64) {
    program.append(&mut command!(RapidPositioning { Z: z }).into_token_vec());
}

fn append_rapid_xy<'input>(program: &mut Vec<Token<'input>>, point: Point<f64>) {
    program.append(
        &mut command!(RapidPositioning {
            X: point.x,
            Y: point.y,
        })
        .into_token_vec(),
    );
}

fn append_plunge<'input>(program: &mut Vec<Token<'input>>, depth: f64, plunge_feedrate: f64) {
    program.append(
        &mut command!(LinearInterpolation {
            Z: depth,
            F: plunge_feedrate,
        })
        .into_token_vec(),
    );
}

fn append_cut_move<'input>(program: &mut Vec<Token<'input>>, point: Point<f64>, cut_feedrate: f64) {
    program.append(
        &mut command!(LinearInterpolation {
            X: point.x,
            Y: point.y,
            F: cut_feedrate,
        })
        .into_token_vec(),
    );
}

fn validate_engraving_config(engraving: &EngravingConfig) -> Result<(), String> {
    if engraving.tool_shape != crate::ToolShape::Flat {
        return Err("Tool shape is not yet supported for engraving CAM; select Flat.".into());
    }
    if engraving.target_depth <= 0.0 {
        return Err("Target depth must be greater than 0.".into());
    }
    if engraving.max_stepdown <= 0.0 {
        return Err("Max stepdown must be greater than 0.".into());
    }
    if engraving.tool_diameter <= 0.0 {
        return Err("Tool diameter must be greater than 0.".into());
    }
    if engraving.stepover <= 0.0 {
        return Err("Stepover must be greater than 0.".into());
    }

    Ok(())
}

fn empty_engraving_geometry_error(
    has_fill_shapes: bool,
    has_stroke_paths: bool,
    warnings: &[GenerationWarning],
) -> String {
    if has_fill_shapes
        && !has_stroke_paths
        && warnings.contains(&GenerationWarning::ToolTooLargeForFill)
    {
        return "Filled SVG geometry was found, but the selected tool diameter is too large to fit inside any filled region. Reduce the tool diameter or use stroke engraving.".into();
    }

    "No engravable SVG geometry was found. Add fills and/or strokes.".into()
}

fn apply_dimension_overrides(
    mut options: ConversionOptions,
    engraving: &EngravingConfig,
) -> ConversionOptions {
    if let Some(width) = engraving.svg_width_override {
        options.dimensions[0] = Some(Length {
            number: width,
            unit: LengthUnit::Mm,
        });
        options.dimensions[1] = None;
    }

    options
}

fn collect_engraving_groups<'a>(
    doc: &'a Document,
    config: &ConversionConfig,
    engraving: &EngravingConfig,
    options: ConversionOptions,
) -> Result<(Vec<OperationGroup>, Vec<GenerationWarning>), String> {
    validate_engraving_config(engraving)?;
    let options = apply_dimension_overrides(options, engraving);
    let selector_filter = config
        .selector_filter
        .as_deref()
        .map(|s| SelectorList::parse(s).expect("invalid selector_filter"));

    let bounding_box_generator = || {
        let mut visitor = ConversionVisitor {
            terrarium: crate::turtle::Terrarium::new(crate::turtle::DpiConvertingTurtle {
                inner: crate::turtle::PreprocessTurtle::default(),
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

    let mut collect_visitor = ConversionVisitor {
        terrarium: crate::turtle::Terrarium::new(crate::turtle::DpiConvertingTurtle {
            inner: CamTurtle::new(config.tolerance),
            dpi: config.dpi,
        }),
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

    let cam_turtle = collect_visitor.terrarium.turtle.inner;
    let has_stroke_paths = !cam_turtle.stroke_paths.is_empty();
    let fill_shapes = simplify_fill_nodes(cam_turtle.fill_nodes);
    let has_fill_shapes = !fill_shapes.is_empty();
    let depths = depth_passes(engraving.target_depth, engraving.max_stepdown);
    let tool_radius = engraving.tool_diameter * 0.5;

    let mut warnings = Vec::new();
    if engraving.target_depth > engraving.material_thickness {
        warnings.push(GenerationWarning::DepthExceedsMaterialThickness);
    }

    let mut groups = build_stroke_groups(cam_turtle.stroke_paths, &depths);
    match engraving.fill_mode {
        FillMode::Pocket => {
            if fill_shapes
                .iter()
                .any(|shape| fill_shape_loses_detail(shape, tool_radius))
            {
                warnings.push(GenerationWarning::FillDetailLoss);
            }

            groups.extend(build_fill_groups(
                &fill_shapes,
                &depths,
                tool_radius,
                engraving.stepover,
                &mut warnings,
            ));
        }
        FillMode::Contour => {
            groups.extend(build_fill_contour_groups(&fill_shapes, &depths));
        }
    }

    if groups.is_empty() {
        return Err(empty_engraving_geometry_error(
            has_fill_shapes,
            has_stroke_paths,
            &warnings,
        ));
    }

    translate_toolpaths(
        &mut groups,
        Point::new(engraving.placement_x, engraving.placement_y),
    );
    groups = optimize_operation_groups(groups);

    if let Some((min_x, min_y, max_x, max_y)) = toolpath_bounds(&groups) {
        if min_x < tool_radius
            || min_y < tool_radius
            || max_x > engraving.material_width - tool_radius
            || max_y > engraving.material_height - tool_radius
        {
            warnings.push(GenerationWarning::MaterialBoundsExceeded);
        }
        if min_x < tool_radius
            || min_y < tool_radius
            || max_x > engraving.machine_width - tool_radius
            || max_y > engraving.machine_height - tool_radius
        {
            warnings.push(GenerationWarning::MachineBoundsExceeded);
        }
    }

    Ok((optimize_operation_groups(groups), collect_warnings(warnings)))
}

fn append_engraving_program_header<'input>(
    program: &mut Vec<Token<'input>>,
    machine: &mut Machine<'input>,
) {
    program.append(&mut command!(UnitsMillimeters {}).into_token_vec());
    program.extend(machine.absolute());
    program.extend(machine.program_begin());
    program.extend(machine.absolute());
    program.push(comment_token("Engraving CAM"));
}

fn append_engraving_paths<'input>(
    program: &mut Vec<Token<'input>>,
    machine: &mut Machine<'input>,
    engraving: &EngravingConfig,
    groups: Vec<OperationGroup>,
) {
    let travel_z = machine
        .z_motion()
        .map(|(travel_z, _, _)| travel_z)
        .unwrap_or(2.0);

    for group in groups {
        for path in group.paths {
            if path.points.len() < 2 {
                continue;
            }
            program.extend(machine.tool_off());
            program.extend(machine.absolute());
            program.extend(machine.path_begin());
            program.extend(machine.absolute());
            append_rapid_z(program, travel_z);
            append_rapid_xy(program, path.points[0]);
            program.extend(machine.tool_on());
            program.extend(machine.absolute());
            append_plunge(program, path.depth, engraving.plunge_feedrate);
            for point in path.points.iter().copied().skip(1) {
                append_cut_move(program, point, engraving.cut_feedrate);
            }
        }
    }
}

fn append_engraving_program_footer<'input>(
    program: &mut Vec<Token<'input>>,
    machine: &mut Machine<'input>,
) {
    let travel_z = machine
        .z_motion()
        .map(|(travel_z, _, _)| travel_z)
        .unwrap_or(2.0);
    program.extend(machine.tool_off());
    program.extend(machine.absolute());
    append_rapid_z(program, travel_z);
    program.extend(machine.program_end());
}

pub fn svg2program_engraving<'a, 'input: 'a>(
    doc: &'a Document,
    config: &ConversionConfig,
    options: ConversionOptions,
    machine: Machine<'input>,
    engraving: &EngravingConfig,
) -> Result<(Vec<Token<'input>>, Vec<GenerationWarning>), String> {
    let (groups, warnings) = collect_engraving_groups(doc, config, engraving, options)?;
    if groups.is_empty() {
        return Err("No engravable SVG geometry was found. Add fills and/or strokes.".into());
    }

    let mut machine = machine;
    let mut program = vec![];
    append_engraving_program_header(&mut program, &mut machine);
    append_engraving_paths(&mut program, &mut machine, engraving, groups);
    append_engraving_program_footer(&mut program, &mut machine);

    Ok((program, warnings))
}

pub fn svg2program_engraving_multi<'a, 'input: 'a>(
    doc: &'a Document,
    config: &ConversionConfig,
    options: ConversionOptions,
    machine: Machine<'input>,
    engraving: &EngravingConfig,
    operations: &[EngravingOperation],
) -> Result<(Vec<Token<'input>>, Vec<GenerationWarning>), String> {
    validate_engraving_config(engraving)?;

    let mut machine = machine;
    let mut program = vec![];
    let mut warnings = Vec::new();
    let mut emitted_any_geometry = false;

    append_engraving_program_header(&mut program, &mut machine);

    for operation in operations {
        if operation.selector_filter.trim().is_empty() {
            continue;
        }

        let mut operation_config = config.clone();
        operation_config.selector_filter = Some(operation.selector_filter.clone());

        let mut operation_engraving = engraving.clone();
        operation_engraving.target_depth = operation.target_depth;

        let (groups, operation_warnings) =
            collect_engraving_groups(doc, &operation_config, &operation_engraving, options.clone())?;

        warnings.extend(operation_warnings);
        if groups.is_empty() {
            continue;
        }

        emitted_any_geometry = true;
        program.push(comment_token(format!(
            "operation:start:{}:{}",
            operation.id, operation.name
        )));
        append_engraving_paths(&mut program, &mut machine, &operation_engraving, groups);
        program.push(comment_token(format!("operation:end:{}", operation.id)));
    }

    if !emitted_any_geometry {
        return Err("No engravable SVG geometry was found. Add fills and/or strokes.".into());
    }

    append_engraving_program_footer(&mut program, &mut machine);

    Ok((program, collect_warnings(warnings)))
}
