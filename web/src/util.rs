use base64::Engine;
use std::path::Path;
use wasm_bindgen::JsCast;
use web_sys::{window, HtmlElement};

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
