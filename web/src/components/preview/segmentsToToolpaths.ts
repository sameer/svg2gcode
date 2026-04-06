import type { ParsedSegment } from '@svg2gcode/bridge/viewer'
import type { ToolpathGroup, StockBounds } from '../../types/preview'
import { createTrueCncSweepShape } from './clipperSweep'

/**
 * Convert bridge ParsedSegments into PoC-style ToolpathGroups suitable for
 * Clipper-based Minkowski sweep visualization.
 *
 * Groups consecutive cut segments into continuous toolpaths, breaking on
 * rapid/retract moves. Each group gets its sweep shapes computed via Clipper.
 */
export function segmentsToToolpaths(
  segments: ParsedSegment[],
  toolRadius: number,
  materialWidth: number,
  materialHeight: number,
): { toolpaths: ToolpathGroup[]; stockBounds: StockBounds } {
  const groups: ToolpathGroup[] = []
  let currentPoints: { x: number; y: number }[] = []
  let currentSegments: ParsedSegment[] = []
  let currentDepth = 0

  const flushGroup = () => {
    if (currentPoints.length < 2) {
      currentPoints = []
      currentSegments = []
      return
    }

    const slotShapes = createTrueCncSweepShape(currentPoints, toolRadius, false)

    groups.push({
      pathPoints: currentPoints,
      depth: Math.abs(currentDepth),
      radius: toolRadius,
      closed: false,
      slotShapes,
      segments: currentSegments,
    })

    currentPoints = []
    currentSegments = []
  }

  for (const segment of segments) {
    if (segment.motionKind === 'cut') {
      if (currentPoints.length === 0) {
        currentPoints.push({ x: segment.start.x, y: segment.start.y })
      }
      currentPoints.push({ x: segment.end.x, y: segment.end.y })
      currentSegments.push(segment)
      currentDepth = Math.min(segment.start.z, segment.end.z)
    } else {
      flushGroup()
    }
  }
  flushGroup()

  const stockBounds: StockBounds = {
    minX: 0,
    minY: 0,
    maxX: materialWidth,
    maxY: materialHeight,
  }

  return { toolpaths: groups, stockBounds }
}
