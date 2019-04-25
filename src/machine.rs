use super::code::*;

pub struct Machine {
    tool_state: Tool,
    distance_mode: Distance,
    pub tool_on_action: Program,
    pub tool_off_action: Program,
}

impl Default for Machine {
    fn default() -> Self {
        Self {
            tool_state: Tool::Off,
            distance_mode: Distance::Absolute,
            tool_on_action: vec![],
            tool_off_action: vec![],
        }
    }
}

impl Machine {
    pub fn tool_on(&mut self, p: &mut Program) {
        if self.tool_state == Tool::Off {
            self.tool_on_action
                .iter()
                .map(Clone::clone)
                .for_each(|x| p.push(x));
        }
        self.tool_state = Tool::On;
    }

    pub fn tool_off(&mut self, p: &mut Program) {
        if self.tool_state == Tool::On {
            self.tool_off_action
                .iter()
                .map(Clone::clone)
                .for_each(|x| p.push(x));
        }
        self.tool_state = Tool::Off;
    }

    pub fn distance(&mut self, p: &mut Program, is_absolute: bool) {
        if is_absolute {
            self.absolute(p);
        } else {
            self.incremental(p);
        }
    }

    pub fn absolute(&mut self, p: &mut Program) {
        if self.distance_mode == Distance::Incremental {
            p.push(GCode::DistanceMode(Distance::Absolute));
        }
        self.distance_mode = Distance::Absolute;
    }

    pub fn incremental(&mut self, p: &mut Program) {
        if self.distance_mode == Distance::Absolute {
            p.push(GCode::DistanceMode(Distance::Incremental));
        }
        self.distance_mode = Distance::Incremental;
    }
}
