// WASM lifecycle
export { ensureWasmReady, loadDefaultSettings, prepareSvgDocument, generateEngravingJob } from "./wasm";

// Core types
export type {
  ToolShape,
  FillMode,
  EngraveType,
  Settings,
  SvgTreeNode,
  PreparedSvgDocument,
  ArtObject,
  FrontendOperation,
  ElementAssignment,
  AssignmentProfileGroup,
  GenerateJobRequest,
  OperationLineRange,
  GenerateJobResponse,
  SvgDocumentMetrics,
  JobProgress,
} from "./types";

// Settings helpers
export {
  setNumberAtPath,
  computeRecommendedAdvancedValues,
  applyRecommendedSettings,
  RECOMMENDED_ADVANCED_PATHS,
  MATERIAL_PRESETS,
  MATERIAL_PRESET_LIST,
  type MaterialPresetId,
  type MaterialPresetData,
} from "./settings";

// Engraving mappings
export {
  engraveTypeToFillMode,
  fillModeToEngraveType,
  engraveTypeLabel,
  isSupportedEngraveType,
  ENGRAVE_TYPE_OPTIONS,
} from "./engraving";

// SVG composition (browser-only: uses DOMParser)
export {
  composeArtObjectsSvg,
  createArtObject,
  getDerivedOperationsForArtObjects,
  getAutoPlacement,
  resizeArtObjectWithAspect,
  buildCompositeElementId,
  splitCompositeElementId,
  cloneTreeWithCompositeIds,
  withCompositeElementIds,
  getArtObjectElementIds,
  getMergedAssignments,
  localElementColor,
} from "./art-objects";

// Geometry
export {
  parseSvgDocumentMetrics,
  clampPlacementToArtboard,
  getSvgWidthMm,
  getSvgHeightMm,
} from "./geometry";

// Profile groups
export {
  groupAssignmentsForIds,
  deriveOperationsFromProfileGroups,
  getAssignmentProfileKey,
} from "./profile-groups";

// Operation colors
export { colorForOperation } from "./colors";

// Utilities
export { clamp, roundMm, formatMillimeters, unique } from "./utils";
