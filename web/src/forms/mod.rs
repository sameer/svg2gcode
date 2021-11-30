use gloo_file::futures::{read_as_bytes, read_as_text};
use js_sys::TypeError;
use roxmltree::Document;
use std::{convert::TryInto, path::Path};
use svg2gcode::Settings;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use web_sys::{window, FileList, HtmlElement, Response};
use yew::prelude::*;
use yewdux::prelude::{BasicStore, Dispatcher};
use yewdux_functional::use_store;

use crate::{
    state::{AppStore, FormState, Svg},
    ui::{
        Button, ButtonStyle, Checkbox, FileUpload, FormGroup, HyperlinkButton, Icon, IconName,
        Input, InputType, Modal,
    },
};

mod editors;
mod inputs;

use editors::*;
use inputs::*;

#[function_component(SettingsForm)]
pub fn settings_form() -> Html {
    let app = use_store::<AppStore>();
    let form = use_store::<BasicStore<FormState>>();

    // let handle = use_state(|| None);
    let disabled = form
        .state()
        .map(|state| {
            state.tolerance.is_err()
                || state.feedrate.is_err()
                || state.dpi.is_err()
                || state.origin.iter().all(Result::is_err)
                || state
                    .tool_on_sequence
                    .as_ref()
                    .map(Result::is_err)
                    .unwrap_or(false)
                || state
                    .tool_off_sequence
                    .as_ref()
                    .map(Result::is_err)
                    .unwrap_or(false)
                || state
                    .begin_sequence
                    .as_ref()
                    .map(Result::is_err)
                    .unwrap_or(false)
                || state
                    .end_sequence
                    .as_ref()
                    .map(Result::is_err)
                    .unwrap_or(false)
        })
        .unwrap_or(true);

    let close_ref = NodeRef::default();

    let on_circular_interpolation_change =
        form.dispatch().reduce_callback_with(|form, change_data| {
            if let ChangeData::Value(_) = change_data {
                form.circular_interpolation = !form.circular_interpolation;
            }
        });
    let circular_interpolation_checked = form
        .state()
        .map(|state| state.circular_interpolation)
        .unwrap_or(false);

    let save_onclick = {
        let close_ref = close_ref.clone();
        app.dispatch().reduce_callback(move |app| {
            if let (false, Some(form)) = (disabled, form.state()) {
                app.settings = form.as_ref().try_into().unwrap();

                // TODO: this is a poor man's crutch for closing the Modal.
                // There is probably a better way.
                if let Some(element) = close_ref.cast::<HtmlElement>() {
                    element.click();
                }
            }
        })
    };

    html! {
        <Modal
            id="settings"
            header={
                html!(
                    <>
                        <h2>{ "Settings" }</h2>
                        <p>{"Persisted using "}
                            // Opening new tabs is usually bad.
                            // But if we don't, the user is at risk of losing the settings they've entered so far.
                            <a href="https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage" target="_blank">
                                {"local storage"}
                            </a>
                            {"."}
                        </p>
                    </>
                )
            }
            body={html!(
                <>
                    <ToleranceInput/>
                    <FeedrateInput/>
                    <OriginXInput/>
                    <OriginYInput/>
                    <FormGroup>
                        <Checkbox
                            label="Enable circular interpolation"
                            desc="Please check if your machine supports G2/G3 commands before enabling this"
                            checked={circular_interpolation_checked}
                            onchange={on_circular_interpolation_change}
                        />
                    </FormGroup>
                    <DpiInput/>
                    <ToolOnSequenceInput/>
                    <ToolOffSequenceInput/>
                    <BeginSequenceInput/>
                    <EndSequenceInput/>
                </>
            )}
            footer={
                html!(
                    <>
                        <HyperlinkButton
                            title="Import/Export"
                            href="#import_export"
                            style={ButtonStyle::Default}
                            disabled={disabled}
                            icon={IconName::Copy}
                        />
                        {" "}
                        <Button
                            title="Save"
                            style={ButtonStyle::Primary}
                            disabled={disabled}
                            onclick={save_onclick}
                        />
                        {" "}
                        <HyperlinkButton
                            ref={close_ref}
                            title="Close"
                            href="#close"
                            style={ButtonStyle::Default}
                        />
                    </>
                )
            }
        />
    }
}

