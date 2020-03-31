use core::convert::TryFrom;
use std::io::{self, Write};

/// Collapses GCode words into higher-level commands
/// Relies on the first word being a command.
pub struct CommandVec {
    pub inner: Vec<Word>,
}

impl Default for CommandVec {
    fn default() -> Self {
        Self {
            inner: vec![]
        }
    }
}

impl IntoIterator for CommandVec {
    type Item = Command;
    type IntoIter = CommandVecIntoIterator;
    fn into_iter(self) -> Self::IntoIter {
        CommandVecIntoIterator {
            vec: self,
            index: 0,
        }
    }
}

pub struct CommandVecIntoIterator {
    vec: CommandVec,
    index: usize,
}

impl Iterator for CommandVecIntoIterator {
    type Item = Command;
    fn next(&mut self) -> Option<Self::Item> {
        if self.vec.inner.len() == self.index {
            return None;
        }
        
        let mut i = self.index + 1;
        while i < self.vec.inner.len() {
            if CommandWord::is_command(&self.vec.inner[i]) {
                break;
            }
            i += 1;
        }
        Command::try_from(&self.vec.inner[self.index..i]).ok()
    }
}

/// Fundamental unit of GCode: a value preceded by a descriptive letter.
/// A float is used here to encompass all the possible variations of a value.
/// Some flavors of GCode may allow strings, but that is currently not supported.
#[derive(Clone, PartialEq, Debug)]
pub struct Word {
    pub letter: char,
    pub value: f64,
}

#[macro_export]
macro_rules! command {
    ($commandWord: expr, {$($argument: ident : $value: expr,)*}) => {
        paste::expr! (Command::new($commandWord, vec![$(Word {
            letter: stringify!([<$argument:upper>]).chars().next().unwrap(),
            value: $value as f64,
        },)*]))
    };
}

