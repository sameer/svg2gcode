use gloo_file::{
    callbacks::{read_as_bytes, FileReader},
    futures::read_as_text,
};
use js_sys::TypeError;
use roxmltree::{Document, ParsingOptions};
use std::{convert::TryInto, path::Path};
use svg2gcode::Settings;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use web_sys::{window, Event, FileList, HtmlElement, HtmlInputElement, Response};
use yew::prelude::*;
use yewdux::{functional::use_store, use_dispatch};

use crate::{
    state::{AppState, FormState, Svg},
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
    let app_dispatch = use_dispatch::<AppState>();
    let (form_state, form_dispatch) = use_store::<FormState>();

    let disabled = form_state.tolerance.is_err()
        || form_state.feedrate.is_err()
        || form_state.dpi.is_err()
        || form_state
            .origin
            .iter()
            .all(|opt| opt.as_ref().map_or(false, |r| r.is_err()))
        || form_state
            .tool_on_sequence
            .as_ref()
            .map(Result::is_err)
            .unwrap_or(false)
        || form_state
            .tool_off_sequence
            .as_ref()
            .map(Result::is_err)
            .unwrap_or(false)
        || form_state
            .begin_sequence
            .as_ref()
            .map(Result::is_err)
            .unwrap_or(false)
        || form_state
            .end_sequence
            .as_ref()
            .map(Result::is_err)
            .unwrap_or(false);

    let close_ref = use_node_ref();

    // MDN says on input should fire for checkboxes
    // but historically hasn't been the case, on change is safer.
    let on_circular_interpolation_change =
        form_dispatch.reduce_mut_callback_with(|form, event: Event| {
            form.circular_interpolation =
                event.target_unchecked_into::<HtmlInputElement>().checked();
        });

    let on_checksums_change = form_dispatch.reduce_mut_callback_with(|form, event: Event| {
        form.checksums = event.target_unchecked_into::<HtmlInputElement>().checked();
    });

    let on_line_numbers_change = form_dispatch.reduce_mut_callback_with(|form, event: Event| {
        form.line_numbers = event.target_unchecked_into::<HtmlInputElement>().checked();
    });

    let on_newline_before_comment_change =
        form_dispatch.reduce_mut_callback_with(|form, event: Event| {
            form.newline_before_comment =
                event.target_unchecked_into::<HtmlInputElement>().checked();
        });

    let save_onclick = {
        let close_ref = close_ref.clone();
        let form_state = form_state.clone();
        app_dispatch.reduce_mut_callback(move |app| {
            if !disabled {
                app.settings = form_state.as_ref().try_into().unwrap();
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
                            {" Reloading the page clears unsaved settings."}
                        </p>
                    </>
                )
            }
            body={html!(
                <div class="columns">
                    <div class="column col-6 col-sm-12">
                        <ToleranceInput/>
                    </div>
                    <div class="column col-6 col-sm-12">
                        <FeedrateInput/>
                    </div>
                    <div class="column col-6 col-sm-12">
                        <OriginXInput/>
                    </div>
                    <div class="column col-6 col-sm-12">
                        <OriginYInput/>
                    </div>
                    <div class="column col-12">
                        <FormGroup>
                            <Checkbox
                                label="Enable circular interpolation (experimental)"
                                desc="Please check if your machine supports G2/G3 commands before enabling this"
                                checked={form_state.circular_interpolation}
                                onchange={on_circular_interpolation_change}
                            />
                        </FormGroup>
                    </div>
                    <div class="column col-12">
                        <DpiInput/>
                    </div>
                    <div class="column col-12">
                        <ToolOnSequenceInput/>
                    </div>
                    <div class="column col-12">
                        <ToolOffSequenceInput/>
                    </div>
                    <div class="column col-12">
                        <BeginSequenceInput/>
                    </div>
                    <div class="column col-12">
                        <EndSequenceInput/>
                    </div>
                    <div class="column col-6 col-sm-12">
                        <FormGroup>
                            <Checkbox
                                label="Generate checksums"
                                desc="Useful when streaming g-code"
                                checked={form_state.checksums}
                                onchange={on_checksums_change}
                            />
                        </FormGroup>
                    </div>
                    <div class="column col-6 col-sm-12">
                        <FormGroup>
                            <Checkbox
                                label="Generate line numbers"
                                desc="Useful when streaming g-code or debugging"
                                checked={form_state.line_numbers}
                                onchange={on_line_numbers_change}
                            />
                        </FormGroup>
                    </div>
                    <div class="column col-6 col-sm-12">
                        <FormGroup>
                            <Checkbox
                                label="Newline before comments"
                                desc="Workaround for parsers that don't accept comments on the same line"
                                checked={form_state.newline_before_comment}
                                onchange={on_newline_before_comment_change}
                            />
                        </FormGroup>
                    </div>
                </div>
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
                            title="Close"
                            href="#close"
                            style={ButtonStyle::Default}
                            noderef={close_ref}
                        />
                    </>
                )
            }
        />
    }
}

#[function_component(ImportExportModal)]
pub fn import_export_modal() -> Html {
    let app_dispatch = use_dispatch::<AppState>();
    let form_dispatch = use_dispatch::<FormState>();

    let import_state = use_state(|| Option::<Result<Settings, String>>::None);

    let import_reading = use_state(|| Option::<FileReader>::None);
    let import_reading_setter = import_reading.setter();

    let export_error = use_state(|| Option::<String>::None);
    let export_onclick = {
        let export_error = export_error.clone();
        app_dispatch.reduce_mut_callback(move |app| {
            match serde_json::to_vec_pretty(&app.settings) {
                Ok(settings_json_bytes) => {
                    let filename = "svg2gcode_settings";
                    let filepath = Path::new(&filename).with_extension("json");
                    crate::util::prompt_download(filepath, settings_json_bytes);
                }
                Err(serde_json_err) => {
                    export_error.set(Some(serde_json_err.to_string()));
                }
            }
        })
    };

    let close_ref = use_node_ref();

    let settings_upload_onchange = {
        let import_state = import_state.clone();
        Callback::from(move |file_list: FileList| {
            let import_state = import_state.clone();

            let file = file_list.item(0).unwrap();
            let filename = file.name();
            let import_reading_setter_inner = import_reading_setter.clone();
            import_reading_setter.clone().set(Some(read_as_bytes(
                &gloo_file::File::from(file),
                move |res| {
                    let res = res
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
                    import_reading_setter_inner.set(None);
                },
            )));
        })
    };

    let import_save_onclick = {
        let import_state = import_state.clone();
        let close_ref = close_ref.clone();
        app_dispatch.reduce_mut_callback(move |app| {
            if let Some(Ok(ref settings)) = *import_state {
                app.settings = settings.clone();
                // App only hydrates the form on start now, so need to do it again here
                form_dispatch.reduce_mut(|form| *form = (&app.settings).into());
                import_state.set(None);
                // TODO: another way to close the modal?
                if let Some(element) = close_ref.cast::<HtmlElement>() {
                    element.click();
                }
            }
        })
    };

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
                                        disabled={import_state.as_ref().map_or(true, |r| r.is_err()) || import_reading.is_some()}
                                        title="Save"
                                        onclick={import_save_onclick}
                                        input_group=true
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
                        style={ButtonStyle::Default}
                        title="Close"
                        href="#close"
                        noderef={close_ref}
                    />
                )
            }
        />
    }
}

