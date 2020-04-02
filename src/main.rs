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

fn main() -> io::Result<()> {
    if let Err(_) = env::var("RUST_LOG") {
        env::set_var("RUST_LOG", "svg2gcode=info")
    }
    env_logger::init();
    let matches = clap_app!(svg2gcode =>
        (version: crate_version!())
        (author: crate_authors!())
        (about: crate_description!())
        (@arg FILE: "A file path for an SVG, else reads from stdin")
        (@arg tolerance: --tolerance +takes_value "Curve interpolation tolerance (default: 0.002mm)")
        (@arg feedrate: --feedrate +takes_value  "Machine feed rate in mm/min (default: 300mm/min)")
        (@arg dpi: --dpi +takes_value "Dots per inch (DPI) for pixels, points, picas, etc. (default: 96dpi)")
        (@arg tool_on_sequence: --on +takes_value +required "Tool on GCode sequence")
        (@arg tool_off_sequence: --off +takes_value +required "Tool off GCode sequence")
        (@arg begin_sequence: --begin +takes_value "Optional GCode begin sequence (i.e. change to a tool)")
        (@arg end_sequence: --end +takes_value "Optional GCode end sequence, prior to program end (i.e. change to a tool)")
        (@arg out: --out -o +takes_value "Output file path (overwrites old files), else writes to stdout")
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
            info!("Reading from stdin");
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            input
        }
    };

    let opts = ProgramOptions {
        tolerance: matches
            .value_of("tolerance")
            .map(|x| x.parse().expect("could not parse tolerance"))
            .unwrap_or(0.002),
        feedrate: matches
            .value_of("feedrate")
            .map(|x| x.parse().expect("could not parse feedrate"))
            .unwrap_or(300.0),
        dpi: matches
            .value_of("dpi")
            .map(|x| x.parse().expect("could not parse DPI"))
            .unwrap_or(96.0),
    };

    let mach = Machine::new(
        matches.value_of("tool_on_sequence").map(parse_gcode).unwrap_or_default(),
        matches.value_of("tool_off_sequence").map(parse_gcode).unwrap_or_default(),
        matches
            .value_of("begin_sequence")
            .map(parse_gcode)
            .unwrap_or_default(),
        matches.value_of("end_sequence").map(parse_gcode).unwrap_or_default(),
    );

    let doc = svgdom::Document::from_str(&input).expect("Invalid or unsupported SVG file");

    let prog = svg2program(&doc, opts, mach);
    if let Some(out_path) = matches.value_of("out") {
        program2gcode(prog, File::create(out_path)?)
    } else {
        program2gcode(prog, std::io::stdout())
    }
}

/// High-level output options
struct ProgramOptions {
    /// Curve interpolation tolerance in millimeters
    tolerance: f64,
    /// Feedrate in millimeters / minute
    feedrate: f64,
    /// Dots per inch for pixels, picas, points, etc.
    dpi: f64,
}

fn svg2program(doc: &svgdom::Document, opts: ProgramOptions, mach: Machine) -> Vec<Command> {
    let mut t = Turtle::new(mach);

    let mut p = vec![
        command!(CommandWord::UnitsMillimeters, {}),
        command!(CommandWord::FeedRateUnitsPerMinute, {}),
    ];
    let mut namestack: Vec<String> = vec![];
    p.append(&mut t.mach.program_begin());
    p.append(&mut t.mach.absolute());
    p.append(&mut t.move_to(true, 0.0, 0.0));

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
                                PathSegment::ClosePath { abs: _ } => {
                                    // Ignore abs, should have identical effect: [9.3.4. The "closepath" command]("https://www.w3.org/TR/SVG/paths.html#PathDataClosePathCommand)
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
    p.append(&mut t.move_to(true, 0.0, 0.0));
    p.append(&mut t.mach.program_end());
    p.push(command!(CommandWord::ProgramEnd, {}));

    p
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
