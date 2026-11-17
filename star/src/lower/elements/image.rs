//! SVG image processing.

use std::str::FromStr;

use base64::{Engine, engine::general_purpose::STANDARD};
use log::warn;
use roxmltree::Node;
use svgtypes::{Align, AspectRatio, ViewBox};

use crate::{
    lower::{ConversionVisitor, transform::get_viewport_transform},
    turtle::Turtle,
};

pub const IMAGE_TAG_NAME: &str = "image";

pub struct ImageElement<'a, 'input>(pub Node<'a, 'input>);

impl<'a, 'input> ImageElement<'a, 'input> {
    pub fn render<T: Turtle>(&self, visitor: &mut ConversionVisitor<'a, 'input, T>) {
        let node = self.0;
        let Some(href) = node
            .attribute("href")
            .or_else(|| node.attribute(("http://www.w3.org/1999/xlink", "href")))
        else {
            warn!("image element has no href: {node:?}");
            return;
        };
        let Some(b64) = href
            .strip_prefix("data:image/png;base64,")
            .or_else(|| href.strip_prefix("data:image/jpeg;base64,"))
        else {
            warn!("Unsupported image href {href}");
            return;
        };

        let b64_no_whitespace: String = b64.chars().filter(|c| !c.is_ascii_whitespace()).collect();
        let bytes = match STANDARD.decode(&b64_no_whitespace) {
            Ok(bytes) => bytes,
            Err(err) => {
                warn!("image base64 decode failed: {err}");
                return;
            }
        };
        let image = match image::load_from_memory(&bytes) {
            Ok(img) => img,
            Err(e) => {
                warn!("image decode failed: {e}");
                return;
            }
        };

        let [x, y, width, height] = ["x", "y", "width", "height"].map(|a| {
            visitor
                .viewport
                .length_attr_to_user_units(node, a)
                .unwrap_or(0.)
        });

        let preserve_aspect_ratio = node.attribute("preserveAspectRatio").map_or(
            AspectRatio {
                defer: false,
                align: Align::XMidYMid,
                slice: false,
            },
            |attr| AspectRatio::from_str(attr).expect("could not parse preserveAspectRatio"),
        );

        let view_box = ViewBox {
            x: 0.,
            y: 0.,
            w: f64::from(image.width()),
            h: f64::from(image.height()),
        };
        let image_to_user = get_viewport_transform(
            view_box,
            Some(preserve_aspect_ratio),
            [width, height],
            [Some(x), Some(y)],
        );

        visitor.comment();
        visitor
            .terrarium
            .image(image, image_to_user, preserve_aspect_ratio);
    }
}
