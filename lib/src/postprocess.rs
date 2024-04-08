#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Default, Clone, PartialEq)]
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
