use codespan_reporting::term::{Config, emit_to_io_write, termcolor::NoColor};
use g_code::parse::{into_diagnostic, snippet_parser};
use gloo_timers::callback::Timeout;
use paste::paste;
use web_sys::HtmlInputElement;
use yew::prelude::*;
use yewdux::functional::{use_store, use_store_value};

use crate::{
    state::{AppState, FormState},
    ui::{FormGroup, TextArea},
};

macro_rules! gcode_input {
    ($($name: ident {
        $label: literal,
        $desc: literal,
        $form_accessor: expr $(=> $form_idx: literal)?,
        $app_accessor: expr $(=> $app_idx: literal)?,
    })*) => {
        $(
            paste! {
                #[function_component([<$name Input>])]
                pub fn [<$name:snake:lower _input>]() -> Html {
                    const VALIDATION_TIMEOUT: u32 = 350;
                    let app_state = use_store_value::<AppState>();
                    let (form_state, form_dispatch) = use_store::<FormState>();

                    let timeout = use_state::<Option<Timeout>, _>(|| None);
                    let oninput = {
                        let timeout = timeout.clone();
                        form_dispatch.reduce_mut_callback_with(move |state, event: InputEvent| {
                            let value = event.target_unchecked_into::<HtmlInputElement>().value();
                            let res = Some(match snippet_parser(&value) {
                                Ok(_) => Ok(value),
                                Err(err) => {
                                    let mut buf = NoColor::new(vec![]);
                                    let config = Config::default();
                                    emit_to_io_write(
                                        &mut buf,
                                        &config,
                                        &codespan_reporting::files::SimpleFile::new("<input>", value),
                                        &into_diagnostic(&err),
                                    )
                                    .unwrap();
                                    Err(String::from_utf8_lossy(buf.get_ref().as_slice()).to_string())
                                }
                            }).filter(|res| {
                                !res.as_ref().ok().map_or(false, |value| value.is_empty())
                            });

                            let timeout_inner = timeout.clone();
                            timeout.set(Some(Timeout::new(VALIDATION_TIMEOUT, move || {
                                timeout_inner.set(None);
                            })));
                            state.$form_accessor $([$form_idx])? = res;
                        })
                    };
                    html! {
                        <FormGroup success={form_state.$form_accessor $([$form_idx])?.as_ref().map(Result::is_ok)}>
                            <TextArea<String, String> label=$label desc=$desc
                                default={(app_state.$app_accessor $([$app_idx])?).clone()}
                                parsed={(form_state.$form_accessor $([$form_idx])?).clone().filter(|_| timeout.is_none())}
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
        settings.machine.tool_on_sequence,
    }
    ToolOffSequence {
        "Tool Off Sequence",
        "G-Code for turning off the tool",
        tool_off_sequence,
        settings.machine.tool_off_sequence,
    }
    BeginSequence {
        "Program Begin Sequence",
        "G-Code for initializing the machine at the beginning of the program",
        begin_sequence,
        settings.machine.begin_sequence,
    }
    EndSequence {
        "Program End Sequence",
        "G-Code for stopping/idling the machine at the end of the program",
        end_sequence,
        settings.machine.end_sequence,
    }
}
