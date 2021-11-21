use roxmltree::{Document, Node};

pub trait XmlVisitor {
    fn visit(&mut self, node: Node);
}

pub fn depth_first_visit(doc: &Document, visitor: &mut impl XmlVisitor) {
    let mut stack = doc
        .root()
        .children()
        .rev()
        .filter(|x| x.is_element())
        .collect::<Vec<_>>();
    while let Some(node) = stack.pop() {
        visitor.visit(node);
        stack.extend(node.children().rev().filter(|x| x.is_element()));
    }
}
