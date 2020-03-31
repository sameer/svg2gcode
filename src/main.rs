/// TODO: documentation

#[macro_use]
extern crate clap;
extern crate env_logger;
#[macro_use]
extern crate log;
extern crate lyon_geom;
extern crate regex;
extern crate svgdom;
extern crate uom;

use std::env;
use std::fs::File;
use std::io::{self, Read};

use lyon_geom::{euclid, math};
use svgdom::{AttributeId, AttributeValue, ElementId, ElementType, PathSegment};

#[macro_use]
mod code;
mod machine;
mod turtle;

use code::*;
use machine::*;
use turtle::*;

// TODO: Documentation
fn main() -> io::Result<()> {
    if env::var("RUST_LOG").is_err() {
        env::set_var("RUST_LOG", "svg2gcode=info")
    }
    env_logger::init();
    let matches = clap_app!(svg2gcode =>
        (version: crate_version!())
        (author: crate_authors!())
        (about: crate_description!())
        (@arg FILE: "Selects the input SVG file to use, else reading from stdin")
        (@arg tolerance: --tolerance "Sets the interpolation tolerance for curves")
        (@arg feedrate: --feedrate "Sets the machine feed rate")
        (@arg dpi: --dpi "Sets the DPI for SVGs with units in pt, pc, etc. (default 72.0)")
        (@arg tool_on_action: --tool_on_action "Sets the tool on GCode sequence")
        (@arg tool_off_action: --tool_off_action "Sets the tool off GCode sequence")
    )
    .get_matches();

    let input = match matches.value_of("FILE") {
        Some(filename) => {
            let mut f = File::open(filename)?;
            let len = f.metadata()?.len();
            let mut input = String::with_capacity(len as usize + 1);
            f.read_to_string(&mut input)?;
            input
        }
        None => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            input
        }
    };

    let mut opts = ProgramOptions::default();
    let mut mach = Machine::new(CommandVec::default(), CommandVec::default());

    if let Some(tolerance) = matches.value_of("tolerance").and_then(|x| x.parse().ok()) {
        opts.tolerance = tolerance;
    }
    if let Some(feedrate) = matches.value_of("feedrate").and_then(|x| x.parse().ok()) {
        opts.feedrate = feedrate;
    }
    if let Some(dpi) = matches.value_of("dpi").and_then(|x| x.parse().ok()) {
        opts.dpi = dpi;
    }

    // if let Some(tool_on_action) = matches.value_of("tool_on_action").filter(validate_gcode) {
    //     mach.tool_on_action = vec![GCode::Raw(Box::new(tool_on_action.to_string()))];
    // }
    // if let Some(tool_off_action) = matches.value_of("tool_off_action").filter(validate_gcode) {
    //     mach.tool_off_action = vec![GCode::Raw(Box::new(tool_off_action.to_string()))];
    // }

    let doc = svgdom::Document::from_str(&input).expect("Invalid or unsupported SVG file");

    let prog = svg2program(&doc, opts, mach);
    program2gcode(prog, File::create("out.gcode")?)
}

// TODO: Documentation
struct ProgramOptions {
    tolerance: f64,
    feedrate: f64,
    dpi: f64,
}

// Sets the baseline options for the machine.
impl Default for ProgramOptions {
    fn default() -> Self {
        ProgramOptions {
            tolerance: 0.002, // See https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration#12--arc-tolerance-mm
            feedrate: 3000.0,
            dpi: 72.0,
        }
    }
}

