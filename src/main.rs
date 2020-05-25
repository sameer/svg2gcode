#[macro_use]
extern crate clap;
#[macro_use]
extern crate log;

use std::env;
use std::fs::File;
use std::io::{self, Read};

/// Converts an SVG to GCode in an internal representation
mod converter;
/// Defines an internal GCode representation
#[macro_use]
mod gcode;
/// Emulates the state of an arbitrary machine that can run GCode
mod machine;
/// Operations that are easier to implement after GCode is generated, or would
/// over-complicate SVG conversion
mod postprocess;
/// Provides an interface for drawing lines in GCode
/// This concept is referred to as [Turtle graphics](https://en.wikipedia.org/wiki/Turtle_graphics).
mod turtle;

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
        (@arg origin: --origin +takes_value "Set where the bottom left corner of the SVG will be placed (default: 0,0)")
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

    let options = converter::ProgramOptions {
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

    let machine = machine::Machine::new(
        matches
            .value_of("tool_on_sequence")
            .map(gcode::parse_gcode)
            .unwrap_or_default(),
        matches
            .value_of("tool_off_sequence")
            .map(gcode::parse_gcode)
            .unwrap_or_default(),
        matches
            .value_of("begin_sequence")
            .map(gcode::parse_gcode)
            .unwrap_or_default(),
        matches
            .value_of("end_sequence")
            .map(gcode::parse_gcode)
            .unwrap_or_default(),
    );

    let document = roxmltree::Document::parse(&input).expect("Invalid or unsupported SVG file");

    let mut program = converter::svg2program(&document, options, machine);

    let origin = matches
        .value_of("origin")
        .map(|coords| coords.split(','))
        .map(|coords| coords.map(|point| point.parse().expect("could not parse coordinate")))
        .map(|coords| coords.collect::<Vec<f64>>())
        .map(|coords| (coords[0], coords[1]))
        .unwrap_or((0., 0.));
    postprocess::set_origin(&mut program, lyon_geom::math::point(origin.0, origin.1));

    if let Some(out_path) = matches.value_of("out") {
        gcode::program2gcode(program, File::create(out_path)?)
    } else {
        gcode::program2gcode(program, std::io::stdout())
    }
}
