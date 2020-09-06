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

use converter::ProgramOptions;
use machine::Machine;

fn main() -> io::Result<()> {
    if env::var("RUST_LOG").is_err() {
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

    let mut options = ProgramOptions::default();

    if let Some(tolerance) = matches
        .value_of("tolerance")
        .map(|tolerance| tolerance.parse().expect("could not parse tolerance"))
    {
        options.tolerance = tolerance;
    }
    if let Some(feedrate) = matches
        .value_of("feedrate")
        .map(|feedrate| feedrate.parse().expect("could not parse tolerance"))
    {
        options.feedrate = feedrate;
    }
    if let Some(dpi) = matches
        .value_of("dpi")
        .map(|dpi| dpi.parse().expect("could not parse tolerance"))
    {
        options.dpi = dpi;
    }

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

#[cfg(test)]
mod test {
    use super::*;

    fn get_actual(input: &str) -> String {
        let options = ProgramOptions::default();
        let machine = Machine::default();
        let document = roxmltree::Document::parse(input).unwrap();

        let mut program = converter::svg2program(&document, options, machine);
        postprocess::set_origin(&mut program, lyon_geom::math::point(0., 0.));

        let mut actual = vec![];
        assert!(gcode::program2gcode(program, &mut actual).is_ok());
        String::from_utf8(actual).unwrap()
    }

    #[test]
    fn square_produces_expected_gcode() {
        let square = include_str!("../tests/square.svg");
        let actual = get_actual(square);

        assert_eq!(actual, include_str!("../tests/square.gcode"))
    }

    #[test]
    fn square_transformed_produces_expected_gcode() {
        let square_transformed = include_str!("../tests/square_transformed.svg");
        let actual = get_actual(square_transformed);

        assert_eq!(actual, include_str!("../tests/square_transformed.gcode"))
    }
}
