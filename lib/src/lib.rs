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

pub use converter::{svg2program, ConversionOptions};
pub use machine::Machine;
pub use machine::SupportedFunctionality;
pub use postprocess::set_origin;
pub use turtle::Turtle;

#[cfg(test)]
mod test {
    use super::*;
    use g_code::emit::{format_gcode_fmt, FormatOptions};
    use svgtypes::{Length, LengthUnit};

    fn get_actual(
        input: &str,
        circular_interpolation: bool,
        dimensions: [Option<Length>; 2],
    ) -> String {
        let options = ConversionOptions {
            dimensions,
            ..Default::default()
        };
        let document = roxmltree::Document::parse(input).unwrap();

        let mut turtle = Turtle::new(Machine::new(
            SupportedFunctionality {
                circular_interpolation,
            },
            None,
            None,
            None,
            None,
        ));
        let mut program = converter::svg2program(&document, options, &mut turtle);
        postprocess::set_origin(&mut program, [0., 0.]);

        let mut acc = String::new();
        format_gcode_fmt(&program, FormatOptions::default(), &mut acc).unwrap();
        acc
    }

    #[test]
    fn square_produces_expected_gcode() {
        let square = include_str!("../tests/square.svg");
        let actual = get_actual(square, false, [None; 2]);

        assert_eq!(actual, include_str!("../tests/square.gcode"))
    }

    #[test]
    fn square_dimension_override_produces_expected_gcode() {
        let side_length = Length {
            number: 10.,
            unit: LengthUnit::Mm,
        };

        for square in [
            include_str!("../tests/square.svg"),
            include_str!("../tests/square_dimensionless.svg"),
        ] {
            assert_eq!(
                get_actual(square, false, [Some(side_length); 2]),
                include_str!("../tests/square.gcode")
            );
            assert_eq!(
                get_actual(square, false, [Some(side_length), None]),
                include_str!("../tests/square.gcode")
            );
            assert_eq!(
                get_actual(square, false, [None, Some(side_length)]),
                include_str!("../tests/square.gcode")
            );
        }
    }

    #[test]
    fn square_transformed_produces_expected_gcode() {
        let square_transformed = include_str!("../tests/square_transformed.svg");
        let actual = get_actual(square_transformed, false, [None; 2]);

        assert_eq!(actual, include_str!("../tests/square_transformed.gcode"))
    }

    #[test]
    fn square_viewport_produces_expected_gcode() {
        let square_transformed = include_str!("../tests/square_viewport.svg");
        let actual = get_actual(square_transformed, false, [None; 2]);

        assert_eq!(actual, include_str!("../tests/square_viewport.gcode"))
    }

    #[test]
    fn circular_interpolation_produces_expected_gcode() {
        let circular_interpolation = include_str!("../tests/circular_interpolation.svg");
        let actual = get_actual(circular_interpolation, true, [None; 2]);

        assert_eq!(
            actual,
            include_str!("../tests/circular_interpolation.gcode")
        )
    }

    #[test]
    fn svg_with_smooth_curves_produces_expected_gcode() {
        let svg = include_str!("../tests/smooth_curves.svg");
        assert_eq!(
            get_actual(svg, false, [None; 2]),
            include_str!("../tests/smooth_curves.gcode")
        );

        assert_eq!(
            get_actual(svg, true, [None; 2]),
            include_str!("../tests/smooth_curves_circular_interpolation.gcode")
        );
    }
}
