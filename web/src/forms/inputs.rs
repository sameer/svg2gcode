use paste::paste;
use std::num::ParseFloatError;
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
