use std::num::ParseFloatError;

use paste::paste;
use yew::prelude::*;
use yewdux::functional::{use_store, use_store_value};

use crate::{
    state::{AppState, FormState},
    ui::*,
};

macro_rules! form_input {
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
                    let app_state = use_store_value::<AppState>();
                    let (form_state, form_dispatch) = use_store::<FormState>();
                    let oninput = form_dispatch.reduce_mut_callback_with(|state, event: InputEvent| {
                        let value = event.target_unchecked_into::<web_sys::HtmlInputElement>().value();
                        let parsed = value.parse::<f64>();

                        // Handle Option origins
                        $(
                            let _ = $app_idx;
                            let parsed = if value.is_empty() { None } else { Some(parsed) };
                        )?
                        state.$form_accessor $([$form_idx])? = parsed;
                    });
                    html! {
                        // unwrap_or(&Ok(0.)) is just a macro hack to make None a valid state
                        <FormGroup success={form_state.$form_accessor $([$form_idx] .as_ref().unwrap_or(&Ok(0.)))?.is_ok()}>
                            <Input<f64, ParseFloatError> label=$label desc=$desc
                                default={app_state.$app_accessor $([$app_idx])?}
                                parsed={form_state.$form_accessor $([$form_idx])?.clone()}
                                oninput={oninput}
                            />
                        </FormGroup>
                    }
                }
            }
        )*
    };
}

macro_rules! optional_form_input {
    ($($name: ident {
        $label: literal,
        $desc: literal,
        $form_accessor: ident,
        $app_accessor: expr,
    })*) => {
        $(
            paste! {
                #[function_component([<$name Input>])]
                pub fn [<$name:snake:lower _input>]() -> Html {
                    let app_state = use_store_value::<AppState>();
                    let (form_state, form_dispatch) = use_store::<FormState>();
                    let oninput = form_dispatch.reduce_mut_callback_with(|state, event: InputEvent| {
                        let value = event.target_unchecked_into::<web_sys::HtmlInputElement>().value();
                        state.$form_accessor = if value.is_empty() {
                            None
                        } else {
                            Some(value.parse::<f64>())
                        };
                    });
                    html! {
                        <FormGroup success={form_state.$form_accessor.as_ref().map(Result::is_ok).unwrap_or(true)}>
                            <Input<f64, ParseFloatError> label=$label desc=$desc
                                default={app_state.$app_accessor}
                                parsed={form_state.$form_accessor.clone()}
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
        settings.conversion.tolerance,
    }
    Feedrate {
        "Feedrate",
        "Machine feedrate (mm/min)",
        feedrate,
        settings.conversion.feedrate,
    }
    Dpi {
        "Dots per Inch",
        "Used for scaling visual units (pixels, points, picas, etc.)",
        dpi,
        settings.conversion.dpi,
    }
    MaterialWidth {
        "Material Width",
        "Material width in mm",
        material_width,
        settings.engraving.material_width,
    }
    MaterialHeight {
        "Material Height",
        "Material height in mm",
        material_height,
        settings.engraving.material_height,
    }
    MaterialThickness {
        "Material Thickness",
        "Material thickness in mm",
        material_thickness,
        settings.engraving.material_thickness,
    }
    ToolDiameter {
        "Tool Diameter",
        "Flat-end tool diameter in mm",
        tool_diameter,
        settings.engraving.tool_diameter,
    }
    TargetDepth {
        "Target Depth",
        "Final engraving depth in mm",
        target_depth,
        settings.engraving.target_depth,
    }
    MaxStepdown {
        "Max Stepdown",
        "Maximum depth per pass in mm",
        max_stepdown,
        settings.engraving.max_stepdown,
    }
    CutFeedrate {
        "Cut Feedrate",
        "XY cutting feedrate in mm/min",
        cut_feedrate,
        settings.engraving.cut_feedrate,
    }
    Stepover {
        "Stepover",
        "Pocket stepover in mm",
        stepover,
        settings.engraving.stepover,
    }
    PlacementX {
        "Placement X",
        "Left offset of the SVG inside the material, measured from the material's bottom-left origin (mm)",
        placement_x,
        settings.engraving.placement_x,
    }
    PlacementY {
        "Placement Y",
        "Bottom offset of the SVG inside the material, measured from the material's bottom-left origin (mm)",
        placement_y,
        settings.engraving.placement_y,
    }
    OriginX {
        "Origin X",
        "X-axis coordinate for the lower left corner of the machine",
        origin => 0,
        settings.conversion.origin => 0,
    }
    OriginY {
        "Origin Y",
        "Y-axis coordinate for the lower left corner of the machine",
        origin => 1,
        settings.conversion.origin => 1,
    }
}

optional_form_input! {
    TravelZ {
        "Travel Z",
        "Absolute safe travel height on the Z axis (mm). Requires Cut Z.",
        travel_z,
        settings.machine.travel_z,
    }
    CutZ {
        "Cut Z",
        "Absolute cutting depth on the Z axis (mm). Requires Travel Z.",
        cut_z,
        settings.machine.cut_z,
    }
    PlungeFeedrate {
        "Plunge Feedrate",
        "Feedrate used for plunging in mm/min. Used by engraving CAM and optional basic Z mode.",
        plunge_feedrate,
        settings.machine.plunge_feedrate,
    }
    SvgWidthOverride {
        "SVG Width Override",
        "Optional SVG width in mm. Height is inferred from aspect ratio.",
        svg_width_override,
        settings.engraving.svg_width_override,
    }
}
