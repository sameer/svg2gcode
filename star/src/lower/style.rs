use std::{collections::HashMap, iter};

use roxmltree::{Document, Node};

use crate::lower::{
    elements::{PATTERN_TAG_NAME, SVG_TAG_NAME, SYMBOL_TAG_NAME},
    visit::DEFS_TAG_NAME,
};

pub type CssRules<'a> = HashMap<&'a str, HashMap<&'a str, (usize, &'a str)>>;

/// Returns the effective value of the given presentation attribute (i.e. stroke),
/// adhering to precedence rules and checking inheritance.
///
/// 1. Inline style attribute
/// 2. CSS class rules
/// 3. Presentation attribute.
pub fn calculate_presentation_attr<'a, 'input: 'a>(
    node: Node<'a, 'input>,
    name: &str,
    css_rules: &'a CssRules<'input>,
    use_stack: &[(roxmltree::NodeId, [Option<f64>; 2])],
) -> Option<&'a str> {
    let find_in_ancestors = |start: Node<'a, 'input>| {
        for current in iter::successors(Some(start), Node::parent) {
            if !current.is_element() {
                continue;
            }
            if let Some(val) = get_node_presentation_attr(current, name, css_rules) {
                return Some(val);
            }
            if matches!(
                current.tag_name().name(),
                SVG_TAG_NAME | DEFS_TAG_NAME | SYMBOL_TAG_NAME | PATTERN_TAG_NAME
            ) {
                break;
            }
        }
        None
    };

    find_in_ancestors(node).or_else(|| {
        let doc = node.document();
        use_stack
            .iter()
            .rev()
            .filter_map(|&(id, _)| doc.get_node(id))
            .find_map(find_in_ancestors)
    })
}

/// Helper for [calculate_presentation_attr] that only checks the current node.
pub fn get_node_presentation_attr<'a, 'input: 'a>(
    node: Node<'a, 'input>,
    name: &str,
    css_rules: &'a CssRules<'input>,
) -> Option<&'a str> {
    node.attribute("style")
        .and_then(|style| {
            style.split(';').find_map(|decl| {
                let (k, v) = decl.split_once(':')?;
                (k.trim() == name).then(|| v.trim())
            })
        })
        .or_else(|| {
            node.attribute("class").and_then(|classes| {
                classes
                    .split_whitespace()
                    .filter_map(|cls| css_rules.get(cls)?.get(name))
                    .max_by_key(|(order, _)| *order)
                    .map(|(_, val)| *val)
            })
        })
        .or_else(|| node.attribute(name).map(str::trim))
}

/// Barebones CSS class rules parser.
///
/// Returns a map from class name to property + `(rule_order, value)` pairs. Only simple, flat
/// class selectors (`.classname { prop: val; }`) are handled.
pub fn parse_css<'a>(doc: &'a Document) -> CssRules<'a> {
    let mut rules: CssRules<'a> = HashMap::new();
    let mut rule_order = 0usize;
    for node in doc.descendants() {
        if node.tag_name().name() != "style" {
            continue;
        }
        let Some(css) = node.text() else { continue };
        for block in css.split('}') {
            let Some((selector, declarations)) = block.split_once('{') else {
                continue;
            };
            for subselector in selector.split(',') {
                let Some(class) = subselector.trim().strip_prefix('.') else {
                    continue;
                };
                // Strip pseudo-classes and other complexity.
                let class = class
                    .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
                    .next()
                    .unwrap_or("")
                    .trim();
                if class.is_empty() {
                    continue;
                }
                let entry = rules.entry(class).or_default();
                for decl in declarations.split(';') {
                    let Some((prop, val)) = decl.split_once(':') else {
                        continue;
                    };
                    let prop = prop.trim();
                    let val = val.trim();
                    if !prop.is_empty() && !val.is_empty() {
                        entry.insert(prop, (rule_order, val));
                    }
                }
                rule_order += 1;
            }
        }
    }
    rules
}
