use std::fmt::Display;
use web_sys::{Event, FileList, HtmlInputElement, InputEvent, InputEventInit, MouseEvent};
use yew::{
    classes, function_component, html, use_force_update, use_node_ref, use_state,
    virtual_dom::{VChild, VNode},
    AttrValue, Callback, Children, Html, NodeRef, Properties, TargetCast, ToHtml,
};

macro_rules! css_class_enum {
    ($name: ident $(($prefix: literal))? {
        $(
            $variant: ident => $class: literal
        ),*
    }) => {
        #[derive(PartialEq, Eq, Clone, Copy)]
        pub enum $name {
            $(
                #[allow(dead_code)]
                $variant
            ),*
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> Result<(), std::fmt::Error> {
                let suffix = match self {
                    $(
                        Self::$variant => $class
                    ),*
                };
                if !suffix.is_empty() {
                    $(
                        write!(f, "{}-", $prefix)?;
                    )?
                    write!(f, "{suffix}")
                } else {
                    Ok(())
                }
            }

        }
    };
}

#[derive(Properties, PartialEq, Clone)]
pub struct InputProps<T, E>
where
    T: Clone + PartialEq,
    E: Display + Clone + PartialEq,
{
    pub label: &'static str,
    #[prop_or_default]
    pub desc: Option<&'static str>,
    #[prop_or_default]
    pub parsed: Option<Result<T, E>>,
    #[prop_or_default]
    pub placeholder: Option<T>,
    #[prop_or_default]
    pub default: Option<T>,
    #[prop_or(InputType::Text)]
    pub r#type: InputType,
    #[prop_or_default]
    pub oninput: Callback<InputEvent>,
    #[prop_or_default]
    pub button: Option<VChild<Button>>,
}

css_class_enum! {
    InputType {
        Text => "text",
        Url => "url"
    }
}

