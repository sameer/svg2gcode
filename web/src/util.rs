use std::path::Path;
use wasm_bindgen::JsCast;
use web_sys::{window, HtmlElement};

pub fn prompt_download(path: impl AsRef<Path>, content: impl AsRef<[u8]>) {
    let window = window().unwrap();
    let document = window.document().unwrap();
    let hyperlink = document.create_element("a").unwrap();
    let content_base64 = base64::encode(content);
    hyperlink
        .set_attribute(
            "href",
            &format!("data:text/plain;base64,{}", content_base64),
        )
        .unwrap();
    hyperlink
        .set_attribute("download", &path.as_ref().display().to_string())
        .unwrap();
    hyperlink.unchecked_into::<HtmlElement>().click();
}
