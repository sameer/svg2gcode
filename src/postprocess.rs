use crate::gcode::CommandWord::*;
use crate::gcode::*;
use lyon_geom::math::{point, vector, F64Point};

/// Moves all the commands so that they are beyond a specified position
pub fn set_origin(commands: &mut [Command], origin: F64Point) {
    let offset = -get_bounding_box(commands).0.to_vector() + origin.to_vector();

    let mut is_relative = false;
    let mut current_position = point(0f64, 0f64);

    for command in commands {
        match command.word() {
            RapidPositioning | LinearInterpolation => {
                let x: f64 = (&command.get('X').unwrap().value).into();
                let y: f64 = (&command.get('Y').unwrap().value).into();
                if is_relative {
                    current_position += vector(x, y);
                } else {
                    current_position = point(x, y);
                    command.set('X', Value::Float((current_position + offset).x));
                    command.set('Y', Value::Float((current_position + offset).y));
                }
            }
            AbsoluteDistanceMode => {
                is_relative = false;
            }
            RelativeDistanceMode => {
                is_relative = true;
            }
            _ => {}
        }
    }
}

fn get_bounding_box(commands: &[Command]) -> (F64Point, F64Point) {
    let (mut minimum, mut maximum) = (point(0f64, 0f64), point(0f64, 0f64));
    let mut is_relative = false;
    let mut current_position = point(0f64, 0f64);
    for command in commands {
        match command.word() {
            AbsoluteDistanceMode => {
                is_relative = false;
            }
            RelativeDistanceMode => {
                is_relative = true;
            }
            LinearInterpolation | RapidPositioning => {
                let x: f64 = (&command.get('X').unwrap().value).into();
                let y: f64 = (&command.get('Y').unwrap().value).into();
                if is_relative {
                    current_position += vector(x, y)
                } else {
                    current_position = point(x, y);
                }
                minimum = minimum.min(current_position);
                maximum = maximum.max(current_position);
            }
            _ => (),
        }
    }
    (minimum, maximum)
}
