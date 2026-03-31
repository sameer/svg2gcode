use std::{
    env,
    fs::File,
    io::{self, Read, Write},
    path::PathBuf,
};

use clap::Parser;
use codespan_reporting::term::emit_to_io_write;
use g_code::{
    emit::{FormatOptions, format_gcode_io},
    parse::snippet_parser,
};
use log::{error, info, warn};
use roxmltree::ParsingOptions;
use svg2gcode::{
    ConversionOptions, Machine, Settings, SupportedFunctionality, ToolShape, Version, svg2program,
    svg2program_engraving,
};
use svgtypes::LengthListParser;

#[derive(Debug, Parser)]
#[command(name = "svg2gcode", version, author, about)]
struct Opt {
    /// Curve interpolation tolerance (mm)
    #[arg(long)]
    tolerance: Option<f64>,
    /// Machine feed rate (mm/min)
    #[arg(long)]
    feedrate: Option<f64>,
    /// Dots per Inch (DPI)
    /// Used for scaling visual units (pixels, points, picas, etc.)
    #[arg(long)]
    dpi: Option<f64>,
    #[arg(long)]
    /// Enable engraving CAM mode
    engrave: bool,
    #[arg(long)]
    /// Material width in mm
    material_width: Option<f64>,
    #[arg(long)]
    /// Material height in mm
    material_height: Option<f64>,
    #[arg(long)]
    /// Material thickness in mm
    material_thickness: Option<f64>,
    #[arg(long)]
    /// Flat-end tool diameter in mm
    tool_diameter: Option<f64>,
    #[arg(long)]
    /// Tool shape: flat, ball, or v
    tool_shape: Option<String>,
    #[arg(long)]
    /// Engraving target depth in mm
    target_depth: Option<f64>,
    #[arg(long)]
    /// Maximum depth removed per pass in mm
    max_stepdown: Option<f64>,
    #[arg(long)]
    /// Feedrate used for XY cutting moves in CAM mode (mm/min)
    cut_feedrate: Option<f64>,
    #[arg(long)]
    /// Stepover used for pocketing filled regions in CAM mode (mm)
    stepover: Option<f64>,
    #[arg(long)]
    /// Optional SVG width override in mm, preserving aspect ratio
    svg_width: Option<f64>,
    #[arg(long)]
    /// X offset inside the material from the bottom-left stock origin (mm)
    placement_x: Option<f64>,
    #[arg(long)]
    /// Y offset inside the material from the bottom-left stock origin (mm)
    placement_y: Option<f64>,
    #[arg(long)]
    /// Absolute safe travel height on the Z axis (mm)
    travel_z: Option<f64>,
    #[arg(long)]
    /// Absolute cutting depth on the Z axis (mm)
    cut_z: Option<f64>,
    #[arg(long)]
    /// Feedrate for plunging from travel_z to cut_z (mm/min)
    plunge_feedrate: Option<f64>,
    #[arg(alias = "tool_on_sequence", long = "on")]
    /// G-Code for turning on the tool
    tool_on_sequence: Option<String>,
    #[arg(alias = "path_begin_sequence", long = "path-begin")]
    /// G-Code for inserting at the beginning of each SVG path/stroke
    path_begin_sequence: Option<String>,
    #[arg(alias = "tool_off_sequence", long = "off")]
    /// G-Code for turning off the tool
    tool_off_sequence: Option<String>,
    /// G-Code for initializing the machine at the beginning of the program
    #[arg(alias = "begin_sequence", long = "begin")]
    begin_sequence: Option<String>,
    /// G-Code for stopping/idling the machine at the end of the program
    #[arg(alias = "end_sequence", long = "end")]
    end_sequence: Option<String>,
    /// A file path to an SVG, else reads from stdin
    file: Option<PathBuf>,
    /// Output file path (overwrites old files), else writes to stdout
    #[arg(short, long)]
    out: Option<PathBuf>,
    /// Provide settings from a JSON file. Overrides command-line arguments.
    #[arg(long)]
    settings: Option<PathBuf>,
    /// Export current settings to a JSON file instead of converting.
    ///
    /// Use `-` to export to standard out.
    #[arg(long)]
    export: Option<PathBuf>,
    /// Coordinates for the bottom left corner of the machine
    #[arg(long, allow_hyphen_values = true)]
    origin: Option<String>,
    /// Override the width and height of the SVG (i.e. 210mm,297mm)
    ///
    /// Useful when the SVG does not specify these (see https://github.com/sameer/svg2gcode/pull/16)
    ///
    /// Passing "210mm," or ",297mm" calculates the missing dimension to conform to the viewBox aspect ratio.
    #[arg(long)]
    dimensions: Option<String>,
    /// Whether to use circular arcs when generating g-code
    ///
    /// Please check if your machine supports G2/G3 commands before enabling this.
    #[arg(long)]
    circular_interpolation: Option<bool>,

