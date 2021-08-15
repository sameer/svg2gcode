/// Converts an SVG to GCode in an internal representation
mod converter;
/// Emulates the state of an arbitrary machine that can run GCode
mod machine;
/// Operations that are easier to implement after GCode is generated, or would
/// otherwise over-complicate SVG conversion
mod postprocess;
/// Provides an interface for drawing lines in GCode
/// This concept is referred to as [Turtle graphics](https://en.wikipedia.org/wiki/Turtle_graphics).
mod turtle;

pub use converter::{svg2program, ConversionOptions};
pub use machine::Machine;
pub use postprocess::set_origin;
pub use turtle::Turtle;

#[cfg(test)]
mod test {
    use super::*;
    use g_code::emit::{format_gcode_fmt, FormatOptions};
    use pretty_assertions::assert_eq;

    fn get_actual(input: &str) -> String {
        let options = ConversionOptions::default();
        let document = roxmltree::Document::parse(input).unwrap();

        let mut turtle = Turtle::new(Machine::default());
        let mut program = converter::svg2program(&document, options, &mut turtle);
        postprocess::set_origin(&mut program, [0., 0.]);

        let mut acc = String::new();
        format_gcode_fmt(&program, FormatOptions::default(), &mut acc).unwrap();
        acc
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

    #[test]
    fn square_viewport_produces_expected_gcode() {
        let square_transformed = include_str!("../tests/square_viewport.svg");
        let actual = get_actual(square_transformed);

        assert_eq!(actual, include_str!("../tests/square_viewport.gcode"))
    }
}
