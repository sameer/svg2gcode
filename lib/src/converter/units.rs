use log::warn;
use roxmltree::Node;
use svgtypes::{Length, LengthListParser};

use crate::Turtle;

use super::ConversionVisitor;

/// The DPI assumed by CSS is 96.
///
/// <https://www.w3.org/TR/css3-values/#absolute-lengths>
pub const CSS_DEFAULT_DPI: f64 = 96.;

/// Used to compute percentages correctly
///
/// <https://www.w3.org/TR/SVG/coords.html#Units>
#[derive(Clone, Copy)]
pub enum DimensionHint {
    Horizontal,
    Vertical,
    Other,
}

impl<'a, T: Turtle> ConversionVisitor<'a, T> {
    /// Convenience function for converting a length attribute to user units
    pub fn length_attr_to_user_units(&self, node: &Node, attr: &str) -> Option<f64> {
        let l = node
            .attribute(attr)
            .map(LengthListParser::from)
            .and_then(|mut parser| parser.next())
            .transpose()
            .ok()
            .flatten()?;

        Some(self.length_to_user_units(
            l,
            match attr {
                "x" | "x1" | "x2" | "cx" | "rx" | "width" => DimensionHint::Horizontal,
                "y" | "y1" | "y2" | "cy" | "ry" | "height" => DimensionHint::Vertical,
                _ => DimensionHint::Other,
            },
        ))
    }
    /// Convenience function for converting [`Length`] to user units
    ///
    /// Absolute lengths are listed in [CSS 4 §6.2](https://www.w3.org/TR/css-values/#absolute-lengths).
    /// Relative lengths in [CSS 4 §6.1](https://www.w3.org/TR/css-values/#relative-lengths) are not supported and will simply be interpreted as millimeters.
    ///
    /// A default DPI of 96 is used as per [CSS 4 §7.4](https://www.w3.org/TR/css-values/#resolution)
    pub fn length_to_user_units(&self, l: Length, hint: DimensionHint) -> f64 {
        use svgtypes::LengthUnit::*;
        use uom::si::f64::Length;
        use uom::si::length::*;

        match l.unit {
            Cm => Length::new::<centimeter>(l.number).get::<inch>() * CSS_DEFAULT_DPI,
            Mm => Length::new::<millimeter>(l.number).get::<inch>() * CSS_DEFAULT_DPI,
            In => Length::new::<inch>(l.number).get::<inch>() * CSS_DEFAULT_DPI,
            Pc => Length::new::<pica_computer>(l.number).get::<inch>() * CSS_DEFAULT_DPI,
            Pt => Length::new::<point_computer>(l.number).get::<inch>() * CSS_DEFAULT_DPI,
            // https://www.w3.org/TR/SVG/coords.html#ViewportSpace says None should be treated as Px
            Px | None => l.number,
            Em | Ex => {
                warn!("Converting from em/ex to millimeters assumes 1em/ex = 16px");
                16. * l.number
            }
            // https://www.w3.org/TR/SVG/coords.html#Units
            Percent => {
                if let Some([width, height]) = self.viewport_dim_stack.last() {
                    let scale = match hint {
                        DimensionHint::Horizontal => *width,
                        DimensionHint::Vertical => *height,
                        DimensionHint::Other => {
                            (width.powi(2) + height.powi(2)).sqrt() / 2.0_f64.sqrt()
                        }
                    };
                    l.number / 100. * scale
                } else {
                    warn!("A percentage without an established viewport is not valid!");
                    l.number / 100.
                }
            }
        }
    }
}
