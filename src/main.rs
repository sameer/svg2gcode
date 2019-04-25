#[macro_use]
extern crate clap;
extern crate env_logger;
extern crate svgdom;
#[macro_use]
extern crate log;
extern crate lyon_geom;

use std::env;
use std::fs::File;
use std::io::{self, Read, Write};

use lyon_geom::math;
use svgdom::{AttributeId, AttributeValue, ElementId, ElementType, FilterSvg, PathSegment};

fn main() -> io::Result<()> {
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

    let mut opts = MachineOptions::default();

    if let Some(tolerance) = matches.value_of("tolerance").and_then(|x| x.parse().ok()) {
        opts.tolerance = tolerance;
    }
    if let Some(feedrate) = matches.value_of("feedrate").and_then(|x| x.parse().ok()) {
        opts.feedrate = feedrate;
    }
    if let Some(dpi) = matches.value_of("dpi").and_then(|x| x.parse().ok()) {
        opts.dpi = dpi;
    }

    let doc = svgdom::Document::from_str(&input).expect("Invalid or unsupported SVG file");

    let prog = svg2program(&doc, opts);
    program2gcode(&prog, File::create("out.gcode")?)
}

struct MachineOptions {
    tolerance: f64,
    feedrate: f64,
    tool_on_action: Vec<MachineCode>,
    tool_off_action: Vec<MachineCode>,
    dpi: f64,
}

impl Default for MachineOptions {
    fn default() -> Self {
        Self {
            tolerance: 0.1,
            feedrate: 3000.0,
            tool_on_action: vec![MachineCode::StopSpindle, MachineCode::Dwell { p: 1.5 }],
            tool_off_action: vec![
                MachineCode::Dwell { p: 0.1 },
                MachineCode::StartSpindle {
                    d: Direction::Clockwise,
                    s: 40.0,
                },
                MachineCode::Dwell { p: 0.2 },
            ],
            dpi: 72.0,
        }
    }
}

