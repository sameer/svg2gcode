import svgpath from 'svgpath'

import type {
  CanvasFillRule,
  CanvasNode,
  GroupNode,
  LineNode,
  PathNode,
  PendingSvgImport,
} from '../types/editor'

const SVG_NS = 'http://www.w3.org/2000/svg'
const IMPORT_PADDING = 32
const DEFAULT_FILL = '#000000'

type Matrix = [number, number, number, number, number, number]

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface PaintContext {
  fill?: string
  stroke?: string
  strokeWidth?: number
  fillRule?: CanvasFillRule
}

interface ParseContext {
  transform: Matrix
  paint: PaintContext
  idPrefix: string
}

interface ImportSvgOptions {
  artboardWidth: number
  artboardHeight: number
  fileName: string
  svgText: string
}

interface PathMeasure {
  measurePathBounds: (data: string) => Bounds | null
  cleanup: () => void
}

const identityMatrix = (): Matrix => [1, 0, 0, 1, 0, 0]

const multiplyMatrices = (left: Matrix, right: Matrix): Matrix => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
]

const applyMatrixToPoint = (
  point: { x: number; y: number },
  matrix: Matrix,
): { x: number; y: number } => ({
  x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
  y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
})

const translateMatrix = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]

const scaleMatrix = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0]

const rotateMatrix = (angleInDegrees: number): Matrix => {
  const angleInRadians = (angleInDegrees * Math.PI) / 180
  const cos = Math.cos(angleInRadians)
  const sin = Math.sin(angleInRadians)
  return [cos, sin, -sin, cos, 0, 0]
}

const skewXMatrix = (angleInDegrees: number): Matrix => [
  1,
  0,
  Math.tan((angleInDegrees * Math.PI) / 180),
  1,
  0,
  0,
]

const skewYMatrix = (angleInDegrees: number): Matrix => [
  1,
  Math.tan((angleInDegrees * Math.PI) / 180),
  0,
  1,
  0,
  0,
]

const parseNumber = (value: string | null | undefined): number | null => {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || trimmed.endsWith('%')) {
    return null
  }

  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const parseOpacity = (value: string | null | undefined): number => {
  const parsed = parseNumber(value)
  if (parsed == null) {
    return 1
  }

  return Math.min(1, Math.max(0, parsed))
}

const parseFillRule = (value: string | null | undefined): CanvasFillRule | undefined => {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'evenodd') {
    return 'evenodd'
  }

  if (normalized === 'nonzero') {
    return 'nonzero'
  }

  return undefined
}

const parsePoints = (value: string | null): number[] => {
  if (!value) {
    return []
  }

  return value
    .trim()
    .replaceAll(',', ' ')
    .split(/\s+/)
    .map((entry) => Number.parseFloat(entry))
    .filter((entry) => Number.isFinite(entry))
}

const parseStyleMap = (element: Element): Map<string, string> => {
  const style = element.getAttribute('style')
  const styleMap = new Map<string, string>()

  if (!style) {
    return styleMap
  }

  style
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const separatorIndex = entry.indexOf(':')
      if (separatorIndex < 0) {
        return
      }

      const key = entry.slice(0, separatorIndex).trim().toLowerCase()
      const value = entry.slice(separatorIndex + 1).trim()
      if (key) {
        styleMap.set(key, value)
      }
    })

  return styleMap
}

const getStyleValue = (
  element: Element,
  styleMap: Map<string, string>,
  attributeName: string,
): string | null => {
  const normalizedAttribute = attributeName.toLowerCase()
  const attributeValue = element.getAttribute(normalizedAttribute)
  if (attributeValue != null) {
    return attributeValue
  }

  return styleMap.get(normalizedAttribute) ?? null
}

const normalizeColor = (value: string | null | undefined): string | undefined => {
  if (!value) {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized || normalized === 'none') {
    return undefined
  }

  if (normalized === 'currentColor' || normalized === 'inherit') {
    return undefined
  }

  return normalized
}

const resolvePaint = (
  value: string | null,
  inherited: string | undefined,
  fallback: string | undefined,
): string | undefined => {
  if (value == null || value.trim() === '' || value.trim() === 'inherit') {
    return inherited ?? fallback
  }

  return normalizeColor(value)
}

