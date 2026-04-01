export type ToolShape = "Flat" | "Ball" | "V";
export type FillMode = "Pocket" | "Contour";
export type TabId = "prepare" | "preview";
export type CanvasSelectionTarget = "artboard" | "svg" | null;
export type AlignmentAction =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom";

export interface Settings {
  conversion: {
    tolerance: number;
    feedrate: number;
    dpi: number;
    origin: [number | null, number | null];
    extra_attribute_name: string | null;
    optimize_path_order: boolean;
    selector_filter: string | null;
  };
  engraving: {
    enabled: boolean;
    material_width: number;
    material_height: number;
    material_thickness: number;
    tool_diameter: number;
    tool_shape: ToolShape;
    target_depth: number;
    max_stepdown: number;
    cut_feedrate: number;
    plunge_feedrate: number;
    stepover: number;
    fill_mode: FillMode;
    svg_width_override: number | null;
    placement_x: number;
    placement_y: number;
    machine_width: number;
    machine_height: number;
  };
  machine: {
    supported_functionality: {
      circular_interpolation: boolean;
    };
    travel_z: number | null;
    cut_z: number | null;
    plunge_feedrate: number | null;
    path_begin_sequence: string | null;
    tool_on_sequence: string | null;
    tool_off_sequence: string | null;
    begin_sequence: string | null;
    end_sequence: string | null;
  };
  postprocess: {
    checksums: boolean;
    line_numbers: boolean;
    newline_before_comment: boolean;
  };
  version: string;
}

export interface SvgTreeNode {
  id: string | null;
  label: string;
  tag_name: string;
  selectable: boolean;
  selectable_descendant_ids: string[];
  children: SvgTreeNode[];
}

export interface PreparedSvgDocument {
  normalized_svg: string;
  tree: SvgTreeNode;
  selectable_element_ids: string[];
}

export interface FrontendOperation {
  id: string;
  name: string;
  target_depth_mm: number;
  assigned_element_ids: string[];
  color: string | null;
  fill_mode?: FillMode | null;
}

export interface GenerateJobRequest {
  normalized_svg: string;
  settings: Settings;
  operations: FrontendOperation[];
}

export interface OperationLineRange {
  operation_id: string;
  operation_name: string;
  color: string | null;
  start_line: number;
  end_line: number;
}

export interface GenerateJobResponse {
  gcode: string;
  warnings: string[];
  operation_ranges: OperationLineRange[];
  preview_snapshot: {
    material_width: number;
    material_height: number;
    material_thickness: number;
    tool_diameter: number;
  };
}

export interface StudioProject {
  preparedSvg: PreparedSvgDocument | null;
  settings: Settings | null;
  operations: FrontendOperation[];
  selectedIds: string[];
  activeOperationId: string | null;
  generated: GenerateJobResponse | null;
  isGenerating: boolean;
  error: string | null;
}

export interface CanvasEditorState {
  zoom: number;
  pan: {
    x: number;
    y: number;
  };
  selection: CanvasSelectionTarget;
  paddingMm: number;
}
