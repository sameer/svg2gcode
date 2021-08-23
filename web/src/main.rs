use std::{path::Path, rc::Rc};

use g_code::{
    emit::{format_gcode_fmt, FormatOptions},
    parse::snippet_parser,
};
use log::Level;
use roxmltree::Document;
use svg2gcode::{
    set_origin, svg2program, ConversionOptions, Machine, SupportedFunctionality, Turtle,
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
                    for svg in app_state.svgs.iter() {
                        let options = ConversionOptions {
                            tolerance: app_state.tolerance,
                            feedrate: app_state.feedrate,
                            dpi: app_state.dpi,
                        };
                        let machine = Machine::new(
                            SupportedFunctionality {
                                circular_interpolation: false,
                            },
                            app_state
                                .tool_on_sequence
                                .as_deref()
                                .map(snippet_parser)
                                .transpose()
                                .unwrap(),
                            app_state
                                .tool_off_sequence
                                .as_deref()
                                .map(snippet_parser)
                                .transpose()
                                .unwrap(),
                            app_state
                                .begin_sequence
                                .as_deref()
                                .map(snippet_parser)
                                .transpose()
                                .unwrap(),
                            app_state
                                .end_sequence
                                .as_deref()
                                .map(snippet_parser)
                                .transpose()
                                .unwrap(),
                        );
                        let document = Document::parse(svg.content.as_str()).unwrap();

                        let mut turtle = Turtle::new(machine);
                        let mut program = svg2program(&document, options, &mut turtle);

                        set_origin(&mut program, app_state.origin);

                        let gcode_base64 = {
                            let mut acc = String::new();
                            format_gcode_fmt(&program, FormatOptions::default(), &mut acc).unwrap();
                            base64::encode(acc.as_bytes())
                        };

                        let window = window();
                        let document = window.document().unwrap();
                        let hyperlink = document.create_element("a").unwrap();

                        let filepath = Path::new(svg.filename.as_str()).with_extension("gcode");
                        let filename = filepath.to_str().unwrap();
                        hyperlink
                            .set_attribute(
                                "href",
                                &format!("data:text/plain;base64,{}", gcode_base64),
                            )
                            .unwrap();
                        hyperlink.set_attribute("download", filename).unwrap();
                        hyperlink.unchecked_into::<HtmlElement>().click();
                    }

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
        let generate_disabled = self.generating || self.app_state.svgs.is_empty();
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
                <div class={classes!("column")}>
                    <h1>
                        { "svg2gcode" }
                    </h1>
                    <p>
                        { env!("CARGO_PKG_DESCRIPTION") }
                    </p>
                    <SvgInput/>
                    <ButtonGroup>
                        <Button
                            title="Generate G-Code"
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
                <div class={classes!("text-right", "column")}>
                    <p>
                        { "See the project " }
                        <a href={env!("CARGO_PKG_REPOSITORY")}>
                            { "on GitHub" }
                        </a>
                        {" for support" }
                    </p>
                </div>
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
