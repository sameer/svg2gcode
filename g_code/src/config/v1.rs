/// V1 JSON format: `postprocess` had an `origin` field.
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
    pub origin: [f64; 2],
}
