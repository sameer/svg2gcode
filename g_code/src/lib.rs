//! Implementation of SVG to G-code conversion.

#![cfg_attr(not(test), deny(unused_crate_dependencies))]

use g_code::emit::Token;
use roxmltree::Document;
use rust_decimal::{Decimal, prelude::FromPrimitive};
use svg2star::{
    lower::{ConversionOptions, svg_to_turtle},
    turtle::CoordinateSystem,
};

pub use self::{machine::Machine, turtle::GCodeTurtle};
use crate::config::GCodeConfig;

pub mod config;
/// Emulates the generic state of an arbitrary machine that runs G-Code.
pub mod machine;
/// Drives G-Code generation.
mod turtle;

#[cfg(test)]
mod tests;

/// Top-level function for converting an SVG [`Document`] into g-code
pub fn svg_to_gcode<'a, 'input: 'a>(
    doc: &'a Document,
    config: &GCodeConfig,
    options: ConversionOptions,
    machine: Machine<'input>,
) -> Vec<Token<'input>> {
    let gcode_turtle = self::turtle::GCodeTurtle {
        machine,
        tolerance: Decimal::from_f64(config.tolerance)
            .unwrap_or_default()
            .normalize(),
        feedrate: Decimal::from_f64(config.feedrate)
            .unwrap_or_default()
            .normalize(),
        program: vec![],
    };
    svg_to_turtle(
        doc,
        &config.inner,
        options,
        gcode_turtle,
        CoordinateSystem::YUp,
    )
    .program
}
