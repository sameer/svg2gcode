use std::collections::HashMap;

use g_code::{
    emit::{FormatOptions, format_gcode_fmt},
    parse::snippet_parser,
};
use regex::Regex;
use roxmltree::ParsingOptions;
use serde::{Deserialize, Serialize};
use serde_json::json;
use svg2gcode::{
    ConversionOptions, EngravingOperation, Machine, Settings, svg2program_engraving_multi,
};
use wasm_bindgen::prelude::*;
use xmltree::{Element, XMLNode};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SvgTreeNode {
    pub id: Option<String>,
    pub label: String,
    pub tag_name: String,
    pub selectable: bool,
    pub selectable_descendant_ids: Vec<String>,
    pub children: Vec<SvgTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedSvgDocument {
    pub normalized_svg: String,
    pub tree: SvgTreeNode,
    pub selectable_element_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendOperation {
    pub id: String,
    pub name: String,
    pub target_depth_mm: f64,
    pub assigned_element_ids: Vec<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateJobRequest {
    pub normalized_svg: String,
    pub settings: Settings,
    pub operations: Vec<FrontendOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationLineRange {
    pub operation_id: String,
    pub operation_name: String,
    pub color: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewSnapshot {
    pub material_width: f64,
    pub material_height: f64,
    pub material_thickness: f64,
    pub tool_diameter: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateJobResponse {
    pub gcode: String,
    pub warnings: Vec<String>,
    pub operation_ranges: Vec<OperationLineRange>,
    pub preview_snapshot: PreviewSnapshot,
}

#[wasm_bindgen]
pub fn default_settings() -> String {
    let mut settings = Settings::default();
    settings.engraving.enabled = true;
    serialize_ok(settings)
}

#[wasm_bindgen]
pub fn prepare_svg_document(svg: &str) -> String {
    match prepare_svg(svg) {
        Ok(prepared) => serialize_ok(prepared),
        Err(error) => serialize_error(error),
    }
}

#[wasm_bindgen]
pub fn generate_engraving_job(input: &str) -> String {
    let request: Result<GenerateJobRequest, _> = serde_json::from_str(input);
    match request {
        Ok(request) => match generate_job(request) {
            Ok(response) => serialize_ok(response),
            Err(error) => serialize_error(error),
        },
        Err(error) => serialize_error(error),
    }
}

fn serialize_ok<T: Serialize>(value: T) -> String {
    serde_json::to_string(&json!({
        "ok": true,
        "data": value,
    }))
    .expect("serializing wasm response envelope should succeed")
}

fn serialize_error(error: impl ToString) -> String {
    serde_json::to_string(&json!({
        "ok": false,
        "error": error.to_string(),
    }))
    .expect("serializing wasm error envelope should succeed")
}

fn prepare_svg(svg: &str) -> Result<PreparedSvgDocument, String> {
    let mut root = Element::parse(svg.as_bytes()).map_err(|err| err.to_string())?;
    if root.name != "svg" {
        return Err("Expected an <svg> document.".into());
    }

    let class_styles = collect_class_styles(&root)?;
    let mut counter = 0usize;
    let mut selectable_ids = Vec::new();
    let tree = normalize_element(&mut root, &class_styles, &mut counter, &mut selectable_ids);

    let mut normalized_svg = Vec::new();
    root.write(&mut normalized_svg).map_err(|err| err.to_string())?;
    let normalized_svg = String::from_utf8(normalized_svg).map_err(|err| err.to_string())?;

    Ok(PreparedSvgDocument {
        normalized_svg,
        tree,
        selectable_element_ids: selectable_ids,
    })
}

fn generate_job(request: GenerateJobRequest) -> Result<GenerateJobResponse, String> {
    let document = roxmltree::Document::parse_with_options(
        request.normalized_svg.as_str(),
        ParsingOptions {
            allow_dtd: true,
            ..Default::default()
        },
    )
    .map_err(|err| err.to_string())?;

    let machine = Machine::new(
        request.settings.machine.supported_functionality.clone(),
        request.settings.machine.travel_z,
        request.settings.machine.cut_z,
        request.settings.machine.plunge_feedrate,
        request
            .settings
            .machine
            .path_begin_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose()
            .map_err(|err| err.to_string())?,
        request
            .settings
            .machine
            .tool_on_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose()
            .map_err(|err| err.to_string())?,
        request
            .settings
            .machine
            .tool_off_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose()
            .map_err(|err| err.to_string())?,
        request
            .settings
            .machine
            .begin_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose()
            .map_err(|err| err.to_string())?,
        request
            .settings
            .machine
            .end_sequence
            .as_deref()
            .map(snippet_parser)
            .transpose()
            .map_err(|err| err.to_string())?,
    );

    let operations = request
        .operations
        .iter()
        .filter(|operation| !operation.assigned_element_ids.is_empty())
        .map(|operation| EngravingOperation {
            id: operation.id.clone(),
            name: operation.name.clone(),
            selector_filter: build_selector_filter(&operation.assigned_element_ids),
            target_depth: operation.target_depth_mm,
        })
        .collect::<Vec<_>>();

    let (program, warnings) = svg2program_engraving_multi(
        &document,
        &request.settings.conversion,
        ConversionOptions::default(),
        machine,
        &request.settings.engraving,
        &operations,
    )?;

    let mut gcode = String::new();
    format_gcode_fmt(
        program.iter(),
        FormatOptions {
            checksums: request.settings.postprocess.checksums,
            line_numbers: request.settings.postprocess.line_numbers,
            newline_before_comment: true,
            ..Default::default()
        },
        &mut gcode,
    )
    .map_err(|err| err.to_string())?;

    Ok(GenerateJobResponse {
        operation_ranges: extract_operation_ranges(&gcode, &request.operations),
        gcode,
        warnings: warnings
            .into_iter()
            .map(|warning| warning.message().to_string())
            .collect(),
        preview_snapshot: PreviewSnapshot {
            material_width: request.settings.engraving.material_width,
            material_height: request.settings.engraving.material_height,
            material_thickness: request.settings.engraving.material_thickness,
            tool_diameter: request.settings.engraving.tool_diameter,
        },
    })
}

fn build_selector_filter(ids: &[String]) -> String {
    ids.iter()
        .map(|id| format!("[data-s2g-id=\"{id}\"]"))
        .collect::<Vec<_>>()
        .join(",")
}

fn extract_operation_ranges(
    gcode: &str,
    operations: &[FrontendOperation],
) -> Vec<OperationLineRange> {
    let operation_map = operations
        .iter()
        .map(|operation| (operation.id.as_str(), operation))
        .collect::<HashMap<_, _>>();
    let mut ranges = Vec::new();
    let mut active_operation: Option<(&FrontendOperation, usize)> = None;

    for (index, line) in gcode.lines().enumerate() {
        let line_number = index + 1;
        if let Some(rest) = line.trim().strip_prefix(";operation:start:") {
            let operation_id = rest.split_once(':').map(|(id, _)| id).unwrap_or(rest);
            if let Some(operation) = operation_map.get(operation_id) {
                active_operation = Some((operation, line_number + 1));
            }
        } else if let Some(operation_id) = line.trim().strip_prefix(";operation:end:")
            && let Some((operation, start_line)) = active_operation.take()
            && operation.id == operation_id
        {
            ranges.push(OperationLineRange {
                operation_id: operation.id.clone(),
                operation_name: operation.name.clone(),
                color: operation.color.clone(),
                start_line,
                end_line: line_number.saturating_sub(1),
            });
        }
    }

    if let Some((operation, start_line)) = active_operation.take() {
        ranges.push(OperationLineRange {
            operation_id: operation.id.clone(),
            operation_name: operation.name.clone(),
            color: operation.color.clone(),
            start_line,
            end_line: gcode.lines().count(),
        });
    }

    ranges
}

fn collect_class_styles(root: &Element) -> Result<HashMap<String, HashMap<String, String>>, String> {
    let mut styles = String::new();
    collect_style_text(root, &mut styles);
    if styles.trim().is_empty() {
        return Ok(HashMap::new());
    }

    let mut result = HashMap::new();
    let rule_regex = Regex::new(r"\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}").map_err(|err| err.to_string())?;
    for capture in rule_regex.captures_iter(&styles) {
        let Some(class_name) = capture.get(1).map(|m| m.as_str()) else {
            continue;
        };
        let Some(body) = capture.get(2).map(|m| m.as_str()) else {
            continue;
        };

        let declarations = body
            .split(';')
            .filter_map(|entry| {
                let (key, value) = entry.split_once(':')?;
                Some((key.trim().to_string(), value.trim().to_string()))
            })
            .collect::<HashMap<_, _>>();

        result.insert(class_name.to_string(), declarations);
    }

    Ok(result)
}

fn collect_style_text(element: &Element, output: &mut String) {
    if element.name == "style" {
        for child in &element.children {
            if let XMLNode::Text(text) = child {
                output.push_str(text);
                output.push('\n');
            }
        }
    }

    for child in &element.children {
        if let XMLNode::Element(child) = child {
            collect_style_text(child, output);
        }
    }
}

fn normalize_element(
    element: &mut Element,
    class_styles: &HashMap<String, HashMap<String, String>>,
    counter: &mut usize,
    selectable_ids: &mut Vec<String>,
) -> SvgTreeNode {
    inline_supported_class_styles(element, class_styles);

    let tag_name = element.name.clone();
    let selectable = is_selectable_tag(&tag_name);
    let own_id = if selectable {
        let id = format!("s2g-node-{counter:05}");
        *counter += 1;
        element
            .attributes
            .insert("data-s2g-id".into(), id.clone());
        selectable_ids.push(id.clone());
        Some(id)
    } else {
        None
    };

    let mut children = Vec::new();
    let mut selectable_descendant_ids = own_id.clone().into_iter().collect::<Vec<_>>();

    for child in element.children.iter_mut() {
        if let XMLNode::Element(child) = child {
            let child_tag = child.name.clone();
            if !is_tree_relevant_tag(&child_tag) {
                continue;
            }

            let child_node = normalize_element(child, class_styles, counter, selectable_ids);
            selectable_descendant_ids.extend(child_node.selectable_descendant_ids.iter().cloned());
            children.push(child_node);
        }
    }

    SvgTreeNode {
        id: own_id,
        label: build_label(element, &tag_name),
        tag_name,
        selectable,
        selectable_descendant_ids,
        children,
    }
}

fn inline_supported_class_styles(
    element: &mut Element,
    class_styles: &HashMap<String, HashMap<String, String>>,
) {
    let Some(class_names) = element.attributes.get("class").cloned() else {
        return;
    };

    let supported_keys = ["fill", "stroke", "fill-rule", "visibility"];
    for class_name in class_names.split_whitespace() {
        let Some(rule) = class_styles.get(class_name) else {
            continue;
        };

        for key in supported_keys {
            if element.attributes.contains_key(key) {
                continue;
            }
            if let Some(value) = rule.get(key) {
                element.attributes.insert(key.to_string(), value.clone());
            }
        }
    }
}

fn build_label(element: &Element, tag_name: &str) -> String {
    element
        .attributes
        .get("inkscape:label")
        .or_else(|| element.attributes.get("label"))
        .or_else(|| element.attributes.get("id"))
        .or_else(|| element.attributes.get("data-s2g-id"))
        .cloned()
        .unwrap_or_else(|| tag_name.to_string())
}

fn is_selectable_tag(tag_name: &str) -> bool {
    matches!(
        tag_name,
        "path" | "polyline" | "polygon" | "rect" | "circle" | "ellipse" | "line"
    )
}

fn is_tree_relevant_tag(tag_name: &str) -> bool {
    matches!(
        tag_name,
        "svg"
            | "g"
            | "path"
            | "polyline"
            | "polygon"
            | "rect"
            | "circle"
            | "ellipse"
            | "line"
    )
}