const resolveStrokeWidth = (
  value: string | null,
  inherited: number | undefined,
): number => {
  if (value == null || value.trim() === '' || value.trim() === 'inherit') {
    return inherited ?? 1
  }

  return parseNumber(value) ?? inherited ?? 1
}

const isVisible = (element: Element, styleMap: Map<string, string>): boolean => {
  const display = getStyleValue(element, styleMap, 'display')
  if (display?.trim().toLowerCase() === 'none') {
    return false
  }

  const visibility = getStyleValue(element, styleMap, 'visibility')
  return visibility?.trim().toLowerCase() !== 'hidden'
}

const isSkippableContainer = (tagName: string): boolean =>
  [
    'defs',
    'desc',
    'metadata',
    'title',
    'symbol',
    'use',
    'mask',
    'clippath',
    'filter',
    'lineargradient',
    'radialgradient',
    'pattern',
    'image',
    'text',
  ].includes(tagName)

const unionBounds = (bounds: Bounds[]): Bounds | null => {
  if (bounds.length === 0) {
    return null
  }

  const minX = Math.min(...bounds.map((entry) => entry.x))
  const minY = Math.min(...bounds.map((entry) => entry.y))
  const maxX = Math.max(...bounds.map((entry) => entry.x + entry.width))
  const maxY = Math.max(...bounds.map((entry) => entry.y + entry.height))

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  }
}

const createPathMeasure = (): PathMeasure => {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.position = 'absolute'
  svg.style.left = '-99999px'
  svg.style.top = '-99999px'
  svg.style.visibility = 'hidden'
  svg.style.pointerEvents = 'none'

  const path = document.createElementNS(SVG_NS, 'path')
  svg.appendChild(path)
  document.body.appendChild(svg)

  return {
    measurePathBounds: (data) => {
      try {
        path.setAttribute('d', data)
        const box = path.getBBox()
        if (
          !Number.isFinite(box.x) ||
          !Number.isFinite(box.y) ||
          !Number.isFinite(box.width) ||
          !Number.isFinite(box.height)
        ) {
          return null
        }

        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        }
      } catch {
        return null
      }
    },
    cleanup: () => {
      svg.remove()
    },
  }
}

const parseTransform = (value: string | null | undefined): Matrix => {
  if (!value) {
    return identityMatrix()
  }

  const transformPattern = /([a-zA-Z]+)\(([^)]*)\)/g
  let result = identityMatrix()

  for (const match of value.matchAll(transformPattern)) {
    const [, operationName, rawArguments] = match
    const args = rawArguments
      .trim()
      .split(/[\s,]+/)
      .map((entry) => Number.parseFloat(entry))
      .filter((entry) => Number.isFinite(entry))

    let nextMatrix = identityMatrix()

    switch (operationName.toLowerCase()) {
      case 'matrix':
        if (args.length === 6) {
          nextMatrix = [
            args[0] ?? 1,
            args[1] ?? 0,
            args[2] ?? 0,
            args[3] ?? 1,
            args[4] ?? 0,
            args[5] ?? 0,
          ]
        }
        break
      case 'translate':
        nextMatrix = translateMatrix(args[0] ?? 0, args[1] ?? 0)
        break
      case 'scale':
        nextMatrix = scaleMatrix(args[0] ?? 1, args[1] ?? args[0] ?? 1)
        break
      case 'rotate': {
        const angle = args[0] ?? 0
        const centerX = args[1] ?? 0
        const centerY = args[2] ?? 0
        nextMatrix = multiplyMatrices(
          multiplyMatrices(translateMatrix(centerX, centerY), rotateMatrix(angle)),
          translateMatrix(-centerX, -centerY),
        )
        break
      }
      case 'skewx':
        nextMatrix = skewXMatrix(args[0] ?? 0)
        break
      case 'skewy':
        nextMatrix = skewYMatrix(args[0] ?? 0)
        break
      default:
        nextMatrix = identityMatrix()
        break
    }

    result = multiplyMatrices(result, nextMatrix)
  }

  return result
}

const transformPathData = (data: string, matrix: Matrix): string =>
  svgpath(data)
    .abs()
    .matrix(matrix)
    .round(3)
    .toString()

