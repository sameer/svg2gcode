use paste::paste;
use std::num::ParseFloatError;
use yew::prelude::*;
use yewdux::prelude::{BasicStore};
use yewdux_functional::use_store;
use yewdux_input::*;

use crate::{
    state::{AppState, AppStore, FormState},
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
                    let app = use_store::<AppStore>();
                    let form = use_store::<BasicStore<FormState>>();
                    let oninput = form.dispatch().input(|state, value| state.$form_accessor $([$form_idx])? = value.parse::<f64>());
                    html! {
                        <FormGroup success={form.state().map(|state| (state.$form_accessor $([$form_idx])?).is_ok())}>
                            <Input<f64, ParseFloatError> label=$label desc=$desc
                                default={app.state().map(|state| state.$app_accessor $([$app_idx])?).unwrap_or_else(|| AppState::default().$app_accessor $([$app_idx])?)}
                                parsed={form.state().map(|state| (state.$form_accessor $([$form_idx])?).clone())}
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
        "X-axis coordinate for the bottom left corner of the machine",
        origin => 0,
        settings.postprocess.origin => 0,
    }
    OriginY {
        "Origin Y",
        "Y-axis coordinate for the bottom left corner of the machine",
        origin => 1,
        settings.postprocess.origin => 1,
    }
}
