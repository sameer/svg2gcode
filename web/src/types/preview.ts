import type { Shape } from 'three'
import type { ParsedProgram, ParsedSegment } from '@svg2gcode/bridge/viewer'
import type { GenerateJobResponse } from '@svg2gcode/bridge'
import type { MaterialPreset } from '../lib/materialPresets'

export type CameraType = 'perspective' | 'orthographic'
export type ViewMode = 'design' | 'preview2d' | 'preview3d'

export interface StockBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ToolpathGroup {
  pathPoints: { x: number; y: number }[]
  depth: number
  radius: number
  closed: boolean
  slotShapes: Shape[]
  /** Source segments from bridge parser */
  segments: ParsedSegment[]
}

export interface PreviewState {
  viewMode: ViewMode
  cameraType: CameraType

  // Playback
  playbackDistance: number
  isPlaying: boolean
  playbackRate: number
  loopPlayback: boolean

  // Toggles
  showSvgOverlay: boolean
  showStock: boolean
  showRapidMoves: boolean

  // Init progress (0–100, null when not initializing)
  initProgress: number | null

  materialPreset: MaterialPreset

  // Computed data (set by initPreview)
  parsedProgram: ParsedProgram | null
  toolpaths: ToolpathGroup[] | null
  stockBounds: StockBounds | null
  gcodeText: string | null
  previewSnapshot: GenerateJobResponse['preview_snapshot'] | null
}
