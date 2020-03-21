/// State machine used to generate gcode for various operations.
///
/// TODO: more detailed examples

use crate::code::*;

// Generic machine state simulation, assuming nothing is known about the machine when initialized.
pub struct Machine {
    tool_state: Option<Tool>,
    distance_mode: Option<Distance>,
    pub tool_on_action: Vec<GCode>,
    pub tool_off_action: Vec<GCode>,
}

// Assigns reasonable default settings that apply to most gcode applications.
impl Default for Machine {
    fn default() -> Self {
        Self {
            tool_state: None,
            distance_mode: None,
            tool_on_action: vec![
                GCode::Dwell { p: 0.1 },
                GCode::StartSpindle {
                    d: Direction::Clockwise,
                    s: 70.0,
                },
                GCode::Dwell { p: 0.1 },
            ],
            tool_off_action: vec![
                GCode::Dwell { p: 0.1 },
                GCode::StartSpindle {
                    d: Direction::Clockwise,
                    s: 50.0,
                },
                GCode::Dwell { p: 0.1 },
            ],
        }
    }
}

// Implements the state machine functions
impl Machine {
    // Outputs gcode to turn the tool on.
    pub fn tool_on(&mut self) -> Vec<GCode> {
        if self.tool_state == Some(Tool::Off) || self.tool_state == None {
            self.tool_state = Some(Tool::On);
            self.tool_on_action.clone()
        } else {
            vec![]
        }
    }

    // Outputs gcode to turn the tool off.
    pub fn tool_off(&mut self) -> Vec<GCode> {
        if self.tool_state == Some(Tool::On) || self.tool_state == None {
            self.tool_state = Some(Tool::Off);
            self.tool_off_action.clone()
        } else {
            vec![]
        }
    }

    // Outputs gcode for how distance should be measured: relative or absolute.
    pub fn distance(&mut self, is_absolute: bool) -> Vec<GCode> {
        if is_absolute {
            self.absolute()
        } else {
            self.incremental()
        }
    }

    // Outputs gcode command to use absolute motion
    pub fn absolute(&mut self) -> Vec<GCode> {
        if self.distance_mode == Some(Distance::Incremental) || self.distance_mode == None {
            self.distance_mode = Some(Distance::Absolute);
            vec![GCode::DistanceMode(Distance::Absolute)]
        } else {
            vec![]
        }
    }

    // Outputs gcode command to use relative motion
    pub fn incremental(&mut self) -> Vec<GCode> {
        if self.distance_mode == Some(Distance::Absolute) || self.distance_mode == None {
            self.distance_mode = Some(Distance::Incremental);
            vec![GCode::DistanceMode(Distance::Incremental)]
        } else {
            vec![]
        }
    }
}
