use crate::code::*;

/// Generic machine state simulation, assuming nothing is known about the machine when initialized.
pub struct Machine {
    tool_state: Option<Tool>,
    distance_mode: Option<Distance>,
    pub tool_on_action: Program,
    pub tool_off_action: Program,
}

impl Default for Machine {
    fn default() -> Self {
        Self {
            tool_state: None,
            distance_mode: None,
            tool_on_action: vec![],
            tool_off_action: vec![],
        }
    }
}

impl Machine {
    pub fn tool_on(&mut self) -> Program {
        if self.tool_state == Some(Tool::Off) || self.tool_state == None {
            self.tool_state = Some(Tool::On);
            self.tool_on_action.clone()
        } else {
            vec![]
        }
    }

    pub fn tool_off(&mut self) -> Program {
        if self.tool_state == Some(Tool::On) || self.tool_state == None {
            self.tool_state = Some(Tool::Off);
            self.tool_off_action.clone()
        } else {
            vec![]
        }
    }

    pub fn distance(&mut self, is_absolute: bool) -> Program {
        if is_absolute {
            self.absolute()
        } else {
            self.incremental()
        }
    }

    pub fn absolute(&mut self) -> Program {
        if self.distance_mode == Some(Distance::Incremental) || self.distance_mode == None {
            self.distance_mode = Some(Distance::Absolute);
            vec![GCode::DistanceMode(Distance::Absolute)]
        } else {
            vec![]
        }
    }

    pub fn incremental(&mut self) -> Program {
        if self.distance_mode == Some(Distance::Absolute) || self.distance_mode == None {
            self.distance_mode = Some(Distance::Incremental);
            vec![GCode::DistanceMode(Distance::Incremental)]
        } else {
            vec![]
        }
    }
}
