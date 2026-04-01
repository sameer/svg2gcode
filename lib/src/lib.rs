/// Approximate [Bézier curves](https://en.wikipedia.org/wiki/B%C3%A9zier_curve) with [Circular arcs](https://en.wikipedia.org/wiki/Circular_arc)
mod arc;
/// Converts an SVG to an internal representation
mod converter;
/// CAM-specific engraving configuration and warnings
mod engraving;
/// Emulates the state of an arbitrary machine that can run G-Code
mod machine;
/// Operations that are easier to implement while/after G-Code is generated, or would
/// otherwise over-complicate SVG conversion
mod postprocess;
/// Reorders strokes to minimize pen-up travel using TSP heuristics
mod tsp;
/// Provides an interface for drawing lines in G-Code
/// This concept is referred to as [Turtle graphics](https://en.wikipedia.org/wiki/Turtle_graphics).
mod turtle;

pub use converter::{
    ConversionConfig, ConversionOptions, svg2preview, svg2program, svg2program_engraving,
    svg2program_engraving_multi,
};
pub use engraving::{EngravingConfig, EngravingOperation, FillMode, GenerationWarning, ToolShape};
pub use machine::{Machine, MachineConfig, SupportedFunctionality};
pub use postprocess::PostprocessConfig;
pub use turtle::Turtle;

/// A cross-platform type used to store all configuration types.
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Settings {
    pub conversion: ConversionConfig,
    #[cfg_attr(feature = "serde", serde(default))]
    pub engraving: EngravingConfig,
    pub machine: MachineConfig,
    pub postprocess: PostprocessConfig,
    #[cfg_attr(feature = "serde", serde(default = "Version::unknown"))]
    pub version: Version,
}

impl Settings {
    /// Try to automatically upgrade the supported version.
    ///
    /// This will return an error if:
    ///
    /// - Settings version is [`Version::Unknown`].
    /// - There are breaking changes requiring manual intervention. In which case this does a partial update to that point.
    pub fn try_upgrade(&mut self) -> Result<(), &'static str> {
        loop {
            match self.version {
                // Compatibility for M2 by default
                Version::V0 => {
                    self.machine.end_sequence = Some(format!(
                        "{} M2",
                        self.machine.end_sequence.take().unwrap_or_default()
                    ));
                    self.version = Version::V5;
                }
                Version::V5 => break Ok(()),
                Version::Unknown(_) => break Err("cannot upgrade unknown version"),
            }
        }
    }
}

/// Used to control breaking change behavior for [`Settings`].
///
/// There were already 3 non-breaking version bumps (V1 -> V4) so versioning starts off with [`Version::V5`].
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Version {
    /// Implicitly versioned settings from before this type was introduced.
    V0,
    /// M2 is no longer appended to the program by default
    V5,
    #[cfg_attr(feature = "serde", serde(untagged))]
    Unknown(String),
}

impl Version {
    /// Returns the most recent [`Version`]. This is useful for asking users to upgrade externally-stored settings.
    pub const fn latest() -> Self {
        Self::V5
    }

    /// Default version for old settings.
    pub const fn unknown() -> Self {
        Self::V0
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Version::V0 => f.write_str("V0"),
            Version::V5 => f.write_str("V5"),
            Version::Unknown(unknown) => f.write_str(unknown),
        }
    }
}

impl Default for Version {
    fn default() -> Self {
        Self::latest()
    }
}

#[cfg(test)]
mod test {
    use g_code::emit::{FormatOptions, Token};
    use pretty_assertions::assert_eq;
    use roxmltree::ParsingOptions;
    use svgtypes::{Length, LengthUnit};

    use super::*;

    /// The values change between debug and release builds for circular interpolation,
    /// so only check within a rough tolerance
    const TOLERANCE: f64 = 1E-10;

