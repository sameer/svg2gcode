use std::io;

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

/// Write GCode tokens to a byte sink in a nicely formatted manner
pub fn tokens_into_gcode_bytes<W: std::io::Write>(
    program: &[g_code::emit::Token<'_>],
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
    use pretty_assertions::assert_eq;

    fn get_actual(input: &str) -> String {
        let options = ConversionOptions::default();
        let document = roxmltree::Document::parse(input).unwrap();

        let mut turtle = Turtle::new(Machine::default());
        let mut program = converter::svg2program(&document, options, &mut turtle);
        postprocess::set_origin(&mut program, [0., 0.]);

        let mut actual = vec![];
        assert!(tokens_into_gcode_bytes(&program, &mut actual).is_ok());
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

    #[test]
    fn square_viewport_produces_expected_gcode() {
        let square_transformed = include_str!("../tests/square_viewport.svg");
        let actual = get_actual(square_transformed);

        assert_eq!(actual, include_str!("../tests/square_viewport.gcode"))
    }
}
