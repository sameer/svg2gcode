use lyon_geom::{euclid, math};
use svgdom::{AttributeId, AttributeValue, ElementId, ElementType, PathSegment};

#[macro_use]
use crate::*;
use crate::gcode::*;
use crate::machine::*;
use crate::turtle::*;

/// High-level output options
#[derive(Debug)]
pub struct ProgramOptions {
    /// Curve interpolation tolerance in millimeters
    pub tolerance: f64,
    /// Feedrate in millimeters / minute
    pub feedrate: f64,
    /// Dots per inch for pixels, picas, points, etc.
    pub dpi: f64,
}

pub fn svg2program(doc: &svgdom::Document, options: ProgramOptions, mach: Machine) -> Vec<Command> {
    let mut turtle = Turtle::new(mach);

    let mut program = vec![
        command!(CommandWord::UnitsMillimeters, {}),
        command!(CommandWord::FeedRateUnitsPerMinute, {}),
    ];
    program.append(&mut turtle.machine.program_begin());
    program.append(&mut turtle.machine.absolute());
    program.append(&mut turtle.move_to(true, 0.0, 0.0));

    let mut name_stack: Vec<String> = vec![];

    for edge in doc.root().traverse() {
        let (node, is_start) = match edge {
            svgdom::NodeEdge::Start(node) => (node, true),
            svgdom::NodeEdge::End(node) => (node, false),
        };

        let id = if let svgdom::QName::Id(id) = *node.tag_name() {
            id
        } else {
            continue;
        };

        let attributes = node.attributes();
        if let (ElementId::Svg, true) = (id, is_start) {
            if let Some(&AttributeValue::ViewBox(view_box)) =
                attributes.get_value(AttributeId::ViewBox)
            {
                turtle.stack_scaling(
                    euclid::Transform2D::create_scale(1. / view_box.w, 1. / view_box.h)
                        .post_translate(math::vector(view_box.x, view_box.y)),
                );
            }
            if let (Some(&AttributeValue::Length(width)), Some(&AttributeValue::Length(height))) = (
                attributes.get_value(AttributeId::Width),
                attributes.get_value(AttributeId::Height),
            ) {
                let width_in_mm = length_to_mm(width, options.dpi);
                let height_in_mm = length_to_mm(height, options.dpi);
                turtle.stack_scaling(
                    euclid::Transform2D::create_scale(width_in_mm, -height_in_mm)
                        .post_translate(math::vector(0.0, height_in_mm)),
                );
            }
        }
        // Display named elements in GCode comments
        if let ElementId::G = id {
            if is_start {
                name_stack.push(format!("{}#{}", node.tag_name(), node.id().to_string()));
            } else {
                name_stack.pop();
            }
        }
        if let Some(&AttributeValue::Transform(ref transform)) =
            attributes.get_value(AttributeId::Transform)
        {
            if is_start {
                turtle.push_transform(lyon_geom::euclid::Transform2D::row_major(
                    transform.a,
                    transform.b,
                    transform.c,
                    transform.d,
                    transform.e,
                    transform.f,
                ));
            } else {
                turtle.pop_transform();
            }
        }

        let is_clip_path = node.ancestors().any(|ancestor| {
            if let svgdom::QName::Id(ancestor_id) = *ancestor.tag_name() {
                ancestor_id == ElementId::ClipPath
            } else {
                false
            }
        });

        if node.is_graphic() && is_start && !is_clip_path {
            match id {
                ElementId::Path => {
                    if let Some(&AttributeValue::Path(ref path)) =
                        attributes.get_value(AttributeId::D)
                    {
                        let prefix: String =
                            name_stack.iter().fold(String::new(), |mut acc, name| {
                                acc += name;
                                acc += " => ";
                                acc
                            });
                        program.push(command!(
                            CommandWord::Comment(Box::new(prefix + &node.id())),
                            {}
                        ));
                        turtle.reset();
                        for segment in path.iter() {
                            program.append(&mut match segment {
                                PathSegment::MoveTo { abs, x, y } => turtle.move_to(*abs, *x, *y),
                                PathSegment::ClosePath { abs: _ } => {
                                    // Ignore abs, should have identical effect: [9.3.4. The "closepath" command]("https://www.w3.org/TR/SVG/paths.html#PathDataClosePathCommand)
                                    turtle.close(None, options.feedrate)
                                }
                                PathSegment::LineTo { abs, x, y } => {
                                    turtle.line(*abs, *x, *y, None, options.feedrate)
                                }
                                PathSegment::HorizontalLineTo { abs, x } => {
                                    turtle.line(*abs, *x, None, None, options.feedrate)
                                }
                                PathSegment::VerticalLineTo { abs, y } => {
                                    turtle.line(*abs, None, *y, None, options.feedrate)
                                }
                                PathSegment::CurveTo {
                                    abs,
                                    x1,
                                    y1,
                                    x2,
                                    y2,
                                    x,
                                    y,
                                } => turtle.cubic_bezier(
                                    *abs,
                                    *x1,
                                    *y1,
                                    *x2,
                                    *y2,
                                    *x,
                                    *y,
                                    options.tolerance,
                                    None,
                                    options.feedrate,
                                ),
                                PathSegment::SmoothCurveTo { abs, x2, y2, x, y } => turtle
                                    .smooth_cubic_bezier(
                                        *abs,
                                        *x2,
                                        *y2,
                                        *x,
                                        *y,
                                        options.tolerance,
                                        None,
                                        options.feedrate,
                                    ),
                                PathSegment::Quadratic { abs, x1, y1, x, y } => turtle
                                    .quadratic_bezier(
                                        *abs,
                                        *x1,
                                        *y1,
                                        *x,
                                        *y,
                                        options.tolerance,
                                        None,
                                        options.feedrate,
                                    ),
                                PathSegment::SmoothQuadratic { abs, x, y } => turtle
                                    .smooth_quadratic_bezier(
                                        *abs,
                                        *x,
                                        *y,
                                        options.tolerance,
                                        None,
                                        options.feedrate,
                                    ),
                                PathSegment::EllipticalArc {
                                    abs,
                                    rx,
                                    ry,
                                    x_axis_rotation,
                                    large_arc,
                                    sweep,
                                    x,
                                    y,
                                } => turtle.elliptical(
                                    *abs,
                                    *rx,
                                    *ry,
                                    *x_axis_rotation,
                                    *large_arc,
                                    *sweep,
                                    *x,
                                    *y,
                                    None,
                                    options.feedrate,
                                    options.tolerance,
                                ),
                            });
                        }
                    }
                }
                _ => {
                    warn!("Node <{} id=\"{}\" .../> is not supported", id, node.id());
                }
            }
        }
    }
    // Critical step for actually move the machine back to the origin
    turtle.pop_all_transforms();
    program.append(&mut turtle.machine.tool_off());
    program.append(&mut turtle.machine.absolute());
    program.append(&mut turtle.move_to(true, 0.0, 0.0));
    program.append(&mut turtle.machine.program_end());
    program.push(command!(CommandWord::ProgramEnd, {}));

    program
}

