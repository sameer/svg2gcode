use std::{path::Path, rc::Rc};

use g_code::{
    emit::{format_gcode_fmt, FormatOptions},
    parse::snippet_parser,
};
use log::Level;
use roxmltree::Document;
use svg2gcode::{set_origin, svg2program, ConversionOptions, Machine, Turtle};
use yew::prelude::*;
use yewdux::prelude::{Dispatch, Dispatcher};

mod forms;
mod ui;
mod state;
mod util;

use forms::*;
use ui::*;
use state::*;
use util::*;

struct App {
    app_dispatch: Dispatch<AppStore>,
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
            app_dispatch: Dispatch::bridge_state(link.callback(AppMsg::AppState)),
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
                            dimensions: svg.dimensions,
                        };

                        let machine = Machine::new(
                            app_state.settings.machine.supported_functionality.clone(),
                            app_state
                                .settings
                                .machine
                                .tool_on_sequence
                                .as_deref()
                                .map(snippet_parser)
                                .transpose()
                                .unwrap(),
                            app_state
                                .settings
                                .machine
                                .tool_off_sequence
                                .as_deref()
                                .map(snippet_parser)
                                .transpose()
                                .unwrap(),
                            app_state
                                .settings
                                .machine
                                .begin_sequence
                                .as_deref()
                                .map(snippet_parser)
                                .transpose()
                                .unwrap(),
                            app_state
                                .settings
                                .machine
                                .end_sequence
                                .as_deref()
                                .map(snippet_parser)
                                .transpose()
                                .unwrap(),
                        );
                        let document = Document::parse(svg.content.as_str()).unwrap();

                        let mut turtle = Turtle::new(machine);
                        let mut program = svg2program(
                            &document,
                            &app_state.settings.conversion,
                            options,
                            &mut turtle,
                        );

                        set_origin(&mut program, app_state.settings.postprocess.origin);

                        let gcode = {
                            let mut acc = String::new();
                            format_gcode_fmt(&program, FormatOptions::default(), &mut acc).unwrap();
                            acc
                        };

                        let filepath = Path::new(svg.filename.as_str()).with_extension("gcode");
                        prompt_download(filepath, &gcode.as_bytes());
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
        let hydrated_form_state = FormState::from(&self.app_state.settings);
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
                    <SvgForm/>
                    <div class={classes!("card-container", "columns")}>
                        {
                            for self.app_state.svgs.iter().enumerate().map(|(i, svg)| {
                                let svg_base64 = base64::encode(svg.content.as_bytes());
                                let remove_svg_onclick = self.app_dispatch.reduce_callback_once(move |app| {
                                    app.svgs.remove(i);
                                });
                                let footer = html!{
                                    <Button
                                        title="Remove"
                                        style={ButtonStyle::Primary}
                                        icon={
                                            html_nested!(
                                                <Icon name={IconName::Delete} />
                                            )
                                        }
                                        onclick={remove_svg_onclick}
                                    />
                                };
                                html!{
                                    <div class={classes!("column", "col-6", "col-xs-12")}>
                                        <Card
                                            title={svg.filename.clone()}
                                            img={html_nested!(
                                                <img class="img-responsive" src={format!("data:image/svg+xml;base64,{}", svg_base64)} alt={svg.filename.clone()} />
                                            )}
                                            footer={footer}
                                        />
                                    </div>
                                }
                            })
                        }
                    </div>
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
                    <SettingsForm/>
                    <ImportExportModal/>
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

fn main() {
    wasm_logger::init(wasm_logger::Config::new(Level::Info));
    yew::start_app::<App>();
}
