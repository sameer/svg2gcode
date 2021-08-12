use g_code::{command, emit::Token, parse::ast::Snippet};

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
/// This is used to reduce output GCode verbosity and run repetitive actions.
#[derive(Debug, Default)]
pub struct Machine<'input> {
    tool_state: Option<Tool>,
    distance_mode: Option<Distance>,
    pub tool_on_action: Option<Snippet<'input>>,
    pub tool_off_action: Option<Snippet<'input>>,
    pub program_begin_sequence: Option<Snippet<'input>>,
    pub program_end_sequence: Option<Snippet<'input>>,
}

impl<'input> Machine<'input> {
    pub fn new(
        tool_on_action: Option<Snippet<'input>>,
        tool_off_action: Option<Snippet<'input>>,
        program_begin_sequence: Option<Snippet<'input>>,
        program_end_sequence: Option<Snippet<'input>>,
    ) -> Self {
        Self {
            tool_on_action,
            tool_off_action,
            program_begin_sequence,
            program_end_sequence,
            ..Default::default()
        }
    }
    /// Output gcode to turn the tool on.
    pub fn tool_on(&mut self) -> Vec<Token<'input>> {
        if self.tool_state == Some(Tool::Off) || self.tool_state == None {
            self.tool_state = Some(Tool::On);
            self.tool_on_action
                .iter()
                .flat_map(|s| s.iter_fields())
                .map(Token::from)
                .collect()
        } else {
            vec![]
        }
    }

    /// Output gcode to turn the tool off.
    pub fn tool_off(&mut self) -> Vec<Token<'input>> {
        if self.tool_state == Some(Tool::On) || self.tool_state == None {
            self.tool_state = Some(Tool::Off);
            self.tool_off_action
                .iter()
                .flat_map(|s| s.iter_fields())
                .map(Token::from)
                .collect()
        } else {
            vec![]
        }
    }

    /// Output user-defined setup gcode
    pub fn program_begin(&self) -> Vec<Token<'input>> {
        self.program_begin_sequence
            .iter()
            .flat_map(|s| s.iter_fields())
            .map(Token::from)
            .collect()
    }

    /// Output user-defined teardown gcode
    pub fn program_end(&self) -> Vec<Token<'input>> {
        self.program_end_sequence
            .iter()
            .flat_map(|s| s.iter_fields())
            .map(Token::from)
            .collect()
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