macro_rules! commands {
    ($($(#[$outer:meta])* $commandName: ident {$letter: pat, $number: pat, $fraction: pat, {$($(#[$inner:meta])* $argument: ident), *} },)*) => {

        /// Commands are the operational unit of GCode
        /// They consist of an identifying word followed by arguments
        #[derive(Clone, PartialEq)]
        pub struct Command {
            command_word: CommandWord,
            arguments: Vec<Word>
        }

        paste::item! {
            impl Command {
                pub fn new(command_word: CommandWord, mut arguments: Vec<Word>) -> Self {
                    Self {
                        command_word: command_word.clone(),
                        arguments: arguments.drain(..).filter(|w| {
                            match command_word {
                                $(CommandWord::$commandName => match w.letter.to_lowercase() {
                                    $($argument => true,)*
                                    _ => false
                                },)*
                                _ => false
                            }
                        }).collect()
                    }
                }

                pub fn push(&mut self, argument: Word) {
                    match self.command_word {
                        $(CommandWord::$commandName => match argument.letter.to_lowercase() {
                            $($argument => {
                                self.arguments.push(argument);
                            })*
                            _ => {}
                        },)*
                        _ => {}
                    }
                }
            }
        }

        paste::item! {
            impl Into<Vec<Word>> for Command {
                fn into(self) -> Vec<Word> {
                    let mut args = self.arguments;
                    args.insert(0, self.command_word.into());
                    args
                }
            }
        }

        paste::item! {
            impl TryFrom<&[Word]> for Command {
                type Error = ();
                fn try_from(words: &[Word]) -> Result<Self, ()> {
                    let command_word = CommandWord::try_from(&words[0])?;
                    let mut arguments = Vec::with_capacity(words.len() - 1);
                    for i in 1..words.len() {
                        match command_word {
                            $(CommandWord::$commandName => match words[i].letter.to_lowercase() {
                                $($argument => {
                                    arguments.push(words[i].clone());
                                })*
                                _ => {}
                            },)*
                            _ => {}
                        }
                    }
                    Ok(Self {
                        command_word,
                        arguments
                    })
                }
            }
        }

        #[derive(Clone, PartialEq, Eq)]
        pub enum CommandWord {
            $(
                $(#[$outer])*
                $commandName,
            )*
            /// A comment is a special command: it is a semicolon followed by text until the end of the line
            Comment(Box<String>),
            /// Letter N followed by an integer (with no sign) between 0 and 99999 written with no more than five digits
            LineNumber(u16),
            /// Byte-sized checksums are used by some GCode generators at the end of each line
            Checksum(u8),
        }

        paste::item! {
            impl CommandWord {
                pub fn is_command(word: &Word) -> bool {
                    let number = word.value as u16;
                    let fraction_numeric =
                        f64::from_bits(word.value.fract().to_bits() & 0x00_00_FF_FF_FF_FF_FF_FF) as u16;
                    let fraction = if fraction_numeric == 0 {
                        None
                    } else {
                        Some(fraction_numeric)
                    };
                    match (word.letter, number, fraction) {
                        $(($letter, $number, $fraction) => true,)*
                        ('*', _checksum, None) => true,
                        ('N', _line_number, None) => true,
                        (_, _, _) => false
                    }
                }
            }
        }
        paste::item! {
            impl TryFrom<&Word> for CommandWord {
                type Error = ();
                fn try_from(word: &Word) -> Result<Self, ()> {
                    let number = word.value as u16;
                    let fraction_numeric =
                        f64::from_bits(word.value.fract().to_bits() & 0x00_00_FF_FF_FF_FF_FF_FF) as u16;
                    let fraction = if fraction_numeric == 0 {
                        None
                    } else {
                        Some(fraction_numeric)
                    };
                    match (word.letter, number, fraction) {
                        $(($letter, $number, $fraction) => Ok(Self::$commandName),)*
                        ('*', checksum, None) => Ok(Self::Checksum(checksum as u8)),
                        ('N', line_number, None) => Ok(Self::LineNumber(line_number)),
                        (_, _, _) => Err(())
                    }
                }
            }
        }
        paste::item!{
            impl Into<Word> for CommandWord {
                fn into(self) -> Word {
                    match self {
                        $(
                            Self::$commandName {} => Word {
                                letter: $letter,
                                // TODO: fix fraction
                                value: $number as f64 + ($fraction.unwrap_or(0) as f64)
                            },
                        )*
                        Self::Checksum(value) => Word {
                            letter: '*',
                            value: value as f64
                        },
                        Self::LineNumber(value) => Word {
                            letter: 'N',
                            value: value as f64
                        },
                        Self::Comment(_string) => Word {
                            letter: ';',
                            value: 0.0
                        }
                    }
                }
            }
        }
    };
}

commands!(
    /// Moves the head at the fastest possible speed to the desired speed
    /// Never enter a cut with rapid positioning
    /// Some older machines may "dog leg" rapid positioning, moving one axis at a time
    RapidPositioning {
        'G', 0, None, {
            x,
            y,
            z,
            e,
            f,
            h,
            r,
            s,
            a,
            b,
            c
        }
    },
    /// Typically used for "cutting" motion
    LinearInterpolation {
        'G', 1, None, {
            x,
            y,
            z,
            e,
            f,
            h,
            r,
            s,
            a,
            b,
            c
        }
    },
    /// This will keep the axes unmoving for the period of time in seconds specified by the P number
    Dwell {
        'G', 4, None, {
            /// Time in seconds
            p
        }
    },
    /// Use inches for length units
    UnitsInches {
        'G', 20, None, {}
    },
    /// Use millimeters for length units
    UnitsMillimeters {
        'G', 21, None, {}
    },
    /// In absolute distance mode, axis numbers usually represent positions in terms of the currently active coordinate system. 
    AbsoluteDistanceMode {
        'G', 90, None, {}
    },
    /// In relative distance mode, axis numbers usually represent increments from the current values of the numbers
    RelativeDistanceMode {
        'G', 91, None, {}
    },
    /// Start spinning the spindle clockwise with speed `p`
    StartSpindleClockwise {
        'M', 3, None, {
            /// Speed
            p
        }
    },
    /// Start spinning the spindle counterclockwise with speed `p`
    StartSpindleCounterclockwise {
        'M', 4, None, {
            /// Speed
            p
        }
    },
    /// Stop spinning the spindle
    StopSpindle {
        'M', 5, None, {}
    },
    /// Signals the end of a program
    ProgramEnd {
        'M', 20, None, {}
    },
);

/// Rudimentary regular expression GCode validator
pub fn validate_gcode(gcode: &&str) -> bool {
    use regex::Regex;
    let re = Regex::new(r##"^(?:(?:%|\(.*\)|(?:[A-Z^E^U][+-]?\d+(?:\.\d*)?))\h*)*$"##).unwrap();
    gcode.lines().all(|line| re.is_match(line))
}

/// Writes a GCode program (or sequence) to a Writer
pub fn program2gcode<W: Write>(program: Vec<Command>, mut w: W) -> io::Result<()> {
    for command in program.into_iter() {
        match &command.command_word {
            CommandWord::Comment(string) => {
                writeln!(w, ";{}", string)?;
            },
            _other => {
                let words: Vec<Word> = command.into();
                let mut it = words.iter();
                if let Some(command_word) = it.next() {
                    write!(w, "{}{}", command_word.letter, command_word.value)?;
                    for word in it {
                        write!(w, " {}{} ", word.letter, word.value)?;
                    }
                    writeln!(w, "")?;
                }
            }
        }
    }
    Ok(())
}
