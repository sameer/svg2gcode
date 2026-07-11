#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
pub use svg2star::lower::{ConversionConfig, ConversionOptions};

/// Deserializes a field that can be either a JSON string or an array of strings.
/// Arrays are joined with newlines into a single string.
/// `null` or a missing field deserializes to `None`.
#[cfg(feature = "serde")]
fn deserialize_string_or_strings<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct StringOrStringsVisitor;

    impl<'de> Visitor<'de> for StringOrStringsVisitor {
        type Value = Option<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("null, a string, or an array of strings")
        }

        fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }

        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }

        fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
            Ok(Some(v.to_owned()))
        }

        fn visit_string<E: de::Error>(self, v: String) -> Result<Self::Value, E> {
            Ok(Some(v))
        }

        fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut parts: Vec<String> = Vec::new();
            while let Some(s) = seq.next_element::<String>()? {
                parts.push(s);
            }
            if parts.is_empty() {
                Ok(None)
            } else {
                Ok(Some(parts.join("\n")))
            }
        }
    }

    deserializer.deserialize_any(StringOrStringsVisitor)
}

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
    #[cfg_attr(
        feature = "serde",
        serde(default, deserialize_with = "deserialize_string_or_strings")
    )]
    pub tool_on_sequence: Option<String>,
    #[cfg_attr(
        feature = "serde",
        serde(default, deserialize_with = "deserialize_string_or_strings")
    )]
    pub tool_off_sequence: Option<String>,
    #[cfg_attr(
        feature = "serde",
        serde(default, deserialize_with = "deserialize_string_or_strings")
    )]
    pub begin_sequence: Option<String>,
    #[cfg_attr(
        feature = "serde",
        serde(default, deserialize_with = "deserialize_string_or_strings")
    )]
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

    fn machine_with_field(field: &str, value_json: &str) -> MachineConfig {
        let json = format!(
            r#"{{"supported_functionality": {{"circular_interpolation": false}}, "{field}": {value_json}}}"#
        );
        serde_json::from_str(&json).unwrap()
    }

    fn machine_config(begin_sequence_json: &str) -> MachineConfig {
        machine_with_field("begin_sequence", begin_sequence_json)
    }

    #[test]
    fn begin_sequence_as_string_deserializes() {
        let config = machine_config(r#""G28 O""#);
        assert_eq!(config.begin_sequence, Some("G28 O".to_owned()));
    }

    #[test]
    fn begin_sequence_as_array_deserializes() {
        let config = machine_config(r#"["G28 O", "G0 X70 Y30 Z2 F4500"]"#);
        assert_eq!(
            config.begin_sequence,
            Some("G28 O\nG0 X70 Y30 Z2 F4500".to_owned())
        );
    }

    #[test]
    fn begin_sequence_as_null_deserializes() {
        let config = machine_config("null");
        assert_eq!(config.begin_sequence, None);
    }

    #[test]
    fn begin_sequence_missing_deserializes() {
        let json = r#"{"supported_functionality": {"circular_interpolation": false}}"#;
        let config: MachineConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.begin_sequence, None);
    }

    #[test]
    fn begin_sequence_empty_array_deserializes() {
        let config = machine_config("[]");
        assert_eq!(config.begin_sequence, None);
    }

    #[test]
    fn tool_on_sequence_as_string_deserializes() {
        let config = machine_with_field("tool_on_sequence", r#""M3 S255""#);
        assert_eq!(config.tool_on_sequence, Some("M3 S255".to_owned()));
    }

    #[test]
    fn tool_on_sequence_as_array_deserializes() {
        let config = machine_with_field("tool_on_sequence", r#"["M3", "S255"]"#);
        assert_eq!(config.tool_on_sequence, Some("M3\nS255".to_owned()));
    }

    #[test]
    fn tool_off_sequence_as_string_deserializes() {
        let config = machine_with_field("tool_off_sequence", r#""M5""#);
        assert_eq!(config.tool_off_sequence, Some("M5".to_owned()));
    }

    #[test]
    fn tool_off_sequence_as_array_deserializes() {
        let config = machine_with_field("tool_off_sequence", r#"["M5", "G4 P0"]"#);
        assert_eq!(config.tool_off_sequence, Some("M5\nG4 P0".to_owned()));
    }

    #[test]
    fn end_sequence_as_string_deserializes() {
        let config = machine_with_field("end_sequence", r#""M2""#);
        assert_eq!(config.end_sequence, Some("M2".to_owned()));
    }

    #[test]
    fn end_sequence_as_array_deserializes() {
        let config = machine_with_field("end_sequence", r#"["G0 X0 Y0", "M2"]"#);
        assert_eq!(config.end_sequence, Some("G0 X0 Y0\nM2".to_owned()));
    }
}
