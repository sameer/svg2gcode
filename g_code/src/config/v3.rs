/// V3 JSON format: `postprocess` gained `checksums` and `line_numbers`.
use serde::Deserialize;

use super::v0::{Conversion, Machine};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub conversion: Conversion,
    pub machine: Machine,
    pub postprocess: Postprocess,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Postprocess {
    pub checksums: bool,
    pub line_numbers: bool,
}
