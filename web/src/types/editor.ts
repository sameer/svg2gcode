export type InteractionMode = 'group' | 'direct'
export type CanvasFillRule = 'nonzero' | 'evenodd'

export type ShapeType = 'group' | 'rect' | 'circle' | 'line' | 'path'

export interface ArtboardState {
  width: number
  height: number
  thickness: number
  x: number
  y: number
}

export type RouterBitShape = 'Flat' | 'Ball' | 'V'

export interface MachiningSettings {
  toolDiameter: number
  toolShape: RouterBitShape
  defaultDepthMm: number
  passCount: number
  maxStepdown: number | null
  stepover: number | null
  cutFeedrate: number | null
  plungeFeedrate: number | null
  travelZ: number | null
  cutZ: number | null
  machineWidth: number | null
  machineHeight: number | null
  tabsEnabled: boolean
  tabWidth: number
  tabHeight: number
  tabSpacing: number
}

export interface ViewportState {
  x: number
  y: number
  scale: number
}

export interface MarqueeRect {
  x: number
  y: number
  width: number
  height: number
}

export type EngraveType = 'contour' | 'pocket' | 'outline' | 'raster'

export interface CncMetadata {
  cutDepth?: number
  engraveType?: EngraveType
}

export interface CanvasNodeBase {
  id: string
  type: ShapeType
  name: string
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
  draggable: boolean
  locked: boolean
  visible: boolean
  opacity: number
  parentId: string | null
  cncMetadata?: CncMetadata
}

export interface GroupNode extends CanvasNodeBase {
  type: 'group'
  childIds: string[]
  /** Raw SVG source text, stored on imported SVG root groups for bridge processing. */
  originalSvg?: string
}

export interface RectNode extends CanvasNodeBase {
  type: 'rect'
  width: number
  height: number
  fill: string
  stroke: string
  strokeWidth: number
  cornerRadius?: number
}

export interface CircleNode extends CanvasNodeBase {
  type: 'circle'
  radius: number
  fill: string
  stroke: string
  strokeWidth: number
}

export interface LineNode extends CanvasNodeBase {
  type: 'line'
  points: number[]
  stroke?: string
  strokeWidth: number
  closed?: boolean
  fill?: string
  fillRule?: CanvasFillRule
  lineCap?: 'butt' | 'round' | 'square'
  lineJoin?: 'miter' | 'round' | 'bevel'
}

export interface PathNode extends CanvasNodeBase {
  type: 'path'
  data: string
  fill?: string
  stroke?: string
  strokeWidth: number
  fillRule?: CanvasFillRule
}

// This normalized document model is the hand-off point for future Maker.js parametric generation,
// OpenCV.js alignment metadata, and downstream G-code translation.
export type CanvasNode = GroupNode | RectNode | CircleNode | LineNode | PathNode

export interface PendingSvgImport {
  nodesById: Record<string, CanvasNode>
  rootId: string
  width: number
  height: number
  name: string
  /** Raw SVG source text, preserved for bridge processing at GCode generation time. */
  originalSvg: string
}

export interface ImportStatus {
  tone: 'info' | 'error' | 'success'
  message: string
}

export interface SelectionState {
  selectedIds: string[]
  selectedStage: boolean
  focusGroupId: string | null
  interactionMode: InteractionMode
  directSelectionModifierActive: boolean
}