// TODO: Documentation
// TODO: This function is much too large
fn svg2program(doc: &svgdom::Document, opts: ProgramOptions, mach: Machine) -> Vec<Command> {
    let mut p = vec![];
    let mut t = Turtle::new(mach);

    let mut namestack: Vec<String> = vec![];

    p.push(command!(CommandWord::UnitsMillimeters, {}));
    p.append(&mut t.mach.tool_off());
    p.append(&mut
    t.move_to(true, 0.0, 0.0));

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

        let attrs = node.attributes();
        if let (ElementId::Svg, true) = (id, is_start) {
            if let Some(&AttributeValue::ViewBox(vbox)) = attrs.get_value(AttributeId::ViewBox) {
                t.stack_scaling(
                    euclid::Transform2D::create_scale(1. / vbox.w, 1. / vbox.h)
                        .post_translate(math::vector(vbox.x, vbox.y)),
                );
            }
            if let (Some(&AttributeValue::Length(width)), Some(&AttributeValue::Length(height))) = (
                attrs.get_value(AttributeId::Width),
                attrs.get_value(AttributeId::Height),
            ) {
                let width_in_mm = length_to_mm(width, opts.dpi);
                let height_in_mm = length_to_mm(height, opts.dpi);
                t.stack_scaling(
                    euclid::Transform2D::create_scale(width_in_mm, -height_in_mm)
                        .post_translate(math::vector(0.0, height_in_mm)),
                );
            }
        }
        if let ElementId::G = id {
            if is_start {
                namestack.push(format!("{}#{}", node.tag_name(), node.id().to_string()));
            } else {
                namestack.pop();
            }
        }
        if let Some(&AttributeValue::Transform(ref trans)) = attrs.get_value(AttributeId::Transform)
        {
            if is_start {
                t.push_transform(lyon_geom::euclid::Transform2D::row_major(
                    trans.a, trans.b, trans.c, trans.d, trans.e, trans.f,
                ));
            } else {
                t.pop_transform();
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
                    if let Some(&AttributeValue::Path(ref path)) = attrs.get_value(AttributeId::D) {
                        let prefix: String =
                            namestack.iter().fold(String::new(), |mut acc, name| {
                                acc += name;
                                acc += " => ";
                                acc
                            });
                        p.push(command!(
                            CommandWord::Comment(Box::new(prefix + &node.id())),
                            {}
                        ));
                        t.reset();
                        for segment in path.iter() {
                            p.append(&mut match segment {
                                PathSegment::MoveTo { abs, x, y } => t.move_to(*abs, *x, *y),
                                PathSegment::ClosePath { abs } => {
                                    // Ignore abs, should have identical effect: https://www.w3.org/TR/SVG/paths.html#PathDataClosePathCommand
                                    t.close(None, opts.feedrate)
                                }
                                PathSegment::LineTo { abs, x, y } => {
                                    t.line(*abs, *x, *y, None, opts.feedrate)
                                }
                                PathSegment::HorizontalLineTo { abs, x } => {
                                    t.line(*abs, *x, None, None, opts.feedrate)
                                }
                                PathSegment::VerticalLineTo { abs, y } => {
                                    t.line(*abs, None, *y, None, opts.feedrate)
                                }
                                PathSegment::CurveTo {
                                    abs,
                                    x1,
                                    y1,
                                    x2,
                                    y2,
                                    x,
                                    y,
                                } => t.cubic_bezier(
                                    *abs,
                                    *x1,
                                    *y1,
                                    *x2,
                                    *y2,
                                    *x,
                                    *y,
                                    opts.tolerance,
                                    None,
                                    opts.feedrate,
                                ),
                                PathSegment::SmoothCurveTo { abs, x2, y2, x, y } => t
                                    .smooth_cubic_bezier(
                                        *abs,
                                        *x2,
                                        *y2,
                                        *x,
                                        *y,
                                        opts.tolerance,
                                        None,
                                        opts.feedrate,
                                    ),
                                PathSegment::Quadratic { abs, x1, y1, x, y } => t.quadratic_bezier(
                                    *abs,
                                    *x1,
                                    *y1,
                                    *x,
                                    *y,
                                    opts.tolerance,
                                    None,
                                    opts.feedrate,
                                ),
                                PathSegment::SmoothQuadratic { abs, x, y } => t
                                    .smooth_quadratic_bezier(
                                        *abs,
                                        *x,
                                        *y,
                                        opts.tolerance,
                                        None,
                                        opts.feedrate,
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
                                } => t.elliptical(
                                    *abs,
                                    *rx,
                                    *ry,
                                    *x_axis_rotation,
                                    *large_arc,
                                    *sweep,
                                    *x,
                                    *y,
                                    None,
                                    opts.feedrate,
                                    opts.tolerance,
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

    p.append(&mut t.mach.tool_off());
    p.append(&mut t.mach.absolute());
    p.push(command!(CommandWord::RapidPositioning, {
        x: 0.0,
        y: 0.0,
    }));
    p.push(command!(CommandWord::ProgramEnd, {}));

    p
}

// TODO: Documentation
fn length_to_mm(l: svgdom::Length, dpi: f64) -> f64 {
    use svgdom::LengthUnit::*;
    use uom::si::f64::Length;
    use uom::si::length::*;

    let length = match l.unit {
        Cm => Length::new::<centimeter>(l.num),
        Mm => Length::new::<millimeter>(l.num),
        In => Length::new::<inch>(l.num),
        Pt => Length::new::<point_printers>(l.num) * dpi / 72.0, // See https://github.com/iliekturtles/uom/blob/5cad47d4e67c902304c4c2b7feeb9c3d34fdffba/src/si/length.rs#L61
        Pc => Length::new::<pica_printers>(l.num) * dpi / 72.0, // See https://github.com/iliekturtles/uom/blob/5cad47d4e67c902304c4c2b7feeb9c3d34fdffba/src/si/length.rs#L58
        _ => Length::new::<millimeter>(l.num),
    };

    length.get::<millimeter>()
}