#[function_component(Input)]
pub fn input<T, E>(props: &InputProps<T, E>) -> Html
where
    T: Display + Clone + PartialEq + 'static,
    E: Display + Clone + PartialEq,
{
    let success = props.parsed.as_ref().map(|x| x.is_ok()).unwrap_or(false);
    let error = props.parsed.as_ref().map(|x| x.is_err()).unwrap_or(false);
    let id = props.label.to_lowercase().replace(' ', "-");

    // To properly set the default value, we need to force a second render
    // so the noderef becomes valid.
    let first_render = use_state(|| true);
    let trigger = use_force_update();
    let node_ref = use_node_ref();

    if *first_render {
        first_render.set(false);
        trigger.force_update();
    }

    let user_edited = use_state(|| false);
    let last_default_value = use_state(|| None);
    if let Some(input_element) = node_ref.cast::<HtmlInputElement>() {
        // Re-apply default if it changes
        if !*user_edited && props.default != *last_default_value {
            if let Some(d) = props.default.as_ref() {
                input_element.set_value(&d.to_string());
            } else {
                input_element.set_value("");
            }
            let init = InputEventInit::new();
            init.set_data(Some("ignore"));
            input_element
                .dispatch_event(&InputEvent::new_with_event_init_dict("input", &init).unwrap())
                .unwrap();
            last_default_value.set(props.default.clone());
        }
    }

    let prop_oninput = props.oninput.clone();
    // Wrap callback to determine when user performed an edit
    let oninput = Callback::from(move |event: InputEvent| {
        if !event.data().map_or(false, |d| d == "ignore") {
            user_edited.set(true);
        }
        prop_oninput.emit(event);
    });

    html! {
        <>
            <label class="form-label" for={id.clone()}>
                { props.label }
            </label>
            <div class={classes!(if props.button.is_some() { Some("input-group") } else { None })}>
                <div class={classes!(if props.button.is_some() { Some("input-group") } else { None }, if success || error { Some("has-icon-right") } else { None })}>
                    <input id={id} class="form-input" type={props.r#type.to_string()} ref={node_ref.clone()}
                        oninput={oninput} placeholder={ props.placeholder.as_ref().map(ToString::to_string) }
                    />
                    {
                        if let Some(parsed) = props.parsed.as_ref() {
                            match parsed {
                                Ok(_) => html!(<Icon form=true name={IconName::Check}/>),
                                Err(_) => html!(<Icon form=true name={IconName::Cross}/>)
                            }
                        } else {
                            html!()
                        }
                    }
                </div>
                { props.button.clone().map(Html::from).unwrap_or_default() }
            </div>
            {
                if let Some(Err(ref err)) = props.parsed.as_ref() {
                    html!{ <pre class="form-input-hint">{ err.to_string() }</pre> }
                } else if let Some(desc) = props.desc {
                    html! { <p class="form-input-hint">{ desc }</p> }
                } else {
                    html!()
                }
            }
        </>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct CheckboxProps {
    pub label: &'static str,
    pub desc: Option<&'static str>,
    #[prop_or(false)]
    pub checked: bool,
    #[prop_or_default]
    pub onchange: Callback<Event>,
}

#[function_component(Checkbox)]
pub fn checkbox(props: &CheckboxProps) -> Html {
    html! {
        <>
            <label class="form-checkbox">
                <input type="checkbox"  onchange={props.onchange.clone()} checked={props.checked} />
                <Icon form={true} name={IconName::None} />
                { props.label }
            </label>
            {
                if let Some(desc) = props.desc {
                    html! { <p class="form-input-hint">{ desc }</p> }
                } else {
                    html!()
                }
            }
        </>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct FileUploadProps<T, E>
where
    T: Clone + PartialEq,
    E: Display + Clone + PartialEq + ToHtml,
{
    pub label: &'static str,
    #[prop_or_default]
    pub desc: Option<&'static str>,
    #[prop_or_default]
    pub accept: Option<&'static str>,
    #[prop_or(false)]
    pub multiple: bool,
    #[prop_or_default]
    pub parsed: Option<Result<T, E>>,
    #[prop_or_default]
    pub onchange: Callback<FileList>,
    #[prop_or_default]
    pub button: Option<VChild<Button>>,
}

#[function_component(FileUpload)]
pub fn file_upload<T, E>(props: &FileUploadProps<T, E>) -> Html
where
    T: Clone + PartialEq,
    E: Display + Clone + PartialEq + ToHtml,
{
    let success = props.parsed.as_ref().map(|x| x.is_ok()).unwrap_or(false);
    let error = props.parsed.as_ref().map(|x| x.is_err()).unwrap_or(false);
    let id = props.label.to_lowercase().replace(' ', "-");
    html! {
        <>
            <label class="form-label" for={id.clone()}>
                { props.label }
            </label>
            <div class={classes!(if props.button.is_some() { Some("input-group") } else { None })}>
                <div class={classes!(if props.button.is_some() { Some("input-group") } else { None }, if success || error { Some("has-icon-right") } else { None })}>
                    <input id={id} class="form-input" type="file" accept={props.accept} multiple={props.multiple}
                        onchange={props.onchange.clone().reform(|x: Event| {
                            x.target_unchecked_into::<HtmlInputElement>().files().expect("this is a file input")
                        })}
                    />
                    {
                        if let Some(parsed) = props.parsed.as_ref() {
                            match parsed {
                                Ok(_) => html!(<Icon form=true name={IconName::Check}/>),
                                Err(_) => html!(<Icon form=true name={IconName::Cross}/>)
                            }
                        } else {
                            html!()
                        }
                    }
                </div>
                { props.button.clone().map(Html::from).unwrap_or_default() }
            </div>
            {
                if let Some(Err(ref err)) = props.parsed.as_ref() {
                    html!{ <pre class="form-input-hint">{ err }</pre> }
                } else if let Some(desc) = props.desc {
                    html! { <p class="form-input-hint">{ desc }</p> }
                } else {
                    html!()
                }
            }
        </>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct SelectProps {
    #[prop_or_default]
    pub children: Children,
    #[prop_or(false)]
    pub disabled: bool,
    #[prop_or(false)]
    pub multiple: bool,
}

#[function_component(Select)]
pub fn select(props: &SelectProps) -> Html {
    html! {
        <select class={classes!("form-select")}>{ for props.children.iter() }</select>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct OptionProps {
    #[prop_or_default]
    pub children: Children,
    #[prop_or(false)]
    pub selected: bool,
    #[prop_or(false)]
    pub disabled: bool,
    pub value: Option<&'static str>,
}

#[function_component(Opt)]
pub fn option(props: &OptionProps) -> Html {
    html! {
        <option value={props.value}>{ for props.children.iter() }</option>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct InputGroupProps {
    #[prop_or_default]
    pub children: Children,
}

#[function_component(InputGroup)]
pub fn input_group(props: &InputGroupProps) -> Html {
    html! {
        <div class="input-group">
            { for props.children.iter() }
        </div>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct FormGroupProps {
    #[prop_or_default]
    pub children: Children,
    #[prop_or_default]
    pub success: Option<bool>,
}

#[function_component(FormGroup)]
pub fn form_group(props: &FormGroupProps) -> Html {
    html! {
        <div class={classes!(
            "form-group",
            if let Some(true) = props.success {
                Some("has-success")
            } else if let Some(false) = props.success {
                Some("has-error")
            } else {
                None
            }
        )}>
            { for props.children.iter() }
        </div>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct TextAreaProps<T, E>
where
    T: Display + Clone + PartialEq,
    E: Display + Clone + PartialEq + ToHtml,
{
    pub label: &'static str,
    pub desc: Option<&'static str>,
    pub parsed: Option<Result<T, E>>,
    #[prop_or_default]
    pub placeholder: Option<AttrValue>,
    pub default: Option<AttrValue>,
    #[prop_or_default]
    pub oninput: Callback<InputEvent>,
    #[prop_or_default]
    pub rows: Option<usize>,
    #[prop_or_default]
    pub cols: Option<usize>,
}

#[function_component(TextArea)]
pub fn text_area<T, E>(props: &TextAreaProps<T, E>) -> Html
where
    T: Display + Clone + PartialEq,
    E: Display + Clone + PartialEq + ToHtml,
{
    let success = props.parsed.as_ref().map(|x| x.is_ok()).unwrap_or(false);
    let error = props.parsed.as_ref().map(|x| x.is_err()).unwrap_or(false);
    let id = props.label.to_lowercase().replace(' ', "-");

    // To properly set the default value, we need to force a second render
    // so the noderef becomes valid.
    let first_render = use_state(|| true);
    let trigger = use_force_update();
    let node_ref = use_node_ref();

    if *first_render {
        first_render.set(false);
        trigger.force_update();
    }

    let user_edited = use_state(|| false);
    let last_default_value = use_state(|| None);
    if let Some(input_element) = node_ref.cast::<HtmlInputElement>() {
        // Re-apply default if it changes
        if !*user_edited && props.default != *last_default_value {
            if let Some(d) = props.default.as_ref() {
                input_element.set_value(d);
            } else {
                input_element.set_value("");
            }
            let init = InputEventInit::new();
            init.set_data(Some("ignore"));
            input_element
                .dispatch_event(&InputEvent::new_with_event_init_dict("input", &init).unwrap())
                .unwrap();
            last_default_value.set(props.default.clone());
        }
    }

    let prop_oninput = props.oninput.clone();
    // Wrap callback to determine when user performed an edit
    let oninput = Callback::from(move |event: InputEvent| {
        if !event.data().map_or(false, |d| d == "ignore") {
            user_edited.set(true);
        }
        prop_oninput.emit(event);
    });

    html! {
        <>
            <label class="form-label" for={id.clone()}>
                { props.label }
            </label>
            <div class={classes!(if success || error { Some("has-icon-right") } else { None })}>
                <textarea class="form-input" id={id} oninput={oninput}
                    ref={node_ref}
                    placeholder={props.placeholder.as_ref().cloned()}
                    rows={props.rows.as_ref().map(ToString::to_string)}
                    cols={props.cols.as_ref().map(ToString::to_string)}
                />
                {
                    if let Some(parsed) = props.parsed.as_ref() {
                        match parsed {
                            Ok(_) => html!(<Icon form=true name={IconName::Check}/>),
                            Err(_) => html!(<Icon form=true name={IconName::Cross}/>)
                        }
                    } else {
                        html!()
                    }
                }
            </div>
            {
                if let Some(Err(ref err)) = props.parsed.as_ref() {
                    html!{ <pre class="form-input-hint">{ err }</pre> }
                } else if let Some(desc) = props.desc {
                    html! { <p class="form-input-hint">{ desc }</p> }
                } else {
                    html!()
                }
            }
        </>
    }
}

css_class_enum! {
    ButtonStyle("btn") {
        Default => "",
        Primary => "primary",
        Link => "link",
        Success => "success",
        Error => "error"
    }
}

impl Default for ButtonStyle {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct ButtonProps {
    #[prop_or_default]
    pub style: ButtonStyle,
    #[prop_or_default]
    pub disabled: bool,
    #[prop_or_default]
    pub loading: bool,
    #[prop_or_default]
    pub input_group: bool,
    #[prop_or_default]
    pub title: Option<&'static str>,
    #[prop_or_default]
    pub icon: Option<VChild<Icon>>,
    #[prop_or_default]
    pub onclick: Callback<MouseEvent>,
    #[prop_or_default]
    pub noderef: NodeRef,
}

#[function_component(Button)]
pub fn button(props: &ButtonProps) -> Html {
    let html = html! {
        <button
            class={classes!(
                "btn",
                props.style.to_string(),
                if props.disabled { Some("disabled") } else { None },
                if props.loading { Some("loading" )} else { None },
                if props.input_group { Some("input-group-btn") } else { None }
            )}
            disabled={props.disabled}
            onclick={props.onclick.clone()}
            ref={props.noderef.clone()}
        >
            { props.title.map(Into::into).unwrap_or_else(|| html!()) }
            { if props.icon.is_some() && props.title.is_some() { " " } else { "" } }
            { props.icon.clone().map(Html::from).unwrap_or_default() }
        </button>
    };
    html
}

#[derive(Properties, PartialEq, Clone)]
pub struct HyperlinkButtonProps {
    #[prop_or_default]
    pub style: ButtonStyle,
    #[prop_or(false)]
    pub disabled: bool,
    #[prop_or(false)]
    pub loading: bool,
    pub title: Option<&'static str>,
    #[prop_or_default]
    pub icon: Option<IconName>,
    pub href: &'static str,
    #[prop_or_default]
    pub onclick: Callback<MouseEvent>,
    #[prop_or_default]
    pub noderef: NodeRef,
}

#[function_component(HyperlinkButton)]
pub fn hyperlink_button(props: &HyperlinkButtonProps) -> Html {
    html! {
        <a
            class={classes!(
                "btn",
                props.style.to_string(),
                if props.disabled { Some("disabled") } else { None },
                if props.loading { Some("loading" )} else { None },
            )}
            disabled={props.disabled}
            href={props.href}
            onclick={props.onclick.clone()}
            ref={props.noderef.clone()}
        >
            { props.title.map(Into::into).unwrap_or_else(|| html!()) }
            { if props.icon.is_some() && props.title.is_some() { " " } else { "" } }
            {
                if let Some(name) = props.icon {
                    html!{
                        <Icon name={name} />
                    }
                } else {
                    html!()
                }
            }
        </a>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct ButtonGroupProps {
    pub children: Children,
    #[prop_or(false)]
    pub block: bool,
}

#[function_component(ButtonGroup)]
pub fn button_group(props: &ButtonGroupProps) -> Html {
    html! {
        <div class={classes!("btn-group", if props.block { Some("btn-group-block") } else { None })}>
            {
                for props.children.iter()
            }
        </div>
    }
}

css_class_enum! {
    IconName ("icon") {
        Check => "check",
        Cross => "cross",
        Stop => "stop",
        Download => "download",
        Edit => "edit",
        Delete => "delete",
        Copy => "copy",
        None => ""
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct IconProps {
    pub name: IconName,
    #[prop_or(false)]
    pub form: bool,
}

#[function_component(Icon)]
pub fn icon(props: &IconProps) -> Html {
    html! {
        <i class={classes!("icon", if props.form { Some("form-icon") } else { None }, props.name.to_string())}></i>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct ModalProps {
    pub id: Option<&'static str>,
    #[prop_or(false)]
    pub active: bool,
    #[prop_or_default]
    pub size: ModalSize,
    #[prop_or_default]
    pub header: VNode,
    #[prop_or_default]
    pub body: VNode,
    #[prop_or_default]
    pub footer: VNode,
}

css_class_enum! {
    ModalSize("modal") {
        Small => "sm",
        Large => "lg",
        Default => ""
    }
}

impl Default for ModalSize {
    fn default() -> Self {
        Self::Default
    }
}

#[function_component(Modal)]
pub fn modal(props: &ModalProps) -> Html {
    html! {
        <div id={props.id} class={classes!("modal", props.size.to_string(), if props.active { Some("active") } else { None} )}>
            <a href="#close" class="modal-overlay" aria-label="Close"></a>
            <div class="modal-container">
                <div class="modal-header">
                    { props.header.clone() }
                </div>
                <div class="modal-body">
                    { props.body.clone() }
                </div>
                <div class="modal-footer">
                    { props.footer.clone() }
                </div>
            </div>
        </div>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct CardProps {
    pub title: String,
    #[prop_or_default]
    pub img: Option<VNode>,
    #[prop_or_default]
    pub subtitle: Option<String>,
    #[prop_or_default]
    pub body: Option<VNode>,
    #[prop_or_default]
    pub footer: Option<VNode>,
}

#[function_component(Card)]
pub fn card(props: &CardProps) -> Html {
    html! {
        <div class="card">
            <div class="card-header">
                <div class={classes!("card-title", "h5")}>{ props.title.clone() }</div>
                {
                    if let Some(subtitle) = props.subtitle.clone() {
                        html! {
                            <div class="card-subtitle">
                                { subtitle }
                            </div>
                        }
                    } else {
                        html!{ }
                    }
                }
            </div>
            {
                if let Some(img) = props.img.clone() {
                    html!{ <div class="card-image">{ img }</div> }
                } else {
                    html!{ }
                }
            }
            {
                if let Some(body) = props.body.clone() {
                    html!{ <div class="card-body">{ body }</div> }
                } else {
                    html!{ }
                }
            }
            {
                if let Some(footer) = props.footer.clone() {
                    html!{ <div class="card-footer">{ footer }</div> }
                } else {
                    html!{ }
                }
            }
        </div>
    }
}
