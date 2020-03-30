use std::io::{self, Write};

/// Fields are the basic unit of GCode.
trait Field {
    /// An uppercase letter
    const LETTER: char;
    /// A number if the field has a fixed number.
    const NUMBER: Option<u16>;
    /// A fraction if the field has a fixed fraction following a fixed number.
    const FRACTION: Option<u16>;

    fn from_arguments<'a>(arguments: &[Argument<'a>]) -> Self;
    fn into_arguments<'a>(&'a self) -> Vec<Argument<'a>>;
}

/// Arguments, described by a letter and a value, belong to a field.
pub struct Argument<'a> {
    letter: char,
    value: &'a str,
}

macro_rules! field {
    ($(#[$outer:meta])* $fieldName: ident {$letter: pat, $number: pat, $fraction: pat, {$($(#[$inner:meta])* $argument: ident : $type: ty), *} }) => {
        $(#[$outer])*
        struct $fieldName {
            $(
                $(#[$inner])*
                $argument: Option<$type>,
            )*
        }

        paste::item! {
            impl Field for $fieldName {
                const LETTER: char = $letter;
                const NUMBER: Option<u16> = $number;
                const FRACTION: Option<u16> = $fraction;
                fn from_arguments<'a>(arguments: &[Argument<'a>]) -> Self {
                    let mut field = Self {
                        $($argument: None,)*
                    };
                    for arg in arguments.iter() {
                        $(if arg.letter == stringify!([<$argument:upper>]).chars().next().unwrap() {
                            field.$argument = Some(arg.value.parse().unwrap());
                        })*
                    }
                    field
                }
                fn into_arguments<'a>(&'a self) -> Vec<Argument<'a>> {
                    let mut args = vec![];
                    $(
                        if let Some(value) = self.$argument {
                            args.push(Argument {
                                letter: stringify!([<$argument:upper>]).chars().next().unwrap(),
                                value: &value.to_string()
                            });
                        }
                     )*
                    args
                }
            }
        }
    };
}

field!(
    /// Moves the head at the fastest possible speed to the desired speed.
    /// Never enter a cut with rapid positioning.
    /// Some older machines may "dog leg" rapid positioning, moving one axis at a time.
    RapidPositioning {
    'G', Some(0), None, {
        x: f64,
        y: f64,
        z: f64,
        e: f64,
        f: f64,
        h: f64,
        r: f64,
        s: f64,
        a: f64,
        b: f64,
        c: f64
    }
});

field!(
    /// Typically used for "cutting" motion
    LinearInterpolation {
    'G', Some(1), None, {
        x: f64,
        y: f64,
        z: f64,
        e: f64,
        f: f64,
        h: f64,
        r: f64,
        s: f64,
        a: f64,
        b: f64,
        c: f64
    }
});

field!(
    /// This will keep the axes unmoving for the period of time in seconds specified by the P number.
    Dwell {
    'G', Some(4), None, {
        /// Time in seconds
        p: f64
    }
});

field!(
    /// Use inches for length units
    UnitsInches {
    'G', Some(20), None, {}
});

field!(
    /// Use millimeters for length units
    UnitsMillimeters {
    'G', Some(21), None, {}
});

field!(
    /// In absolute distance mode, axis numbers usually represent positions in terms of the currently active coordinate system. 
    AbsoluteDistanceMode {
    'G', Some(90), None, {}
});

field!(
    /// In incremental distance mode, axis numbers usually represent increments from the current values of the numbers.
    IncrementalDistanceMode {
    'G', Some(91), None, {}
});

field!(
    /// Start spinning the spindle clockwise with speed `p`
    StartSpindleClockwise {
        'M', Some(3), None, {
            /// Speed
            p: f64
        }
    }
);

field!(
    /// Start spinning the spindle counterclockwise with speed `p`
    StartSpindleCounterclockwise {
        'M', Some(4), None, {
            /// Speed
            p: f64
        }
    }
);

field!(
    /// Stop spinning the spindle
    StopSpindle {
        'M', Some(5), None, {}
    }
);

field!(
    /// Signals the end of a program
    ProgramEnd {
        'M', Some(20), None, {}
    }
);

/// Checksums are used by some GCode generators at the end of each line
struct Checksum {
    /// Checksum value
    value: u8,
}

impl Field for Checksum {
    const LETTER: char = '*';
    const NUMBER: Option<u16> = None;
    const FRACTION: Option<u16> = None;
    fn from_arguments<'a>(arguments: &[Argument<'a>]) -> Self {
        Self { value: 0 }
    }
    fn into_arguments(&self) -> Vec<Argument> {
        vec![]
    }
}

/// A line number is the letter N followed by an integer (with no sign) between 0 and 99999 written with no more than five digits
struct LineNumber {
    /// Line number
    value: u16,
}

impl Field for LineNumber {
    const LETTER: char = 'N';
    const NUMBER: Option<u16> = None;
    const FRACTION: Option<u16> = None;
    fn from_arguments<'a>(arguments: &[Argument<'a>]) -> Self {
        Self { value: 0 }
    }
    fn into_arguments(&self) -> Vec<Argument> {
        vec![]
    }
}

/// Rudimentary regular expression GCode validator.
pub fn validate_gcode(gcode: &&str) -> bool {
    use regex::Regex;
    let re = Regex::new(r##"^(?:(?:%|\(.*\)|(?:[A-Z^E^U][+-]?\d+(?:\.\d*)?))\h*)*$"##).unwrap();
    gcode.lines().all(|line| re.is_match(line))
}

// TODO: Documentation
// TODO: This function is too large
pub fn program2gcode<W: Write>(p: &Program, mut w: W) -> io::Result<()> {
    
    let mut last_feedrate: Option<f64> = None;
    let letter = '*';
    let number = Some(0);
    let fraction = None;

    macro_rules! match_field {
        ($($fieldName: ident)*) => {
                match (letter, number, fraction) {
                    $(($fieldName::LETTER, $fieldName::NUMBER, $fieldName::FRACTION) => {
                        Some($fieldName::from_arguments(arguments))
                    },)*
                    _ => {None}
                }
        };
    }
    for code in p.iter() {
        match_field!(LineNumber);
    }
    Ok(())
}
