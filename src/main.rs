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

    let tolerance = matches
        .value_of("tolerance")
        .and_then(|x| x.parse().ok())
        .unwrap_or(0.1);
    let feedrate = matches
        .value_of("feedrate")
        .and_then(|x| x.parse().ok())
        .unwrap_or(3000.0);

    let doc = svgdom::Document::from_str(&input).expect("Invalid or unsupported SVG file");

    let tool_on_action = vec![MachineCode::StopSpindle, MachineCode::Dwell { p: 1.5 }];
    let tool_off_action = vec![
        MachineCode::Dwell { p: 0.1 },
        MachineCode::StartSpindle {
            d: Direction::Clockwise,
            s: 40.0,
        },
        MachineCode::Dwell { p: 0.2 },
    ];

    let tool = std::cell::Cell::new(Tool::Off);
    let tool_on = |p: &mut Program| {
        if tool.get() == Tool::Off {
            tool_on_action.iter().for_each(|x| {
                p.push(x.clone());
            });
            tool.set(Tool::On);
        }
    };

    let tool_off = |p: &mut Program| {
        if tool.get() == Tool::On {
            tool_off_action.iter().for_each(|x| {
                p.push(x.clone());
            });
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

    let mut p = Program::new();
    p.push(MachineCode::UnitsMillimeters);
    tool_off(&mut p);
    p.push(MachineCode::RapidPositioning {
        x: 0.0.into(),
        y: 0.0.into(),
    });
    tool_on(&mut p);

    for (id, node) in doc.root().descendants().svg() {
        if node.is_graphic() {
            match id {
                ElementId::Path => {
                    let attrs = node.attributes();
                    if let Some(&AttributeValue::Path(ref path)) = attrs.get_value(AttributeId::D) {
                        p.push(MachineCode::Named(Box::new(node.id().to_string())));
                        let mut cx = 0.0;
                        let mut cy = 0.0;
                        for segment in path.iter() {
                            match segment {
                                PathSegment::MoveTo { abs, x, y } => {
                                    tool_off(&mut p);
                                    if *abs {
                                        absolute(&mut p);
                                    } else {
                                        incremental(&mut p);
                                    }
                                    p.push(MachineCode::RapidPositioning {
                                        x: (*x).into(),
                                        y: (*y).into(),
                                    });
                                    if *abs {
                                        cx = *x;
                                        cy = *y;
                                    } else {
                                        cx += *x;
                                        cy += *y;
                                    }
                                }
                                PathSegment::ClosePath { abs } => {
                                    tool_off(&mut p);
                                }
                                PathSegment::LineTo { abs, x, y } => {
                                    tool_on(&mut p);
                                    if *abs {
                                        absolute(&mut p);
                                    } else {
                                        incremental(&mut p);
                                    }
                                    p.push(MachineCode::LinearInterpolation {
                                        x: (*x).into(),
                                        y: (*y).into(),
                                        z: None,
                                        f: feedrate.into(),
                                    });
                                    if *abs {
                                        cx = *x;
                                        cy = *y;
                                    } else {
                                        cx += *x;
                                        cy += *y;
                                    }
                                }
                                PathSegment::HorizontalLineTo { abs, x } => {
                                    tool_on(&mut p);
                                    if *abs {
                                        absolute(&mut p);
                                    } else {
                                        incremental(&mut p);
                                    }
                                    p.push(MachineCode::LinearInterpolation {
                                        x: (*x).into(),
                                        y: None,
                                        z: None,
                                        f: feedrate.into(),
                                    });
                                    if *abs {
                                        cx = *x;
                                    } else {
                                        cx += *x;
                                    }
                                }
                                PathSegment::VerticalLineTo { abs, y } => {
                                    tool_on(&mut p);
                                    if *abs {
                                        absolute(&mut p);
                                    } else {
                                        incremental(&mut p);
                                    }
                                    p.push(MachineCode::LinearInterpolation {
                                        x: None,
                                        y: (*y).into(),
                                        z: None,
                                        f: feedrate.into(),
                                    });
                                    if *abs {
                                        cy = *y;
                                    } else {
                                        cy += *y;
                                    }
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
                                    println!("Curve {:?} starting at ({}, {})", segment, cx, cy);
                                    tool_on(&mut p);
                                    absolute(&mut p);
                                    let from = math::point(cx, cy);
                                    let ctrl1 = if *abs {
                                        math::point(*x1, *y1)
                                    } else {
                                        math::point(cx + *x1, cy + *y1)
                                    };
                                    let ctrl2 = if *abs {
                                        math::point(*x2, *y2)
                                    } else {
                                        math::point(cx + *x2, cy + *y2)
                                    };
                                    let to = if *abs {
                                        math::point(*x, *y)
                                    } else {
                                        math::point(cx + *x, cy + *y)
                                    };
                                    let cbs = lyon_geom::CubicBezierSegment {
                                        from,
                                        ctrl1,
                                        ctrl2,
                                        to,
                                    };
                                    let last_point = std::cell::Cell::new(math::point(cx, cy));
                                    cbs.flattened(tolerance).for_each(|point| {
                                        p.push(MachineCode::LinearInterpolation {
                                            x: point.x.into(),
                                            y: point.y.into(),
                                            z: None,
                                            f: feedrate.into(),
                                        });
                                        last_point.set(point);
                                    });
                                    cx = last_point.get().x;
                                    cy = last_point.get().y;
                                }
                                PathSegment::Quadratic { abs, x1, y1, x, y } => {
                                    tool_on(&mut p);
                                    absolute(&mut p);
                                    let from = math::point(cx, cy);
                                    let ctrl = if *abs {
                                        math::point(*x1, *y1)
                                    } else {
                                        math::point(cx + *x1, cy + *y1)
                                    };
                                    let to = if *abs {
                                        math::point(*x, *y)
                                    } else {
                                        math::point(cx + *x, cy + *y)
                                    };
                                    let qbs = lyon_geom::QuadraticBezierSegment { from, ctrl, to };
                                    let last_point = std::cell::Cell::new(math::point(cx, cy));
                                    qbs.flattened(tolerance).for_each(|point| {
                                        p.push(MachineCode::LinearInterpolation {
                                            x: point.x.into(),
                                            y: point.y.into(),
                                            z: None,
                                            f: feedrate.into(),
                                        });
                                        last_point.set(point);
                                    });
                                    cx = last_point.get().x;
                                    cy = last_point.get().y;
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
                                    let from = math::point(cx, cy);
                                    let to = if *abs {
                                        math::point(*x, *y)
                                    } else {
                                        math::point(cx + *x, cy + *y)
                                    };
                                    let sarc = lyon_geom::SvgArc {
                                        from,
                                        to,
                                        radii: math::vector(*rx, *ry),
                                        x_rotation: lyon_geom::euclid::Angle {
                                            radians: *x_axis_rotation,
                                        },
                                        flags: lyon_geom::ArcFlags {
                                            large_arc: *large_arc,
                                            sweep: *sweep,
                                        },
                                    };
                                    let last_point = std::cell::Cell::new(math::point(cx, cy));
                                    sarc.for_each_flattened(
                                        tolerance,
                                        &mut |point: math::F64Point| {
                                            p.push(MachineCode::LinearInterpolation {
                                                x: point.x.into(),
                                                y: point.y.into(),
                                                z: None,
                                                f: feedrate.into(),
                                            });
                                            last_point.set(point);
                                        },
                                    );
                                    cx = last_point.get().x;
                                    cy = last_point.get().y;
                                }

                                _ => panic!("Unsupported path segment type"),
                            }
                        }
                    }
                }
                _ => {
                    info!("Other {}", node);
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

    program2gcode(p, File::create("out.gcode")?)
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

fn program2gcode<W: Write>(p: Program, mut w: W) -> io::Result<()> {
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
                writeln!(w, "({})", name)?;
            }
        }
    }
    Ok(())
}