#[function_component(ImportExportModal)]
pub fn import_export_modal() -> Html {
    let app = use_store::<AppStore>();
    let import_state = use_state(|| Option::<Result<Settings, String>>::None);

    let export_error = use_state(|| Option::<String>::None);
    let export_onclick = {
        let export_error = export_error.clone();
        app.dispatch()
            .reduce_callback(move |app| match serde_json::to_vec_pretty(&app.settings) {
                Ok(settings_json_bytes) => {
                    let filename = "svg2gcode_settings";
                    let filepath = Path::new(&filename).with_extension("json");
                    crate::util::prompt_download(&filepath, &settings_json_bytes);
                }
                Err(serde_json_err) => {
                    export_error.set(Some(serde_json_err.to_string()));
                }
            })
    };

    let settings_upload_onchange = {
        let import_state = import_state.clone();
        app.dispatch()
            .future_callback_with(move |app, file_list: FileList| {
                let import_state = import_state.clone();
                async move {
                    let file = file_list.item(0).unwrap();
                    let filename = file.name();

                    let res = read_as_bytes(&gloo_file::File::from(file))
                        .await
                        .map_err(|err| format!("Error reading {}: {}", &filename, err))
                        .and_then(|bytes| {
                            serde_json::from_slice::<Settings>(&bytes)
                                .map_err(|err| format!("Error parsing {}: {}", &filename, err))
                        });

                    match res {
                        Ok(settings) => {
                            import_state.set(Some(Ok(settings)));
                        }
                        Err(err) => {
                            import_state.set(Some(Err(err)));
                        }
                    }
                }
            })
    };

    let import_save_onclick = {
        let import_state = import_state.clone();
        app.dispatch().reduce_callback(move |app| {
            if let Some(Ok(ref settings)) = *import_state {
                app.settings = settings.clone();
                import_state.set(None);
            }
        })
    };

    let close_ref = NodeRef::default();

    html! {
        <Modal
            id="import_export"
            header={html!(
                <>
                    <h2>{"Import/Export Settings"}</h2>
                    <p>{"Uses JSON, compatible with the "}<a href="https://github.com/sameer/svg2gcode/releases">{"command line interface"}</a>{"."}</p>
                </>
            )}
            body={
                html!(
                    <>
                        <h3>{"Import"}</h3>
                        <FormGroup success={import_state.as_ref().map(Result::is_ok)}>
                            <FileUpload<Settings, String>
                                label="Select settings JSON file"
                                accept=".json"
                                multiple={false}
                                onchange={settings_upload_onchange}
                                parsed={(*import_state).clone()}
                                button={html_nested!(
                                    <Button
                                        style={ButtonStyle::Primary}
                                        disabled={import_state.is_none()}
                                        title="Save"
                                        onclick={import_save_onclick}
                                    />
                                )}
                            />
                        </FormGroup>

                        <h3>{"Export"}</h3>
                        <Button
                            style={ButtonStyle::Primary}
                            disabled={false}
                            title="Download as JSON"
                            icon={html_nested!(<Icon name={IconName::Download}/>)}
                            onclick={export_onclick}
                        />
                        {
                            if let Some(ref err) = *export_error {
                                html!{
                                    <pre class="text-error">{ err }</pre>
                                }
                            } else {
                                html!{}
                            }
                        }
                    </>
                )
            }
            footer={
                html!(
                    <HyperlinkButton
                        ref={close_ref}
                        style={ButtonStyle::Default}
                        title="Close"
                        href="#close"
                    />
                )
            }
        />
    }
}

