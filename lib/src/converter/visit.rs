use roxmltree::{Document, Node};

pub trait XmlVisitor {
    fn visit(&mut self, node: Node);
}

pub fn is_valid_node(node: &Node) -> bool {
    return node.is_element() && !node.attribute("style").unwrap_or_default().contains("display:none");
}

pub fn depth_first_visit(doc: &Document, visitor: &mut impl XmlVisitor) {
    let mut stack = doc
        .root()
        .children()
        .rev()
        .filter(|x| is_valid_node(x))
        .collect::<Vec<_>>();
    while let Some(node) = stack.pop() {
        visitor.visit(node);
        stack.extend(node.children().rev().filter(|x| is_valid_node(x)));
    }
}
