import type { ArtboardState, CanvasNode, CircleNode, GroupNode, LineNode, PathNode, RectNode } from '../types/editor'

// ─── helpers ─────────────────────────────────────────────────────────────────

function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function attr(name: string, value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  return ` ${name}="${esc(value)}"`
}

function optionalAttr(name: string, value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'number' && value === 1 && name === 'opacity') return ''
  return ` ${name}="${esc(value)}"`
}

/**
 * Builds a compact SVG transform string. Omits components that are identity.
 */
function serializeTransform(
  x: number,
  y: number,
  rotation: number,
  scaleX: number,
  scaleY: number,
): string {
  const parts: string[] = []

  if (x !== 0 || y !== 0) {
    parts.push(`translate(${x} ${y})`)
  }
  if (rotation !== 0) {
    parts.push(`rotate(${rotation})`)
  }
  if (scaleX !== 1 || scaleY !== 1) {
    parts.push(`scale(${scaleX} ${scaleY})`)
  }

  return parts.length > 0 ? ` transform="${parts.join(' ')}"` : ''
}

/**
 * Injects CNC custom data attributes for leaf nodes.
 * Returns an empty string when no CNC metadata is set.
 */
function cncDataAttrs(node: CanvasNode): string {
  const meta = node.cncMetadata
  if (!meta) return ''
  let out = ''
  if (meta.cutDepth !== undefined) {
    out += attr('data-cut-depth', meta.cutDepth)
  }
  if (meta.engraveType) {
    out += attr('data-engrave-type', meta.engraveType)
  }
  return out
}

// ─── per-type serializers ─────────────────────────────────────────────────────

function serializeGroup(
  node: GroupNode,
  nodesById: Record<string, CanvasNode>,
  indent: string,
): string {
  const transform = serializeTransform(node.x, node.y, node.rotation, node.scaleX, node.scaleY)
  const opacityAttr = optionalAttr('opacity', node.opacity)
  const children = node.childIds
    .map((id) => {
      const child = nodesById[id]
      if (!child || !child.visible) return ''
      return serializeNode(child, nodesById, indent + '  ')
    })
    .filter(Boolean)
    .join('\n')

  return `${indent}<g${transform}${opacityAttr}>\n${children}\n${indent}</g>`
}

function serializeRect(node: RectNode, indent: string): string {
  const transform = serializeTransform(0, 0, node.rotation, node.scaleX, node.scaleY)
  return (
    `${indent}<rect` +
    attr('x', node.x) +
    attr('y', node.y) +
    attr('width', node.width) +
    attr('height', node.height) +
    attr('fill', node.fill ?? 'none') +
    attr('stroke', node.stroke ?? 'none') +
    attr('stroke-width', node.strokeWidth) +
    (node.cornerRadius ? attr('rx', node.cornerRadius) : '') +
    optionalAttr('opacity', node.opacity) +
    (transform || '') +
    cncDataAttrs(node) +
    ' />'
  )
}

function serializeCircle(node: CircleNode, indent: string): string {
  // Konva treats (x, y) as the center of the circle.
  // Represent this in SVG as cx/cy on the circle element, no separate translate needed.
  if (node.rotation !== 0 || node.scaleX !== 1 || node.scaleY !== 1) {
    // If there's non-trivial transform, wrap in a group for correctness.
    const transform = serializeTransform(node.x, node.y, node.rotation, node.scaleX, node.scaleY)
    return (
      `${indent}<g${transform}>\n` +
      `${indent}  <circle` +
      attr('cx', 0) +
      attr('cy', 0) +
      attr('r', node.radius) +
      attr('fill', node.fill ?? 'none') +
      attr('stroke', node.stroke ?? 'none') +
      attr('stroke-width', node.strokeWidth) +
      optionalAttr('opacity', node.opacity) +
      cncDataAttrs(node) +
      ` />\n${indent}</g>`
    )
  }

  return (
    `${indent}<circle` +
    attr('cx', node.x) +
    attr('cy', node.y) +
    attr('r', node.radius) +
    attr('fill', node.fill ?? 'none') +
    attr('stroke', node.stroke ?? 'none') +
    attr('stroke-width', node.strokeWidth) +
    optionalAttr('opacity', node.opacity) +
    cncDataAttrs(node) +
    ' />'
  )
}

