use std::{convert::TryInto, num::ParseFloatError};

use serde::{Deserialize, Serialize};
use svg2gcode::{
    ConversionConfig, EngravingConfig, GenerationWarning, MachineConfig, PostprocessConfig,
    Settings, SupportedFunctionality, ToolShape, Version,
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
    pub optimize_path_order: bool,
    pub dpi: Result<f64, ParseFloatError>,
    pub engraving_enabled: bool,
    pub material_width: Result<f64, ParseFloatError>,
    pub material_height: Result<f64, ParseFloatError>,
    pub material_thickness: Result<f64, ParseFloatError>,
    pub tool_diameter: Result<f64, ParseFloatError>,
    pub tool_shape: ToolShape,
    pub target_depth: Result<f64, ParseFloatError>,
    pub max_stepdown: Result<f64, ParseFloatError>,
    pub cut_feedrate: Result<f64, ParseFloatError>,
    pub stepover: Result<f64, ParseFloatError>,
    pub svg_width_override: Option<Result<f64, ParseFloatError>>,
    pub placement_x: Result<f64, ParseFloatError>,
    pub placement_y: Result<f64, ParseFloatError>,
    pub travel_z: Option<Result<f64, ParseFloatError>>,
    pub cut_z: Option<Result<f64, ParseFloatError>>,
    pub plunge_feedrate: Option<Result<f64, ParseFloatError>>,
    pub path_begin_sequence: Option<Result<String, String>>,
    pub tool_on_sequence: Option<Result<String, String>>,
    pub tool_off_sequence: Option<Result<String, String>>,
    pub begin_sequence: Option<Result<String, String>>,
    pub end_sequence: Option<Result<String, String>>,
    pub checksums: bool,
    pub line_numbers: bool,
    pub newline_before_comment: bool,
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
    #[error("Z motion requires both Travel Z and Cut Z")]
    IncompleteZMotion,
}

impl TryInto<Settings> for &FormState {
    type Error = FormStateConversionError;

    fn try_into(self) -> Result<Settings, Self::Error> {
        if self.travel_z.is_some() != self.cut_z.is_some() {
            return Err(FormStateConversionError::IncompleteZMotion);
        }
        Ok(Settings {
            conversion: ConversionConfig {
                tolerance: self.tolerance.clone()?,
                feedrate: self.feedrate.clone()?,
                dpi: self.dpi.clone()?,
                origin: [
                    self.origin[0].clone().transpose()?,
                    self.origin[1].clone().transpose()?,
                ],
                extra_attribute_name: None,
                optimize_path_order: self.optimize_path_order,
                selector_filter: None,
            },
            engraving: EngravingConfig {
                enabled: self.engraving_enabled,
                material_width: self.material_width.clone()?,
                material_height: self.material_height.clone()?,
                material_thickness: self.material_thickness.clone()?,
                tool_diameter: self.tool_diameter.clone()?,
                tool_shape: self.tool_shape,
                target_depth: self.target_depth.clone()?,
                max_stepdown: self.max_stepdown.clone()?,
                cut_feedrate: self.cut_feedrate.clone()?,
                plunge_feedrate: self.plunge_feedrate.clone().transpose()?.unwrap_or(120.0),
                stepover: self.stepover.clone()?,
                svg_width_override: self.svg_width_override.clone().transpose()?,
                placement_x: self.placement_x.clone()?,
                placement_y: self.placement_y.clone()?,
                ..self_defaults_engraving()
            },
            machine: MachineConfig {
                supported_functionality: SupportedFunctionality {
                    circular_interpolation: self.circular_interpolation,
                },
                travel_z: self.travel_z.clone().transpose()?,
                cut_z: self.cut_z.clone().transpose()?,
                plunge_feedrate: self.plunge_feedrate.clone().transpose()?,
                path_begin_sequence: self
                    .path_begin_sequence
                    .clone()
                    .transpose()
                    .map_err(FormStateConversionError::GCode)?,
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
                newline_before_comment: self.newline_before_comment,
            },
            version: Version::latest(),
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
            optimize_path_order: settings.conversion.optimize_path_order,
            origin: [
                settings.conversion.origin[0].map(Ok),
                settings.conversion.origin[1].map(Ok),
            ],
            dpi: Ok(settings.conversion.dpi),
            engraving_enabled: settings.engraving.enabled,
            material_width: Ok(settings.engraving.material_width),
            material_height: Ok(settings.engraving.material_height),
            material_thickness: Ok(settings.engraving.material_thickness),
            tool_diameter: Ok(settings.engraving.tool_diameter),
            tool_shape: settings.engraving.tool_shape,
            target_depth: Ok(settings.engraving.target_depth),
            max_stepdown: Ok(settings.engraving.max_stepdown),
            cut_feedrate: Ok(settings.engraving.cut_feedrate),
            stepover: Ok(settings.engraving.stepover),
            svg_width_override: settings.engraving.svg_width_override.map(Ok),
            placement_x: Ok(settings.engraving.placement_x),
            placement_y: Ok(settings.engraving.placement_y),
            travel_z: settings.machine.travel_z.map(Ok),
            cut_z: settings.machine.cut_z.map(Ok),
            plunge_feedrate: settings.machine.plunge_feedrate.map(Ok),
            path_begin_sequence: settings.machine.path_begin_sequence.clone().map(Ok),
            tool_on_sequence: settings.machine.tool_on_sequence.clone().map(Ok),
            tool_off_sequence: settings.machine.tool_off_sequence.clone().map(Ok),
            begin_sequence: settings.machine.begin_sequence.clone().map(Ok),
            end_sequence: settings.machine.end_sequence.clone().map(Ok),
            checksums: settings.postprocess.checksums,
            line_numbers: settings.postprocess.line_numbers,
            newline_before_comment: settings.postprocess.newline_before_comment,
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
    #[serde(skip)]
    pub generation_warnings: Vec<GenerationWarning>,
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
            generation_warnings: vec![],
        }
    }
}

fn self_defaults_engraving() -> EngravingConfig {
    EngravingConfig::default()
}
