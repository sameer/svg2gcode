//! Implementation of SVG to G-code conversion.

#![cfg_attr(not(test), deny(unused_crate_dependencies))]

use g_code::emit::Token;
use roxmltree::Document;
use svg2star::{
    lower::{ConversionOptions, svg_to_turtle},
    turtle::CoordinateSystem,
};

pub use self::{machine::Machine, turtle::GCodeTurtle};
use crate::config::GCodeConfig;

pub mod config;
pub mod layer_metadata;
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
        tolerance: config.tolerance,
        feedrate: config.feedrate,
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

/// Extract layer metadata from SVG document
pub fn extract_layer_metadata(doc: &Document) -> layer_metadata::ConversionMetadata {
    use layer_metadata::LayerMetadata;

    let root = doc.root_element();
    let pattern_name = extract_filename_from_doc(doc);

    let mut layers = Vec::new();

    // Find all group elements that represent layers
    for child in root.children() {
        if child.tag_name().name() == "g" {
            if let Some(layer) = extract_layer_from_group(child) {
                layers.push(layer);
            }
        }
    }

    layer_metadata::ConversionMetadata {
        pattern_name,
        layers,
    }
}

fn extract_filename_from_doc(doc: &Document) -> String {
    doc.root_element()
        .attribute("data-pattern-name")
        .or_else(|| doc.root_element().attribute("id"))
        .unwrap_or("pattern")
        .to_string()
}

fn extract_layer_from_group(group: roxmltree::Node) -> Option<layer_metadata::LayerMetadata> {
    let name = group
        .attribute("id")
        .or_else(|| group.attribute("data-name"))
        .or_else(|| group.attribute("label"))?
        .to_string();

    let stroke = group
        .attribute("stroke")
        .or_else(|| {
            group
                .attribute("style")
                .and_then(|style| parse_css_property(style, "stroke"))
        })
        .map(|s| s.to_string());

    let stroke_width = group
        .attribute("stroke-width")
        .or_else(|| {
            group
                .attribute("style")
                .and_then(|style| parse_css_property(style, "stroke-width"))
        })
        .and_then(|s| parse_dimension(s));

    Some(layer_metadata::LayerMetadata {
        name,
        stroke,
        stroke_width,
        feed: None,
        power: None,
        warnings: None,
    })
}

fn parse_css_property<'a>(style: &'a str, prop_name: &str) -> Option<&'a str> {
    style.split(';').find_map(|decl| {
        let (k, v) = decl.split_once(':')?;
        (k.trim() == prop_name).then(|| v.trim())
    })
}

fn parse_dimension(s: &str) -> Option<f64> {
    s.trim_end_matches("mm")
        .trim_end_matches("px")
        .trim_end_matches("pt")
        .trim()
        .parse()
        .ok()
}
