use euclid::default::Box2D;
use g_code::emit::{
    Field, Token, Value, ABSOLUTE_DISTANCE_MODE_FIELD, RELATIVE_DISTANCE_MODE_FIELD,
};
use lyon_geom::{point, vector, Point};

type F64Point = Point<f64>;

/// Moves all the commands so that they are beyond a specified position
pub fn set_origin(tokens: &mut [Token<'_>], origin: F64Point) {
    let offset = -get_bounding_box(tokens.iter()).min.to_vector() + origin.to_vector();

    let mut is_relative = false;
    let mut current_position = point(0f64, 0f64);
    let x = "X";
    let y = "Y";
    let abs_tok = Token::Field(ABSOLUTE_DISTANCE_MODE_FIELD);
    let rel_tok = Token::Field(RELATIVE_DISTANCE_MODE_FIELD);
    for token in tokens {
        match token {
            abs if *abs == abs_tok => is_relative = false,
            rel if *rel == rel_tok => is_relative = true,
            Token::Field(Field { letters, value }) if *letters == x => {
                if let Some(float) = value.as_f64() {
                    if is_relative {
                        current_position += vector(float, 0.)
                    } else {
                        current_position = point(float, 0.);
                    }
                    *value = Value::Float(current_position.x + offset.x)
                }
            }
            Token::Field(Field { letters, value }) if *letters == y => {
                if let Some(float) = value.as_f64() {
                    if is_relative {
                        current_position += vector(0., float)
                    } else {
                        current_position = point(0., float);
                    }
                    *value = Value::Float(current_position.y + offset.y)
                }
            }
            _ => {}
        }
    }
}

fn get_bounding_box<'a, I: Iterator<Item = &'a Token<'a>>>(tokens: I) -> Box2D<f64> {
    let (mut minimum, mut maximum) = (point(0f64, 0f64), point(0f64, 0f64));
    let mut is_relative = false;
    let mut current_position = point(0f64, 0f64);
    let x = "X";
    let y = "Y";
    let abs_tok = Token::Field(ABSOLUTE_DISTANCE_MODE_FIELD);
    let rel_tok = Token::Field(RELATIVE_DISTANCE_MODE_FIELD);
    for token in tokens {
        match token {
            abs if *abs == abs_tok => is_relative = false,
            rel if *rel == rel_tok => is_relative = true,
            Token::Field(Field { letters, value }) if *letters == x => {
                if let Some(value) = value.as_f64() {
                    if is_relative {
                        current_position += vector(value, 0.)
                    } else {
                        current_position = point(value, 0.);
                    }
                    minimum = minimum.min(current_position);
                    maximum = maximum.max(current_position);
                }
            }
            Token::Field(Field { letters, value }) if *letters == y => {
                if let Some(value) = value.as_f64() {
                    if is_relative {
                        current_position += vector(0., value)
                    } else {
                        current_position = point(0., value);
                    }
                    minimum = minimum.min(current_position);
                    maximum = maximum.max(current_position);
                }
            }
            _ => {}
        }
    }
    Box2D::new(minimum, maximum)
}
