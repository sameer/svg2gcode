use std::fmt::Display;
use web_sys::{FileList, HtmlInputElement, MouseEvent};
use yew::{
    classes, function_component, html, use_state,
    virtual_dom::{VChild, VNode},
    Callback, ChangeData, Children, Html, InputData, NodeRef, Properties,
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

        impl ToString for $name {
            fn to_string(&self) -> String {
                let suffix = match self {
                    $(
                        Self::$variant => $class
                    ),*
                };
                if suffix.is_empty() {
                    String::default()
                } else {
                    let mut acc = String::default();
                    $(
                        acc += $prefix;
                        acc.push('-');
                    )?
                    acc += suffix;
                    acc
                }
            }
        }
    };
}

#[derive(Properties, PartialEq, Clone)]
pub struct InputProps<T, E>
where
    T: Display + Clone + PartialEq,
    E: Display + Clone + PartialEq,
{
    pub label: &'static str,
    pub desc: Option<&'static str>,
    pub parsed: Option<Result<T, E>>,
    pub placeholder: Option<T>,
    pub default: Option<T>,
    #[prop_or_default]
    pub oninput: Callback<InputData>,
}

#[function_component(Input)]
pub fn input<T, E>(props: &InputProps<T, E>) -> Html
where
    T: Display + Clone + PartialEq,
    E: Display + Clone + PartialEq,
{
    let success = props.parsed.as_ref().map(|x| x.is_ok()).unwrap_or(false);
    let error = props.parsed.as_ref().map(|x| x.is_err()).unwrap_or(false);
    let id = props.label.to_lowercase().replace(' ', "-");

    let applied_default_value = use_state(|| false);
    let node_ref = use_state(|| NodeRef::default());

    if let (false, Some(default), Some(input_element)) = (
        *applied_default_value,
        props.default.as_ref(),
        node_ref.cast::<HtmlInputElement>(),
    ) {
        input_element.set_value(&default.to_string());
        applied_default_value.set(true);
    }

    html! {
        <div class={classes!(
            "form-group",
            if success { Some("has-success") } else if error { Some("has-error") } else { None }
        )}>
            <label class="form-label" for={id.clone()}>
                { props.label }
            </label>
            <div class={classes!(if success || error { Some("has-icon-right") } else { None })}>
                <input id={id} class="form-input" type="text" ref={(*node_ref).clone()}
                    oninput={props.oninput.clone()} placeholder={ props.placeholder.as_ref().map(ToString::to_string) }
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
        </div>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct FileUploadProps<T, E>
where
    T: Clone + PartialEq,
    E: Display + Clone + PartialEq,
{
    pub label: &'static str,
    pub desc: Option<&'static str>,
    pub accept: Option<&'static str>,
    #[prop_or(false)]
    pub multiple: bool,
    pub parsed: Option<Result<T, E>>,
    #[prop_or_default]
    pub onchange: Callback<FileList>,
}

#[function_component(FileUpload)]
pub fn file_upload<T, E>(props: &FileUploadProps<T, E>) -> Html
where
    T: Clone + PartialEq,
    E: Display + Clone + PartialEq,
{
    let success = props.parsed.as_ref().map(|x| x.is_ok()).unwrap_or(false);
    let error = props.parsed.as_ref().map(|x| x.is_err()).unwrap_or(false);
    let id = props.label.to_lowercase().replace(' ', "-");
    html! {
        <div class={classes!(
            "form-group",
            if success { Some("has-success") } else if error { Some("has-error") } else { None }
        )}>
            <label class="form-label" for={id.clone()}>
                { props.label }
            </label>
            <div class={classes!(if success || error { Some("has-icon-right") } else { None })}>
                <input id={id} class="form-input" type="file" accept={props.accept} multiple={props.multiple}
                    onchange={props.onchange.clone().reform(|x: ChangeData| {
                        match x {
                            ChangeData::Files(file_list) => file_list,
                            _ => unreachable!()
                        }
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
            {
                if let Some(Err(ref err)) = props.parsed.as_ref() {
                    html!{ <pre class="form-input-hint">{ err }</pre> }
                } else if let Some(desc) = props.desc {
                    html! { <p class="form-input-hint">{ desc }</p> }
                } else {
                    html!()
                }
            }
        </div>
    }
}

#[derive(Properties, PartialEq, Clone)]
pub struct TextAreaProps<T, E>
where
    T: Display + Clone + PartialEq,
    E: Display + Clone + PartialEq,
{
    pub label: &'static str,
    pub desc: Option<&'static str>,
    pub parsed: Option<Result<T, E>>,
    pub placeholder: Option<String>,
    pub default: Option<String>,
    #[prop_or_default]
    pub oninput: Callback<InputData>,
    pub rows: Option<usize>,
    pub cols: Option<usize>,
}

#[function_component(TextArea)]
pub fn text_area<T, E>(props: &TextAreaProps<T, E>) -> Html
where
    T: Display + Clone + PartialEq,
    E: Display + Clone + PartialEq,
{
    let success = props.parsed.as_ref().map(|x| x.is_ok()).unwrap_or(false);
    let error = props.parsed.as_ref().map(|x| x.is_err()).unwrap_or(false);
    let id = props.label.to_lowercase().replace(' ', "-");

    let applied_default_value = use_state(|| false);
    let node_ref = use_state(|| NodeRef::default());

    if let (false, Some(default), Some(input_element)) = (
        *applied_default_value,
        props.default.as_ref(),
        node_ref.cast::<HtmlInputElement>(),
    ) {
        input_element.set_value(&default.to_string());
        applied_default_value.set(true);
    }

    html! {
        <div class={classes!(
            "form-group",
            if success { Some("has-success") } else if error { Some("has-error") } else { None }
        )}>
            <label class="form-label" for={id.clone()}>
                { props.label }
            </label>
            <div class={classes!(if success || error { Some("has-icon-right") } else { None })}>
                <textarea class="form-input" id={id} oninput={props.oninput.clone()}
                    ref={(*node_ref).clone()}
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
        </div>
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
    #[prop_or(false)]
    pub disabled: bool,
    #[prop_or(false)]
    pub loading: bool,
    pub title: Option<&'static str>,
    pub icon: Option<VChild<Icon>>,
    #[prop_or_default]
    pub onclick: Callback<MouseEvent>,
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
            )}
            disabled={props.disabled}
            onclick={props.onclick.clone()}
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
    pub icon: Option<IconName>,
    pub href: &'static str,
    #[prop_or_default]
    pub onclick: Callback<MouseEvent>,
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
        >
            { props.title.map(Into::into).unwrap_or_else(|| html!()) }
            { if props.icon.is_some() && props.title.is_some() { " " } else { "" } }
            {
                if let Some(name) = props.icon.clone() {
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
}

#[function_component(ButtonGroup)]
pub fn button_group(props: &ButtonGroupProps) -> Html {
    html! {
        <div class={classes!("btn-group", "btn-group-block")}>
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
        Edit => "edit"
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
