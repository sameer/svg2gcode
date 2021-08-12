use std::{io::Cursor, path::Path, rc::Rc};

use g_code::parse::snippet_parser;
use log::Level;
use roxmltree::Document;
use svg2gcode::{
    set_origin, svg2program, tokens_into_gcode_bytes, ConversionOptions, Machine, Turtle,
};
use wasm_bindgen::JsCast;
use web_sys::HtmlElement;
use yew::{prelude::*, utils::window};
use yewdux::prelude::{Dispatch, Dispatcher};

mod inputs;
mod spectre;
mod state;

use inputs::*;
use spectre::*;
use state::*;

struct App {
    _app_dispatch: Dispatch<AppStore>,
    app_state: Rc<AppState>,
    form_dispatch: Dispatch<FormStore>,
    form_state: Rc<FormState>,
    generating: bool,
    link: ComponentLink<Self>,
}

enum AppMsg {
    AppState(Rc<AppState>),
    FormState(Rc<FormState>),
    Generate,
    Done,
}

impl Component for App {
    type Message = AppMsg;

    type Properties = ();

    fn create(_props: Self::Properties, link: ComponentLink<Self>) -> Self {
        Self {
            _app_dispatch: Dispatch::bridge_state(link.callback(AppMsg::AppState)),
            app_state: Default::default(),
            form_dispatch: Dispatch::bridge_state(link.callback(AppMsg::FormState)),
            form_state: Default::default(),
            generating: false,
            link,
        }
    }

    fn update(&mut self, msg: Self::Message) -> ShouldRender {
        match msg {
            AppMsg::AppState(app_state) => {
                self.app_state = app_state;
                true
            }
            AppMsg::FormState(form_state) => {
                self.form_state = form_state;
                true
            }
            AppMsg::Generate => {
                self.generating = true;
                let app_state = self.app_state.clone();
                // TODO: once trunk and yew have better support for workers,
                // pull this out into one so that the UI can actually
                // show progress updates.
                self.link.send_future(async move {
                    let options = ConversionOptions {
                        tolerance: app_state.tolerance,
                        feedrate: app_state.feedrate,
                        dpi: app_state.dpi,
                    };
                    let machine = Machine::new(
                        app_state
                            .tool_on_sequence
                            .as_ref()
                            .map(String::as_str)
                            .map(snippet_parser)
                            .transpose()
                            .unwrap(),
                        app_state
                            .tool_off_sequence
                            .as_ref()
                            .map(String::as_str)
                            .map(snippet_parser)
                            .transpose()
                            .unwrap(),
                        app_state
                            .begin_sequence
                            .as_ref()
                            .map(String::as_str)
                            .map(snippet_parser)
                            .transpose()
                            .unwrap(),
                        app_state
                            .end_sequence
                            .as_ref()
                            .map(String::as_str)
                            .map(snippet_parser)
                            .transpose()
                            .unwrap(),
                    );
                    let document = Document::parse(app_state.svg.as_ref().unwrap()).unwrap();

                    let mut turtle = Turtle::new(machine);
                    let mut program = svg2program(&document, options, &mut turtle);

                    set_origin(&mut program, app_state.origin);

                    let gcode_base64 = {
                        let mut cursor = Cursor::new(vec![]);
                        tokens_into_gcode_bytes(&program, &mut cursor).unwrap();
                        base64::encode(cursor.get_ref())
                    };

                    let window = window();
                    let document = window.document().unwrap();
                    let hyperlink = document.create_element("a").unwrap();

                    let filepath =
                        Path::new(app_state.svg_filename.as_ref().unwrap()).with_extension("gcode");
                    let filename = filepath.to_str().unwrap();
                    hyperlink
                        .set_attribute("href", &format!("data:text/plain;base64,{}", gcode_base64))
                        .unwrap();
                    hyperlink.set_attribute("download", filename).unwrap();
                    hyperlink.unchecked_into::<HtmlElement>().click();

                    AppMsg::Done
                });
                true
            }
            AppMsg::Done => {
                self.generating = false;
                true
            }
        }
    }

    fn change(&mut self, _props: Self::Properties) -> ShouldRender {
        false
    }

    fn view(&self) -> Html {
        let generate_disabled = self.generating || self.app_state.svg.is_none();
        let generate_onclick = self.link.callback(|_| AppMsg::Generate);

        // TODO: come up with a less awkward way to do this.
        // Having separate stores is somewhat of an anti-pattern in Redux,
        // but there's no easy way to do hydration after the app state is
        // restored from local storage.
        let hydrated_form_state = FormState::from(self.app_state.as_ref());
        let settings_hydrate_onclick = self.form_dispatch.reduce_callback_once(move |form| {
            *form = hydrated_form_state;
        });
        html! {
            <div class="container">
                <div class={classes!("column", "col-xl-9", "col-md-11")}>
                    <h1>
                        { env!("CARGO_PKG_NAME") }
                    </h1>
                    <p>
                        { env!("CARGO_PKG_DESCRIPTION") }
                    </p>
                </div>
                <SvgInput/>
                <ButtonGroup>
                    <Button
                        title="Generate GCode"
                        style={ButtonStyle::Primary}
                        loading={self.generating}
                        icon={
                            html_nested! (
                                <Icon name={IconName::Download} />
                            )
                        }
                        disabled={generate_disabled}
                        onclick={generate_onclick}
                    />
                    <HyperlinkButton
                        title="Settings"
                        style={ButtonStyle::Default}
                        icon={IconName::Edit}
                        onclick={settings_hydrate_onclick}
                        href="#settings"
                    />
                </ButtonGroup>
                <SettingsForm />
            </div>
        }
    }
}

// #[function_component(App)]
// fn app() -> Html {
//     let app = use_store::<AppStore>();
//     let form = use_store::<BasicStore<FormState>>();

//     let generating = use_state(|| false);

//     }
// }

fn main() {
    wasm_logger::init(wasm_logger::Config::new(Level::Info));
    yew::start_app::<App>();
}
