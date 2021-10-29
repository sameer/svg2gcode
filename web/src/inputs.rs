use codespan_reporting::term::{emit, termcolor::NoColor, Config};
use g_code::parse::{into_diagnostic, snippet_parser};
use gloo_file::futures::read_as_text;
use gloo_timers::callback::Timeout;
use js_sys::TypeError;
use log::info;
use paste::paste;
use roxmltree::Document;
use std::num::ParseFloatError;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use web_sys::{window, FileList, HtmlElement, Response};
use yew::prelude::*;
use yewdux::prelude::{BasicStore, Dispatcher};
use yewdux_functional::use_store;
use yewdux_input::*;

use crate::{
    spectre::*,
    state::{AppState, AppStore, FormState, FormStore, Svg},
};

// TODO: make a nice, syntax highlighting editor for g-code.
// I started on this but it quickly got too complex.
// pub struct GCodeEditor {
//     props: GCodeEditorProps,
//     dispatch: AppDispatch,
//     state: Rc<State>,
//     validation_task: Option<TimeoutTask>,
//     link: ComponentLink<Self>,
//     parsed: Option<Result<Html, String>>,
//     node_ref: NodeRef,
// }

// pub enum InputMessage {
//     Validate(String),
//     State(Rc<State>),
//     Change(InputData),
// }

// impl Component for GCodeEditor {
//     type Message = InputMessage;

//     type Properties = GCodeEditorProps;

//     fn create(props: Self::Properties, link: ComponentLink<Self>) -> Self {
//         Self {
//             props,
//             dispatch: Dispatch::bridge_state(link.callback(InputMessage::State)),
//             state: Default::default(),
//             validation_task: None,
//             link,
//             parsed: None,
//             node_ref: NodeRef::default(),
//         }
//     }

//     fn update(&mut self, msg: Self::Message) -> ShouldRender {
//         match msg {
//             InputMessage::State(state) => {
//                 self.state = state;
//                 true
//             }
//             InputMessage::Validate(value) => {
//                 self.parsed = Some(snippet_parser(&value).map(|snippet| {
//                     html! {
//                         <>
//                             {
//                                 for snippet.iter_emit_tokens().flat_map(|token| {
//                                     if let Token::Field(field) = &token {
//                                         vec![
//                                             html! {
//                                                 <span class=classes!("hljs-type")>{field.letters.to_string()}</span>
//                                             },
//                                             {
//                                                 let class = match &field.value {
//                                                     Value::Rational(_) | Value::Integer(_) | Value::Float(_) => "hljs-number",
//                                                     Value::String(_) => "hljs-string",
//                                                 };
//                                                 html! {
//                                                     <span class=classes!(class)>{field.value.to_string()}</span>
//                                                 }
//                                             }
//                                         ]
//                                     } else if let Token::Newline{..} = &token {
//                                         vec![
//                                             html! {
//                                                 "\r\n"
//                                             }
//                                         ]
//                                     }
//                                     else {
//                                         let class = match &token {
//                                             Token::Comment{..} => "hljs-comment",
//                                             Token::Checksum(..) => "hljs-number",
//                                             Token::Whitespace(..) => "whitespace",
//                                             Token::Newline{..} => "newline",
//                                             Token::Percent => "hljs-keyword",
//                                             _ => unreachable!(),
//                                         };
//                                         vec![html!{
//                                             <span class=classes!("token", class)>
//                                             { token.to_string() }
//                                             </span>
//                                         }]
//                                     }
//                                 })
//                             }
//                         </>
//                     }
//                 }).map_err(|err| {
//                     let mut buf = Buffer::no_color();
//                     let config = Config::default();
//                     emit(
//                         &mut buf,
//                         &config,
//                         &codespan_reporting::files::SimpleFile::new("<input>", value),
//                         &into_diagnostic(&err),
//                     )
//                     .unwrap();
//                     String::from_utf8_lossy(buf.as_slice()).to_string()
//                 }));
//                 true
//             }
//             InputMessage::Change(InputData { value, .. }) => {
//                 self.parsed = None;
//                 self.validation_task = None;
//                 self.validation_task = Some(TimeoutService::spawn(
//                     self.props.validation_timeout,
//                     self.link
//                         .callback(move |_| InputMessage::Validate(value.clone())),
//                 ));
//                 true
//             }
//         }
//     }

//     fn change(&mut self, props: Self::Properties) -> ShouldRender {
//         self.props.neq_assign(props)
//     }

//     fn view(&self) -> Html {
//         let oninput = self.link.callback(|x: InputData| InputMessage::Change(x));

//         html! {
//             <>
//                 <div class=classes!("editor-container")>
//                     <label>
//                         {self.props.label}
//                         <textarea class=classes!("editor") ref=self.node_ref.clone() oninput=oninput />
//                     </label>
//                     <br/>
//                     <pre class=classes!("hljs") ref=self.node_ref.clone() aria-hidden="true">
//                         {
//                             if let Some(res) = self.parsed.as_ref() {
//                                 match res.as_ref() {
//                                     Ok(parsed) => parsed.clone(),
//                                     Err(err) => err.into()
//                                 }
//                             } else {
//                                 html! {}
//                             }
//                         }
//                     </pre>
//                 </div>
//             </>
//         }
//     }
// }

