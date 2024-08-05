use g_code::{
    command,
    emit::Token,
    parse::{ast::Snippet, snippet_parser},
};
#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

/// Whether the tool is active (i.e. cutting)
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Tool {
    Off,
    On,
}

/// The distance mode for movement commands
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Distance {
    Absolute,
    Relative,
}

/// Generic machine state simulation, assuming nothing is known about the machine when initialized.
/// This is used to reduce output G-Code verbosity and run repetitive actions.
#[derive(Debug, Clone)]
pub struct Machine<'input> {
    supported_functionality: SupportedFunctionality,
    tool_state: Option<Tool>,
    distance_mode: Option<Distance>,
    tool_on_sequence: Snippet<'input>,
    tool_off_sequence: Snippet<'input>,
    program_begin_sequence: Snippet<'input>,
    program_end_sequence: Snippet<'input>,
    /// Empty snippet used to provide the same iterator type when a sequence must be empty
    empty_snippet: Snippet<'input>,
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
        let empty_snippet = snippet_parser("").expect("empty string is a valid snippet");
        Self {
            supported_functionality,
            tool_on_sequence: tool_on_sequence.unwrap_or_else(|| empty_snippet.clone()),
            tool_off_sequence: tool_off_sequence.unwrap_or_else(|| empty_snippet.clone()),
            program_begin_sequence: program_begin_sequence.unwrap_or_else(|| empty_snippet.clone()),
            program_end_sequence: program_end_sequence.unwrap_or_else(|| empty_snippet.clone()),
            empty_snippet,
            tool_state: Default::default(),
            distance_mode: Default::default(),
        }
    }

    pub fn supported_functionality(&self) -> &SupportedFunctionality {
        &self.supported_functionality
    }

    /// Output gcode to turn the tool on.
    pub fn tool_on(&mut self) -> impl Iterator<Item = Token<'input>> + '_ {
        if self.tool_state == Some(Tool::Off) || self.tool_state.is_none() {
            self.tool_state = Some(Tool::On);
            self.tool_on_sequence.iter_emit_tokens()
        } else {
            self.empty_snippet.iter_emit_tokens()
        }
    }

    /// Output gcode to turn the tool off.
    pub fn tool_off(&mut self) -> impl Iterator<Item = Token<'input>> + '_ {
        if self.tool_state == Some(Tool::On) || self.tool_state.is_none() {
            self.tool_state = Some(Tool::Off);
            self.tool_off_sequence.iter_emit_tokens()
        } else {
            self.empty_snippet.iter_emit_tokens()
        }
    }

    /// Output user-defined setup gcode
    pub fn program_begin(&self) -> impl Iterator<Item = Token<'input>> + '_ {
        self.program_begin_sequence.iter_emit_tokens()
    }

    /// Output user-defined teardown gcode
    pub fn program_end(&self) -> impl Iterator<Item = Token<'input>> + '_ {
        self.program_end_sequence.iter_emit_tokens()
    }

    /// Output absolute distance field if mode was relative or unknown.
    pub fn absolute(&mut self) -> Vec<Token<'input>> {
        if self.distance_mode == Some(Distance::Relative) || self.distance_mode.is_none() {
            self.distance_mode = Some(Distance::Absolute);
            command!(AbsoluteDistanceMode {}).into_token_vec()
        } else {
            vec![]
        }
    }

    /// Output relative distance field if mode was absolute or unknown.
    pub fn relative(&mut self) -> Vec<Token<'input>> {
        if self.distance_mode == Some(Distance::Absolute) || self.distance_mode.is_none() {
            self.distance_mode = Some(Distance::Relative);
            command!(RelativeDistanceMode {}).into_token_vec()
        } else {
            vec![]
        }
    }
}