    #[arg(long)]
    /// Include line numbers at the beginning of each line
    ///
    /// Useful for debugging/streaming g-code
    line_numbers: Option<bool>,
    #[arg(long)]
    /// Include checksums at the end of each line
    ///
    /// Useful for streaming g-code
    checksums: Option<bool>,
    #[arg(long)]
    /// Add a newline character before each comment
    ///
    /// Workaround for parsers that don't accept comments on the same line
    newline_before_comment: Option<bool>,
    #[arg(long)]
    /// When printing a node name , print a extra attribute
    ///
    /// Useful to print the label of layer on SVG generated by Inkscape
    extra_attribute_name: Option<String>,
    #[arg(long)]
    /// Reorder paths to minimize travel time
    optimize_path_order: Option<bool>,
    /// CSS selector to filter which SVG elements are converted.
    ///
    /// Only the `:not`, `:is`, and `:has` pseudo classes are supported.
    ///
    /// <https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Selectors>
    #[arg(long)]
    selector_filter: Option<String>,
}

fn main() -> io::Result<()> {
    if env::var("RUST_LOG").is_err() {
        // SAFETY: calling in a single-threaded context
        unsafe { env::set_var("RUST_LOG", "svg2gcode=info") }
    }
    env_logger::init();

    let opt = Opt::parse();

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
            conversion.tolerance = opt.tolerance.unwrap_or(conversion.tolerance);
        }
        {
            let engraving = &mut settings.engraving;
            if opt.engrave {
                engraving.enabled = true;
            }
            if let Some(material_width) = opt.material_width {
                engraving.material_width = material_width;
            }
            if let Some(material_height) = opt.material_height {
                engraving.material_height = material_height;
            }
            if let Some(material_thickness) = opt.material_thickness {
                engraving.material_thickness = material_thickness;
            }
            if let Some(tool_diameter) = opt.tool_diameter {
                engraving.tool_diameter = tool_diameter;
            }
            if let Some(tool_shape) = opt.tool_shape.as_deref() {
                engraving.tool_shape = tool_shape.parse::<ToolShape>().unwrap_or_else(|msg| {
                    error!("{msg}");
                    std::process::exit(1);
                });
            }
            if let Some(target_depth) = opt.target_depth {
                engraving.target_depth = target_depth;
            }
            if let Some(max_stepdown) = opt.max_stepdown {
                engraving.max_stepdown = max_stepdown;
            }
            if let Some(cut_feedrate) = opt.cut_feedrate {
                engraving.cut_feedrate = cut_feedrate;
            }
            if let Some(stepover) = opt.stepover {
                engraving.stepover = stepover;
            }
            if let Some(svg_width) = opt.svg_width {
                engraving.svg_width_override = Some(svg_width);
            }
            if let Some(placement_x) = opt.placement_x {
                engraving.placement_x = placement_x;
            }
            if let Some(placement_y) = opt.placement_y {
                engraving.placement_y = placement_y;
            }
            if let Some(plunge_feedrate) = opt.plunge_feedrate {
                engraving.plunge_feedrate = plunge_feedrate;
            }
        }
        {
            let machine = &mut settings.machine;
            machine.supported_functionality = SupportedFunctionality {
                circular_interpolation: opt
                    .circular_interpolation
                    .unwrap_or(machine.supported_functionality.circular_interpolation),
            };
            if let Some(travel_z) = opt.travel_z {
                machine.travel_z = Some(travel_z);
            }
            if let Some(cut_z) = opt.cut_z {
                machine.cut_z = Some(cut_z);
            }
            if let Some(plunge_feedrate) = opt.plunge_feedrate {
                machine.plunge_feedrate = Some(plunge_feedrate);
            }
            if let seq @ Some(_) = opt.path_begin_sequence {
                machine.path_begin_sequence = seq;
            }
            if let seq @ Some(_) = opt.tool_on_sequence {
                machine.tool_on_sequence = seq;
            }
            if let seq @ Some(_) = opt.tool_off_sequence {
                machine.tool_off_sequence = seq;
            }
            if let seq @ Some(_) = opt.begin_sequence {
                machine.begin_sequence = seq;
            }
            if let seq @ Some(_) = opt.end_sequence {
                machine.end_sequence = seq;
            }
        }
        {
            if let Some(origin) = opt.origin {
                for (i, dimension_origin) in origin
                    .split(',')
                    .map(|point| {
                        if point.is_empty() {
                            Default::default()
                        } else {
                            point.parse::<f64>().expect("could not parse coordinate")
                        }
                    })
                    .take(2)
                    .enumerate()
                {
                    settings.conversion.origin[i] = Some(dimension_origin);
                }
            }
        }

        if let Some(line_numbers) = opt.line_numbers {
            settings.postprocess.line_numbers = line_numbers;
        }

        if let Some(checksums) = opt.checksums {
            settings.postprocess.checksums = checksums;
        }

        if let Some(newline_before_comment) = opt.newline_before_comment {
            settings.postprocess.newline_before_comment = newline_before_comment;
        }

        settings.conversion.extra_attribute_name = opt.extra_attribute_name;
        if let Some(optimize_path_order) = opt.optimize_path_order {
            settings.conversion.optimize_path_order = optimize_path_order;
        }
        if let Some(selector_filter) = opt.selector_filter {
            settings.conversion.selector_filter = Some(selector_filter);
        }

        if let Version::Unknown(ref unknown) = settings.version {
            error!(
                "Your settings use an unknown version. Your version: {unknown}, latest: {}. See {} to download the latest CLI version.",
                Version::latest(),
                env!("CARGO_PKG_REPOSITORY"),
            );
            std::process::exit(1);
        }

        let old_version = settings.version.clone();
        if let Err(msg) = settings.try_upgrade() {
            error!(
                "Your settings are out of date and require manual intervention: {msg}. Your version: {old_version}, latest: {}. See {} for instructions.",
                Version::latest(),
                env!("CARGO_PKG_REPOSITORY"),
            );
            std::process::exit(1);
        }

        settings
    };

    if settings.machine.travel_z.is_some() != settings.machine.cut_z.is_some() {
        error!("Z motion requires both --travel-z and --cut-z (or both fields in settings).");
        std::process::exit(1);
    }

    if let Some(export_path) = opt.export {
        let config_json_bytes = serde_json::to_vec_pretty(&settings)?;
        if export_path.to_string_lossy() == "-" {
            return io::stdout().write_all(&config_json_bytes);
        } else {
            return File::create(export_path)?.write_all(&config_json_bytes);
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
            .path_begin_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose(),
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

    let machine = if let [
        Ok(path_begin_sequence),
        Ok(tool_on_action),
        Ok(tool_off_action),
        Ok(program_begin_sequence),
        Ok(program_end_sequence),
    ] = snippets
    {
        Machine::new(
            settings.machine.supported_functionality,
            settings.machine.travel_z,
            settings.machine.cut_z,
            settings.machine.plunge_feedrate,
            path_begin_sequence,
            tool_on_action,
            tool_off_action,
            program_begin_sequence,
            program_end_sequence,
        )
    } else {
        use codespan_reporting::term::termcolor::{ColorChoice, StandardStream};
        let mut writer = StandardStream::stderr(ColorChoice::Auto);
        let config = codespan_reporting::term::Config::default();

        for (i, (filename, gcode)) in [
            ("path_begin_sequence", &settings.machine.path_begin_sequence),
            ("tool_on_sequence", &settings.machine.tool_on_sequence),
            ("tool_off_sequence", &settings.machine.tool_off_sequence),
            ("begin_sequence", &settings.machine.begin_sequence),
            ("end_sequence", &settings.machine.end_sequence),
        ]
        .iter()
        .enumerate()
        {
            if let Err(err) = &snippets[i] {
                emit_to_io_write(
                    &mut writer,
                    &config,
                    &codespan_reporting::files::SimpleFile::new(filename, gcode.as_ref().unwrap()),
                    &g_code::parse::into_diagnostic(err),
                )
                .unwrap();
            }
        }
        std::process::exit(1)
    };

    let document = roxmltree::Document::parse_with_options(
        &input,
        ParsingOptions {
            allow_dtd: true,
            ..Default::default()
        },
    )
    .unwrap();

    let program = if settings.engraving.enabled {
        let (program, warnings) = svg2program_engraving(
            &document,
            &settings.conversion,
            options,
            machine,
            &settings.engraving,
        )
        .unwrap_or_else(|msg| {
            error!("{msg}");
            std::process::exit(1);
        });
        for warning in warnings {
            warn!("{}", warning.message());
        }
        program
    } else {
        svg2program(&document, &settings.conversion, options, machine)
    };

    if let Some(out_path) = opt.out {
        format_gcode_io(
            &program,
            FormatOptions {
                line_numbers: settings.postprocess.line_numbers,
                checksums: settings.postprocess.checksums,
                ..Default::default()
            },
            File::create(out_path)?,
        )
    } else {
        format_gcode_io(
            &program,
            FormatOptions {
                line_numbers: settings.postprocess.line_numbers,
                checksums: settings.postprocess.checksums,
                newline_before_comment: settings.postprocess.newline_before_comment,
                ..Default::default()
            },
            std::io::stdout(),
        )
    }
}
