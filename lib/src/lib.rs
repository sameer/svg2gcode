/// Approximate [Bézier curves](https://en.wikipedia.org/wiki/B%C3%A9zier_curve) with [Circular arcs](https://en.wikipedia.org/wiki/Circular_arc)
mod arc;
/// Converts an SVG to "G-Code in an internal representation
mod converter;
/// Emulates the state of an arbitrary machine that can run "G-Code
mod machine;
/// Operations that are easier to implement after "G-Code is generated, or would
/// otherwise over-complicate SVG conversion
mod postprocess;
/// Provides an interface for drawing lines in "G-Code
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
    use pretty_assertions::assert_eq;

    fn get_actual(input: &str, circular_interpolation: bool) -> String {
        let options = ConversionOptions::default();
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
        let actual = get_actual(square, false);

        assert_eq!(actual, include_str!("../tests/square.gcode"))
    }

    #[test]
    fn square_transformed_produces_expected_gcode() {
        let square_transformed = include_str!("../tests/square_transformed.svg");
        let actual = get_actual(square_transformed, false);

        assert_eq!(actual, include_str!("../tests/square_transformed.gcode"))
    }

    #[test]
    fn square_viewport_produces_expected_gcode() {
        let square_transformed = include_str!("../tests/square_viewport.svg");
        let actual = get_actual(square_transformed, false);

        assert_eq!(actual, include_str!("../tests/square_viewport.gcode"))
    }

    #[test]
    fn circular_interpolation_produces_expected_gcode() {
        let circular_interpolation = include_str!("../tests/circular_interpolation.svg");
        let actual = get_actual(circular_interpolation, true);

        assert_eq!(
            actual,
            include_str!("../tests/circular_interpolation.gcode")
        )
    }
}
