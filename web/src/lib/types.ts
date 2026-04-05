export type ToolShape = "Flat" | "Ball" | "V";
export type FillMode = "Pocket" | "Contour";
export type EngraveType = "outline" | "pocket" | "raster" | "skeleton";
export type EditorInteractionMode = "group" | "direct";
export type TabId = "prepare" | "preview";
export type CanvasSelectionTarget = "material" | "svg" | null;
export type InspectorTab = "design" | "material";
export type LayerGroupingMode = "structure" | "depth" | "fill";
export type AlignmentAction =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom";
export type DistributionAction = "horizontal" | "vertical";

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

export interface ArtObject {
  id: string;
  name: string;
  preparedSvg: PreparedSvgDocument;
  svgMetrics: SvgDocumentMetrics;
  placementX: number;
  placementY: number;
  widthMm: number;
  heightMm: number;
  aspectLocked: boolean;
  elementAssignments: Record<string, ElementAssignment>;
  elementColors: Map<string, string>;
}

export interface FrontendOperation {
  id: string;
  name: string;
  target_depth_mm: number;
  assigned_element_ids: string[];
  color: string | null;
  engrave_type?: EngraveType | null;
  fill_mode?: FillMode | null;
}

export interface ElementAssignment {
  elementId: string;
  targetDepthMm: number;
  engraveType: EngraveType | null;
  fillMode: FillMode | null;
}

export interface AssignmentProfileGroup {
  key: string;
  targetDepthMm: number;
  engraveType: EngraveType | null;
  fillMode: FillMode | null;
  elementIds: string[];
  color: string;
}

export interface EditorFocusScope {
  artObjectId: string;
  scopeNodeId: string | null;
}

export interface DiveRootScope {
  id: string;
  label: string;
  elementIds: string[];
  artObjectId: string;
  scopeNodeId: string | null;
}

export interface DesignSelectionSnapshot {
  surfaceMode: "design" | "material";
  selectedArtObjectIds: string[];
  selectedUnitIds: string[];
  focusScope: EditorFocusScope | null;
  interactionMode: EditorInteractionMode;
}

export type EditorSelection =
  | {
      type: "none";
    }
  | {
      type: "material";
    }
  | {
      type: "art-object";
      artObjectId: string;
    }
  | {
      type: "art-objects";
      artObjectIds: string[];
    }
  | {
      type: "elements";
      artObjectId: string;
      elementIds: string[];
    };

export type InspectorContext =
  | {
      type: "none";
    }
  | {
      type: "art-object";
      artObjectId: string;
      elementIds: string[];
      profileGroups: AssignmentProfileGroup[];
    }
  | {
      type: "svg";
      elementIds: string[];
      profileGroups: AssignmentProfileGroup[];
    }
  | {
      type: "selection";
      elementIds: string[];
      profileGroups: AssignmentProfileGroup[];
      mixedDepth: boolean;
      mixedFillMode: boolean;
      targetDepthMm: number | null;
      fillMode: FillMode | null;
    };

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
  selection: EditorSelection;
  paddingMm: number;
}

export interface SvgDocumentMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number;
}
