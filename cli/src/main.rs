use g_code::{
    emit::{format_gcode_io, FormatOptions},
    parse::snippet_parser,
};
use log::info;
use std::{
    env,
    fs::File,
    io::{self, Read},
    path::PathBuf,
};
use structopt::StructOpt;

use svg2gcode::{
    set_origin, svg2program, ConversionOptions, Machine, SupportedFunctionality, Turtle,
};

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
    /// Tool on "G-Code sequence
    tool_on_sequence: Option<String>,
    #[structopt(alias = "tool_off_sequence", long = "off")]
    /// Tool off "G-Code sequence
    tool_off_sequence: Option<String>,
    /// Optional "G-Code begin sequence (i.e. change to a cutter tool)
    #[structopt(alias = "begin_sequence", long = "begin")]
    begin_sequence: Option<String>,
    /// Optional "G-Code end sequence, prior to program end (i.e. put away a cutter tool)
    #[structopt(alias = "end_sequence", long = "end")]
    end_sequence: Option<String>,
    /// A file path for an SVG, else reads from stdin
    file: Option<PathBuf>,
    /// Output file path (overwrites old files), else writes to stdout
    #[structopt(short, long)]
    out: Option<PathBuf>,
    /// Set where the bottom left corner of the SVG will be placed. Also affects begin/end and
    /// on/off sequences.
    #[structopt(long, default_value = "0,0")]
    origin: String,
    /// Whether to use circular arcs when generating g-code
    ///
    /// Please check if your machine supports G2/G3 commands before enabling this.
    #[structopt(long)]
    circular_interpolation: bool,
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
            info!("Reading from standard input");
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            input
        }
    };

    let options = ConversionOptions {
        tolerance: opt.tolerance,
        feedrate: opt.feedrate,
        dpi: opt.dpi,
    };

    let snippets = [
        opt.tool_on_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose(),
        opt.tool_off_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose(),
        opt.begin_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose(),
        opt.end_sequence.as_deref().map(snippet_parser).transpose(),
    ];

    let machine = if let [Ok(tool_on_action), Ok(tool_off_action), Ok(program_begin_sequence), Ok(program_end_sequence)] =
        snippets
    {
        Machine::new(
            SupportedFunctionality {
                circular_interpolation: opt.circular_interpolation,
            },
            tool_on_action,
            tool_off_action,
            program_begin_sequence,
            program_end_sequence,
        )
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

    let document = roxmltree::Document::parse(&input).unwrap();

    let mut turtle = Turtle::new(machine);
    let mut program = svg2program(&document, options, &mut turtle);

    let mut origin = [0., 0.];

    for (i, dimension_origin) in opt
        .origin
        .split(',')
        .map(|point| {
            if point.is_empty() {
                Default::default()
            } else {
                point.parse().expect("could not parse coordinate")
            }
        })
        .take(2)
        .enumerate()
    {
        origin[i] = dimension_origin;
    }
    set_origin(&mut program, origin);

    if let Some(out_path) = opt.out {
        format_gcode_io(&program, FormatOptions::default(), File::create(out_path)?)
    } else {
        format_gcode_io(&program, FormatOptions::default(), std::io::stdout())
    }
}
