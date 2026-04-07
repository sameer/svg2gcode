//! Lightweight CSS stylesheet parser for resolving styles defined in SVG `<style>` blocks.
//!
//! Only supports property lookup by matching rules against a given node — no full cascade,
//! specificity, or `@`-rules. Last-match-wins among rules in document order.

use log::warn;
use roxmltree::{Document, Node};

use super::selector::SelectorList;

/// A single CSS rule: a selector list and its property declarations.
#[derive(Debug, Clone)]
struct CssRule {
    selector: SelectorList,
    /// Property declarations in source order, e.g. `("fill", "none")`.
    declarations: Vec<(String, String)>,
}

/// A parsed CSS stylesheet extracted from `<style>` elements in an SVG document.
#[derive(Debug, Clone)]
pub struct Stylesheet {
    rules: Vec<CssRule>,
}

impl Default for Stylesheet {
    fn default() -> Self {
        Self { rules: vec![] }
    }
}

impl Stylesheet {
    /// Scan an SVG document for all `<style>` elements and parse their CSS text.
    pub fn from_document(doc: &Document) -> Self {
        let mut css_text = String::new();
        for node in doc.root().descendants() {
            if node.is_element() && node.tag_name().name() == "style" {
                // roxmltree exposes text content (including CDATA) via children
                for child in node.children() {
                    if child.is_text() || child.is_comment() {
                        if let Some(text) = child.text() {
                            css_text.push_str(text);
                        }
                    }
                }
            }
        }
        if css_text.is_empty() {
            return Self::default();
        }
        Self::parse_css(&css_text)
    }

    fn parse_css(input: &str) -> Self {
        let stripped = strip_comments(input);
        let mut rules = Vec::new();

        // Split on `{` and `}` to extract selector/declaration pairs
        let mut rest = stripped.as_str();
        while let Some(open) = rest.find('{') {
            let selector_text = rest[..open].trim();
            rest = &rest[open + 1..];

            let Some(close) = rest.find('}') else {
                break;
            };
            let declarations_text = rest[..close].trim();
            rest = &rest[close + 1..];

            // Skip @-rules
            if selector_text.starts_with('@') {
                continue;
            }

            if selector_text.is_empty() {
                continue;
            }

            let selector = match SelectorList::parse(selector_text) {
                Ok(s) => s,
                Err(e) => {
                    warn!("Failed to parse CSS selector `{selector_text}`: {e}");
                    continue;
                }
            };

            let declarations = parse_declarations(declarations_text);
            if !declarations.is_empty() {
                rules.push(CssRule {
                    selector,
                    declarations,
                });
            }
        }

        Self { rules }
    }

    /// Look up a CSS property value for a given node by matching against all rules.
    /// Returns the value from the last matching rule (document order, last-match-wins).
    pub fn get_property<'a>(&'a self, node: Node, property: &str) -> Option<&'a str> {
        let mut result = None;
        for rule in &self.rules {
            if rule.selector.matches(node) {
                for (key, value) in &rule.declarations {
                    if key == property {
                        result = Some(value.as_str());
                    }
                }
            }
        }
        result
    }
}

/// Strip CSS comments (`/* ... */`) from the input.
fn strip_comments(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.char_indices().peekable();
    while let Some((_i, c)) = chars.next() {
        if c == '/' {
            if let Some(&(_, '*')) = chars.peek() {
                // Start of comment — skip until `*/`
                chars.next(); // consume '*'
                loop {
                    match chars.next() {
                        Some((_, '*')) => {
                            if let Some(&(_, '/')) = chars.peek() {
                                chars.next(); // consume '/'
                                break;
                            }
                        }
                        None => break,
                        _ => {}
                    }
                }
                continue;
            }
        }
        output.push(c);
    }
    output
}

