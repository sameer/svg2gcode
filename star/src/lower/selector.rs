//! Really rough implementation of CSS selectors for node filtering.
//!
//! <https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Selectors>

use roxmltree::Node;

/// List of selectors separated by commas.
///
/// <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Selector_list>
#[derive(Debug, Clone)]
pub struct SelectorList(Vec<CombinatorSelector>);

/// A single selector with optional combinators, e.g. `g.layer > path`.
#[derive(Debug, Clone)]
struct CombinatorSelector {
    first: CompoundSelector,
    rest: Vec<(Combinator, CompoundSelector)>,
}

/// List of selectors that must all be satisfied for a node to match.
#[derive(Debug, Clone)]
struct CompoundSelector(Vec<Selector>);

/// Combines selectors
#[derive(Debug, Clone)]
enum Combinator {
    /// Whitespace
    ///
    /// <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Descendant_combinator>
    Descendant,
    /// `>`
    ///
    /// <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Child_combinator>
    Child,
}

/// <https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Selectors>
#[derive(Debug, Clone)]
enum Selector {
    /// `*`
    Star,
    /// `p`
    Type(String),
    /// `#id`
    Id(String),
    /// `.class`
    Class(String),
    /// `[attr]`
    Attribute(AttributeSelector),
    /// `:not(...)`
    ///
    /// <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:not>
    Not(SelectorList),
    /// `:is(...)`
    ///
    /// <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:is>
    Is(SelectorList),
    /// `:has(...)`
    ///
    /// <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:has>
    Has(RelativeSelectorList),
}

/// A selector list used inside `:has()` where each entry may optionally start with
/// a combinator (relative selector syntax). No leading combinator defaults to descendant.
///
/// <https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_selectors/Selectors_and_combinators>
#[derive(Debug, Clone)]
struct RelativeSelectorList(Vec<RelativeComplexSelector>);

#[derive(Debug, Clone)]
struct RelativeComplexSelector {
    /// Leading combinator; `None` means descendant (the default).
    leading: Option<Combinator>,
    selector: CombinatorSelector,
}

/// <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Attribute_selectors>
#[derive(Debug, Clone)]
struct AttributeSelector {
    name: String,
    /// No `op` means there just exists an attribute `name`.
    op: Option<(AttributeOp, String)>,
}

#[derive(Debug, Clone)]
enum AttributeOp {
    /// `[attr=val]` exact match
    Equal,
    /// `[attr~=val]` space-separated list includes val
    Includes,
    /// `[attr|=val]` equals val or starts with `val-`
    DashMatch,
    /// `[attr^=val]` starts with val
    Prefix,
    /// `[attr$=val]` ends with val
    Suffix,
    /// `[attr*=val]` contains val
    Substring,
}

// --- Parser ---

