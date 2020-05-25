use std::convert::TryFrom;

/// Fundamental unit of GCode: a value preceded by a descriptive letter.
#[derive(Clone, PartialEq, Debug)]
pub struct Word {
    pub letter: char,
    pub value: Value,
}

/// All the possible variations of a word's value.
/// Fractional is needed to support commands like G91.1 which would be changed by float arithmetic.
/// Some flavors of GCode also allow for strings.
#[derive(Clone, PartialEq, Debug)]
pub enum Value {
    Fractional(u32, Option<u32>),
    Float(f64),
    String(Box<String>),
}

impl Into<f64> for &Value {
    fn into(self) -> f64 {
        match self {
            Value::Float(f) => *f,
            _ => panic!("Unwrapping a non-float"),
        }
    }
}

impl std::fmt::Display for Value {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Fractional(number, Some(fraction)) => write!(f, "{}.{}", number, fraction),
            Self::Fractional(number, None) => write!(f, "{}", number),
            Self::Float(float) => write!(f, "{}", float),
            Self::String(string) => write!(f, "{}", string),
        }
    }
}

/// A macro for quickly instantiating a float-valued command
#[macro_export]
macro_rules! command {
    ($commandWord: expr, {$($argument: ident : $value: expr,)*}) => {
        paste::expr! (Command::new($commandWord, vec![$(Word {
            letter: stringify!([<$argument:upper>]).chars().next().unwrap(),
            value: Value::Float($value),
        },)*]))
    };
}

macro_rules! commands {
    ($($(#[$outer:meta])* $commandName: ident {$letter: expr, $number: expr, $fraction: path, {$($(#[$inner:meta])* $argument: ident), *} },)*) => {

        /// Commands are the operational unit of GCode
        /// They consist of an identifying word followed by arguments
        #[derive(Clone, PartialEq, Debug)]
        pub struct Command {
            command_word: CommandWord,
            arguments: Vec<Word>
        }

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

            pub fn word(&'_ self) -> &'_ CommandWord {
                &self.command_word
            }

            pub fn get(&'_ self, letter: char) -> Option<&'_ Word> {
                let letter = letter.to_ascii_uppercase();
                self.arguments.iter().find(|arg| arg.letter == letter)
            }

            pub fn set(&mut self, letter: char, value: Value) {
                let letter = letter.to_ascii_uppercase();
                for i in 0..self.arguments.len() {
                    if self.arguments[i].letter == letter {
                        self.arguments[i].value = value;
                        break;
                    }
                }
            }
        }

        impl Into<Vec<Word>> for Command {
            fn into(self) -> Vec<Word> {
                let mut args = self.arguments;
                args.insert(0, self.command_word.into());
                args
            }
        }

        impl TryFrom<&[Word]> for Command {
            type Error = ();
            fn try_from(words: &[Word]) -> Result<Self, ()> {
                if words.len() == 0 {
                    return Err(());
                }
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

        #[derive(Clone, PartialEq, Eq, Debug)]
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

        impl CommandWord {
            pub fn is_command(word: &Word) -> bool {
                let (number, fraction) = match &word.value {
                    Value::Fractional(number, fraction) => (number, fraction),
                    _other => return false
                };
                match (word.letter, number, fraction) {
                    $(($letter, $number, $fraction) => true,)*
                    ('*', _checksum, None) => true,
                    ('N', _line_number, None) => true,
                    (_, _, _) => false
                }
            }
        }

        impl TryFrom<&Word> for CommandWord {
            type Error = ();
            fn try_from(word: &Word) -> Result<Self, ()> {
                let (number, fraction) = match &word.value {
                    Value::Fractional(number, fraction) => (number, fraction),
                    _other => return Err(())
                };
                match (word.letter, number, fraction) {
                    $(($letter, $number, $fraction) => Ok(Self::$commandName),)*
                    ('*', checksum, None) => Ok(Self::Checksum(*checksum as u8)),
                    ('N', line_number, None) => Ok(Self::LineNumber(*line_number as u16)),
                    (_, _, _) => Err(())
                }
            }
        }

        impl Into<Word> for CommandWord {
            fn into(self) -> Word {
                match self {
                    $(
                        Self::$commandName {} => Word {
                            letter: $letter,
                            // TODO: fix fraction
                            value: Value::Fractional($number, $fraction)
                        },
                    )*
                    Self::Checksum(value) => Word {
                        letter: '*',
                        value: Value::Fractional(value as u32, None)
                    },
                    Self::LineNumber(value) => Word {
                        letter: 'N',
                        value: Value::Fractional(value as u32, None)
                    },
                    Self::Comment(string) => Word {
                        letter: ';',
                        value: Value::String(string)
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
    FeedRateUnitsPerMinute {
        'G', 94, None, {}
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