    fn get_actual(
        input: &str,
        circular_interpolation: bool,
        dimensions: [Option<Length>; 2],
    ) -> Vec<Token<'_>> {
        let config = ConversionConfig::default();
        let options = ConversionOptions { dimensions };
        let document = roxmltree::Document::parse_with_options(
            input,
            ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .unwrap();

        let machine = Machine::new(
            SupportedFunctionality {
                circular_interpolation,
            },
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        converter::svg2program(&document, &config, options, machine)
    }

    fn get_engraving_actual(
        input: &str,
        engraving: EngravingConfig,
    ) -> (Vec<Token<'static>>, Vec<GenerationWarning>) {
        let config = ConversionConfig::default();
        let document = roxmltree::Document::parse_with_options(
            input,
            ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .unwrap();
        let machine = Machine::new(
            SupportedFunctionality {
                circular_interpolation: false,
            },
            Some(5.0),
            Some(-1.0),
            Some(120.0),
            None,
            Some(g_code::parse::snippet_parser("M3 S18000").unwrap()),
            Some(g_code::parse::snippet_parser("M5").unwrap()),
            None,
            None,
        );

        converter::svg2program_engraving(
            &document,
            &config,
            ConversionOptions::default(),
            machine,
            &engraving,
        )
        .unwrap()
    }

    fn format_tokens(tokens: &[Token<'_>]) -> String {
        let mut code = String::new();
        g_code::emit::format_gcode_fmt(tokens.iter(), FormatOptions::default(), &mut code).unwrap();
        code
    }

    fn assert_close(left: Vec<Token<'_>>, right: Vec<Token<'_>>) {
        let mut code = String::new();
        g_code::emit::format_gcode_fmt(left.iter(), FormatOptions::default(), &mut code).unwrap();
        assert_eq!(left.len(), right.len(), "{code}");
        for (i, pair) in left.into_iter().zip(right.into_iter()).enumerate() {
            match pair {
                (Token::Field(l), Token::Field(r)) => {
                    assert_eq!(l.letters, r.letters);
                    if let (Some(l_value), Some(r_value)) = (l.value.as_f64(), r.value.as_f64()) {
                        assert!(
                            (l_value - r_value).abs() < TOLERANCE,
                            "Values differ significantly at {i}: {l} vs {r} ({})",
                            (l_value - r_value).abs()
                        );
                    } else {
                        assert_eq!(l, r);
                    }
                }
                (l, r) => {
                    assert_eq!(l, r, "Differs at {i}");
                }
            }
        }
    }

    #[test]
    fn square_produces_expected_gcode() {
        let expected = g_code::parse::file_parser(include_str!("../tests/square.gcode"))
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();
        let actual = get_actual(include_str!("../tests/square.svg"), false, [None; 2]);

        assert_close(actual, expected);
    }

    #[test]
    fn square_dimension_override_produces_expected_gcode() {
        let side_length = Length {
            number: 10.,
            unit: LengthUnit::Mm,
        };

        let expected = g_code::parse::file_parser(include_str!("../tests/square.gcode"))
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();

        for square in [
            include_str!("../tests/square.svg"),
            include_str!("../tests/square_dimensionless.svg"),
        ] {
            assert_close(
                get_actual(square, false, [Some(side_length); 2]),
                expected.clone(),
            );
            assert_close(
                get_actual(square, false, [Some(side_length), None]),
                expected.clone(),
            );
            assert_close(
                get_actual(square, false, [None, Some(side_length)]),
                expected.clone(),
            );
        }
    }

    #[test]
    fn square_transformed_produces_expected_gcode() {
        let square_transformed = include_str!("../tests/square_transformed.svg");
        let expected =
            g_code::parse::file_parser(include_str!("../tests/square_transformed.gcode"))
                .unwrap()
                .iter_emit_tokens()
                .collect::<Vec<_>>();
        let actual = get_actual(square_transformed, false, [None; 2]);

        assert_close(actual, expected)
    }

    #[test]
    fn square_transformed_nested_produces_expected_gcode() {
        let square_transformed = include_str!("../tests/square_transformed_nested.svg");
        let expected =
            g_code::parse::file_parser(include_str!("../tests/square_transformed_nested.gcode"))
                .unwrap()
                .iter_emit_tokens()
                .collect::<Vec<_>>();
        let actual = get_actual(square_transformed, false, [None; 2]);

        assert_close(actual, expected)
    }

    #[test]
    fn square_viewport_produces_expected_gcode() {
        let square_viewport = include_str!("../tests/square_viewport.svg");
        let expected = g_code::parse::file_parser(include_str!("../tests/square_viewport.gcode"))
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();
        let actual = get_actual(square_viewport, false, [None; 2]);

        assert_close(actual, expected);
    }

    #[test]
    fn circular_interpolation_produces_expected_gcode() {
        let circular_interpolation = include_str!("../tests/circular_interpolation.svg");
        let expected =
            g_code::parse::file_parser(include_str!("../tests/circular_interpolation.gcode"))
                .unwrap()
                .iter_emit_tokens()
                .collect::<Vec<_>>();
        let actual = get_actual(circular_interpolation, true, [None; 2]);

        assert_close(actual, expected)
    }

    #[test]
    fn svg_with_smooth_curves_produces_expected_gcode() {
        let svg = include_str!("../tests/smooth_curves.svg");

        let expected = g_code::parse::file_parser(include_str!("../tests/smooth_curves.gcode"))
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();

        let file = if cfg!(debug) {
            include_str!("../tests/smooth_curves_circular_interpolation.gcode")
        } else {
            include_str!("../tests/smooth_curves_circular_interpolation_release.gcode")
        };
        let expected_circular_interpolation = g_code::parse::file_parser(file)
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();
        assert_close(get_actual(svg, false, [None; 2]), expected);

        assert_close(
            get_actual(svg, true, [None; 2]),
            expected_circular_interpolation,
        );
    }

    #[test]
    fn shapes_produces_expected_gcode() {
        let shapes = include_str!("../tests/shapes.svg");
        let expected = g_code::parse::file_parser(include_str!("../tests/shapes.gcode"))
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();
        let actual = get_actual(shapes, false, [None; 2]);

        assert_close(actual, expected)
    }

    #[test]
    fn use_defs_produces_expected_gcode() {
        let svg = include_str!("../tests/use_defs.svg");
        let expected = g_code::parse::file_parser(include_str!("../tests/use_defs.gcode"))
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();
        let actual = get_actual(svg, false, [None; 2]);

        assert_close(actual, expected)
    }

    #[test]
    fn use_xlink_href_produces_expected_gcode() {
        let svg = include_str!("../tests/use_xlink_href.svg");
        let expected = g_code::parse::file_parser(include_str!("../tests/use_xlink_href.gcode"))
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();
        let actual = get_actual(svg, false, [None; 2]);

        assert_close(actual, expected)
    }

    #[test]
    fn use_symbol_produces_expected_gcode() {
        let svg = include_str!("../tests/use_symbol.svg");
        let expected = g_code::parse::file_parser(include_str!("../tests/use_symbol.gcode"))
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();
        let actual = get_actual(svg, false, [None; 2]);

        assert_close(actual, expected);
    }

    #[test]
    fn transform_origin_produces_expected_gcode() {
        let svg = include_str!("../tests/transform_origin.svg");
        let expected = g_code::parse::file_parser(include_str!("../tests/transform_origin.gcode"))
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();
        let actual = get_actual(svg, false, [None; 2]);
        assert_close(actual, expected)
    }

    /// `transform-origin="5 5"` with `rotate(90)` should be identical to the
    /// manual SVG equivalent `translate(5,5) rotate(90) translate(-5,-5)`
    #[test]
    fn transform_origin_matches_manual_equivalent() {
        let with_origin = get_actual(
            include_str!("../tests/transform_origin.svg"),
            false,
            [None; 2],
        );
        let manual = get_actual(
            include_str!("../tests/transform_origin_equivalent.svg"),
            false,
            [None; 2],
        );
        assert_close(with_origin, manual)
    }

    /// Regression test for https://github.com/sameer/svg2gcode/issues/105
    #[test]
    fn issue_105_optimize_path_order_does_not_shrink_output() {
        let svg = include_str!("../tests/square.svg");
        let document = roxmltree::Document::parse_with_options(
            svg,
            ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .unwrap();
        let machine = Machine::new(
            SupportedFunctionality {
                circular_interpolation: false,
            },
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        let normal = converter::svg2program(
            &document,
            &ConversionConfig::default(),
            ConversionOptions::default(),
            machine.clone(),
        );
        let optimized = converter::svg2program(
            &document,
            &ConversionConfig {
                optimize_path_order: true,
                ..ConversionConfig::default()
            },
            ConversionOptions::default(),
            machine,
        );

        // Collect and sort all numeric coordinate values from each output.
        // Path reordering changes token order but not the set of coordinate values.
        // The bug caused optimized values to be ~0.265x smaller than normal.
        let mut normal_values: Vec<f64> = normal
            .iter()
            .filter_map(|t| {
                if let Token::Field(f) = t {
                    f.value.as_f64()
                } else {
                    None
                }
            })
            .collect();
        let mut optimized_values: Vec<f64> = optimized
            .iter()
            .filter_map(|t| {
                if let Token::Field(f) = t {
                    f.value.as_f64()
                } else {
                    None
                }
            })
            .collect();

        normal_values.sort_by(f64::total_cmp);
        optimized_values.sort_by(f64::total_cmp);
        assert_eq!(normal_values, optimized_values);
    }

    #[test]
    fn path_begin_sequence_is_emitted_before_stroke_motion() {
        let svg = include_str!("../tests/square.svg");
        let document = roxmltree::Document::parse_with_options(
            svg,
            ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .unwrap();
        let machine = Machine::new(
            SupportedFunctionality {
                circular_interpolation: false,
            },
            None,
            None,
            None,
            Some(g_code::parse::snippet_parser("M800").unwrap()),
            None,
            None,
            None,
            None,
        );
        let actual = converter::svg2program(
            &document,
            &ConversionConfig::default(),
            ConversionOptions::default(),
            machine,
        );
        let mut code = String::new();
        g_code::emit::format_gcode_fmt(actual.iter(), FormatOptions::default(), &mut code).unwrap();

        assert!(code.contains("path#path838\nM800\nG0 X1 Y9"), "{code}");
        assert!(code.contains("path#path832\nM800\nG0 X8 Y2.5"), "{code}");
    }

    #[test]
    fn z_motion_retracts_before_rapids_and_plunges_before_cuts() {
        let svg = include_str!("../tests/square.svg");
        let document = roxmltree::Document::parse_with_options(
            svg,
            ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .unwrap();
        let machine = Machine::new(
            SupportedFunctionality {
                circular_interpolation: false,
            },
            Some(5.0),
            Some(-1.0),
            Some(120.0),
            Some(g_code::parse::snippet_parser("M800").unwrap()),
            Some(g_code::parse::snippet_parser("M3 S18000").unwrap()),
            Some(g_code::parse::snippet_parser("M5").unwrap()),
            None,
            Some(g_code::parse::snippet_parser("G28\nM30").unwrap()),
        );
        let actual = converter::svg2program(
            &document,
            &ConversionConfig::default(),
            ConversionOptions::default(),
            machine,
        );
        let mut code = String::new();
        g_code::emit::format_gcode_fmt(actual.iter(), FormatOptions::default(), &mut code).unwrap();

        assert!(
            code.contains(
                "path#path838\nM5\nM800\nG0 Z5\nG0 X1 Y9\nM3 S18000\nG1 Z-1 F120\nG1 X9 Y9 F300"
            ),
            "{code}"
        );
        assert!(
            code.contains("G1 X8 Y2.5 F300\nM5\nG0 Z5\nG28\nM30"),
            "{code}"
        );
    }

    #[test]
    fn engraving_fill_rect_generates_multi_pass_pockets() {
        let svg = r#"
            <svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10">
                <rect x="0" y="0" width="10" height="10" />
            </svg>
        "#;
        let (program, warnings) = get_engraving_actual(
            svg,
            EngravingConfig {
                enabled: true,
                material_width: 20.0,
                material_height: 20.0,
                material_thickness: 10.0,
                tool_diameter: 2.0,
                target_depth: 2.0,
                max_stepdown: 1.0,
                cut_feedrate: 300.0,
                plunge_feedrate: 120.0,
                stepover: 2.0,
                ..EngravingConfig::default()
            },
        );
        let code = format_tokens(&program);

        assert_eq!(warnings, vec![]);
        assert_eq!(code.matches("G1 Z-1 F120").count(), 2, "{code}");
        assert_eq!(code.matches("G1 Z-2 F120").count(), 2, "{code}");
        assert!(!code.contains("\nG2"), "{code}");
        assert!(!code.contains("\nG3"), "{code}");
    }

    #[test]
    fn engraving_circle_and_donut_generate_fill_toolpaths() {
        let circle = r#"
            <svg xmlns="http://www.w3.org/2000/svg" width="12mm" height="12mm" viewBox="0 0 12 12">
                <circle cx="6" cy="6" r="6" />
            </svg>
        "#;
        let donut = r#"
            <svg xmlns="http://www.w3.org/2000/svg" width="12mm" height="12mm" viewBox="0 0 12 12">
                <path fill-rule="evenodd" d="M0 0H12V12H0Z M4 4H8V8H4Z" />
            </svg>
        "#;

        let (circle_program, circle_warnings) = get_engraving_actual(
            circle,
            EngravingConfig {
                enabled: true,
                material_width: 20.0,
                material_height: 20.0,
                tool_diameter: 2.0,
                target_depth: 1.0,
                max_stepdown: 1.0,
                stepover: 2.0,
                ..EngravingConfig::default()
            },
        );
        let (donut_program, donut_warnings) = get_engraving_actual(
            donut,
            EngravingConfig {
                enabled: true,
                material_width: 20.0,
                material_height: 20.0,
                tool_diameter: 2.0,
                target_depth: 1.0,
                max_stepdown: 1.0,
                stepover: 2.0,
                ..EngravingConfig::default()
            },
        );

        let circle_code = format_tokens(&circle_program);
        let donut_code = format_tokens(&donut_program);

        assert_eq!(circle_warnings, vec![]);
        assert_eq!(donut_warnings, vec![]);
        assert!(circle_code.matches("G0 X").count() >= 1, "{circle_code}");
        assert!(donut_code.matches("G0 X").count() >= 2, "{donut_code}");
    }

    #[test]
    fn engraving_fill_contour_mode_traces_boundaries_without_pocket_loops() {
        let svg = r#"
            <svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10">
                <rect x="0" y="0" width="10" height="10" />
            </svg>
        "#;
        let (program, warnings) = get_engraving_actual(
            svg,
            EngravingConfig {
                enabled: true,
                material_width: 20.0,
                material_height: 20.0,
                material_thickness: 10.0,
                tool_diameter: 2.0,
                target_depth: 2.0,
                max_stepdown: 1.0,
                cut_feedrate: 300.0,
                plunge_feedrate: 120.0,
                stepover: 2.0,
                fill_mode: FillMode::Contour,
                ..EngravingConfig::default()
            },
        );
        let code = format_tokens(&program);

        assert_eq!(warnings, vec![]);
        assert_eq!(code.matches("G1 Z-1 F120").count(), 1, "{code}");
        assert_eq!(code.matches("G1 Z-2 F120").count(), 1, "{code}");
        assert_eq!(code.matches("\nG0 X").count(), 2, "{code}");
    }

    #[test]
    fn engraving_warns_when_pocketing_loses_narrow_fill_details() {
        let svg = r#"
            <svg xmlns="http://www.w3.org/2000/svg" width="12mm" height="12mm" viewBox="0 0 12 12">
                <path fill-rule="evenodd" d="M0 0H12V12H0Z M2 2H10V10H2Z" />
            </svg>
        "#;
        let (_program, warnings) = get_engraving_actual(
            svg,
            EngravingConfig {
                enabled: true,
                material_width: 20.0,
                material_height: 20.0,
                tool_diameter: 2.0,
                target_depth: 1.0,
                max_stepdown: 1.0,
                stepover: 2.0,
                ..EngravingConfig::default()
            },
        );

        assert_eq!(warnings, vec![GenerationWarning::FillDetailLoss]);
    }

    #[test]
    fn engraving_reports_when_tool_is_too_large_for_fill_only_svg() {
        let svg = r#"
            <svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10">
                <rect x="0" y="0" width="2" height="2" />
            </svg>
        "#;
        let document = roxmltree::Document::parse_with_options(
            svg,
            ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .unwrap();
        let machine = Machine::new(
            SupportedFunctionality {
                circular_interpolation: false,
            },
            Some(5.0),
            Some(-1.0),
            Some(120.0),
            None,
            None,
            None,
            None,
            None,
        );
        let error = converter::svg2program_engraving(
            &document,
            &ConversionConfig::default(),
            ConversionOptions::default(),
            machine,
            &EngravingConfig {
                enabled: true,
                material_width: 20.0,
                material_height: 20.0,
                tool_diameter: 6.0,
                target_depth: 1.0,
                max_stepdown: 1.0,
                stepover: 2.0,
                ..EngravingConfig::default()
            },
        )
        .unwrap_err();

        assert_eq!(
            error,
            "Filled SVG geometry was found, but the selected tool diameter is too large to fit inside any filled region. Reduce the tool diameter or use stroke engraving."
        );
    }

    #[test]
    fn engraving_strokes_follow_centerline_at_each_depth() {
        let svg = r#"
            <svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10">
                <path d="M1 5 L9 5" fill="none" stroke="black" />
            </svg>
        "#;
        let (program, warnings) = get_engraving_actual(
            svg,
            EngravingConfig {
                enabled: true,
                material_width: 20.0,
                material_height: 20.0,
                tool_diameter: 2.0,
                target_depth: 2.0,
                max_stepdown: 1.0,
                ..EngravingConfig::default()
            },
        );
        let code = format_tokens(&program);

        assert_eq!(warnings, vec![]);
        assert_eq!(code.matches("G1 Z-1 F120").count(), 1, "{code}");
        assert_eq!(code.matches("G1 Z-2 F120").count(), 1, "{code}");
        assert_eq!(code.matches("Y5 F300").count(), 2, "{code}");
        assert!(code.contains("G0 X1 Y5"), "{code}");
    }

    #[test]
    fn engraving_width_override_preserves_aspect_ratio() {
        let svg = r#"
            <svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="20mm" viewBox="0 0 10 20">
                <path d="M0 10 L10 10" fill="none" stroke="black" />
            </svg>
        "#;
        let (program, warnings) = get_engraving_actual(
            svg,
            EngravingConfig {
                enabled: true,
                material_width: 60.0,
                material_height: 60.0,
                machine_width: 60.0,
                machine_height: 60.0,
                tool_diameter: 2.0,
                target_depth: 1.0,
                max_stepdown: 1.0,
                svg_width_override: Some(20.0),
                placement_x: 2.0,
                ..EngravingConfig::default()
            },
        );
        let code = format_tokens(&program);

        assert_eq!(warnings, vec![]);
        assert!(code.contains("G1 X22 Y20 F300"), "{code}");
    }

    #[test]
    fn engraving_applies_stock_offset_and_warns_on_bounds() {
        let svg = r#"
            <svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10">
                <path d="M0 10 L10 10" fill="none" stroke="black" />
            </svg>
        "#;
        let (offset_program, offset_warnings) = get_engraving_actual(
            svg,
            EngravingConfig {
                enabled: true,
                material_width: 30.0,
                material_height: 30.0,
                tool_diameter: 2.0,
                target_depth: 1.0,
                max_stepdown: 1.0,
                placement_x: 3.0,
                placement_y: 4.0,
                ..EngravingConfig::default()
            },
        );
        let offset_code = format_tokens(&offset_program);
        assert_eq!(offset_warnings, vec![]);
        assert!(offset_code.contains("G0 X3 Y4"), "{offset_code}");

        let (_program, warnings) = get_engraving_actual(
            svg,
            EngravingConfig {
                enabled: true,
                material_width: 10.0,
                material_height: 10.0,
                material_thickness: 5.0,
                machine_width: 12.0,
                machine_height: 12.0,
                tool_diameter: 2.0,
                target_depth: 12.0,
                max_stepdown: 1.0,
                placement_x: 3.0,
                placement_y: 4.0,
                ..EngravingConfig::default()
            },
        );
        assert_eq!(
            warnings,
            vec![
                GenerationWarning::MaterialBoundsExceeded,
                GenerationWarning::MachineBoundsExceeded,
                GenerationWarning::DepthExceedsMaterialThickness,
            ]
        );
    }

    #[test]
    fn engraving_multi_operation_emits_one_program_with_operation_markers() {
        let svg = r#"
            <svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 20 10">
                <path id="left" d="M1 5 L9 5" fill="none" stroke="black" />
                <path id="right" d="M11 5 L19 5" fill="none" stroke="black" />
            </svg>
        "#;
        let document = roxmltree::Document::parse_with_options(
            svg,
            ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .unwrap();
        let machine = Machine::new(
            SupportedFunctionality {
                circular_interpolation: false,
            },
            Some(5.0),
            Some(-1.0),
            Some(120.0),
            None,
            Some(g_code::parse::snippet_parser("M3 S18000").unwrap()),
            Some(g_code::parse::snippet_parser("M5").unwrap()),
            Some(g_code::parse::snippet_parser("G17").unwrap()),
            Some(g_code::parse::snippet_parser("M30").unwrap()),
        );
        let engraving = EngravingConfig {
            enabled: true,
            material_width: 40.0,
            material_height: 20.0,
            machine_width: 40.0,
            machine_height: 20.0,
            tool_diameter: 2.0,
            target_depth: 1.0,
            max_stepdown: 1.0,
            ..EngravingConfig::default()
        };
        let operations = vec![
            EngravingOperation {
                id: "left-op".into(),
                name: "Left".into(),
                selector_filter: "#left".into(),
                target_depth: 1.0,
                fill_mode: None,
            },
            EngravingOperation {
                id: "right-op".into(),
                name: "Right".into(),
                selector_filter: "#right".into(),
                target_depth: 2.0,
                fill_mode: None,
            },
        ];

        let (program, warnings) = converter::svg2program_engraving_multi(
            &document,
            &ConversionConfig::default(),
            ConversionOptions::default(),
            machine,
            &engraving,
            &operations,
        )
        .unwrap();
        let code = format_tokens(&program);
        let z1_positions = code
            .match_indices("G1 Z-1 F120")
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        let right_start_positions = code
            .match_indices(";operation:start:right-op:Right")
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        let right_end_positions = code
            .match_indices(";operation:end:right-op")
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        let left_start = code.find(";operation:start:left-op:Left").unwrap();
        let left_end = code.find(";operation:end:left-op").unwrap();
        let z2 = code.find("G1 Z-2 F120").unwrap();

        assert_eq!(warnings, vec![]);
        assert_eq!(code.matches("G21").count(), 1, "{code}");
        assert_eq!(code.matches("G17").count(), 1, "{code}");
        assert_eq!(code.matches("operation:start:left-op:Left").count(), 1, "{code}");
        assert_eq!(code.matches("operation:start:right-op:Right").count(), 2, "{code}");
        assert_eq!(z1_positions.len(), 2, "{code}");
        assert_eq!(right_start_positions.len(), 2, "{code}");
        assert_eq!(right_end_positions.len(), 2, "{code}");
        assert!(left_start < z1_positions[0], "{code}");
        assert!(z1_positions[0] < left_end, "{code}");
        assert!(left_end < right_start_positions[0], "{code}");
        assert!(right_start_positions[0] < z1_positions[1], "{code}");
        assert!(z1_positions[1] < right_end_positions[0], "{code}");
        assert!(right_end_positions[0] < right_start_positions[1], "{code}");
        assert!(right_start_positions[1] < z2, "{code}");
        assert!(z2 < right_end_positions[1], "{code}");
    }

    #[test]
    #[cfg(feature = "serde")]
    fn deserialize_v1_config_succeeds() {
        let json = r#"
        {
            "conversion": {
              "tolerance": 0.002,
              "feedrate": 300.0,
              "dpi": 96.0
            },
            "machine": {
              "supported_functionality": {
                "circular_interpolation": true
              },
              "tool_on_sequence": null,
              "tool_off_sequence": null,
              "begin_sequence": null,
              "end_sequence": null
            },
            "postprocess": {
              "origin": [
                0.0,
                0.0
              ]
            }
          }
        "#;
        serde_json::from_str::<Settings>(json).unwrap();
    }

    #[test]
    #[cfg(feature = "serde")]
    fn deserialize_v2_config_succeeds() {
        let json = r#"
        {
            "conversion": {
              "tolerance": 0.002,
              "feedrate": 300.0,
              "dpi": 96.0
            },
            "machine": {
              "supported_functionality": {
                "circular_interpolation": true
              },
              "tool_on_sequence": null,
              "tool_off_sequence": null,
              "begin_sequence": null,
              "end_sequence": null
            },
            "postprocess": { }
          }
        "#;
        serde_json::from_str::<Settings>(json).unwrap();
    }

    #[test]
    #[cfg(feature = "serde")]
    fn deserialize_v3_config_succeeds() {
        let json = r#"
        {
            "conversion": {
              "tolerance": 0.002,
              "feedrate": 300.0,
              "dpi": 96.0
            },
            "machine": {
              "supported_functionality": {
                "circular_interpolation": true
              },
              "tool_on_sequence": null,
              "tool_off_sequence": null,
              "begin_sequence": null,
              "end_sequence": null
            },
            "postprocess": {
                "checksums": false,
                "line_numbers": false
            }
          }
        "#;
        serde_json::from_str::<Settings>(json).unwrap();
    }

    #[test]
    #[cfg(feature = "serde")]
    fn deserialize_v4_config_succeeds() {
        let json = r#"
        {
            "conversion": {
              "tolerance": 0.002,
              "feedrate": 300.0,
              "dpi": 96.0
            },
            "machine": {
              "supported_functionality": {
                "circular_interpolation": true
              },
              "tool_on_sequence": null,
              "tool_off_sequence": null,
              "begin_sequence": null,
              "end_sequence": null
            },
            "postprocess": {
                "checksums": false,
                "line_numbers": false,
                "newline_before_comment": false
            }
          }
        "#;
        serde_json::from_str::<Settings>(json).unwrap();
    }

    #[test]
    #[cfg(feature = "serde")]
    fn deserialize_v5_config_succeeds() {
        let json = r#"
        {
            "conversion": {
              "tolerance": 0.002,
              "feedrate": 300.0,
              "dpi": 96.0
            },
            "machine": {
              "supported_functionality": {
                "circular_interpolation": true
              },
              "tool_on_sequence": null,
              "tool_off_sequence": null,
              "begin_sequence": null,
              "end_sequence": null
            },
            "postprocess": {
                "checksums": false,
                "line_numbers": false,
                "newline_before_comment": false
            },
            "version": "V5"
          }
        "#;
        serde_json::from_str::<Settings>(json).unwrap();
    }
}
