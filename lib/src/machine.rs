use g_code::{command, emit::Token, parse::ast::Snippet};
#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

/// Whether the tool is active (i.e. cutting)
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Tool {
    Off,
    On,
}

impl std::ops::Not for Tool {
    type Output = Self;
    fn not(self) -> Self {
        match self {
            Self::Off => Self::On,
            Self::On => Self::Off,
        }
    }
}

/// The distance mode for movement commands
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Distance {
    Absolute,
    Relative,
}

impl std::ops::Not for Distance {
    type Output = Self;
    fn not(self) -> Self {
        match self {
            Self::Absolute => Self::Relative,
            Self::Relative => Self::Absolute,
        }
    }
}

/// Generic machine state simulation, assuming nothing is known about the machine when initialized.
/// This is used to reduce output G-Code verbosity and run repetitive actions.
#[derive(Debug, Default, Clone)]
pub struct Machine<'input> {
    supported_functionality: SupportedFunctionality,
    tool_state: Option<Tool>,
    distance_mode: Option<Distance>,
    tool_on_sequence: Vec<Token<'input>>,
    tool_off_sequence: Vec<Token<'input>>,
    program_begin_sequence: Vec<Token<'input>>,
    program_end_sequence: Vec<Token<'input>>,
}

#[derive(Debug, Default, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct MachineConfig {
    pub supported_functionality: SupportedFunctionality,
    pub tool_on_sequence: Option<String>,
    pub tool_off_sequence: Option<String>,
    pub begin_sequence: Option<String>,
    pub end_sequence: Option<String>,
}

#[derive(Debug, Default, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct SupportedFunctionality {
    /// Indicates support for G2/G3 circular interpolation.
    ///
    /// Most modern machines support this. Old ones like early MakerBot 3D printers do not.
    pub circular_interpolation: bool,
}

impl<'input> Machine<'input> {
    pub fn new(
        supported_functionality: SupportedFunctionality,
        tool_on_sequence: Option<Snippet<'input>>,
        tool_off_sequence: Option<Snippet<'input>>,
        program_begin_sequence: Option<Snippet<'input>>,
        program_end_sequence: Option<Snippet<'input>>,
    ) -> Self {
        Self {
            supported_functionality,
            tool_on_sequence: tool_on_sequence
                .map(|s| s.iter_emit_tokens().collect())
                .unwrap_or_default(),
            tool_off_sequence: tool_off_sequence
                .map(|s| s.iter_emit_tokens().collect())
                .unwrap_or_default(),
            program_begin_sequence: program_begin_sequence
                .map(|s| s.iter_emit_tokens().collect())
                .unwrap_or_default(),
            program_end_sequence: program_end_sequence
                .map(|s| s.iter_emit_tokens().collect())
                .unwrap_or_default(),
            ..Default::default()
        }
    }

    pub fn supported_functionality(&self) -> &SupportedFunctionality {
        &self.supported_functionality
    }

    /// Output gcode to turn the tool on.
    pub fn tool_on(&mut self) -> Vec<Token<'input>> {
        if self.tool_state == Some(Tool::Off) || self.tool_state == None {
            self.tool_state = Some(Tool::On);
            self.tool_on_sequence.clone()
        } else {
            vec![]
        }
    }

    /// Output gcode to turn the tool off.
    pub fn tool_off(&mut self) -> Vec<Token<'input>> {
        if self.tool_state == Some(Tool::On) || self.tool_state == None {
            self.tool_state = Some(Tool::Off);
            self.tool_off_sequence.clone()
        } else {
            vec![]
        }
    }

    /// Output user-defined setup gcode
    pub fn program_begin(&self) -> Vec<Token<'input>> {
        self.program_begin_sequence.clone()
    }

    /// Output user-defined teardown gcode
    pub fn program_end(&self) -> Vec<Token<'input>> {
        self.program_end_sequence.clone()
    }

    /// Output absolute distance field if mode was relative or unknown.
    pub fn absolute(&mut self) -> Vec<Token<'input>> {
        if self.distance_mode == Some(Distance::Relative) || self.distance_mode == None {
            self.distance_mode = Some(Distance::Absolute);
            command!(AbsoluteDistanceMode {}).into_token_vec()
        } else {
            vec![]
        }
    }

    /// Output relative distance field if mode was absolute or unknown.
    pub fn relative(&mut self) -> Vec<Token<'input>> {
        if self.distance_mode == Some(Distance::Absolute) || self.distance_mode == None {
            self.distance_mode = Some(Distance::Relative);
            command!(RelativeDistanceMode {}).into_token_vec()
        } else {
            vec![]
        }
    }
}
