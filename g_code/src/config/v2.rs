/// V2 JSON format: `postprocess` became an empty object.
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
pub struct Postprocess {}