/// Convenience function for converting absolute lengths to millimeters
/// Absolute lengths are listed in [CSS 4 §6.2](https://www.w3.org/TR/css-values/#absolute-lengths)
/// Relative lengths in [CSS 4 §6.1](https://www.w3.org/TR/css-values/#relative-lengths) are not supported and will cause a panic.
/// A default DPI of 96 is used as per [CSS 4 §7.4](https://www.w3.org/TR/css-values/#resolution), which you can adjust with --dpi
fn length_to_mm(l: svgdom::Length, dpi: f64) -> f64 {
    use svgdom::LengthUnit::*;
    use uom::si::f64::Length;
    use uom::si::length::*;

    let length = match l.unit {
        Cm => Length::new::<centimeter>(l.num),
        Mm => Length::new::<millimeter>(l.num),
        In => Length::new::<inch>(l.num),
        Pc => Length::new::<pica_computer>(l.num) * dpi / 96.0,
        Pt => Length::new::<point_computer>(l.num) * dpi / 96.0,
        Px => Length::new::<inch>(l.num * dpi / 96.0),
        other => {
            warn!(
                "Converting from '{:?}' to millimeters is not supported, treating as millimeters",
                other
            );
            Length::new::<millimeter>(l.num)
        }
    };

    length.get::<millimeter>()
}