fn svg2program(doc: &svgdom::Document, opts: MachineOptions) -> Program {
    let tool = std::cell::Cell::new(Tool::On);
    let tool_on = |p: &mut Program| {
        if tool.get() == Tool::Off {
            opts.tool_on_action
                .iter()
                .map(Clone::clone)
                .for_each(|x| p.push(x));
            tool.set(Tool::On);
        }
    };

    let tool_off = |p: &mut Program| {
        if tool.get() == Tool::On {
            opts.tool_off_action
                .iter()
                .map(Clone::clone)
                .for_each(|x| p.push(x));
            tool.set(Tool::Off);
        }
    };

    let is_absolute = std::cell::Cell::from(true);
    let incremental = |p: &mut Program| {
        if is_absolute.get() {
            p.push(MachineCode::IncrementalDistanceMode);
            is_absolute.set(false);
        }
    };
    let absolute = |p: &mut Program| {
        if !is_absolute.get() {
            p.push(MachineCode::AbsoluteDistanceMode);
            is_absolute.set(true);
        }
    };
    let select_mode = |p: &mut Program, abs: bool| {
        if abs {
            absolute(p);
        } else {
            incremental(p);
        }
    };

    let mut current_transform = lyon_geom::euclid::Transform2D::default();
    let mut transform_stack = vec![];

    let mut p = Program::new();
    p.push(MachineCode::UnitsMillimeters);
    tool_off(&mut p);
    p.push(MachineCode::RapidPositioning {
        x: 0.0.into(),
        y: 0.0.into(),
    });
    tool_on(&mut p);

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
                current_transform = lyon_geom::euclid::Transform2D::create_scale(
                    width_in_mm / width.num,
                    height_in_mm / height.num,
                );
            }
        }
        if let (ElementId::G, true) = (id, is_start) {
            p.push(MachineCode::Named(Box::new(node.id().to_string())));
        }
        if let Some(&AttributeValue::Transform(ref t)) = attrs.get_value(AttributeId::Transform) {
            if is_start {
                transform_stack.push(current_transform);
                current_transform = current_transform.post_mul(
                    &lyon_geom::euclid::Transform2D::row_major(t.a, t.b, t.c, t.d, t.e, t.f),
                );
            } else {
                current_transform = transform_stack.pop().unwrap();
            }
        }
        if node.is_graphic() && is_start {
            match id {
                ElementId::Path => {
                    if let Some(&AttributeValue::Path(ref path)) = attrs.get_value(AttributeId::D) {
                        p.push(MachineCode::Named(Box::new(node.id().to_string())));
                        let mut curpos = math::point(0.0, 0.0);
                        curpos = current_transform.transform_point(&curpos);
                        let mut prev_ctrl = curpos;
                        for segment in path.iter() {
                            match segment {
                                PathSegment::MoveTo { abs, x, y } => {
                                    tool_off(&mut p);
                                    select_mode(&mut p, *abs);
                                    let mut to = math::point(*x, *y);
                                    to = current_transform.transform_point(&to);
                                    if !*abs {
                                        to -= math::vector(current_transform.m31, current_transform.m32);
                                    }
                                    p.push(MachineCode::RapidPositioning {
                                        x: to.x.into(),
                                        y: to.y.into(),
                                    });
                                    if *abs {
                                        curpos = to;
                                    } else {
                                        curpos += to.to_vector();
                                    }
                                    prev_ctrl = curpos;
                                }
                                PathSegment::ClosePath { abs } => {
                                    tool_off(&mut p);
                                }
                                PathSegment::LineTo { abs, x, y } => {
                                    tool_on(&mut p);
                                    select_mode(&mut p, *abs);
                                    let mut to = math::point(*x, *y);
                                    to = current_transform.transform_point(&to);
                                    if !*abs {
                                        to -= math::vector(current_transform.m31, current_transform.m32);
                                    }
                                    p.push(MachineCode::LinearInterpolation {
                                        x: to.x.into(),
                                        y: to.y.into(),
                                        z: None,
                                        f: opts.feedrate.into(),
                                    });
                                    if *abs {
                                        curpos = to;
                                    } else {
                                        curpos += to.to_vector();
                                    }
                                    prev_ctrl = curpos;
                                }
                                PathSegment::HorizontalLineTo { abs, x } => {
                                    tool_on(&mut p);
                                    select_mode(&mut p, *abs);
                                    let mut to = if *abs {
                                        let inv_transform = current_transform
                                            .inverse()
                                            .expect("could not invert transform");
                                        math::point(*x, inv_transform.transform_point(&curpos).y)
                                    } else {
                                        math::point(*x, 0.0)
                                    };
                                    to = current_transform.transform_point(&to);
                                    if !*abs {
                                        to -= math::vector(current_transform.m31, current_transform.m32);
                                    }
                                    p.push(MachineCode::LinearInterpolation {
                                        x: to.x.into(),
                                        y: to.y.into(),
                                        z: None,
                                        f: opts.feedrate.into(),
                                    });
                                    if *abs {
                                        curpos = to;
                                    } else {
                                        curpos += to.to_vector();
                                    }
                                    prev_ctrl = curpos;
                                }
                                PathSegment::VerticalLineTo { abs, y } => {
                                    tool_on(&mut p);
                                    select_mode(&mut p, *abs);
                                    let mut to = if *abs {
                                        let inv_transform = current_transform
                                            .inverse()
                                            .expect("could not invert transform");
                                        math::point(inv_transform.transform_point(&curpos).x, *y)
                                    } else {
                                        math::point(0.0, *y)
                                    };
                                    to = current_transform.transform_point(&to);
                                    if !*abs {
                                        to -= math::vector(current_transform.m31, current_transform.m32);
                                    }
                                    p.push(MachineCode::LinearInterpolation {
                                        x: to.x.into(),
                                        y: to.y.into(),
                                        z: None,
                                        f: opts.feedrate.into(),
                                    });
                                    if *abs {
                                        curpos = to;
                                    } else {
                                        curpos += to.to_vector();
                                    }
                                    prev_ctrl = curpos;
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
                                    tool_on(&mut p);
                                    absolute(&mut p);
                                    let from = curpos;
                                    let mut ctrl1 = math::point(*x1, *y1);
                                    ctrl1 = current_transform.transform_point(&ctrl1);
                                    let mut ctrl2 = math::point(*x2, *y2);
                                    ctrl2 = current_transform.transform_point(&ctrl2);
                                    let mut to = math::point(*x, *y);
                                    to = current_transform.transform_point(&to);
                                    if !*abs {
                                        ctrl1 += curpos.to_vector();
                                        ctrl2 += curpos.to_vector();
                                        to += curpos.to_vector();
                                    }
                                    let cbs = lyon_geom::CubicBezierSegment {
                                        from,
                                        ctrl1,
                                        ctrl2,
                                        to,
                                    };
                                    let last_point = std::cell::Cell::new(curpos);
                                    cbs.flattened(opts.tolerance).for_each(|point| {
                                        p.push(MachineCode::LinearInterpolation {
                                            x: point.x.into(),
                                            y: point.y.into(),
                                            z: None,
                                            f: opts.feedrate.into(),
                                        });
                                        last_point.set(point);
                                    });
                                    curpos = last_point.get();
                                    prev_ctrl = ctrl1;
                                }
                                PathSegment::SmoothCurveTo { abs, x2, y2, x, y } => {
                                    tool_on(&mut p);
                                    absolute(&mut p);
                                    let from = curpos;
                                    let mut ctrl1 = prev_ctrl;
                                    let mut ctrl2 = math::point(*x2, *y2);
                                    ctrl2 = current_transform.transform_point(&ctrl2);
                                    let mut to = math::point(*x, *y);
                                    to = current_transform.transform_point(&to);
                                    if !*abs {
                                        ctrl1 += curpos.to_vector();
                                        ctrl2 += curpos.to_vector();
                                        to += curpos.to_vector();
                                    }
                                    let cbs = lyon_geom::CubicBezierSegment {
                                        from,
                                        ctrl1,
                                        ctrl2,
                                        to,
                                    };
                                    let last_point = std::cell::Cell::new(curpos);
                                    cbs.flattened(opts.tolerance).for_each(|point| {
                                        p.push(MachineCode::LinearInterpolation {
                                            x: point.x.into(),
                                            y: point.y.into(),
                                            z: None,
                                            f: opts.feedrate.into(),
                                        });
                                        last_point.set(point);
                                    });
                                    curpos = last_point.get();
                                    prev_ctrl = ctrl1;
                                }
                                PathSegment::Quadratic { abs, x1, y1, x, y } => {
                                    tool_on(&mut p);
                                    absolute(&mut p);
                                    let from = curpos;
                                    let mut ctrl = math::point(*x1, *y1);
                                    ctrl = current_transform.transform_point(&ctrl);
                                    let mut to = math::point(*x, *y);
                                    to = current_transform.transform_point(&to);
                                    if !*abs {
                                        ctrl += curpos.to_vector();
                                        to += curpos.to_vector();
                                    }
                                    let qbs = lyon_geom::QuadraticBezierSegment { from, ctrl, to };
                                    let last_point = std::cell::Cell::new(curpos);
                                    qbs.flattened(opts.tolerance).for_each(|point| {
                                        p.push(MachineCode::LinearInterpolation {
                                            x: point.x.into(),
                                            y: point.y.into(),
                                            z: None,
                                            f: opts.feedrate.into(),
                                        });
                                        last_point.set(point);
                                    });
                                    curpos = last_point.get();
                                    prev_ctrl = ctrl;
                                }
                                PathSegment::SmoothQuadratic { abs, x, y } => {
                                    tool_on(&mut p);
                                    absolute(&mut p);
                                    let from = curpos;
                                    let mut ctrl = prev_ctrl;
                                    let mut to = math::point(*x, *y);
                                    to = current_transform.transform_point(&to);
                                    if !*abs {
                                        ctrl += curpos.to_vector();
                                        to += curpos.to_vector();
                                    }
                                    let qbs = lyon_geom::QuadraticBezierSegment { from, ctrl, to };
                                    let last_point = std::cell::Cell::new(curpos);
                                    qbs.flattened(opts.tolerance).for_each(|point| {
                                        p.push(MachineCode::LinearInterpolation {
                                            x: point.x.into(),
                                            y: point.y.into(),
                                            z: None,
                                            f: opts.feedrate.into(),
                                        });
                                        last_point.set(point);
                                    });
                                    curpos = last_point.get();
                                    prev_ctrl = ctrl;
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
                                    tool_on(&mut p);
                                    absolute(&mut p);
                                    let from = curpos;
                                    let mut to = math::point(*x, *y);
                                    to = current_transform.transform_point(&to);
                                    if !*abs {
                                        to += curpos.to_vector();
                                    }

                                    let mut radii = math::vector(*rx, *ry);
                                    radii = current_transform.transform_vector(&radii);

                                    let sarc = lyon_geom::SvgArc {
                                        from,
                                        to,
                                        radii,
                                        x_rotation: lyon_geom::euclid::Angle {
                                            radians: *x_axis_rotation,
                                        },
                                        flags: lyon_geom::ArcFlags {
                                            large_arc: *large_arc,
                                            sweep: *sweep,
                                        },
                                    };
                                    let last_point = std::cell::Cell::new(curpos);
                                    sarc.for_each_flattened(
                                        opts.tolerance,
                                        &mut |point: math::F64Point| {
                                            p.push(MachineCode::LinearInterpolation {
                                                x: point.x.into(),
                                                y: point.y.into(),
                                                z: None,
                                                f: opts.feedrate.into(),
                                            });
                                            last_point.set(point);
                                        },
                                    );
                                    curpos = last_point.get();
                                    prev_ctrl = curpos;
                                }
                            }
                        }
                    }
                }
                _ => {
                    info!("{} node with id {} is unsupported", id, node.id());
                }
            }
        }
    }

    tool_off(&mut p);
    p.push(MachineCode::RapidPositioning {
        x: 0.0.into(),
        y: 0.0.into(),
    });
    tool_on(&mut p);
    p.push(MachineCode::ProgramEnd);

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

