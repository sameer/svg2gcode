#[macro_use]
extern crate clap;
extern crate env_logger;
extern crate svgdom;
#[macro_use]
extern crate log;
extern crate lyon_geom;

use std::env;
use std::fs::File;
use std::io::{self, Read};

use lyon_geom::{math, euclid};
use svgdom::{AttributeId, AttributeValue, ElementId, ElementType, PathSegment};

mod code;
mod machine;
mod turtle;

use code::*;
use machine::*;
use turtle::*;

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
        (@arg tolerance: "Sets the interpolation tolerance for curves")
        (@arg feedrate: "Sets the machine feed rate")
        (@arg dpi: "Sets the DPI for SVGs with units in pt, pc, etc.")
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
    let mut mach = Machine::default();

    if let Some(tolerance) = matches.value_of("tolerance").and_then(|x| x.parse().ok()) {
        opts.tolerance = tolerance;
    }
    if let Some(feedrate) = matches.value_of("feedrate").and_then(|x| x.parse().ok()) {
        opts.feedrate = feedrate;
    }
    if let Some(dpi) = matches.value_of("dpi").and_then(|x| x.parse().ok()) {
        opts.dpi = dpi;
    }

    if true {
        mach.tool_on_action = vec![GCode::StopSpindle, GCode::Dwell { p: 1.5 }];
    }
    if true {
        mach.tool_off_action = vec![
            GCode::Dwell { p: 0.1 },
            GCode::StartSpindle {
                d: Direction::Clockwise,
                s: 40.0,
            },
            GCode::Dwell { p: 0.2 },
        ];
    }

    let doc = svgdom::Document::from_str(&input).expect("Invalid or unsupported SVG file");

    let prog = svg2program(&doc, opts, mach);
    program2gcode(&prog, File::create("out.gcode")?)
}

struct ProgramOptions {
    tolerance: f64,
    feedrate: f64,
    dpi: f64,
}

impl Default for ProgramOptions {
    fn default() -> Self {
        ProgramOptions {
            tolerance: 0.001,
            feedrate: 3000.0,
            dpi: 72.0,
        }
    }
}

fn svg2program(doc: &svgdom::Document, opts: ProgramOptions, mach: Machine) -> Program {
    let mut p = Program::new();
    let mut t = Turtle::default();
    t.mach = mach;

    p.push(GCode::UnitsMillimeters);
    p.extend(t.mach.tool_off());
    p.extend(t.move_to(true, 0.0, 0.0));
    p.extend(t.mach.tool_on());

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
            if let (Some(&AttributeValue::Length(width)), Some(&AttributeValue::Length(height))) = (
                attrs.get_value(AttributeId::Width),
                attrs.get_value(AttributeId::Height),
            ) {
                let width_in_mm = length_to_mm(width, opts.dpi);
                let height_in_mm = length_to_mm(height, opts.dpi);
                t.set_scaling(
                    euclid::Transform2D::create_scale(
                        width_in_mm / width.num,
                        height_in_mm / height.num,
                    )
                    .post_translate(math::vector(0.0, height_in_mm)),
                );
            }
        }
        if let (ElementId::G, true) = (id, is_start) {
            p.push(GCode::Named(Box::new(node.id().to_string())));
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
        if node.is_graphic() && is_start {
            match id {
                ElementId::Path => {
                    if let Some(&AttributeValue::Path(ref path)) = attrs.get_value(AttributeId::D) {
                        p.push(GCode::Named(Box::new(node.id().to_string())));
                        t.reset();
                        for segment in path.iter() {
                            match segment {
                                PathSegment::MoveTo { abs, x, y } => {
                                    p.extend(t.move_to(*abs, *x, *y))
                                }
                                PathSegment::ClosePath { abs } => {
                                    // Ignore abs, should have identical effect: https://www.w3.org/TR/SVG/paths.html#PathDataClosePathCommand
                                    p.extend(t.line(true, 0.0, 0.0, None, opts.feedrate))
                                }
                                PathSegment::LineTo { abs, x, y } => {
                                    p.extend(t.line(*abs, *x, *y, None, opts.feedrate));
                                }
                                PathSegment::HorizontalLineTo { abs, x } => {
                                    p.extend(t.line(*abs, *x, None, None, opts.feedrate));
                                }
                                PathSegment::VerticalLineTo { abs, y } => {
                                    p.extend(t.line(*abs, None, *y, None, opts.feedrate));
                                }
                                PathSegment::CurveTo {
                                    abs,
                                    x1,
                                    y1,
                                    x2,
                                    y2,
                                    x,
                                    y,
                                } => {
                                    p.extend(t.cubic_bezier(
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
                                    ));
                                }
                                PathSegment::SmoothCurveTo { abs, x2, y2, x, y } => {
                                    p.extend(t.smooth_cubic_bezier(
                                        *abs,
                                        *x2,
                                        *y2,
                                        *x,
                                        *y,
                                        opts.tolerance,
                                        None,
                                        opts.feedrate,
                                    ));
                                }
                                PathSegment::Quadratic { abs, x1, y1, x, y } => {
                                    p.extend(t.quadratic_bezier(
                                        *abs,
                                        *x1,
                                        *y1,
                                        *x,
                                        *y,
                                        opts.tolerance,
                                        None,
                                        opts.feedrate,
                                    ));
                                }
                                PathSegment::SmoothQuadratic { abs, x, y } => {
                                    p.extend(t.smooth_quadratic_bezier(
                                        *abs,
                                        *x,
                                        *y,
                                        opts.tolerance,
                                        None,
                                        opts.feedrate,
                                    ));
                                }
                                PathSegment::EllipticalArc {
                                    abs,
                                    rx,
                                    ry,
                                    x_axis_rotation,
                                    large_arc,
                                    sweep,
                                    x,
                                    y,
                                } => {
                                    p.extend(t.elliptical(
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
                                    ));
                                }
                            }
                        }
                    }
                }
                _ => {
                    info!("Node <{} id=\"{}\" .../> is not supported", id, node.id());
                }
            }
        }
    }

    p.extend(t.mach.tool_off());
    p.extend(t.mach.absolute());
    p.push(GCode::RapidPositioning {
        x: 0.0.into(),
        y: 0.0.into(),
    });
    p.extend(t.mach.tool_on());
    p.push(GCode::ProgramEnd);

    p
}

fn length_to_mm(l: svgdom::Length, dpi: f64) -> f64 {
    use svgdom::LengthUnit::*;
    let scale = match l.unit {
        Cm => 0.1,
        Mm => 1.0,
        In => 25.4,
        Pt => 25.4 / dpi,
        Pc => 25.4 / (6.0 * (dpi / 72.0)),
        _ => 1.0,
    };

    l.num * scale
}