#[function_component(SvgForm)]
pub fn svg_form() -> Html {
    let app_dispatch = use_dispatch::<AppState>();

    let file_upload_state = use_mut_ref(Vec::default);
    let file_upload_state_cloned = file_upload_state.clone();
    let file_upload_onchange =
        app_dispatch.future_callback_with(move |app, file_list: FileList| {
            let file_upload_state_cloned = file_upload_state_cloned.clone();
            Box::pin(async move {
                let mut results = Vec::with_capacity(file_list.length() as usize);
                for file in (0..file_list.length()).filter_map(|i| file_list.item(i)) {
                    let filename = file.name();
                    results.push(
                        read_as_text(&gloo_file::File::from(file))
                            .await
                            .map_err(|err| err.to_string())
                            .and_then(|text| {
                                if let Some(err) = Document::parse_with_options(
                                    &text,
                                    ParsingOptions {
                                        allow_dtd: true,
                                        ..Default::default()
                                    },
                                )
                                .err()
                                {
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
                // Clear any errors from previous entry, add new successfully parsed SVGs
                (*file_upload_state_cloned).borrow_mut().clear();
                for result in results.iter() {
                    (*file_upload_state_cloned)
                        .borrow_mut()
                        .push(result.clone().map(|_| ()));
                }
                app.reduce_mut(|app| {
                    app.svgs.extend(results.drain(..).filter_map(Result::ok));
                });
            })
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
        Callback::from(move |event: InputEvent| {
            let url = event.target_unchecked_into::<HtmlInputElement>();
            url_input_state.set(Some(url.value()));
            url_input_parsed.set(None);
        })
    };

    let url_add_loading = use_state(|| false);
    let url_add_onclick = {
        let url_input_state = url_input_state.clone();
        let url_input_parsed = url_input_parsed.clone();
        let url_add_loading = url_add_loading.clone();

        app_dispatch.future_callback_with(move |app, _| {
            let url_input_state = url_input_state.clone();
            let url_input_parsed = url_input_parsed.clone();
            let url_add_loading = url_add_loading.clone();
            url_add_loading.set(true);

            let request_url = url_input_state.as_ref().unwrap().clone();
            Box::pin(async move {
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
                        if let Some(err) = Document::parse_with_options(
                            &text,
                            ParsingOptions {
                                allow_dtd: true,
                                ..Default::default()
                            },
                        )
                        .err()
                        {
                            url_input_parsed.set(Some(Err(format!(
                                "Error parsing {}: {}",
                                &response_url, err
                            ))));
                        } else {
                            app.reduce_mut(|app| {
                                app.svgs.push(Svg {
                                    content: text,
                                    filename: response_url,
                                    dimensions: [None; 2],
                                });
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
            })
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
