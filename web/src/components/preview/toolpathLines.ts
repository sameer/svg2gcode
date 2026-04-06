/**
 * Build line geometries from ParsedSegment[] for 3D toolpath visualization.
 * Uses draw-range for zero-allocation playback animation.
 */

import * as THREE from 'three'
import type { ParsedSegment } from '@svg2gcode/bridge/viewer'

const CUT_COLOR = new THREE.Color(0xff4d6d)
const RAPID_COLOR = new THREE.Color(0x666666)
const PLUNGE_COLOR = new THREE.Color(0x44aaff)
const RETRACT_COLOR = new THREE.Color(0x88cc44)

export interface ToolpathLineData {
  mesh: THREE.LineSegments
  /** Cumulative distance at the end of each vertex pair (for binary search during playback) */
  distanceTable: Float64Array
  totalVertexCount: number
}

export function buildToolpathLines(
  segments: ParsedSegment[],
  showRapidMoves: boolean,
): ToolpathLineData {
  const filteredSegments = showRapidMoves
    ? segments
    : segments.filter((s) => s.motionKind !== 'rapid')

  const vertexCount = filteredSegments.length * 2
  const positions = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const distanceTable = new Float64Array(filteredSegments.length)

  for (let i = 0; i < filteredSegments.length; i++) {
    const seg = filteredSegments[i]
    const vi = i * 6

    positions[vi] = seg.start.x
    positions[vi + 1] = seg.start.y
    positions[vi + 2] = seg.start.z
    positions[vi + 3] = seg.end.x
    positions[vi + 4] = seg.end.y
    positions[vi + 5] = seg.end.z

    let color: THREE.Color
    if (seg.operationColor && seg.motionKind === 'cut') {
      color = new THREE.Color(seg.operationColor)
    } else {
      switch (seg.motionKind) {
        case 'cut':
          color = CUT_COLOR
          break
        case 'rapid':
          color = RAPID_COLOR
          break
        case 'plunge':
          color = PLUNGE_COLOR
          break
        case 'retract':
          color = RETRACT_COLOR
          break
        default:
          color = CUT_COLOR
      }
    }

    const ci = i * 6
    colors[ci] = color.r
    colors[ci + 1] = color.g
    colors[ci + 2] = color.b
    colors[ci + 3] = color.r
    colors[ci + 4] = color.g
    colors[ci + 5] = color.b

    distanceTable[i] = seg.cumulativeDistanceEnd
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
  })

  const mesh = new THREE.LineSegments(geometry, material)

  return { mesh, distanceTable, totalVertexCount: vertexCount }
}

/**
 * Update the draw range to show only segments up to the given distance.
 * Uses binary search on the pre-built distance table for O(log n) lookups.
 */
export function updateDrawRange(data: ToolpathLineData, currentDistance: number): void {
  if (currentDistance <= 0) {
    data.mesh.geometry.setDrawRange(0, 0)
    return
  }

  const table = data.distanceTable
  if (currentDistance >= table[table.length - 1]) {
    data.mesh.geometry.setDrawRange(0, data.totalVertexCount)
    return
  }

  // Binary search for the segment containing currentDistance
  let lo = 0
  let hi = table.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (table[mid] < currentDistance) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }

  // Show all complete segments plus 1 (the partial segment)
  const vertexCount = (lo + 1) * 2
  data.mesh.geometry.setDrawRange(0, Math.min(vertexCount, data.totalVertexCount))
}
