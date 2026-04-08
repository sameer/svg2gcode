#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
pub use svg2star::lower::{ConversionConfig, ConversionOptions};

#[cfg(all(test, feature = "serde"))]
#[allow(dead_code)]
mod v0;
#[cfg(all(test, feature = "serde"))]
#[allow(dead_code)]
mod v1;
#[cfg(all(test, feature = "serde"))]
#[allow(dead_code)]
mod v2;
#[cfg(all(test, feature = "serde"))]
#[allow(dead_code)]
mod v3;
#[cfg(all(test, feature = "serde"))]
#[allow(dead_code)]
mod v4;
#[cfg(all(test, feature = "serde"))]
#[allow(dead_code)]
mod v5;

/// A cross-platform type used to store all configuration types.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Settings {
    pub conversion: GCodeConfig,
    pub machine: MachineConfig,
    pub postprocess: PostprocessConfig,
    #[cfg_attr(feature = "serde", serde(default = "Version::unknown"))]
    pub version: Version,
}

#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Default, Clone, PartialEq)]
pub struct MachineConfig {
    pub supported_functionality: SupportedFunctionality,
    pub tool_on_sequence: Option<String>,
    pub tool_off_sequence: Option<String>,
    pub begin_sequence: Option<String>,
    pub end_sequence: Option<String>,
}

#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone, PartialEq)]
pub struct GCodeConfig {
    #[cfg_attr(feature = "serde", serde(flatten))]
    pub inner: ConversionConfig,
    pub tolerance: f64,
    pub feedrate: f64,
}

impl Default for GCodeConfig {
    fn default() -> Self {
        Self {
            inner: Default::default(),
            tolerance: 0.002,
            feedrate: 300.0,
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct SupportedFunctionality {
    /// Indicates support for G2/G3 circular interpolation.
    ///
    /// Most modern machines support this. Old ones like early MakerBot 3D printers do not.
    pub circular_interpolation: bool,
}

#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Default, Clone, PartialEq)]
/// Operations performed after G-Code generation.
pub struct PostprocessConfig {
    /// Convenience field for [g_code::emit::FormatOptions] field
    #[cfg_attr(feature = "serde", serde(default))]
    pub checksums: bool,
    /// Convenience field for [g_code::emit::FormatOptions] field
    #[cfg_attr(feature = "serde", serde(default))]
    pub line_numbers: bool,
    /// Convenience field for [g_code::emit::FormatOptions] field
    #[cfg_attr(feature = "serde", serde(default))]
    pub newline_before_comment: bool,
}

impl Settings {
    /// Try to automatically upgrade the supported version.
    ///
    /// This will return an error if:
    ///
    /// - Settings version is [`Version::Unknown`].
    /// - There are breaking changes requiring manual intervention. In which case this does a partial update to that point.
    pub fn try_upgrade(&mut self) -> Result<(), &'static str> {
        loop {
            match self.version {
                // Compatibility for M2 by default
                Version::V0 => {
                    self.machine.end_sequence = Some(format!(
                        "{} M2",
                        self.machine.end_sequence.take().unwrap_or_default()
                    ));
                    self.version = Version::V5;
                }
                Version::V5 => break Ok(()),
                Version::Unknown(_) => break Err("cannot upgrade unknown version"),
            }
        }
    }
}

/// Used to control behavioral changes for [`Settings`].
///
/// There were already 3 non-breaking version bumps (V1 -> V4) so versioning starts off with [`Version::V5`].
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Version {
    /// Implicitly versioned settings from before this type was introduced.
    V0,
    /// M2 is no longer appended to the program by default.
    V5,
    #[cfg_attr(feature = "serde", serde(untagged))]
    Unknown(String),
}

impl Version {
    /// Returns the most recent [`Version`]. This is useful for asking users to upgrade externally-stored settings.
    pub const fn latest() -> Self {
        Self::V5
    }

    /// Default version for old settings.
    pub const fn unknown() -> Self {
        Self::V0
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Version::V0 => f.write_str("V0"),
            Version::V5 => f.write_str("V5"),
            Version::Unknown(unknown) => f.write_str(unknown),
        }
    }
}

impl Default for Version {
    fn default() -> Self {
        Self::latest()
    }
}

#[cfg(all(test, feature = "serde"))]
mod tests {
    use super::*;

    #[test]
    fn deserialize_v1_config_succeeds() {
        let json = r#"
        {
            "conversion": {
              "tolerance": 0.002,
              "feedrate": 300.0,
              "dpi": 96.0
            },
            "machine": {
              "supported_functionality": {
                "circular_interpolation": true
              },
              "tool_on_sequence": null,
              "tool_off_sequence": null,
              "begin_sequence": null,
              "end_sequence": null
            },
            "postprocess": {
              "origin": [
                0.0,
                0.0
              ]
            }
          }
        "#;
        serde_json::from_str::<v1::Settings>(json).unwrap();
    }

    #[test]
    fn deserialize_v2_config_succeeds() {
        let json = r#"
        {
            "conversion": {
              "tolerance": 0.002,
              "feedrate": 300.0,
              "dpi": 96.0
            },
            "machine": {
              "supported_functionality": {
                "circular_interpolation": true
              },
              "tool_on_sequence": null,
              "tool_off_sequence": null,
              "begin_sequence": null,
              "end_sequence": null
            },
            "postprocess": { }
          }
        "#;
        serde_json::from_str::<v2::Settings>(json).unwrap();
    }

    #[test]
    fn deserialize_v3_config_succeeds() {
        let json = r#"
        {
            "conversion": {
              "tolerance": 0.002,
              "feedrate": 300.0,
              "dpi": 96.0
            },
            "machine": {
              "supported_functionality": {
                "circular_interpolation": true
              },
              "tool_on_sequence": null,
              "tool_off_sequence": null,
              "begin_sequence": null,
              "end_sequence": null
            },
            "postprocess": {
                "checksums": false,
                "line_numbers": false
            }
          }
        "#;
        serde_json::from_str::<v3::Settings>(json).unwrap();
    }

    #[test]
    fn deserialize_v4_config_succeeds() {
        let json = r#"
        {
            "conversion": {
              "tolerance": 0.002,
              "feedrate": 300.0,
              "dpi": 96.0
            },
            "machine": {
              "supported_functionality": {
                "circular_interpolation": true
              },
              "tool_on_sequence": null,
              "tool_off_sequence": null,
              "begin_sequence": null,
              "end_sequence": null
            },
            "postprocess": {
                "checksums": false,
                "line_numbers": false,
                "newline_before_comment": false
            }
          }
        "#;
        serde_json::from_str::<v4::Settings>(json).unwrap();
    }

    #[test]
    fn deserialize_v5_config_succeeds() {
        let json = r#"
        {
            "conversion": {
              "tolerance": 0.002,
              "feedrate": 300.0,
              "dpi": 96.0
            },
            "machine": {
              "supported_functionality": {
                "circular_interpolation": true
              },
              "tool_on_sequence": null,
              "tool_off_sequence": null,
              "begin_sequence": null,
              "end_sequence": null
            },
            "postprocess": {
                "checksums": false,
                "line_numbers": false,
                "newline_before_comment": false
            },
            "version": "V5"
          }
        "#;
        serde_json::from_str::<v5::Settings>(json).unwrap();
    }
}
