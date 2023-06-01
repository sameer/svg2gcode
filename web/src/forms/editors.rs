use codespan_reporting::term::{emit, termcolor::NoColor, Config};
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