#[derive(Clone, PartialEq, Eq)]
enum Direction {
    Clockwise,
    Anticlockwise,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Tool {
    Off,
    On,
}

macro_rules! write_if_some {
    ($w:expr, $s:expr, $v:ident) => {
        if let Some(v) = $v {
            write!($w, $s, v)
        } else {
            Ok(())
        }
    };
}

#[derive(Clone, PartialEq)]
enum MachineCode {
    RapidPositioning {
        x: Option<f64>,
        y: Option<f64>,
    },
    LinearInterpolation {
        x: Option<f64>,
        y: Option<f64>,
        z: Option<f64>,
        f: Option<f64>,
    },
    Dwell {
        p: f64,
    },
    UnitsInches,
    UnitsMillimeters,
    ProgramEnd,
    StartSpindle {
        d: Direction,
        s: f64,
    },
    StopSpindle,
    AbsoluteDistanceMode,
    IncrementalDistanceMode,
    Named(Box<String>),
}

type Program = Vec<MachineCode>;

fn program2gcode<W: Write>(p: &Program, mut w: W) -> io::Result<()> {
    use MachineCode::*;
    for code in p.iter() {
        match code {
            RapidPositioning { x, y } => {
                if let (None, None) = (x, y) {
                    continue;
                }
                write!(w, "G0")?;
                write_if_some!(w, " X{}", x)?;
                write_if_some!(w, " Y{}", y)?;
                writeln!(w)?;
            }
            LinearInterpolation { x, y, z, f } => {
                if let (None, None, None, None) = (x, y, z, f) {
                    continue;
                }
                write!(w, "G1")?;
                write_if_some!(w, " X{}", x)?;
                write_if_some!(w, " Y{}", y)?;
                write_if_some!(w, " Z{}", z)?;
                write_if_some!(w, " F{}", f)?;
                writeln!(w, "")?;
            }
            Dwell { p } => {
                writeln!(w, "G4 P{}", p)?;
            }
            UnitsInches => {
                writeln!(w, "G20")?;
            }
            UnitsMillimeters => {
                writeln!(w, "G21")?;
            }
            ProgramEnd => {
                writeln!(w, "M20")?;
            }
            StartSpindle { d, s } => {
                let d = match d {
                    Direction::Clockwise => 3,
                    Direction::Anticlockwise => 4,
                };
                writeln!(w, "M{} S{}", d, s)?;
            }
            StopSpindle => {
                writeln!(w, "M5")?;
            }
            AbsoluteDistanceMode => {
                writeln!(w, "G90")?;
            }
            IncrementalDistanceMode => {
                writeln!(w, "G91")?;
            }
            Named(name) => {
                if name.len() > 0 {
                    writeln!(w, "({})", name)?;
                }
            }
        }
    }
    Ok(())
}
