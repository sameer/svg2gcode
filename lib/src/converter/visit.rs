use roxmltree::{Document, Node};

pub trait XmlVisitor {
    fn visit_enter(&mut self, node: Node);
    fn visit_exit(&mut self, node: Node);
}

pub fn is_valid_node(node: Node) -> bool {
    return node.is_element()
        && !node
            .attribute("style")
            .unwrap_or_default()
            .contains("display:none");
}

pub fn depth_first_visit(doc: &Document, visitor: &mut impl XmlVisitor) {
    fn visit_node(node: Node, visitor: &mut impl XmlVisitor) {
        if !is_valid_node(node) {
            return;
        }
        visitor.visit_enter(node);
        node.children().for_each(|child| visit_node(child, visitor));
        visitor.visit_exit(node);
    }

    doc.root()
        .children()
        .for_each(|child| visit_node(child, visitor));
}
