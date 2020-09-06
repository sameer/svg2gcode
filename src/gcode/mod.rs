use core::convert::TryFrom;
use std::io::{self, Write};

#[macro_use]
mod spec;
pub use spec::*;

/// Collapses GCode words into higher-level commands
pub struct CommandVecIntoIterator {
    vec: Vec<Word>,
    index: usize,
}

impl Iterator for CommandVecIntoIterator {
    type Item = Command;
    fn next(&mut self) -> Option<Self::Item> {
        if self.vec.len() <= self.index {
            return None;
        }
        let mut i = self.index + 1;
        while i < self.vec.len() {
            if CommandWord::is_command(&self.vec[i]) {
                break;
            }
            i += 1;
        }
        let command = Command::try_from(&self.vec[self.index..i]).ok();
        self.index = i;
        command
    }
}

impl From<Vec<Word>> for CommandVecIntoIterator {
    fn from(vec: Vec<Word>) -> Self {
        Self { vec, index: 0 }
    }
}

pub fn parse_gcode(gcode: &str) -> Vec<Word> {
    let mut vec = vec![];
    let mut in_string = false;
    let mut letter: Option<char> = None;
    let mut value_range = 0..0;
    gcode.char_indices().for_each(|(i, c)| {
        if (c.is_alphabetic() || c.is_ascii_whitespace()) && !in_string {
            if let Some(l) = letter {
                vec.push(Word {
                    letter: l,
                    value: parse_value(&gcode[value_range.clone()]),
                });
                letter = None;
            }
            if c.is_alphabetic() {
                letter = Some(c);
            }
            value_range = (i + 1)..(i + 1);
        } else if in_string {
            value_range = value_range.start..(i + 1);
        } else {
            if c == '"' {
                in_string = !in_string;
            }
            value_range = value_range.start..(i + 1);
        }
    });
    if let Some(l) = letter {
        vec.push(Word {
            letter: l,
            value: parse_value(&gcode[value_range]),
        });
    }
    vec
}

fn parse_value(word: &str) -> Value {
    if word.starts_with('"') && word.ends_with('"') {
        Value::String(Box::new(word.to_string()))
    } else {
        let index_of_dot = word.find('.');
        Value::Fractional(
            word[..index_of_dot.unwrap_or_else(|| word.len())]
                .parse::<u32>()
                .unwrap(),
            index_of_dot.map(|j| word[j + 1..].parse::<u32>().unwrap()),
        )
    }
}

/// Writes a GCode program or sequence to a Writer
/// Each command is placed on a separate line
pub fn program2gcode<W: Write>(program: Vec<Command>, mut w: W) -> io::Result<()> {
    for command in program.into_iter() {
        let words: Vec<Word> = command.into();
        let mut it = words.iter();
        if let Some(command_word) = it.next() {
            write!(w, "{}{}", command_word.letter, command_word.value)?;
            for (i, word) in it.enumerate() {
                write!(w, " {}{}", word.letter, word.value)?;
                if i != words.len() - 2 {
                    write!(w, " ");
                }
            }
            writeln!(w, "")?;
        }
    }
    Ok(())
}