peg::parser!(grammar selector_parser() for str {
    rule whitespace() = [' ' | '\t' | '\n' | '\r']
    rule _()          = whitespace()*
    rule s()          = whitespace()+

    // Tag names, class names, and IDs
    rule ident() -> String = s:$(['a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_']+) { s.to_string() }

    // Attribute names
    rule attr_name() -> String = s:$(['a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | ':']+) { s.to_string() }

    // Attribute value
    rule unquoted() -> char = [c if c != ']' && !c.is_ascii_whitespace()]
    rule attr_value() -> String
        = "\"" s:$((!"\"" [_])*) "\"" { s.to_string() }
        / "'"  s:$((!"'"  [_])*) "'"  { s.to_string() }
        / cs:unquoted()+             { cs.into_iter().collect() }

    rule attr_op() -> AttributeOp
        = "~=" { AttributeOp::Includes  }
        / "|=" { AttributeOp::DashMatch }
        / "^=" { AttributeOp::Prefix    }
        / "$=" { AttributeOp::Suffix    }
        / "*=" { AttributeOp::Substring }
        / "="  { AttributeOp::Equal     }

    rule attribute_selector() -> AttributeSelector
        = "[" _() name:attr_name() _() op:(op:attr_op() _() val:attr_value() { (op, val) })? _() "]"
        { AttributeSelector { name, op } }

    rule selector() -> Selector
        = "*"                              { Selector::Star  }
        / "#" id:ident()                   { Selector::Id(id)     }
        / "." cls:ident()                  { Selector::Class(cls) }
        / a:attribute_selector()           { Selector::Attribute(a) }
        / ":not(" _() list:selector_list() _() ")" { Selector::Not(list) }
        / ":is("  _() list:selector_list() _() ")" { Selector::Is(list)  }
        / ":has(" _() list:relative_selector_list_no_has() _() ")" { Selector::Has(list) }
        / t:ident()                        { Selector::Type(t)    }

    rule compound() -> CompoundSelector
        = selectors:selector()+ { CompoundSelector(selectors) }

    rule combinator() -> Combinator
        = _() ">" _() { Combinator::Child      }
        / s()         { Combinator::Descendant }

    rule complex() -> CombinatorSelector
        = first:compound() rest:(c:combinator() cs:compound() { (c, cs) })*
        { CombinatorSelector { first, rest } }

    pub rule selector_list() -> SelectorList
        = _() selectors:(complex() ++ (_() "," _())) _()
        { SelectorList(selectors) }

    // Restricted variants used inside :has() — identical to the above but omit :has(),
    // enforcing the spec prohibition on nesting :has() inside :has() at parse time.
    rule selector_no_has() -> Selector
        = "*"                              { Selector::Star  }
        / "#" id:ident()                   { Selector::Id(id)     }
        / "." cls:ident()                  { Selector::Class(cls) }
        / a:attribute_selector()           { Selector::Attribute(a) }
        / ":not(" _() list:selector_list_no_has() _() ")" { Selector::Not(list) }
        / ":is("  _() list:selector_list_no_has() _() ")" { Selector::Is(list)  }
        / t:ident()                        { Selector::Type(t)    }

    rule compound_no_has() -> CompoundSelector
        = selectors:selector_no_has()+ { CompoundSelector(selectors) }

    rule complex_no_has() -> CombinatorSelector
        = first:compound_no_has() rest:(c:combinator() cs:compound_no_has() { (c, cs) })*
        { CombinatorSelector { first, rest } }

    rule selector_list_no_has() -> SelectorList
        = _() selectors:(complex_no_has() ++ (_() "," _())) _()
        { SelectorList(selectors) }

    // Relative selector list: used inside :has(), each entry may start with a combinator.
    // No leading combinator defaults to descendant.
    rule relative_complex_no_has() -> RelativeComplexSelector
        = _() leading:combinator()? first:compound_no_has() rest:(c:combinator() cs:compound_no_has() { (c, cs) })*
        { RelativeComplexSelector { leading, selector: CombinatorSelector { first, rest } } }

    rule relative_selector_list_no_has() -> RelativeSelectorList
        = selectors:(relative_complex_no_has() ++ (_() "," _())) _()
        { RelativeSelectorList(selectors) }
});

impl SelectorList {
    pub fn parse(input: &str) -> Result<Self, String> {
        selector_parser::selector_list(input)
            .map_err(|e| format!("Parse error at `{:?}`: expected {}", e.location, e.expected))
    }

    pub fn matches(&self, node: Node) -> bool {
        self.0.iter().any(|s| s.matches(node))
    }
}

impl RelativeSelectorList {
    /// Matches if any relative selector finds a candidate under `node`.
    fn matches(&self, node: Node) -> bool {
        self.0.iter().any(|rel| {
            let sel = &rel.selector;
            match rel.leading {
                None | Some(Combinator::Descendant) => {
                    node.descendants().skip(1).any(|d| sel.matches(d))
                }
                Some(Combinator::Child) => node
                    .children()
                    .filter(|n| n.is_element())
                    .any(|d| sel.matches(d)),
            }
        })
    }
}

impl CombinatorSelector {
    /// Match by working right-to-left: the rightmost compound must match the node,
    /// then each combinator+compound is satisfied working up the DOM.
    fn matches(&self, node: Node) -> bool {
        // The rightmost compound is the last entry in `rest`
        let Some((_rightmost_combinator, rightmost)) = self.rest.last() else {
            return self.first.matches(node);
        };
        if !rightmost.matches(node) {
            return false;
        }

        // Walk backwards through the combinators
        // rest = [(comb0, c1), (comb1, c2), ..., (combN-1, cN)]
        // We matched cN. Now verify each (combinator, compound) going left.
        let mut current = node;
        for i in (0..self.rest.len()).rev() {
            let (combinator, _) = &self.rest[i];
            let target = if i == 0 {
                &self.first
            } else {
                &self.rest[i - 1].1
            };

            match combinator {
                // Find first matching ancestor
                Combinator::Descendant => {
                    let found = std::iter::successors(current.parent(), |n| n.parent())
                        .filter(|n| n.is_element())
                        .find(|n| target.matches(*n));
                    match found {
                        Some(ancestor) => current = ancestor,
                        None => return false,
                    }
                }
                // Check parent
                Combinator::Child => {
                    match current
                        .parent()
                        .filter(|n| n.is_element() && target.matches(*n))
                    {
                        Some(parent) => current = parent,
                        None => return false,
                    }
                }
            }
        }
        true
    }
}

impl CompoundSelector {
    fn matches(&self, node: Node) -> bool {
        self.0.iter().all(|s| s.matches(node))
    }
}

impl Selector {
    fn matches(&self, node: Node) -> bool {
        match self {
            Self::Star => true,
            Self::Type(t) => node.tag_name().name() == t,
            Self::Id(id) => node.attribute("id") == Some(id),
            Self::Class(cls) => node
                .attribute("class")
                .is_some_and(|c| c.split_whitespace().any(|w| w == cls)),
            Self::Attribute(attr) => attr.matches(node),
            Self::Not(list) => !list.matches(node),
            Self::Is(list) => list.matches(node),
            Self::Has(list) => list.matches(node),
        }
    }
}

impl AttributeSelector {
    fn matches(&self, node: Node) -> bool {
        // Use attribute-name matching across all attributes to support namespaced attrs
        // like `inkscape:label` which roxmltree may expose under a namespace.
        let value = node
            .attributes()
            .find(|a| a.name() == self.name)
            .map(|a| a.value());

        match (&self.op, value) {
            (None, Some(_)) => true,
            (None, None) => false,
            (Some(_), None) => false,
            (Some((op, expected)), Some(val)) => match op {
                AttributeOp::Equal => val == expected,
                AttributeOp::Includes => val.split_whitespace().any(|w| w == expected),
                AttributeOp::DashMatch => {
                    val == expected
                        || (val.starts_with(expected.as_str())
                            && val.as_bytes().get(expected.len()) == Some(&b'-'))
                }
                AttributeOp::Prefix => val.starts_with(expected),
                AttributeOp::Suffix => val.ends_with(expected),
                AttributeOp::Substring => val.contains(expected),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse() {
        // (selector, whether expected to parse successfully)
        let cases: &[(&str, bool)] = &[
            // types
            ("path", true),
            ("g", true),
            ("svg", true),
            // id & class
            ("#layer1", true),
            ("g#layer1", true),
            (".cut", true),
            ("path.cut", true),
            // attributes
            ("[id]", true),
            ("[id=foo]", true),
            ("[id=\"foo bar\"]", true),
            ("[style*=\"display:none\"]", true),
            ("[inkscape:label=\"Layer 1\"]", true),
            // combinators
            ("g path", true),
            ("g > path", true),
            ("g.layer1 > path.cut", true),
            // selector list
            ("path, rect", true),
            ("path,rect", true),
            (".cut, .engrave, #border", true),
            // pseudo-classes
            (":not(.draft)", true),
            ("path:not(.draft)", true),
            (":is(path, rect)", true),
            (":is(path, rect):not(.draft)", true),
            (":not(path, rect)", true),
            (":has(path)", true),
            (":has(path.cut)", true),
            (":has(> path)", true),
            (":has(:not(.draft))", true),
            (":has(:is(path, rect))", true),
            // :has() inside :has() is forbidden
            (":has(:has(path))", false),
            (":has(:is(:has(path)))", false),
            (":has(:not(:has(path)))", false),
            // errors
            ("", false),
            (",", false),
            ("path >", false),
        ];

        for &(input, ok) in cases {
            let result = SelectorList::parse(input);
            if ok {
                result.unwrap_or_else(|e| panic!("expected parse ok for {input:?}: {e}"));
            } else {
                assert!(result.is_err(), "expected parse error for {input:?}");
            }
        }
    }

    #[test]
    fn test_match() {
        let svg = r#"<svg>
            <g id="layer1">
                <path id="p-cut"    class="cut"/>
                <path id="p-draft"  class="draft"/>
                <g id="nested">
                    <path id="p-nested"/>
                </g>
            </g>
            <path   id="p-outer"  style="display:none"/>
            <rect   id="r-draft"  class="draft"/>
            <circle id="c1"/>
        </svg>"#;
        let doc = roxmltree::Document::parse(svg).unwrap();

        // (selector, node id in fixture, expected match result)
        let cases: &[(&str, &str, bool)] = &[
            // type selector
            ("path", "p-cut", true),
            ("path", "r-draft", false),
            ("circle", "c1", true),
            // id selector
            ("#layer1", "layer1", true),
            ("#layer1", "p-cut", false),
            // class selector
            (".cut", "p-cut", true),
            (".cut", "p-draft", false),
            (".draft", "r-draft", true),
            // attribute selector
            ("[style*=\"display:none\"]", "p-outer", true),
            ("[style*=\"display:none\"]", "r-draft", false),
            // descendant combinator — p-cut is inside layer1, p-outer is not
            ("#layer1 path", "p-cut", true),
            ("#layer1 path", "p-nested", true),
            ("#layer1 path", "p-outer", false),
            // child combinator — p-cut is a direct child of layer1
            ("#layer1 > path", "p-cut", true),
            ("#layer1 > path", "p-nested", false), // nested is child of g#nested
            // `#layer1 *` matches descendants of layer1, not layer1 itself
            ("#layer1 *", "p-cut", true),
            ("#layer1 *", "p-outer", false),
            ("#layer1", "p-cut", false), // per-node: layer1 ≠ p-cut
            // :not()
            (":not(.draft)", "p-cut", true),
            (":not(.draft)", "p-draft", false),
            (":not(.draft)", "r-draft", false),
            ("path:not(.draft)", "p-cut", true),
            ("path:not(.draft)", "p-draft", false),
            ("path:not(.draft)", "r-draft", false), // rect, not path
            // :is()
            (":is(path, rect)", "p-cut", true),
            (":is(path, rect)", "r-draft", true),
            (":is(path, rect)", "c1", false),
            // :is() + :not() AND grouping
            (":is(path, rect):not(.draft)", "p-cut", true),
            (":is(path, rect):not(.draft)", "r-draft", false),
            (":is(path, rect):not(.draft)", "c1", false),
            // :not() with selector list
            (":not(path, rect)", "c1", true),
            (":not(path, rect)", "p-cut", false),
            (":not(path, rect)", "r-draft", false),
            // :has() — matches the container, not the descendant
            (":has(path)", "layer1", true), // layer1 contains paths
            (":has(path)", "p-cut", false), // p-cut has no path descendants
            (":has(path)", "c1", false),
            (":has(.cut)", "layer1", true),
            (":has(.cut)", "nested", false), // nested only contains p-nested (no class)
            (":has(> path)", "layer1", true), // layer1 has direct child paths
            (":has(> path)", "nested", true), // nested has direct child p-nested
            ("g:has(path.cut)", "layer1", true), // g containing path.cut
            ("g:has(path.cut)", "nested", false), // nested has no path.cut
            // selector list (OR)
            ("path, rect", "p-cut", true),
            ("path, rect", "r-draft", true),
            ("path, rect", "c1", false),
        ];

        for &(selector, id, expected) in cases {
            let sel = SelectorList::parse(selector)
                .unwrap_or_else(|e| panic!("parse failed for {selector:?}: {e}"));
            let node = doc
                .root()
                .descendants()
                .find(|n| n.attribute("id") == Some(id))
                .unwrap_or_else(|| panic!("no node with id={id:?} in fixture"));
            let got = sel.matches(node);
            assert_eq!(
                got, expected,
                "selector={selector:?} node={id:?}: expected {expected}, got {got}"
            );
        }
    }
}
