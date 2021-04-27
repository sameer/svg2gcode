#[macro_use]
extern crate log;

use std::env;
use std::fs::File;
use std::io::{self, Read};
use std::path::PathBuf;

use g_code::parse::{ast::Snippet, snippet_parser, ParseError};
use structopt::StructOpt;

/// Converts an SVG to GCode in an internal representation
mod converter;
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
use turtle::Turtle;

#[derive(Debug, StructOpt)]
#[structopt(name = "svg2gcode", author, about)]
struct Opt {
    /// Curve interpolation tolerance
    #[structopt(long, default_value = "0.002")]
    tolerance: f64,
    /// Machine feed rate in mm/min
    #[structopt(long, default_value = "300")]
    feedrate: f64,
    /// Dots per inch (DPI) for pixels, points, picas, etc.
    #[structopt(long, default_value = "96")]
    dpi: f64,
    #[structopt(alias = "tool_on_sequence", long = "on")]
    /// Tool on GCode sequence
    tool_on_sequence: Option<String>,
    #[structopt(alias = "tool_off_sequence", long = "off")]
    /// Tool off GCode sequence
    tool_off_sequence: Option<String>,
    /// Optional GCode begin sequence (i.e. change to a cutter tool)
    #[structopt(alias = "begin_sequence", long = "begin")]
    begin_sequence: Option<String>,
    /// Optional GCode end sequence, prior to program end (i.e. put away a cutter tool)
    #[structopt(alias = "end_sequence", long = "end")]
    end_sequence: Option<String>,
    /// A file path for an SVG, else reads from stdin
    file: Option<PathBuf>,
    /// Output file path (overwrites old files), else writes to stdout
    #[structopt(short, long)]
    out: Option<PathBuf>,
    /// Set where the bottom left corner of the SVG will be placed
    #[structopt(long, default_value = "0,0")]
    origin: String,
}

fn main() -> io::Result<()> {
    if env::var("RUST_LOG").is_err() {
        env::set_var("RUST_LOG", "svg2gcode=info")
    }
    env_logger::init();

    let opt = Opt::from_args();

    let input = match opt.file {
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

    let options = ProgramOptions {
        tolerance: opt.tolerance,
        feedrate: opt.feedrate,
        dpi: opt.dpi,
    };

    let snippets = [
        opt.tool_on_sequence.as_ref().map(parse_snippet).transpose(),
        opt.tool_off_sequence
            .as_ref()
            .map(parse_snippet)
            .transpose(),
        opt.begin_sequence.as_ref().map(parse_snippet).transpose(),
        opt.end_sequence.as_ref().map(parse_snippet).transpose(),
    ];

    let machine = if let [Ok(tool_on_action), Ok(tool_off_action), Ok(program_begin_sequence), Ok(program_end_sequence)] =
        snippets
    {
        Machine {
            tool_on_action,
            tool_off_action,
            program_begin_sequence,
            program_end_sequence,
            tool_state: None,
            distance_mode: None,
        }
    } else {
        use codespan_reporting::term::{
            emit,
            termcolor::{ColorChoice, StandardStream},
        };
        let mut writer = StandardStream::stderr(ColorChoice::Auto);
        let config = codespan_reporting::term::Config::default();

        for (i, (filename, gcode)) in [
            ("tool_on_sequence", &opt.tool_on_sequence),
            ("tool_off_sequence", &opt.tool_off_sequence),
            ("begin_sequence", &opt.begin_sequence),
            ("end_sequence", &opt.end_sequence),
        ]
        .iter()
        .enumerate()
        {
            if let Err(err) = &snippets[i] {
                emit(
                    &mut writer,
                    &config,
                    &codespan_reporting::files::SimpleFile::new(filename, gcode.as_ref().unwrap()),
                    &g_code::parse::into_diagnostic(&err),
                )
                .unwrap();
            }
        }
        std::process::exit(1)
    };

    let document = roxmltree::Document::parse(&input).expect("Invalid or unsupported SVG file");

    let mut turtle = Turtle::new(machine);
    let mut program = converter::svg2program(&document, options, &mut turtle);

    let origin = opt
        .origin
        .split(',')
        .map(|point| point.parse().expect("could not parse coordinate"))
        .collect::<Vec<f64>>();
    postprocess::set_origin(&mut program, lyon_geom::point(origin[0], origin[1]));

    if let Some(out_path) = opt.out {
        tokens_into_gcode(program, File::create(out_path)?)
    } else {
        tokens_into_gcode(program, std::io::stdout())
    }
}

fn parse_snippet(gcode: &'_ String) -> Result<Snippet<'_>, ParseError> {
    snippet_parser(gcode)
}

fn tokens_into_gcode<W: std::io::Write>(
    program: Vec<g_code::emit::Token<'_>>,
    mut w: W,
) -> io::Result<()> {
    use g_code::emit::Token::*;
    let mut preceded_by_newline = true;
    for token in program {
        match token {
            Field(f) => {
                if !preceded_by_newline {
                    if matches!(f.letters.as_ref(), "G" | "M") {
                        writeln!(w)?;
                    } else {
                        write!(w, " ")?;
                    }
                }
                write!(w, "{}", f)?;
                preceded_by_newline = false;
            }
            Comment {
                is_inline: true,
                inner,
            } => {
                write!(w, "({})", inner)?;
                preceded_by_newline = false;
            }
            Comment {
                is_inline: false,
                inner,
            } => {
                writeln!(w, ";{}", inner)?;
                preceded_by_newline = true;
            }
            _ => {}
        }
    }
    // Ensure presence of trailing newline
    if !preceded_by_newline {
        writeln!(w)?;
    }
    Ok(())
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::turtle::Turtle;
    use pretty_assertions::assert_eq;

    fn get_actual(input: &str) -> String {
        let options = ProgramOptions::default();
        let machine = Machine {
            tool_state: None,
            distance_mode: None,
            tool_on_action: None,
            tool_off_action: None,
            program_begin_sequence: None,
            program_end_sequence: None,
        };
        let document = roxmltree::Document::parse(input).unwrap();

        let mut turtle = Turtle::new(machine);
        let mut program = converter::svg2program(&document, options, &mut turtle);
        postprocess::set_origin(&mut program, lyon_geom::point(0., 0.));

        let mut actual = vec![];
        assert!(tokens_into_gcode(program, &mut actual).is_ok());
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
