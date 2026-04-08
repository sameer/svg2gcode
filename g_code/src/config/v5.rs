/// V5 JSON format: explicit `version` field introduced at the top level.
use serde::Deserialize;

use super::v0::{Conversion, Machine};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub conversion: Conversion,
    pub machine: Machine,
    pub postprocess: Postprocess,
    pub version: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Postprocess {
    pub checksums: bool,
    pub line_numbers: bool,
    pub newline_before_comment: bool,
}