#[function_component(SvgForm)]
pub fn svg_form() -> Html {
    let app = use_store::<AppStore>();

    let file_upload_state = use_ref(Vec::default);
    let file_upload_state_cloned = file_upload_state.clone();
    let file_upload_onchange =
        app.dispatch()
            .future_callback_with(move |app, file_list: FileList| {
                let file_upload_state_cloned = file_upload_state_cloned.clone();
                async move {
                    let mut results = Vec::with_capacity(file_list.length() as usize);
                    for file in (0..file_list.length()).filter_map(|i| file_list.item(i)) {
                        let filename = file.name();
                        results.push(
                            read_as_text(&gloo_file::File::from(file))
                                .await
                                .map_err(|err| err.to_string())
                                .and_then(|text| {
                                    if let Some(err) = Document::parse(&text).err() {
                                        Err(format!("Error parsing {}: {}", &filename, err))
                                    } else {
                                        Ok(Svg {
                                            content: text,
                                            filename,
                                            dimensions: [None; 2],
                                        })
                                    }
                                }),
                        );
                    }
                    app.reduce(move |app| {
                        // Clear any errors from previous entry, add new successfully parsed SVGs
                        (*file_upload_state_cloned).borrow_mut().clear();
                        for result in results.iter() {
                            (*file_upload_state_cloned)
                                .borrow_mut()
                                .push(result.clone().map(|_| ()));
                        }
                        app.svgs.extend(results.drain(..).filter_map(Result::ok));
                    });
                }
            });

    let file_upload_errors = file_upload_state
        .borrow()
        .iter()
        .filter_map(|res| res.as_ref().err())
        .cloned()
        .collect::<Vec<_>>();
    let file_upload_res = if file_upload_state.borrow().is_empty() {
        None
    } else if file_upload_errors.is_empty() {
        Some(Ok(()))
    } else {
        Some(Err(file_upload_errors.join("\n")))
    };

    let url_input_state = use_state(|| Option::<String>::None);
    let url_input_parsed = use_state(|| Option::<Result<String, String>>::None);
    let url_input_oninput = {
        let url_input_state = url_input_state.clone();
        let url_input_parsed = url_input_parsed.clone();
        Callback::from(move |url: InputData| {
            url_input_state.set(Some(url.value));
            url_input_parsed.set(None);
        })
    };

    let url_add_loading = use_state(|| false);
    let url_add_onclick = {
        let url_input_state = url_input_state.clone();
        let url_input_parsed = url_input_parsed.clone();
        let url_add_loading = url_add_loading.clone();

        app.dispatch().future_callback_with(move |app, _| {
            let url_input_state = url_input_state.clone();
            let url_input_parsed = url_input_parsed.clone();
            let url_add_loading = url_add_loading.clone();
            url_add_loading.set(true);

            let request_url = url_input_state.as_ref().unwrap().clone();
            async move {
                url_input_parsed.set(None);
                let res = JsFuture::from(window().unwrap().fetch_with_str(&request_url))
                    .await
                    .map(JsCast::unchecked_into::<Response>);
                url_add_loading.set(false);
                match res {
                    Ok(res) => {
                        let response_url = res.url();
                        let text = JsFuture::from(res.text().unwrap())
                            .await
                            .unwrap()
                            .as_string()
                            .unwrap();
                        if let Some(err) = Document::parse(&text).err() {
                            url_input_parsed.set(Some(Err(format!(
                                "Error parsing {}: {}",
                                &response_url, err
                            ))));
                        } else {
                            app.reduce(move |app| {
                                app.svgs.push(Svg {
                                    content: text,
                                    filename: response_url,
                                    dimensions: [None; 2],
                                })
                            });
                        };
                    }
                    Err(err) => {
                        url_input_parsed.set(Some(Err(format!(
                            "Error fetching {}: {:?}",
                            &request_url,
                            err.dyn_into::<TypeError>().unwrap().message()
                        ))));
                    }
                }
            }
        })
    };

    html! {
        <FormGroup success={file_upload_res.as_ref().map(Result::is_ok).or_else(|| url_input_parsed.as_ref().map(Result::is_ok))}>
            <FileUpload<(), String>
                label="Select SVG files"
                accept=".svg"
                multiple={true}
                onchange={file_upload_onchange}
            />
            <div class="divider text-center" data-content="OR"/>
            <Input<String, String>
                label="Add an SVG file by URL"
                r#type={InputType::Url}
                placeholder="https://raw.githubusercontent.com/sameer/svg2gcode/master/examples/Vanderbilt_Commodores_logo.svg"
                oninput={url_input_oninput}
                button={html_nested!(
                    <Button
                        style={ButtonStyle::Primary}
                        title="Add"
                        input_group=true
                        disabled={(*url_input_state).is_none()}
                        onclick={url_add_onclick}
                        loading={*url_add_loading}
                    />
                )}
                parsed={(*url_input_parsed).clone()}
            />
        </FormGroup>
    }
}
