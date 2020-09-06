use crate::gcode::*;

//// Direction of the machine spindle
#[derive(Clone, PartialEq, Eq)]
pub enum Direction {
    Clockwise,
    Counterclockwise,
}

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
/// This is used to reduce output GCode verbosity and run repetitive actions.
#[derive(Debug, Default)]
pub struct Machine {
    tool_state: Option<Tool>,
    distance_mode: Option<Distance>,
    tool_on_action: Vec<Command>,
    tool_off_action: Vec<Command>,
    program_begin_sequence: Vec<Command>,
    program_end_sequence: Vec<Command>,
}

impl Machine {
    /// Create a generic machine, given a tool on/off GCode sequence.
    pub fn new(
        tool_on_action: Vec<Word>,
        tool_off_action: Vec<Word>,
        program_begin_sequence: Vec<Word>,
        program_end_sequence: Vec<Word>,
    ) -> Self {
        Self {
            tool_state: None,
            distance_mode: None,
            tool_on_action: CommandVecIntoIterator::from(tool_on_action).collect(),
            tool_off_action: CommandVecIntoIterator::from(tool_off_action).collect(),
            program_begin_sequence: CommandVecIntoIterator::from(program_begin_sequence).collect(),
            program_end_sequence: CommandVecIntoIterator::from(program_end_sequence).collect(),
        }
    }
}

impl Machine {
    /// Output gcode to turn the tool on.
    pub fn tool_on(&mut self) -> Vec<Command> {
        if self.tool_state == Some(Tool::Off) || self.tool_state == None {
            self.tool_state = Some(Tool::On);
            self.tool_on_action.clone()
        } else {
            vec![]
        }
    }

    /// Output gcode to turn the tool off.
    pub fn tool_off(&mut self) -> Vec<Command> {
        if self.tool_state == Some(Tool::On) || self.tool_state == None {
            self.tool_state = Some(Tool::Off);
            self.tool_off_action.clone()
        } else {
            vec![]
        }
    }

    pub fn program_begin(&self) -> Vec<Command> {
        self.program_begin_sequence.clone()
    }
    pub fn program_end(&self) -> Vec<Command> {
        self.program_end_sequence.clone()
    }

    /// Output relative distance field if mode was absolute or unknown.
    pub fn absolute(&mut self) -> Vec<Command> {
        if self.distance_mode == Some(Distance::Relative) || self.distance_mode == None {
            self.distance_mode = Some(Distance::Absolute);
            vec![command!(CommandWord::AbsoluteDistanceMode, {})]
        } else {
            vec![]
        }
    }

    /// Output absolute distance field if mode was relative or unknown.
    pub fn relative(&mut self) -> Vec<Command> {
        if self.distance_mode == Some(Distance::Absolute) || self.distance_mode == None {
            self.distance_mode = Some(Distance::Relative);
            vec![command!(CommandWord::RelativeDistanceMode, {})]
        } else {
            vec![]
        }
    }
}