function serializeLine(node: LineNode, indent: string): string {
  const transform = serializeTransform(node.x, node.y, node.rotation, node.scaleX, node.scaleY)
  // Build "x1,y1 x2,y2 ..." from flat [x1, y1, x2, y2, ...] points array.
  const pointPairs: string[] = []
  for (let i = 0; i + 1 < node.points.length; i += 2) {
    pointPairs.push(`${node.points[i]},${node.points[i + 1]}`)
  }
  const pointsStr = pointPairs.join(' ')
  const tag = node.closed ? 'polygon' : 'polyline'

  return (
    `${indent}<${tag}` +
    attr('points', pointsStr) +
    attr('stroke', node.stroke ?? 'none') +
    attr('stroke-width', node.strokeWidth) +
    (node.fill ? attr('fill', node.fill) : ` fill="none"`) +
    (node.fillRule ? attr('fill-rule', node.fillRule) : '') +
    (node.lineCap ? attr('stroke-linecap', node.lineCap) : '') +
    (node.lineJoin ? attr('stroke-linejoin', node.lineJoin) : '') +
    optionalAttr('opacity', node.opacity) +
    (transform || '') +
    cncDataAttrs(node) +
    ' />'
  )
}

function serializePath(node: PathNode, indent: string): string {
  const transform = serializeTransform(node.x, node.y, node.rotation, node.scaleX, node.scaleY)
  return (
    `${indent}<path` +
    attr('d', node.data) +
    attr('fill', node.fill ?? 'none') +
    attr('stroke', node.stroke ?? 'none') +
    attr('stroke-width', node.strokeWidth) +
    (node.fillRule ? attr('fill-rule', node.fillRule) : '') +
    optionalAttr('opacity', node.opacity) +
    (transform || '') +
    cncDataAttrs(node) +
    ' />'
  )
}

function serializeNode(
  node: CanvasNode,
  nodesById: Record<string, CanvasNode>,
  indent: string,
): string {
  if (!node.visible) return ''

  switch (node.type) {
    case 'group':
      return serializeGroup(node, nodesById, indent)
    case 'rect':
      return serializeRect(node, indent)
    case 'circle':
      return serializeCircle(node, indent)
    case 'line':
      return serializeLine(node, indent)
    case 'path':
      return serializePath(node, indent)
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Converts the normalized canvas state into a clean SVG string.
 *
 * - Coordinates are normalized to artboard-relative (0,0 = artboard top-left).
 * - CNC properties are embedded as data-cut-depth / data-engrave-type attributes.
 * - Invisible nodes are omitted.
 * - No Konva-specific UI elements (Transformer, marquee, guides) are included;
 *   the export reads only nodesById, which never contains those imperative objects.
 */
export function exportToSVG(
  nodesById: Record<string, CanvasNode>,
  rootIds: string[],
  artboard: ArtboardState,
): string {
  const { width, height, x: artX, y: artY } = artboard

  const innerIndent = '    '
  const rootContent = rootIds
    .map((id) => {
      const node = nodesById[id]
      if (!node || !node.visible) return ''
      return serializeNode(node, nodesById, innerIndent)
    })
    .filter(Boolean)
    .join('\n')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <!-- Exported by Konva CNC Editor — artboard origin (${artX}, ${artY}) normalized to 0,0 -->`,
    `  <g transform="translate(${-artX} ${-artY})">`,
    rootContent,
    `  </g>`,
    `</svg>`,
  ].join('\n')
}
