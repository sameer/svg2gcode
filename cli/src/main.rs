use g_code::{
    emit::{format_gcode_io, FormatOptions},
    parse::snippet_parser,
};
use log::info;
use std::{
    env,
    fs::File,
    io::{self, Read, Write},
    path::PathBuf,
};
use structopt::StructOpt;
use svgtypes::LengthListParser;

use svg2gcode::{
    set_origin, svg2program, ConversionOptions, Machine, Settings, SupportedFunctionality, Turtle,
};

#[derive(Debug, StructOpt)]
#[structopt(name = "svg2gcode", author, about)]
struct Opt {
    /// Curve interpolation tolerance (mm)
    #[structopt(long)]
    tolerance: Option<f64>,
    /// Machine feed rate (mm/min)
    #[structopt(long)]
    feedrate: Option<f64>,
    /// Dots per Inch (DPI)
    /// Used for scaling visual units (pixels, points, picas, etc.)
    #[structopt(long)]
    dpi: Option<f64>,
    #[structopt(alias = "tool_on_sequence", long = "on")]
    /// G-Code for turning on the tool
    tool_on_sequence: Option<String>,
    #[structopt(alias = "tool_off_sequence", long = "off")]
    /// G-Code for turning off the tool
    tool_off_sequence: Option<String>,
    /// G-Code for initializing the machine at the beginning of the program
    #[structopt(alias = "begin_sequence", long = "begin")]
    begin_sequence: Option<String>,
    /// G-Code for stopping/idling the machine at the end of the program
    #[structopt(alias = "end_sequence", long = "end")]
    end_sequence: Option<String>,
    /// A file path to an SVG, else reads from stdin
    file: Option<PathBuf>,
    /// Output file path (overwrites old files), else writes to stdout
    #[structopt(short, long)]
    out: Option<PathBuf>,
    /// Provide settings from a JSON file. Overrides command-line arguments.
    #[structopt(long)]
    settings: Option<PathBuf>,
    /// Export current settings to a JSON file instead of converting.
    ///
    /// Use `-` to export to standard out.
    #[structopt(long)]
    export: Option<PathBuf>,
    /// Coordinates for the bottom left corner of the machine
    #[structopt(long)]
    origin: Option<String>,
    /// Override the width and height of the SVG (i.e. 210mm,297mm)
    ///
    /// Useful when the SVG does not specify these (see https://github.com/sameer/svg2gcode/pull/16)
    ///
    /// Passing "210mm," or ",297mm" calculates the missing dimension to conform to the viewBox aspect ratio.
    #[structopt(long)]
    dimensions: Option<String>,
    /// Whether to use circular arcs when generating g-code
    ///
    /// Please check if your machine supports G2/G3 commands before enabling this.
    #[structopt(long)]
    circular_interpolation: Option<bool>,
}

fn main() -> io::Result<()> {
    if env::var("RUST_LOG").is_err() {
        env::set_var("RUST_LOG", "svg2gcode=info")
    }
    env_logger::init();

    let opt = Opt::from_args();

    let settings = {
        let mut settings = if let Some(path) = opt.settings {
            serde_json::from_reader(File::open(path)?)?
        } else {
            Settings::default()
        };

        {
            let conversion = &mut settings.conversion;
            conversion.dpi = opt.dpi.unwrap_or(conversion.dpi);
            conversion.feedrate = opt.feedrate.unwrap_or(conversion.feedrate);
            conversion.tolerance = opt.dpi.unwrap_or(conversion.tolerance);
        }
        {
            let machine = &mut settings.machine;
            machine.supported_functionality = SupportedFunctionality {
                circular_interpolation: opt
                    .circular_interpolation
                    .unwrap_or(machine.supported_functionality.circular_interpolation),
            };
            if let Some(sequence) = opt.tool_on_sequence {
                machine.tool_on_sequence.insert(sequence);
            }
            if let Some(sequence) = opt.tool_off_sequence {
                machine.tool_off_sequence.insert(sequence);
            }
            if let Some(sequence) = opt.begin_sequence {
                machine.begin_sequence.insert(sequence);
            }
            if let Some(sequence) = opt.end_sequence {
                machine.end_sequence.insert(sequence);
            }
        }
        {
            let postprocess = &mut settings.postprocess;
            if let Some(origin) = opt.origin {
                for (i, dimension_origin) in origin
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
                    postprocess.origin[i] = dimension_origin;
                }
            }
        }
        settings
    };

    if let Some(export_path) = opt.export {
        let mut config_json_bytes = serde_json::to_vec_pretty(&settings)?;
        if export_path.to_string_lossy() == "-" {
            return io::stdout().write_all(&mut config_json_bytes);
        } else {
            return File::create(export_path)?.write_all(&mut config_json_bytes);
        }
    }

    let options = {
        let mut dimensions = [None, None];

        if let Some(dimensions_str) = opt.dimensions {
            dimensions_str
                .split(',')
                .map(|dimension_str| {
                    if dimension_str.is_empty() {
                        None
                    } else {
                        LengthListParser::from(dimension_str)
                            .next()
                            .transpose()
                            .expect("could not parse dimension")
                    }
                })
                .take(2)
                .enumerate()
                .for_each(|(i, dimension_origin)| {
                    dimensions[i] = dimension_origin;
                });
        }
        ConversionOptions { dimensions }
    };

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

    let snippets = [
        settings
            .machine
            .tool_on_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose(),
        settings
            .machine
            .tool_off_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose(),
        settings
            .machine
            .begin_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose(),
        settings
            .machine
            .end_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose(),
    ];

    let machine = if let [Ok(tool_on_action), Ok(tool_off_action), Ok(program_begin_sequence), Ok(program_end_sequence)] =
        snippets
    {
        Machine::new(
            settings.machine.supported_functionality,
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
            ("tool_on_sequence", &settings.machine.tool_on_sequence),
            ("tool_off_sequence", &settings.machine.tool_off_sequence),
            ("begin_sequence", &settings.machine.begin_sequence),
            ("end_sequence", &settings.machine.end_sequence),
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
    let mut program = svg2program(&document, &settings.conversion, options, &mut turtle);

    set_origin(&mut program, settings.postprocess.origin);

    if let Some(out_path) = opt.out {
        format_gcode_io(&program, FormatOptions::default(), File::create(out_path)?)
    } else {
        format_gcode_io(&program, FormatOptions::default(), std::io::stdout())
    }
}
