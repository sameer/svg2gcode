use ::g_code::emit::{FormatOptions, Token};
use pretty_assertions::assert_eq;
use roxmltree::ParsingOptions;
use svg2star::lower::ConversionConfig;
use svgtypes::{Length, LengthUnit};

use super::*;
use crate::config::SupportedFunctionality;

/// The values change between debug and release builds for circular interpolation,
/// so only check within a rough tolerance
const TOLERANCE: f64 = 1E-10;

fn get_actual(
    input: &str,
    circular_interpolation: bool,
    dimensions: [Option<Length>; 2],
) -> Vec<Token<'_>> {
    let gcode_config = Default::default();
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
    );
    svg_to_gcode(&document, &gcode_config, options, machine)
}

fn assert_close(left: Vec<Token<'_>>, right: Vec<Token<'_>>) {
    let mut code = String::new();
    ::g_code::emit::format_gcode_fmt(left.iter(), FormatOptions::default(), &mut code).unwrap();
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
    let expected = ::g_code::parse::file_parser(include_str!("../tests/square.gcode"))
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

    let expected = ::g_code::parse::file_parser(include_str!("../tests/square.gcode"))
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
    let expected = ::g_code::parse::file_parser(include_str!("../tests/square_transformed.gcode"))
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
        ::g_code::parse::file_parser(include_str!("../tests/square_transformed_nested.gcode"))
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();
    let actual = get_actual(square_transformed, false, [None; 2]);

    assert_close(actual, expected)
}

#[test]
fn square_viewport_produces_expected_gcode() {
    let square_viewport = include_str!("../tests/square_viewport.svg");
    let expected = ::g_code::parse::file_parser(include_str!("../tests/square_viewport.gcode"))
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
        ::g_code::parse::file_parser(include_str!("../tests/circular_interpolation.gcode"))
            .unwrap()
            .iter_emit_tokens()
            .collect::<Vec<_>>();
    let actual = get_actual(circular_interpolation, true, [None; 2]);

    assert_close(actual, expected)
}

#[test]
fn svg_with_smooth_curves_produces_expected_gcode() {
    let svg = include_str!("../tests/smooth_curves.svg");

    let expected = ::g_code::parse::file_parser(include_str!("../tests/smooth_curves.gcode"))
        .unwrap()
        .iter_emit_tokens()
        .collect::<Vec<_>>();

    let file = if cfg!(debug_assertions) {
        include_str!("../tests/smooth_curves_circular_interpolation.gcode")
    } else {
        include_str!("../tests/smooth_curves_circular_interpolation_release.gcode")
    };
    let expected_circular_interpolation = ::g_code::parse::file_parser(file)
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
    let expected = ::g_code::parse::file_parser(include_str!("../tests/shapes.gcode"))
        .unwrap()
        .iter_emit_tokens()
        .collect::<Vec<_>>();
    let actual = get_actual(shapes, false, [None; 2]);

    assert_close(actual, expected)
}

#[test]
fn use_defs_produces_expected_gcode() {
    let svg = include_str!("../tests/use_defs.svg");
    let expected = ::g_code::parse::file_parser(include_str!("../tests/use_defs.gcode"))
        .unwrap()
        .iter_emit_tokens()
        .collect::<Vec<_>>();
    let actual = get_actual(svg, false, [None; 2]);

    assert_close(actual, expected)
}

#[test]
fn use_xlink_href_produces_expected_gcode() {
    let svg = include_str!("../tests/use_xlink_href.svg");
    let expected = ::g_code::parse::file_parser(include_str!("../tests/use_xlink_href.gcode"))
        .unwrap()
        .iter_emit_tokens()
        .collect::<Vec<_>>();
    let actual = get_actual(svg, false, [None; 2]);

    assert_close(actual, expected)
}

#[test]
fn use_symbol_produces_expected_gcode() {
    let svg = include_str!("../tests/use_symbol.svg");
    let expected = ::g_code::parse::file_parser(include_str!("../tests/use_symbol.gcode"))
        .unwrap()
        .iter_emit_tokens()
        .collect::<Vec<_>>();
    let actual = get_actual(svg, false, [None; 2]);

    assert_close(actual, expected);
}

#[test]
fn transform_origin_produces_expected_gcode() {
    let svg = include_str!("../tests/transform_origin.svg");
    let expected = ::g_code::parse::file_parser(include_str!("../tests/transform_origin.gcode"))
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
    );
    let normal = svg_to_gcode(
        &document,
        &Default::default(),
        ConversionOptions::default(),
        machine.clone(),
    );
    let optimized = svg_to_gcode(
        &document,
        &GCodeConfig {
            inner: ConversionConfig {
                optimize_path_order: true,
                ..Default::default()
            },
            ..Default::default()
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
