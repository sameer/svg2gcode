#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ColorMapping {
    pub rgb: String,
    pub feed: Option<f64>,
    pub power: Option<f64>,
    #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct StrokeWidthMapping {
    pub width_mm: f64,
    pub feed: Option<f64>,
    pub power: Option<f64>,
    #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct LayerMetadata {
    pub name: String,
    pub stroke: Option<String>,
    pub stroke_width: Option<f64>,
    pub feed: Option<f64>,
    pub power: Option<f64>,
    #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
    pub warnings: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ConversionMetadata {
    pub pattern_name: String,
    pub layers: Vec<LayerMetadata>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ColorMappingConfig {
    #[cfg_attr(feature = "serde", serde(default))]
    pub default_feed: Option<f64>,
    #[cfg_attr(feature = "serde", serde(default))]
    pub default_power: Option<f64>,
    pub color_mappings: Vec<ColorMapping>,
    pub stroke_width_mappings: Vec<StrokeWidthMapping>,
}

impl ColorMappingConfig {
    /// Load from JSON file
    #[cfg(feature = "serde")]
    pub fn from_json_file(path: &std::path::Path) -> Result<Self, Box<dyn std::error::Error>> {
        let json = std::fs::read_to_string(path)?;
        let config = serde_json::from_str(&json)?;
        Ok(config)
    }

    /// Find feed/power for a given RGB color
    pub fn lookup_color(&self, rgb: &str) -> Option<(Option<f64>, Option<f64>)> {
        self.color_mappings
            .iter()
            .find(|m| m.rgb.to_lowercase() == rgb.to_lowercase())
            .map(|m| (m.feed, m.power))
    }

    /// Find feed/power for a given stroke width (in mm)
    pub fn lookup_stroke_width(&self, width_mm: f64) -> Option<(Option<f64>, Option<f64>)> {
        self.stroke_width_mappings
            .iter()
            .find(|m| (m.width_mm - width_mm).abs() < 0.01) // Allow 0.01mm tolerance
            .map(|m| (m.feed, m.power))
    }
}
