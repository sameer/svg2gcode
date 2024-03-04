use std::{
    io::Cursor,
    path::{Path, PathBuf},
};

use base64::Engine;
use g_code::{
    emit::{format_gcode_fmt, format_gcode_io, FormatOptions},
    parse::snippet_parser,
};
use js_sys::Date;
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
use yewdux::{prelude::use_store, use_dispatch, YewduxRoot};
use zip::{write::FileOptions, CompressionMethod, ZipWriter};

#[function_component(App)]
fn app() -> Html {
    let generating = use_state_eq(|| false);
    let generating_setter = generating.setter();

    let form_dispatch = use_dispatch::<FormState>();
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
            let mut zip = ZipWriter::new(Cursor::new(vec![]));
            let opts = FileOptions::default().compression_method(CompressionMethod::Stored);

            if app_store.svgs.len() > 1 {
                zip.add_directory("svg2gcode_output", opts).unwrap();
            }

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

                let filepath = if app_store.svgs.len() > 1 {
                    PathBuf::from("svg2gcode_output")
                        .join(Path::new(svg.filename.as_str()).with_extension("gcode"))
                } else {
                    Path::new(svg.filename.as_str()).with_extension("gcode")
                };

                match app_store.svgs.len() {
                    0 => unreachable!(),
                    1 => {
                        let gcode = {
                            let mut acc = String::new();
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
                        prompt_download(filepath, gcode.as_bytes());
                    }
                    _multiple => {
                        zip.start_file(filepath.to_string_lossy(), opts).unwrap();

                        format_gcode_io(
                            &program,
                            FormatOptions {
                                checksums: app_store.settings.postprocess.checksums,
                                line_numbers: app_store.settings.postprocess.line_numbers,
                                ..Default::default()
                            },
                            &mut zip,
                        )
                        .unwrap();
                    }
                }
            }

            if app_store.svgs.len() > 1 {
                zip.set_comment(format!(
                    "Created with svg2gcode: https://sameer.github.io/svg2gcode/\n{}",
                    env!("CARGO_PKG_DESCRIPTION")
                ));
                let output = zip.finish().unwrap();
                let date = Date::new_0().to_iso_string();
                prompt_download(
                    format!("svg2gcode_bulk_download_{date}.zip"),
                    output.get_ref(),
                );
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

#[function_component(AppContainer)]
fn app_container() -> Html {
    html! {
        <YewduxRoot>
            <App/>
        </YewduxRoot>
    }
}

fn main() {
    wasm_logger::init(wasm_logger::Config::new(Level::Info));
    yew::Renderer::<AppContainer>::new().render();
}
