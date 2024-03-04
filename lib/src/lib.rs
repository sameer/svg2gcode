#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

/// Approximate [Bézier curves](https://en.wikipedia.org/wiki/B%C3%A9zier_curve) with [Circular arcs](https://en.wikipedia.org/wiki/Circular_arc)
mod arc;
/// Converts an SVG to G-Code in an internal representation
mod converter;
/// Emulates the state of an arbitrary machine that can run G-Code
mod machine;
/// Operations that are easier to implement after G-Code is generated, or would
/// otherwise over-complicate SVG conversion
mod postprocess;
/// Provides an interface for drawing lines in G-Code
/// This concept is referred to as [Turtle graphics](https://en.wikipedia.org/wiki/Turtle_graphics).
mod turtle;

pub use converter::{svg2program, ConversionConfig, ConversionOptions};
pub use machine::{Machine, MachineConfig, SupportedFunctionality};
pub use postprocess::PostprocessConfig;
pub use turtle::Turtle;

#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Settings {
    pub conversion: ConversionConfig,
    pub machine: MachineConfig,
    pub postprocess: PostprocessConfig,
}

#[cfg(test)]
mod test {
    use super::*;
    use g_code::emit::Token;
    use pretty_assertions::assert_eq;
    use svgtypes::{Length, LengthUnit};

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
        let document = roxmltree::Document::parse(input).unwrap();

        let machine = Machine::new(
            SupportedFunctionality {
                circular_interpolation,
            },
            None,
            None,
            None,
            None,
        );
        converter::svg2program(&document, &config, options, machine)
    }

    fn assert_close(left: Vec<Token<'_>>, right: Vec<Token<'_>>) {
        assert_eq!(left.len(), right.len());
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

        let expected_circular_interpolation = g_code::parse::file_parser(include_str!(
            "../tests/smooth_curves_circular_interpolation.gcode"
        ))
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
}
