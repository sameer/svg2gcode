use std::path::Path;

use base64::Engine;
use wasm_bindgen::JsCast;
use web_sys::{HtmlElement, window};

pub fn open_svg_in_new_tab(svg_bytes: &[u8]) {
    let array = js_sys::Uint8Array::from(svg_bytes);
    let parts = js_sys::Array::new();
    parts.push(&array);
    let props = web_sys::BlobPropertyBag::new();
    props.set_type("image/svg+xml");
    let blob = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &props).unwrap();
    let url = web_sys::Url::create_object_url_with_blob(&blob).unwrap();
    web_sys::window()
        .unwrap()
        .open_with_url_and_target(&url, "_blank")
        .unwrap();
}

pub fn prompt_download(path: impl AsRef<Path>, content: impl AsRef<[u8]>) {
    let window = window().unwrap();
    let document = window.document().unwrap();
    let hyperlink = document.create_element("a").unwrap();

    let mut href = "data:text/plain;base64,".to_string();
    base64::engine::general_purpose::STANDARD_NO_PAD.encode_string(content, &mut href);
    hyperlink.set_attribute("href", &href).unwrap();
    hyperlink
        .set_attribute("download", &path.as_ref().display().to_string())
        .unwrap();
    hyperlink.unchecked_into::<HtmlElement>().click();
}
