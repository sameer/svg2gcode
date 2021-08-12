use serde::{Deserialize, Serialize};
use std::num::ParseFloatError;
use yewdux::prelude::{BasicStore, Persistent, PersistentStore};

#[derive(Debug, Clone)]
pub struct FormState {
    pub tolerance: Result<f64, ParseFloatError>,
    pub feedrate: Result<f64, ParseFloatError>,
    pub dpi: Result<f64, ParseFloatError>,
    pub origin: [Result<f64, ParseFloatError>; 2],
    pub tool_on_sequence: Option<Result<String, String>>,
    pub tool_off_sequence: Option<Result<String, String>>,
    pub begin_sequence: Option<Result<String, String>>,
    pub end_sequence: Option<Result<String, String>>,
}

impl Default for FormState {
    fn default() -> Self {
        let app_state = AppState::default();
        Self::from(&app_state)
    }
}

impl From<&AppState> for FormState {
    fn from(app_state: &AppState) -> Self {
        Self {
            tolerance: Ok(app_state.tolerance),
            feedrate: Ok(app_state.feedrate),
            dpi: Ok(app_state.dpi),
            origin: [Ok(app_state.origin[0]), Ok(app_state.origin[1])],
            tool_on_sequence: app_state.tool_on_sequence.clone().map(Result::Ok),
            tool_off_sequence: app_state.tool_off_sequence.clone().map(Result::Ok),
            begin_sequence: app_state.begin_sequence.clone().map(Result::Ok),
            end_sequence: app_state.end_sequence.clone().map(Result::Ok),
        }
    }
}

pub type AppStore = PersistentStore<AppState>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub first_visit: bool,
    pub tolerance: f64,
    pub feedrate: f64,
    pub dpi: f64,
    pub tool_on_sequence: Option<String>,
    pub tool_off_sequence: Option<String>,
    pub begin_sequence: Option<String>,
    pub end_sequence: Option<String>,
    pub origin: [f64; 2],
    #[serde(skip)]
    pub svg_filename: Option<String>,
    #[serde(skip)]
    pub svg: Option<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            first_visit: true,
            tolerance: 0.002,
            feedrate: 300.,
            dpi: 96.,
            tool_on_sequence: None,
            tool_off_sequence: None,
            begin_sequence: None,
            end_sequence: None,
            origin: [0., 0.],
            svg_filename: None,
            svg: None,
        }
    }
}

impl Persistent for AppState {}

pub type FormStore = BasicStore<FormState>;