const rectToPath = (x: number, y: number, width: number, height: number, rx: number, ry: number) => {
  if (width <= 0 || height <= 0) {
    return null
  }

  const radiusX = Math.max(0, Math.min(rx || ry, width / 2))
  const radiusY = Math.max(0, Math.min(ry || rx, height / 2))

  if (!radiusX && !radiusY) {
    return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`
  }

  return [
    `M ${x + radiusX} ${y}`,
    `H ${x + width - radiusX}`,
    `A ${radiusX} ${radiusY} 0 0 1 ${x + width} ${y + radiusY}`,
    `V ${y + height - radiusY}`,
    `A ${radiusX} ${radiusY} 0 0 1 ${x + width - radiusX} ${y + height}`,
    `H ${x + radiusX}`,
    `A ${radiusX} ${radiusY} 0 0 1 ${x} ${y + height - radiusY}`,
    `V ${y + radiusY}`,
    `A ${radiusX} ${radiusY} 0 0 1 ${x + radiusX} ${y}`,
    'Z',
  ].join(' ')
}

const ellipseToPath = (cx: number, cy: number, rx: number, ry: number): string | null => {
  if (rx <= 0 || ry <= 0) {
    return null
  }

  return [
    `M ${cx - rx} ${cy}`,
    `A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy}`,
    `A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`,
    'Z',
  ].join(' ')
}

const inferName = (element: Element, fallback: string): string => {
  const id = element.getAttribute('id')?.trim()
  return id || fallback
}

const readSvgPaint = (element: Element, inheritedPaint: PaintContext): PaintContext => {
  const styleMap = parseStyleMap(element)
  const fillValue = getStyleValue(element, styleMap, 'fill')
  const strokeValue = getStyleValue(element, styleMap, 'stroke')
  const strokeWidthValue = getStyleValue(element, styleMap, 'stroke-width')
  const fillRuleValue = getStyleValue(element, styleMap, 'fill-rule')

  return {
    fill: resolvePaint(fillValue, inheritedPaint.fill, undefined),
    stroke: resolvePaint(strokeValue, inheritedPaint.stroke, undefined),
    strokeWidth: resolveStrokeWidth(strokeWidthValue, inheritedPaint.strokeWidth),
    fillRule: parseFillRule(fillRuleValue) ?? inheritedPaint.fillRule,
  }
}

const createNodeId = (prefix: string, tagName: string, index: number): string =>
  `${prefix}-${tagName}-${index}`

const shiftNode = (node: CanvasNode, deltaX: number, deltaY: number) => {
  node.x += deltaX
  node.y += deltaY
}

const normalizeSubtree = (
  nodeId: string,
  nodesById: Record<string, CanvasNode>,
  boundsById: Record<string, Bounds>,
  preserveRootOrigin = false,
): Bounds | null => {
  const node = nodesById[nodeId]
  if (!node) {
    return null
  }

  if (node.type !== 'group') {
    return boundsById[nodeId] ?? null
  }

  const childBounds = node.childIds
    .map((childId) => normalizeSubtree(childId, nodesById, boundsById))
    .filter((entry): entry is Bounds => entry != null)

  const union = unionBounds(childBounds)
  if (!union) {
    return null
  }

  node.childIds.forEach((childId) => {
    const childNode = nodesById[childId]
    if (childNode) {
      shiftNode(childNode, -union.x, -union.y)
    }
  })

  if (!preserveRootOrigin) {
    node.x = union.x
    node.y = union.y
  } else {
    node.x = 0
    node.y = 0
  }

  const normalized = {
    x: preserveRootOrigin ? 0 : union.x,
    y: preserveRootOrigin ? 0 : union.y,
    width: union.width,
    height: union.height,
  }

  boundsById[nodeId] = normalized
  return normalized
}

export function importSvgToScene({
  artboardWidth,
  artboardHeight,
  fileName,
  svgText,
}: ImportSvgOptions): PendingSvgImport {
  const parsedDocument = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const parserError = parsedDocument.querySelector('parsererror')
  if (parserError) {
    throw new Error('The selected file could not be parsed as valid SVG.')
  }

  const rootElement = parsedDocument.documentElement
  if (rootElement.tagName.toLowerCase() !== 'svg') {
    throw new Error('The selected file is not an SVG document.')
  }

  const pathMeasure = createPathMeasure()
  const prefix = `svg-${crypto.randomUUID().slice(0, 8)}`
  const nodesById: Record<string, CanvasNode> = {}
  const boundsById: Record<string, Bounds> = {}
  let nodeIndex = 0

  const buildNode = (
    element: Element,
    context: ParseContext,
    parentId: string | null,
  ): string | null => {
    const tagName = element.tagName.toLowerCase()
    if (isSkippableContainer(tagName)) {
      return null
    }

    const styleMap = parseStyleMap(element)
    const ownTransform = parseTransform(getStyleValue(element, styleMap, 'transform'))
    let combinedTransform = multiplyMatrices(context.transform, ownTransform)

    if (tagName === 'svg' && parentId != null) {
      const nestedX = parseNumber(element.getAttribute('x')) ?? 0
      const nestedY = parseNumber(element.getAttribute('y')) ?? 0
      combinedTransform = multiplyMatrices(context.transform, translateMatrix(nestedX, nestedY))
      combinedTransform = multiplyMatrices(combinedTransform, ownTransform)
    }

    const paint = readSvgPaint(element, context.paint)
    const nodeId = createNodeId(context.idPrefix, tagName, nodeIndex)
    const opacity = parseOpacity(getStyleValue(element, styleMap, 'opacity'))
    const visible = isVisible(element, styleMap)
    nodeIndex += 1

    if (tagName === 'svg' || tagName === 'g') {
      const childIds = Array.from(element.children)
        .map((child) =>
          buildNode(child, { ...context, transform: combinedTransform, paint }, nodeId),
        )
        .filter((childId): childId is string => childId != null)

      if (childIds.length === 0) {
        return null
      }

      const groupNode: GroupNode = {
        id: nodeId,
        type: 'group',
        name: inferName(element, tagName === 'svg' ? fileName.replace(/\.svg$/i, '') : 'SVG Group'),
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        draggable: true,
        locked: false,
        visible,
        opacity,
        parentId,
        childIds,
      }

      nodesById[nodeId] = groupNode
      return nodeId
    }

    const createPathNode = (
      data: string | null,
      fallbackName: string,
    ): string | null => {
      if (!data) {
        return null
      }

      const transformedData = transformPathData(data, combinedTransform)
      const bounds = pathMeasure.measurePathBounds(transformedData)
      if (!bounds) {
        return null
      }

      const normalizedData = svgpath(transformedData)
        .translate(-bounds.x, -bounds.y)
        .round(3)
        .toString()

      const pathNode: PathNode = {
        id: nodeId,
        type: 'path',
        name: inferName(element, fallbackName),
        x: bounds.x,
        y: bounds.y,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        draggable: true,
        locked: false,
        visible,
        opacity,
        parentId,
        data: normalizedData,
        fill: paint.fill,
        stroke: paint.stroke,
        strokeWidth: paint.stroke ? paint.strokeWidth ?? 1 : 0,
        fillRule: paint.fillRule,
      }

      nodesById[nodeId] = pathNode
      boundsById[nodeId] = bounds
      return nodeId
    }

    const createLineNode = (
      points: number[],
      fallbackName: string,
      closed: boolean,
    ): string | null => {
      if (points.length < 4 || points.length % 2 !== 0) {
        return null
      }

      const transformedPoints = points.reduce<number[]>((result, _value, index, source) => {
        if (index % 2 !== 0) {
          return result
        }

        const transformedPoint = applyMatrixToPoint(
          { x: source[index] ?? 0, y: source[index + 1] ?? 0 },
          combinedTransform,
        )
        result.push(transformedPoint.x, transformedPoint.y)
        return result
      }, [])

      const xCoordinates = transformedPoints.filter((_, index) => index % 2 === 0)
      const yCoordinates = transformedPoints.filter((_, index) => index % 2 === 1)
      const minX = Math.min(...xCoordinates)
      const minY = Math.min(...yCoordinates)
      const maxX = Math.max(...xCoordinates)
      const maxY = Math.max(...yCoordinates)

      const lineNode: LineNode = {
        id: nodeId,
        type: 'line',
        name: inferName(element, fallbackName),
        x: minX,
        y: minY,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        draggable: true,
        locked: false,
        visible,
        opacity,
        parentId,
        points: transformedPoints.map((value, index) =>
          index % 2 === 0 ? value - minX : value - minY,
        ),
        stroke: paint.stroke,
        strokeWidth: paint.stroke ? paint.strokeWidth ?? 1 : 0,
        closed,
        fill: closed ? paint.fill : undefined,
        fillRule: closed ? paint.fillRule : undefined,
        lineCap: tagName === 'line' ? 'round' : undefined,
        lineJoin: closed ? 'round' : undefined,
      }

      nodesById[nodeId] = lineNode
      boundsById[nodeId] = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      }
      return nodeId
    }

    switch (tagName) {
      case 'path':
        return createPathNode(element.getAttribute('d'), 'SVG Path')
      case 'rect': {
        const x = parseNumber(element.getAttribute('x')) ?? 0
        const y = parseNumber(element.getAttribute('y')) ?? 0
        const width = parseNumber(element.getAttribute('width')) ?? 0
        const height = parseNumber(element.getAttribute('height')) ?? 0
        const rx = parseNumber(element.getAttribute('rx')) ?? 0
        const ry = parseNumber(element.getAttribute('ry')) ?? 0
        return createPathNode(rectToPath(x, y, width, height, rx, ry), 'SVG Rect')
      }
      case 'circle': {
        const cx = parseNumber(element.getAttribute('cx')) ?? 0
        const cy = parseNumber(element.getAttribute('cy')) ?? 0
        const radius = parseNumber(element.getAttribute('r')) ?? 0
        return createPathNode(ellipseToPath(cx, cy, radius, radius), 'SVG Circle')
      }
      case 'ellipse': {
        const cx = parseNumber(element.getAttribute('cx')) ?? 0
        const cy = parseNumber(element.getAttribute('cy')) ?? 0
        const rx = parseNumber(element.getAttribute('rx')) ?? 0
        const ry = parseNumber(element.getAttribute('ry')) ?? 0
        return createPathNode(ellipseToPath(cx, cy, rx, ry), 'SVG Ellipse')
      }
      case 'line': {
        const x1 = parseNumber(element.getAttribute('x1')) ?? 0
        const y1 = parseNumber(element.getAttribute('y1')) ?? 0
        const x2 = parseNumber(element.getAttribute('x2')) ?? 0
        const y2 = parseNumber(element.getAttribute('y2')) ?? 0
        return createLineNode([x1, y1, x2, y2], 'SVG Line', false)
      }
      case 'polyline':
        return createLineNode(parsePoints(element.getAttribute('points')), 'SVG Polyline', false)
      case 'polygon':
        return createLineNode(parsePoints(element.getAttribute('points')), 'SVG Polygon', true)
      default:
        return null
    }
  }

  try {
    const rootId = buildNode(
      rootElement,
      {
        transform: identityMatrix(),
        paint: {
          fill: DEFAULT_FILL,
          stroke: undefined,
          strokeWidth: 1,
          fillRule: 'nonzero',
        },
        idPrefix: prefix,
      },
      null,
    )

    if (!rootId) {
      throw new Error(
        'This SVG does not contain any supported vector shapes. Supported tags: path, rect, circle, ellipse, line, polyline, polygon, and g.',
      )
    }

    const normalizedBounds = normalizeSubtree(rootId, nodesById, boundsById, true)
    if (
      !normalizedBounds ||
      (normalizedBounds.width <= 0 && normalizedBounds.height <= 0)
    ) {
      throw new Error('This SVG could not be converted into visible canvas shapes.')
    }

    const rootNode = nodesById[rootId]
    if (!rootNode || rootNode.type !== 'group') {
      throw new Error('The imported SVG did not produce a valid group root.')
    }

    const effectiveWidth = Math.max(1, normalizedBounds.width)
    const effectiveHeight = Math.max(1, normalizedBounds.height)
    const availableWidth = Math.max(1, artboardWidth - IMPORT_PADDING * 2)
    const availableHeight = Math.max(1, artboardHeight - IMPORT_PADDING * 2)
    const fitScale = Math.min(
      1,
      availableWidth / effectiveWidth,
      availableHeight / effectiveHeight,
    )

    rootNode.scaleX = fitScale
    rootNode.scaleY = fitScale
    rootNode.name = fileName.replace(/\.svg$/i, '') || rootNode.name

    return {
      nodesById,
      rootId,
      width: effectiveWidth * fitScale,
      height: effectiveHeight * fitScale,
      name: rootNode.name,
      originalSvg: svgText,
    }
  } finally {
    pathMeasure.cleanup()
  }
}
