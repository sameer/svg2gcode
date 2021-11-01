use serde::{Deserialize, Serialize};
use std::{convert::TryInto, num::ParseFloatError};
use svg2gcode::{
    Settings, ConversionConfig, MachineConfig, PostprocessConfig, SupportedFunctionality,
};
use svgtypes::Length;
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
        Self::from(&app_state.settings)
    }
}

impl<'a> TryInto<Settings> for &'a FormState {
    type Error = ParseFloatError;

    fn try_into(self) -> Result<Settings, Self::Error> {
        Ok(Settings {
            conversion: ConversionConfig {
                tolerance: self.tolerance.clone()?,
                feedrate: self.feedrate.clone()?,
                dpi: self.dpi.clone()?,
            },
            machine: MachineConfig {
                supported_functionality: SupportedFunctionality {
                    circular_interpolation: self.circular_interpolation,
                },
                tool_on_sequence: self.tool_on_sequence.clone().and_then(Result::ok),
                tool_off_sequence: self.tool_off_sequence.clone().and_then(Result::ok),
                begin_sequence: self.begin_sequence.clone().and_then(Result::ok),
                end_sequence: self.end_sequence.clone().and_then(Result::ok),
            },
            postprocess: PostprocessConfig {
                origin: [self.origin[0].clone()?, self.origin[1].clone()?],
            },
        })
    }
}

impl From<&Settings> for FormState {
    fn from(settings: &Settings) -> Self {
        Self {
            tolerance: Ok(settings.conversion.tolerance),
            feedrate: Ok(settings.conversion.feedrate),
            circular_interpolation: 
                settings
                .machine
                .supported_functionality
                .circular_interpolation,
            origin: [
                Ok(settings.postprocess.origin[0]),
                Ok(settings.postprocess.origin[1]),
            ],
            dpi: Ok(settings.conversion.dpi),
            tool_on_sequence: 
                settings
                .machine
                .tool_on_sequence
                .clone()
                .map(Result::Ok),
            tool_off_sequence: 
                settings
                .machine
                .tool_off_sequence
                .clone()
                .map(Result::Ok),
            begin_sequence: 
                settings
                .machine
                .begin_sequence
                .clone()
                .map(Result::Ok),
            end_sequence: 
                settings
                .machine
                .end_sequence
                .clone()
                .map(Result::Ok),
        }
    }
}

pub type AppStore = PersistentStore<AppState>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub first_visit: bool,
    pub settings: Settings,
    #[serde(skip)]
    pub svgs: Vec<Svg>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Svg {
    pub content: String,
    pub filename: String,
    pub dimensions: [Option<Length>; 2],
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            first_visit: true,
            settings: Settings::default(),
            svgs: vec![],
        }
    }
}

impl Persistent for AppState {}

pub type FormStore = BasicStore<FormState>;