/// Parse CSS declarations from a `key: value; key: value` string.
fn parse_declarations(input: &str) -> Vec<(String, String)> {
    input
        .split(';')
        .filter_map(|entry| {
            let (key, value) = entry.split_once(':')?;
            let key = key.trim();
            let value = value.trim();
            if key.is_empty() || value.is_empty() {
                return None;
            }
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_class_rule() {
        let sheet = Stylesheet::parse_css(".st0 { fill: none; stroke: #1d1d1b; }");
        assert_eq!(sheet.rules.len(), 1);
        assert_eq!(sheet.rules[0].declarations.len(), 2);
        assert_eq!(sheet.rules[0].declarations[0], ("fill".into(), "none".into()));
        assert_eq!(
            sheet.rules[0].declarations[1],
            ("stroke".into(), "#1d1d1b".into())
        );
    }

    #[test]
    fn parse_multiple_rules() {
        let css = ".st0 { fill: none; } .st1 { stroke: red; fill: blue; }";
        let sheet = Stylesheet::parse_css(css);
        assert_eq!(sheet.rules.len(), 2);
        assert_eq!(sheet.rules[0].declarations.len(), 1);
        assert_eq!(sheet.rules[1].declarations.len(), 2);
    }

    #[test]
    fn strip_css_comments() {
        let css = "/* comment */ .st0 { fill: none; /* inner */ stroke: red; }";
        let sheet = Stylesheet::parse_css(css);
        assert_eq!(sheet.rules.len(), 1);
        assert_eq!(sheet.rules[0].declarations.len(), 2);
    }

    #[test]
    fn skip_at_rules() {
        let css = "@charset \"utf-8\"; .st0 { fill: none; }";
        let sheet = Stylesheet::parse_css(css);
        assert_eq!(sheet.rules.len(), 1);
    }

    #[test]
    fn get_property_with_class_match() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <defs><style>.st0 { fill: none; stroke: #1d1d1b; }</style></defs>
            <path class="st0" d="M0,0 L10,10"/>
            <path d="M0,0 L10,10"/>
        </svg>"#;
        let doc = Document::parse(svg).unwrap();
        let sheet = Stylesheet::from_document(&doc);

        let path_with_class = doc
            .root()
            .descendants()
            .find(|n| n.is_element() && n.attribute("class") == Some("st0"))
            .unwrap();
        let path_without_class = doc
            .root()
            .descendants()
            .filter(|n| n.is_element() && n.tag_name().name() == "path")
            .find(|n| n.attribute("class").is_none())
            .unwrap();

        assert_eq!(sheet.get_property(path_with_class, "fill"), Some("none"));
        assert_eq!(
            sheet.get_property(path_with_class, "stroke"),
            Some("#1d1d1b")
        );
        assert_eq!(sheet.get_property(path_without_class, "fill"), None);
    }

    #[test]
    fn multiple_classes_on_element() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <defs><style>.a { fill: none; } .b { stroke: red; }</style></defs>
            <path class="a b" d="M0,0 L10,10"/>
        </svg>"#;
        let doc = Document::parse(svg).unwrap();
        let sheet = Stylesheet::from_document(&doc);

        let path = doc
            .root()
            .descendants()
            .find(|n| n.is_element() && n.tag_name().name() == "path")
            .unwrap();

        assert_eq!(sheet.get_property(path, "fill"), Some("none"));
        assert_eq!(sheet.get_property(path, "stroke"), Some("red"));
    }

    #[test]
    fn last_rule_wins() {
        let css = ".st0 { fill: red; } .st0 { fill: blue; }";
        let sheet = Stylesheet::parse_css(css);

        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <path class="st0" d="M0,0 L10,10"/>
        </svg>"#;
        let doc = Document::parse(svg).unwrap();
        let path = doc
            .root()
            .descendants()
            .find(|n| n.is_element() && n.tag_name().name() == "path")
            .unwrap();

        assert_eq!(sheet.get_property(path, "fill"), Some("blue"));
    }

    #[test]
    fn illustrator_style_svg() {
        let svg = r#"<?xml version="1.0" encoding="UTF-8"?>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
          <defs>
            <style>
              .st0 {
                fill: none;
                stroke: #1d1d1b;
                stroke-miterlimit: 10;
              }
            </style>
          </defs>
          <path class="st0" d="M10,10 L90,90"/>
        </svg>"#;
        let doc = Document::parse(svg).unwrap();
        let sheet = Stylesheet::from_document(&doc);

        let path = doc
            .root()
            .descendants()
            .find(|n| n.is_element() && n.tag_name().name() == "path")
            .unwrap();

        assert_eq!(sheet.get_property(path, "fill"), Some("none"));
        assert_eq!(sheet.get_property(path, "stroke"), Some("#1d1d1b"));
        assert_eq!(
            sheet.get_property(path, "stroke-miterlimit"),
            Some("10")
        );
    }
}
