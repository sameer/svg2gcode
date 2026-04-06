import type { ArtboardState, CanvasNode, GroupNode } from '../types/editor'
import { isGroupNode } from './editorTree'

const SVG_NS = 'http://www.w3.org/2000/svg'

// Lazy singleton for measuring SVG path bounding boxes via the browser's layout engine.
let measureSvg: SVGSVGElement | null = null
let measurePath: SVGPathElement | null = null

function ensureMeasureElements() {
  if (measureSvg) return
  measureSvg = document.createElementNS(SVG_NS, 'svg')
  measureSvg.setAttribute('width', '0')
  measureSvg.setAttribute('height', '0')
  measureSvg.setAttribute('aria-hidden', 'true')
  Object.assign(measureSvg.style, {
    position: 'absolute',
    left: '-99999px',
    top: '-99999px',
    visibility: 'hidden',
    pointerEvents: 'none',
  })
  measurePath = document.createElementNS(SVG_NS, 'path')
  measureSvg.appendChild(measurePath)
  document.body.appendChild(measureSvg)
}

function measurePathBounds(data: string): { width: number; height: number } {
  ensureMeasureElements()
  try {
    measurePath!.setAttribute('d', data)
    const box = measurePath!.getBBox()
    return { width: box.width, height: box.height }
  } catch {
    return { width: 0, height: 0 }
  }
}

export interface NodeSize {
  /** Size before the node's own scaleX/scaleY */
  baseWidth: number
  baseHeight: number
  /** Size in mm (= baseWidth * scaleX) */
  width: number
  height: number
}

/**
 * Compute the intrinsic (base) and effective (mm) dimensions of a node.
 * For groups this recurses into children.
 */
export function getNodeSize(
  node: CanvasNode,
  nodesById: Record<string, CanvasNode>,
): NodeSize {
  let baseWidth: number
  let baseHeight: number

  switch (node.type) {
    case 'rect':
      baseWidth = node.width
      baseHeight = node.height
      break

    case 'circle':
      baseWidth = node.radius * 2
      baseHeight = node.radius * 2
      break

    case 'line': {
      const xs = node.points.filter((_, i) => i % 2 === 0)
      const ys = node.points.filter((_, i) => i % 2 === 1)
      baseWidth = xs.length > 0 ? Math.max(...xs) - Math.min(...xs) : 0
      baseHeight = ys.length > 0 ? Math.max(...ys) - Math.min(...ys) : 0
      break
    }

    case 'path':
      ({ width: baseWidth, height: baseHeight } = measurePathBounds(node.data))
      break

    case 'group':
      ({ width: baseWidth, height: baseHeight } = getGroupBaseSize(node, nodesById))
      break

    default:
      baseWidth = 0
      baseHeight = 0
  }

  return {
    baseWidth,
    baseHeight,
    width: baseWidth * Math.abs(node.scaleX),
    height: baseHeight * Math.abs(node.scaleY),
  }
}

function getGroupBaseSize(
  group: GroupNode,
  nodesById: Record<string, CanvasNode>,
): { width: number; height: number } {
  let maxX = 0
  let maxY = 0

  for (const childId of group.childIds) {
    const child = nodesById[childId]
    if (!child) continue

    const childSize = getNodeSize(child, nodesById)
    const right = child.x + childSize.width
    const bottom = child.y + childSize.height
    if (right > maxX) maxX = right
    if (bottom > maxY) maxY = bottom
  }

  return { width: maxX, height: maxY }
}

/**
 * Get the node offset in mm with left-bottom origin.
 * Canvas origin is left-top, so we flip Y.
 */
export function getNodeOffsetMm(
  node: CanvasNode,
  nodeSize: NodeSize,
  artboard: ArtboardState,
): { x: number; y: number } {
  return {
    x: node.x,
    y: artboard.height - node.y - nodeSize.height,
  }
}

/**
 * Convert a left-bottom-origin offset back to canvas coordinates (left-top).
 */
export function offsetMmToCanvasY(
  offsetY: number,
  nodeHeight: number,
  artboard: ArtboardState,
): number {
  return artboard.height - offsetY - nodeHeight
}
