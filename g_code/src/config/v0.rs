/// Shared types for the V1–V5 JSON format.
///
/// `conversion` held `tolerance`, `feedrate`, and `dpi`.
/// `machine` held `supported_functionality` and the sequence strings.
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Conversion {
    pub tolerance: f64,
    pub feedrate: f64,
    pub dpi: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Machine {
    pub supported_functionality: SupportedFunctionality,
    pub tool_on_sequence: Option<String>,
    pub tool_off_sequence: Option<String>,
    pub begin_sequence: Option<String>,
    pub end_sequence: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SupportedFunctionality {
    pub circular_interpolation: bool,
}
