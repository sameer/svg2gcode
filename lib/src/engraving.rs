#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};

const DEFAULT_DMA_MACHINE_WIDTH_MM: f64 = 20.0;
const DEFAULT_DMA_MACHINE_HEIGHT_MM: f64 = 20.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum ToolShape {
    Flat,
    Ball,
    V,
}

impl Default for ToolShape {
    fn default() -> Self {
        Self::Flat
    }
}

impl fmt::Display for ToolShape {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Flat => f.write_str("flat"),
            Self::Ball => f.write_str("ball"),
            Self::V => f.write_str("v"),
        }
    }
}

impl FromStr for ToolShape {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "flat" => Ok(Self::Flat),
            "ball" => Ok(Self::Ball),
            "v" | "v-bit" | "vbit" => Ok(Self::V),
            _ => Err("tool shape must be one of: flat, ball, v"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct EngravingConfig {
    #[cfg_attr(feature = "serde", serde(default))]
    pub enabled: bool,
    pub material_width: f64,
    pub material_height: f64,
    pub material_thickness: f64,
    pub tool_diameter: f64,
    #[cfg_attr(feature = "serde", serde(default))]
    pub tool_shape: ToolShape,
    pub target_depth: f64,
    pub max_stepdown: f64,
    pub cut_feedrate: f64,
    pub plunge_feedrate: f64,
    pub stepover: f64,
    #[cfg_attr(feature = "serde", serde(default))]
    pub svg_width_override: Option<f64>,
    #[cfg_attr(feature = "serde", serde(default))]
    pub placement_x: f64,
    #[cfg_attr(feature = "serde", serde(default))]
    pub placement_y: f64,
    #[cfg_attr(feature = "serde", serde(default))]
    pub machine_width: f64,
    #[cfg_attr(feature = "serde", serde(default))]
    pub machine_height: f64,
}

impl Default for EngravingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            material_width: DEFAULT_DMA_MACHINE_WIDTH_MM,
            material_height: DEFAULT_DMA_MACHINE_HEIGHT_MM,
            material_thickness: 18.0,
            tool_diameter: 6.0,
            tool_shape: ToolShape::Flat,
            target_depth: 1.0,
            max_stepdown: 1.0,
            cut_feedrate: 300.0,
            plunge_feedrate: 120.0,
            stepover: 2.0,
            svg_width_override: None,
            placement_x: 0.0,
            placement_y: 0.0,
            machine_width: DEFAULT_DMA_MACHINE_WIDTH_MM,
            machine_height: DEFAULT_DMA_MACHINE_HEIGHT_MM,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct EngravingOperation {
    pub id: String,
    pub name: String,
    pub selector_filter: String,
    pub target_depth: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum GenerationWarning {
    MaterialBoundsExceeded,
    MachineBoundsExceeded,
    DepthExceedsMaterialThickness,
    ToolTooLargeForFill,
}

impl GenerationWarning {
    pub fn message(&self) -> &'static str {
        match self {
            Self::MaterialBoundsExceeded => "Toolpath extends beyond the configured material size.",
            Self::MachineBoundsExceeded => {
                "Toolpath extends beyond the configured DMA machine envelope."
            }
            Self::DepthExceedsMaterialThickness => {
                "Target depth exceeds the configured material thickness."
            }
            Self::ToolTooLargeForFill => {
                "At least one filled region is too small for the selected tool diameter."
            }
        }
    }
}
