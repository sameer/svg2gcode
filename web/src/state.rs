use serde::{Deserialize, Serialize};
use std::{convert::TryInto, num::ParseFloatError};
use svg2gcode::{
    ConversionConfig, MachineConfig, PostprocessConfig, Settings, SupportedFunctionality,
};
use svgtypes::Length;
use thiserror::Error;
use yewdux::store::Store;

#[derive(Debug, Clone, PartialEq, Store)]
#[store]
pub struct FormState {
    pub tolerance: Result<f64, ParseFloatError>,
    pub feedrate: Result<f64, ParseFloatError>,
    pub origin: [Option<Result<f64, ParseFloatError>>; 2],
    pub circular_interpolation: bool,
    pub dpi: Result<f64, ParseFloatError>,
    pub tool_on_sequence: Option<Result<String, String>>,
    pub tool_off_sequence: Option<Result<String, String>>,
    pub begin_sequence: Option<Result<String, String>>,
    pub end_sequence: Option<Result<String, String>>,
    pub checksums: bool,
    pub line_numbers: bool,
}

impl Default for FormState {
    fn default() -> Self {
        let app_state = AppState::default();
        Self::from(&app_state.settings)
    }
}

#[derive(Debug, Error)]
pub enum FormStateConversionError {
    #[error(transparent)]
    Float(#[from] ParseFloatError),
    #[error("could not parse gcode: {0}")]
    GCode(String),
}

impl<'a> TryInto<Settings> for &'a FormState {
    type Error = FormStateConversionError;

    fn try_into(self) -> Result<Settings, Self::Error> {
        Ok(Settings {
            conversion: ConversionConfig {
                tolerance: self.tolerance.clone()?,
                feedrate: self.feedrate.clone()?,
                dpi: self.dpi.clone()?,
                origin: [
                    self.origin[0].clone().transpose()?,
                    self.origin[1].clone().transpose()?,
                ],
            },
            machine: MachineConfig {
                supported_functionality: SupportedFunctionality {
                    circular_interpolation: self.circular_interpolation,
                },
                tool_on_sequence: self
                    .tool_on_sequence
                    .clone()
                    .transpose()
                    .map_err(FormStateConversionError::GCode)?,
                tool_off_sequence: self
                    .tool_off_sequence
                    .clone()
                    .transpose()
                    .map_err(FormStateConversionError::GCode)?,
                begin_sequence: self
                    .begin_sequence
                    .clone()
                    .transpose()
                    .map_err(FormStateConversionError::GCode)?,
                end_sequence: self
                    .end_sequence
                    .clone()
                    .transpose()
                    .map_err(FormStateConversionError::GCode)?,
            },
            postprocess: PostprocessConfig {
                checksums: self.checksums,
                line_numbers: self.line_numbers,
            },
        })
    }
}

impl From<&Settings> for FormState {
    fn from(settings: &Settings) -> Self {
        Self {
            tolerance: Ok(settings.conversion.tolerance),
            feedrate: Ok(settings.conversion.feedrate),
            circular_interpolation: settings
                .machine
                .supported_functionality
                .circular_interpolation,
            origin: [
                settings.conversion.origin[0].map(Ok),
                settings.conversion.origin[1].map(Ok),
            ],
            dpi: Ok(settings.conversion.dpi),
            tool_on_sequence: settings.machine.tool_on_sequence.clone().map(Ok),
            tool_off_sequence: settings.machine.tool_off_sequence.clone().map(Ok),
            begin_sequence: settings.machine.begin_sequence.clone().map(Ok),
            end_sequence: settings.machine.end_sequence.clone().map(Ok),
            checksums: settings.postprocess.checksums,
            line_numbers: settings.postprocess.line_numbers,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Store)]
#[store(storage = "local", storage_tab_sync)]
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
