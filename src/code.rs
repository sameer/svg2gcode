use std::io::{self, Write};

#[derive(Clone, PartialEq, Eq)]
pub enum Direction {
    Clockwise,
    AntiClockwise,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Tool {
    Off,
    On,
}

#[derive(Clone, PartialEq)]
pub enum Distance {
    Absolute,
    Incremental,
}

pub type Program = Vec<GCode>;

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
pub enum GCode {
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
    DistanceMode(Distance),
    Named(Box<String>),
}

pub fn program2gcode<W: Write>(p: &Program, mut w: W) -> io::Result<()> {
    use GCode::*;
    let mut last_feedrate = None;
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

                let f = match (last_feedrate, f) {
                    (None, None) => {
                        return Err(io::Error::new(
                            io::ErrorKind::Other,
                            "Linear interpolation without previously set feedrate",
                        ))
                    }
                    (Some(last), Some(new)) => {
                        if last != new {
                            last_feedrate = Some(new);
                            Some(new)
                        } else {
                            None
                        }
                    }
                    (None, Some(new)) => {
                        last_feedrate = Some(new);
                        Some(new)
                    }
                    (Some(_), None) => None,
                };
                write!(w, "G1")?;
                write_if_some!(w, " X{}", x)?;
                write_if_some!(w, " Y{}", y)?;
                write_if_some!(w, " Z{}", z)?;
                write_if_some!(w, " F{}", f)?;
                writeln!(w)?;
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
                    Direction::AntiClockwise => 4,
                };
                writeln!(w, "M{} S{}", d, s)?;
            }
            StopSpindle => {
                writeln!(w, "M5")?;
            }
            DistanceMode(mode) => {
                writeln!(
                    w,
                    "G{}",
                    match mode {
                        Distance::Absolute => 90,
                        Distance::Incremental => 91,
                    }
                )?;
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