macro_rules! gcode_input {
    ($($name: ident {
        $label: literal,
        $desc: literal,
        $accessor: expr $(=> $idx: literal)?,
    })*) => {
        $(
            paste! {
                #[function_component([<$name Input>])]
                fn [<$name:snake:lower _input>]() -> Html {
                    const VALIDATION_TIMEOUT: u32 = 350;
                    let app = use_store::<AppStore>();
                    let form = use_store::<FormStore>();

                    let timeout = use_state::<Option<Timeout>, _>(|| None);
                    let oninput = {
                        let timeout = timeout.clone();
                        form.dispatch().input(move |state, value| {
                            let res = Some(match snippet_parser(&value) {
                                Ok(_) => Ok(value),
                                Err(err) => {
                                    let mut buf = NoColor::new(vec![]);
                                    let config = Config::default();
                                    emit(
                                        &mut buf,
                                        &config,
                                        &codespan_reporting::files::SimpleFile::new("<input>", value),
                                        &into_diagnostic(&err),
                                    )
                                    .unwrap();
                                    Err(String::from_utf8_lossy(buf.get_ref().as_slice()).to_string())
                                }
                            }).filter(|res| {
                                !res.as_ref().ok().map(|value| value.is_empty()).unwrap_or(false)
                            });

                            let timeout_inner = timeout.clone();
                            timeout.set(Some(Timeout::new(VALIDATION_TIMEOUT, move || {
                                timeout_inner.set(None);
                            })));
                            state.$accessor $([$idx])? = res;
                        })
                    };
                    html! {
                        <FormGroup success={form.state().map(|state| (state.$accessor $([$idx])?).as_ref().map(Result::is_ok)).flatten()}>
                            <TextArea<String, String> label=$label desc=$desc
                                default={app.state().map(|state| (state.$accessor $([$idx])?).clone()).unwrap_or_else(|| AppState::default().$accessor $([$idx])?)}
                                parsed={form.state().and_then(|state| (state.$accessor $([$idx])?).clone()).filter(|_| timeout.is_none())}
                                oninput={oninput}
                            />
                        </FormGroup>
                    }
                }
            }
        )*
    };
}

gcode_input! {
    ToolOnSequence {
        "Tool On Sequence",
        "G-Code for turning on the tool",
        tool_on_sequence,
    }
    ToolOffSequence {
        "Tool Off Sequence",
        "G-Code for turning off the tool",
        tool_off_sequence,
    }
    BeginSequence {
        "Program Begin Sequence",
        "G-Code for initializing the machine at the beginning of the program",
        begin_sequence,
    }
    EndSequence {
        "Program End Sequence",
        "G-Code for stopping/idling the machine at the end of the program",
        end_sequence,
    }
}

macro_rules! form_input {
    ($($name: ident {
        $label: literal,
        $desc: literal,
        $accessor: expr $(=> $idx: literal)?,
    })*) => {
        $(
            paste! {
                #[function_component([<$name Input>])]
                fn [<$name:snake:lower _input>]() -> Html {
                    let app = use_store::<AppStore>();
                    let form = use_store::<BasicStore<FormState>>();
                    let oninput = form.dispatch().input(|state, value| state.$accessor $([$idx])? = value.parse::<f64>());
                    html! {
                        <FormGroup success={form.state().map(|state| (state.$accessor $([$idx])?).is_ok())}>
                            <Input<f64, ParseFloatError> label=$label desc=$desc
                                default={app.state().map(|state| state.$accessor $([$idx])?).unwrap_or_else(|| AppState::default().$accessor $([$idx])?)}
                                parsed={form.state().map(|state| (state.$accessor $([$idx])?).clone())}
                                oninput={oninput}
                            />
                        </FormGroup>
                    }
                }
            }
        )*
    };
}

form_input! {
    Tolerance {
        "Tolerance",
        "Curve interpolation tolerance (mm)",
        tolerance,
    }
    Feedrate {
        "Feedrate",
        "Machine feedrate (mm/min)",
        feedrate,
    }
    Dpi {
        "Dots per Inch",
        "Used for scaling visual units (pixels, points, picas, etc.)",
        dpi,
    }
    OriginX {
        "Origin X",
        "X-axis coordinate for the bottom left corner of the machine",
        origin => 0,
    }
    OriginY {
        "Origin Y",
        "Y-axis coordinate for the bottom left corner of the machine",
        origin => 1,
    }
}

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
                app.tolerance = *form.tolerance.as_ref().unwrap();
                app.feedrate = *form.feedrate.as_ref().unwrap();
                app.origin = [
                    *form.origin[0].as_ref().unwrap(),
                    *form.origin[1].as_ref().unwrap(),
                ];
                app.circular_interpolation = form.circular_interpolation;
                app.dpi = *form.dpi.as_ref().unwrap();
                app.tool_on_sequence = form.tool_on_sequence.clone().and_then(Result::ok);
                app.tool_off_sequence = form.tool_off_sequence.clone().and_then(Result::ok);
                app.begin_sequence = form.begin_sequence.clone().and_then(Result::ok);
                app.end_sequence = form.end_sequence.clone().and_then(Result::ok);

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
                    <h5>{ "Settings" }</h5>
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
                        <p>
                            {"These settings are persisted using local storage. Learn more "}
                            // Opening new tabs is usually bad.
                            // But if we don't, the user is at risk of losing the settings they've entered so far.
                            <a href="https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage" target="_blank">
                                {"on MDN"}
                            </a>
                            {"."}
                        </p>
                        <Button
                            style={ButtonStyle::Primary}
                            disabled={disabled}
                            title="Save"
                            onclick={save_onclick}
                        />
                        {" "}
                        <HyperlinkButton
                            ref={close_ref}
                            style={ButtonStyle::Default}
                            title="Close"
                            href="#close"
                        />
                    </>
                )
            }
        >
        </Modal>
    }
}

#[function_component(SvgInput)]
pub fn svg_input() -> Html {
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
                    .map(|res| res.dyn_into::<Response>().unwrap());
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
        <FormGroup success={file_upload_res.as_ref().map(Result::is_ok).or(url_input_parsed.as_ref().map(Result::is_ok))}>
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
