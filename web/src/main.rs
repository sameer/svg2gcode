use std::path::Path;

use base64::Engine;
use g_code::{
    emit::{format_gcode_fmt, FormatOptions},
    parse::snippet_parser,
};
use log::Level;
use roxmltree::Document;
use svg2gcode::{svg2program, ConversionOptions, Machine};
use yew::prelude::*;

mod forms;
mod state;
mod ui;
mod util;

use forms::*;
use state::*;
use ui::*;
use util::*;
use yewdux::prelude::{use_store, Dispatch};

#[function_component]
fn App(_props: &()) -> Html {
    let generating = use_state_eq(|| false);
    let generating_setter = generating.setter();

    let form_dispatch = Dispatch::<FormState>::new();
    let (app_store, app_dispatch) = use_store::<AppState>();

    // TODO: come up with a less awkward way to do this.
    // Having separate stores is somewhat of an anti-pattern in Redux,
    // but there's no easy way to do hydration after the app state is
    // restored from local storage.
    let hydrated_form = use_state(|| false);
    if !*hydrated_form {
        let hydrated_form_state = FormState::from(&app_store.settings);
        form_dispatch.reduce_mut(|state| *state = hydrated_form_state);
        hydrated_form.set(true);
    }

    let generate_disabled = *generating || app_store.svgs.is_empty();
    let generate_onclick = {
        let app_store = app_store.clone();
        Callback::from(move |_| {
            generating_setter.set(true);
            for svg in app_store.svgs.iter() {
                let options = ConversionOptions {
                    dimensions: svg.dimensions,
                };

                let machine = Machine::new(
                    app_store.settings.machine.supported_functionality.clone(),
                    app_store
                        .settings
                        .machine
                        .tool_on_sequence
                        .as_deref()
                        .map(snippet_parser)
                        .transpose()
                        .unwrap(),
                    app_store
                        .settings
                        .machine
                        .tool_off_sequence
                        .as_deref()
                        .map(snippet_parser)
                        .transpose()
                        .unwrap(),
                    app_store
                        .settings
                        .machine
                        .begin_sequence
                        .as_deref()
                        .map(snippet_parser)
                        .transpose()
                        .unwrap(),
                    app_store
                        .settings
                        .machine
                        .end_sequence
                        .as_deref()
                        .map(snippet_parser)
                        .transpose()
                        .unwrap(),
                );
                let document = Document::parse(svg.content.as_str()).unwrap();

                let program =
                    svg2program(&document, &app_store.settings.conversion, options, machine);

                let gcode = {
                    let mut acc: String = String::new();
                    format_gcode_fmt(
                        &program,
                        FormatOptions {
                            checksums: app_store.settings.postprocess.checksums,
                            line_numbers: app_store.settings.postprocess.line_numbers,
                            ..Default::default()
                        },
                        &mut acc,
                    )
                    .unwrap();
                    acc
                };

                let filepath = Path::new(svg.filename.as_str()).with_extension("gcode");
                prompt_download(filepath, gcode.as_bytes());
            }
            generating_setter.set(false);
        })
    };

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
                        for app_store.svgs.iter().enumerate().map(|(i, svg)| {
                            let svg_base64 = base64::engine::general_purpose::STANDARD_NO_PAD.encode(svg.content.as_bytes());
                            let remove_svg_onclick = app_dispatch.reduce_mut_callback(move |app| {
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
                        loading={*generating}
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

fn main() {
    wasm_logger::init(wasm_logger::Config::new(Level::Info));
    yew::Renderer::<App>::new().render();
}
