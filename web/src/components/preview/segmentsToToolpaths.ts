import type { ParsedSegment } from '@svg2gcode/bridge/viewer'
import type { ToolpathGroup, StockBounds } from '../../types/preview'
import { createTrueCncSweepShape } from './clipperSweep'

/**
 * Group consecutive cut segments into continuous toolpath groups,
 * breaking on rapid/retract moves. Does NOT compute sweep shapes yet.
 */
export function groupSegments(
  segments: ParsedSegment[],
  toolRadius: number,
): { pathPoints: { x: number; y: number }[]; depth: number; segments: ParsedSegment[]; radius: number }[] {
  const groups: { pathPoints: { x: number; y: number }[]; depth: number; segments: ParsedSegment[]; radius: number }[] = []
  let currentPoints: { x: number; y: number }[] = []
  let currentSegments: ParsedSegment[] = []
  let currentDepth = 0

  const flushGroup = () => {
    if (currentPoints.length < 2) {
      currentPoints = []
      currentSegments = []
      return
    }

    groups.push({
      pathPoints: currentPoints,
      depth: Math.abs(currentDepth),
      segments: currentSegments,
      radius: toolRadius,
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

  return groups
}

/**
 * Compute sweep shapes for a single toolpath group.
 */
export function computeGroupSweep(
  group: { pathPoints: { x: number; y: number }[]; depth: number; segments: ParsedSegment[]; radius: number },
): ToolpathGroup {
  const slotShapes = createTrueCncSweepShape(group.pathPoints, group.radius, false)
  return {
    pathPoints: group.pathPoints,
    depth: group.depth,
    radius: group.radius,
    closed: false,
    slotShapes,
    segments: group.segments,
  }
}

/**
 * Convert bridge ParsedSegments into ToolpathGroups with sweep shapes.
 * Synchronous convenience wrapper.
 */
export function segmentsToToolpaths(
  segments: ParsedSegment[],
  toolRadius: number,
  materialWidth: number,
  materialHeight: number,
): { toolpaths: ToolpathGroup[]; stockBounds: StockBounds } {
  const rawGroups = groupSegments(segments, toolRadius)
  const toolpaths = rawGroups.map(computeGroupSweep)

  const stockBounds: StockBounds = {
    minX: 0,
    minY: 0,
    maxX: materialWidth,
    maxY: materialHeight,
  }

  return { toolpaths, stockBounds }
}
