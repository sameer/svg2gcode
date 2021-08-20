use serde::{Deserialize, Serialize};
use std::num::ParseFloatError;
use yewdux::prelude::{BasicStore, Persistent, PersistentStore};

#[derive(Debug, Clone)]
pub struct FormState {
    pub tolerance: Result<f64, ParseFloatError>,
    pub feedrate: Result<f64, ParseFloatError>,
    pub origin: [Result<f64, ParseFloatError>; 2],
    pub circular_interpolation: bool,
    pub dpi: Result<f64, ParseFloatError>,
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
            circular_interpolation: app_state.circular_interpolation,
            origin: [Ok(app_state.origin[0]), Ok(app_state.origin[1])],
            dpi: Ok(app_state.dpi),
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
    pub origin: [f64; 2],
    pub circular_interpolation: bool,
    pub dpi: f64,
    pub tool_on_sequence: Option<String>,
    pub tool_off_sequence: Option<String>,
    pub begin_sequence: Option<String>,
    pub end_sequence: Option<String>,
    #[serde(skip)]
    pub svgs: Vec<Svg>,
}

#[derive(Debug, Clone)]
pub struct Svg {
    pub content: String,
    pub filename: String,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            first_visit: true,
            tolerance: 0.002,
            feedrate: 300.,
            origin: [0., 0.],
            circular_interpolation: false,
            dpi: 96.,
            tool_on_sequence: None,
            tool_off_sequence: None,
            begin_sequence: None,
            end_sequence: None,
            svgs: vec![],
        }
    }
}

impl Persistent for AppState {}

pub type FormStore = BasicStore<FormState>;
