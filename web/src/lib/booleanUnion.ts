import paper from 'paper'

import { isOpenPathNode, resolveEngraveType, type NormalizedEngraveType } from './cncVisuals'
import type { CanvasNode } from '../types/editor'

type AreaNode = Extract<CanvasNode, { type: 'rect' | 'circle' | 'path' | 'line' }>

interface LocalTransform {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}

interface Point {
  x: number
  y: number
}

export interface PreviewAreaShape {
  depth: number
  mode: NormalizedEngraveType
  sourceNodeId: string
  node: AreaNode
  transforms: LocalTransform[]
}

export interface PreviewStrokeShape {
  depth: number
  sourceNodeId: string
  points: number[]
  strokeWidth: number
}

export interface DepthPreviewLayer {
  depth: number
  mode: NormalizedEngraveType
  pathData: string | null
  sourceNodeIds: string[]
}

export interface DepthPreviewPlan {
  layers: DepthPreviewLayer[]
  strokeShapes: PreviewStrokeShape[]
  interactiveRootIds: string[]
  passthroughRootIds: string[]
}

let scope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!scope) {
    scope = new paper.PaperScope()
    scope.setup(new paper.Size(1, 1))
  }

  return scope
}

function toLocalTransform(node: CanvasNode): LocalTransform {
  return {
    x: node.x,
    y: node.y,
    rotation: node.rotation,
    scaleX: node.scaleX,
    scaleY: node.scaleY,
  }
}

function applyTransformChain(item: paper.Item, transforms: LocalTransform[]) {
  const s = getScope()
  const origin = new s.Point(0, 0)

  for (const transform of transforms) {
    item.scale(transform.scaleX, transform.scaleY, origin)
    item.rotate(transform.rotation, origin)
    item.translate(new s.Point(transform.x, transform.y))
  }
}

function applyTransformsToPoint(
  x: number,
  y: number,
  transforms: LocalTransform[],
): { x: number; y: number } {
  let nextX = x
  let nextY = y

  for (const transform of transforms) {
    nextX *= transform.scaleX
    nextY *= transform.scaleY

    const radians = (transform.rotation * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const rotatedX = nextX * cos - nextY * sin
    const rotatedY = nextX * sin + nextY * cos

    nextX = rotatedX + transform.x
    nextY = rotatedY + transform.y
  }

  return { x: nextX, y: nextY }
}

const EPSILON = 0.0001

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(point: Point, factor: number): Point {
  return { x: point.x * factor, y: point.y * factor }
}

function length(point: Point): number {
  return Math.hypot(point.x, point.y)
}

function normalize(point: Point): Point {
  const magnitude = length(point)
  if (magnitude < EPSILON) {
    return { x: 0, y: 0 }
  }

  return { x: point.x / magnitude, y: point.y / magnitude }
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x
}

function angleOf(point: Point): number {
  return Math.atan2(point.y, point.x)
}

function dedupePoints(points: Point[]): Point[] {
  return points.filter((point, index) => {
    const previous = index > 0 ? points[index - 1] : null
    return !previous || length(subtract(point, previous)) > EPSILON
  })
}

function intersectLines(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const aDirection = subtract(a2, a1)
  const bDirection = subtract(b2, b1)
  const denominator = cross(aDirection, bDirection)

  if (Math.abs(denominator) < EPSILON) {
    return null
  }

  const offset = subtract(b1, a1)
  const t = cross(offset, bDirection) / denominator

  return add(a1, scale(aDirection, t))
}

function sampleArc(
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  steps: number,
): Point[] {
  const points: Point[] = []

  for (let step = 1; step < steps; step += 1) {
    const t = step / steps
    const angle = startAngle + (endAngle - startAngle) * t
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    })
  }

  return points
}

function buildOffsetSide(
  points: Point[],
  halfWidth: number,
  lineJoin: 'miter' | 'round' | 'bevel',
): Point[] {
  const offsetPoints: Point[] = []
  const segments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1]
    const direction = normalize(subtract(next, point))
    return {
      start: point,
      end: next,
      direction,
      normal: { x: -direction.y, y: direction.x },
    }
  })

  if (segments.length === 0) {
    return offsetPoints
  }

  offsetPoints.push(add(points[0], scale(segments[0].normal, halfWidth)))

  for (let index = 1; index < points.length - 1; index += 1) {
    const vertex = points[index]
    const previous = segments[index - 1]
    const next = segments[index]
    const previousEnd = add(vertex, scale(previous.normal, halfWidth))
    const nextStart = add(vertex, scale(next.normal, halfWidth))
    const turn = cross(previous.direction, next.direction)
    const outerJoin = turn > EPSILON

    if (Math.abs(turn) <= EPSILON) {
      offsetPoints.push(previousEnd)
      continue
    }

    if (!outerJoin) {
      const intersection = intersectLines(
        add(previous.start, scale(previous.normal, halfWidth)),
        add(previous.end, scale(previous.normal, halfWidth)),
        add(next.start, scale(next.normal, halfWidth)),
        add(next.end, scale(next.normal, halfWidth)),
      )
      offsetPoints.push(intersection ?? previousEnd)
      continue
    }

    if (lineJoin === 'round') {
      offsetPoints.push(previousEnd)
      offsetPoints.push(
        ...sampleArc(
          vertex,
          halfWidth,
          angleOf(previous.normal),
          angleOf(next.normal),
          Math.max(6, Math.ceil(halfWidth / 2)),
        ),
      )
      offsetPoints.push(nextStart)
      continue
    }

    if (lineJoin === 'bevel') {
      offsetPoints.push(previousEnd, nextStart)
      continue
    }

    const miter = intersectLines(
      add(previous.start, scale(previous.normal, halfWidth)),
      add(previous.end, scale(previous.normal, halfWidth)),
      add(next.start, scale(next.normal, halfWidth)),
      add(next.end, scale(next.normal, halfWidth)),
    )

    offsetPoints.push(miter ?? previousEnd)
  }

  offsetPoints.push(add(points[points.length - 1], scale(segments[segments.length - 1].normal, halfWidth)))
  return dedupePoints(offsetPoints)
}

function pointsToPathData(points: Point[]): string | null {
  if (points.length < 3) {
    return null
  }

  const commands = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`,
  )

  return `${commands.join(' ')} Z`
}

function buildStrokeOutlinePath(
  points: Point[],
  strokeWidth: number,
  lineCap: 'butt' | 'round' | 'square' = 'round',
  lineJoin: 'miter' | 'round' | 'bevel' = 'round',
): string | null {
  const deduped = dedupePoints(points)
  if (deduped.length < 2 || strokeWidth <= EPSILON) {
    return null
  }

  const halfWidth = strokeWidth / 2
  const workingPoints = deduped.map((point) => ({ ...point }))
  const startDirection = normalize(subtract(workingPoints[1], workingPoints[0]))
  const endDirection = normalize(
    subtract(workingPoints[workingPoints.length - 1], workingPoints[workingPoints.length - 2]),
  )

  if (lineCap === 'square') {
    workingPoints[0] = add(workingPoints[0], scale(startDirection, -halfWidth))
    workingPoints[workingPoints.length - 1] = add(
      workingPoints[workingPoints.length - 1],
      scale(endDirection, halfWidth),
    )
  }

  const leftSide = buildOffsetSide(workingPoints, halfWidth, lineJoin)
  const rightSide = buildOffsetSide([...workingPoints].reverse(), halfWidth, lineJoin)

  if (leftSide.length === 0 || rightSide.length === 0) {
    return null
  }

  const outline: Point[] = [...leftSide]

  if (lineCap === 'round') {
    const endNormal = { x: -endDirection.y, y: endDirection.x }
    outline.push(
      ...sampleArc(
        workingPoints[workingPoints.length - 1],
        halfWidth,
        angleOf(endNormal),
        angleOf(endNormal) - Math.PI,
        Math.max(8, Math.ceil(halfWidth / 1.5)),
      ),
    )
  }

  outline.push(...rightSide)

  if (lineCap === 'round') {
    const startNormal = { x: -startDirection.y, y: startDirection.x }
    outline.push(
      ...sampleArc(
        workingPoints[0],
        halfWidth,
        angleOf(scale(startNormal, -1)),
        angleOf(scale(startNormal, -1)) - Math.PI,
        Math.max(8, Math.ceil(halfWidth / 1.5)),
      ),
    )
  }

  return pointsToPathData(dedupePoints(outline))
}

function previewShapeToPaperItem(shape: PreviewAreaShape): paper.PathItem | null {
  const s = getScope()
  s.activate()

  const node = shape.node
  let item: paper.PathItem | null = null

  try {
    if (node.type === 'rect') {
      const radius = node.cornerRadius ?? 0
      item = radius > 0
        ? new s.Path.Rectangle(
            new s.Rectangle(0, 0, node.width, node.height),
            new s.Size(radius, radius),
          )
        : new s.Path.Rectangle(new s.Rectangle(0, 0, node.width, node.height))
    } else if (node.type === 'circle') {
      item = new s.Path.Circle(new s.Point(0, 0), node.radius)
    } else if (node.type === 'line') {
      if (!node.closed || node.points.length < 6) {
        return null
      }

      const path = new s.Path()
      for (let i = 0; i < node.points.length; i += 2) {
        path.add(new s.Point(node.points[i], node.points[i + 1]))
      }
      path.closed = true
      item = path
    } else {
      try {
        item = new s.CompoundPath(node.data)
      } catch {
        item = new s.Path(node.data)
      }
    }
  } catch {
    return null
  }

  if (!item) {
    return null
  }

  applyTransformChain(item, shape.transforms)
  return item
}

/**
 * Build a round-joined offset path from a closed Paper.js path.
 *
 * Samples points along the path, offsets by the normal, and inserts arc
 * segments at corners where the offset lines diverge. This produces smooth
 * round joins like Illustrator's "round" stroke option.
 *
 * @param offset Positive = outward (expand), negative = inward (contract).
 *               The sign is relative to the path's normal direction.
 */
function buildRoundOffsetPath(
  path: paper.Path,
  offset: number,
): paper.Path | null {
  const s = getScope()
  s.activate()

  if (!path.closed || path.length < 1) return null

  const pathLength = path.length
  const numSamples = Math.min(512, Math.max(96, Math.ceil(pathLength / 2)))

  const points: paper.Point[] = []
  let prevNx = 0
  let prevNy = 0
  let hasPrev = false

  for (let i = 0; i < numSamples; i++) {
    const t = (i / numSamples) * pathLength
    const pt = path.getPointAt(t)
    const normal = path.getNormalAt(t)
    if (!pt || !normal) continue

    if (hasPrev) {
      const dot = normal.x * prevNx + normal.y * prevNy
      if (dot < 0.9) {
        // Corner detected — check if offset lines diverge here.
        // cross > 0 → left turn (convex): outer offset diverges
        // cross < 0 → right turn (concave): inner offset diverges
        const cross = prevNx * normal.y - prevNy * normal.x
        const needsArc = offset * cross > 0

        if (needsArc) {
          const startAngle = Math.atan2(prevNy, prevNx)
          const endAngle = Math.atan2(normal.y, normal.x)
          let angleDiff = endAngle - startAngle

          // Normalize sweep to match the turn direction
          if (cross > 0 && angleDiff < 0) angleDiff += 2 * Math.PI
          if (cross < 0 && angleDiff > 0) angleDiff -= 2 * Math.PI

          const arcSteps = Math.max(4, Math.ceil(Math.abs(angleDiff) / (Math.PI / 8)))
          for (let j = 1; j < arcSteps; j++) {
            const frac = j / arcSteps
            const angle = startAngle + angleDiff * frac
            // Use `offset` (not |offset|) so the arc is on the correct side
            points.push(new s.Point(
              pt.x + Math.cos(angle) * offset,
              pt.y + Math.sin(angle) * offset,
            ))
          }
        }
      }
    }

    points.push(new s.Point(
      pt.x + normal.x * offset,
      pt.y + normal.y * offset,
    ))
    prevNx = normal.x
    prevNy = normal.y
    hasPrev = true
  }

  if (points.length < 3) return null

  const result = new s.Path(points)
  result.closed = true
  return result
}

/**
 * Build a stroke band (ring) for a single closed Paper.js path using
 * round-joined offset paths.
 */
function buildStrokeBandFromPath(
  path: paper.Path,
  strokeWidth: number,
): paper.PathItem | null {
  const halfWidth = strokeWidth / 2

  const pathA = buildRoundOffsetPath(path, halfWidth)
  const pathB = buildRoundOffsetPath(path, -halfWidth)

  if (!pathA && !pathB) return null
  if (!pathA) { pathB!.remove(); return null }
  if (!pathB) {
    const result = pathA as paper.PathItem
    return result
  }

  // Determine which is actually outer (larger area)
  const areaA = Math.abs(pathA.area)
  const areaB = Math.abs(pathB.area)
  const [outer, inner] = areaA >= areaB ? [pathA, pathB] : [pathB, pathA]

  // If the inner collapsed, return solid outer
  if (Math.abs(inner.area) < 1) {
    inner.remove()
    return outer as paper.PathItem
  }

  const band = outer.subtract(inner)
  outer.remove()
  inner.remove()
  return band
}

/**
 * Expand a contour-mode shape into its stroke band geometry.
 *
 * Works for any shape type: circles, rects (with corner radius), closed lines,
 * SVG paths, and compound paths (e.g. text outlines with holes like "e", "o").
 *
 * Each sub-path gets its own band (outer − inner), then all bands are unioned.
 */
function expandContourShapeToBand(
  shape: PreviewAreaShape,
  strokeWidth: number,
): PreviewAreaShape | null {
  const item = previewShapeToPaperItem(shape)
  if (!item) return null

  const s = getScope()
  s.activate()

  let bandData: string | null = null

  try {
    const subPaths: paper.Path[] = item.className === 'CompoundPath'
      ? ([...(item as paper.CompoundPath).children] as paper.Path[])
      : [item as paper.Path]

    let bandUnion: paper.PathItem | null = null

    for (const subPath of subPaths) {
      const band = buildStrokeBandFromPath(subPath, strokeWidth)
      if (!band) continue

      if (!bandUnion) {
        bandUnion = band
      } else {
        const next = bandUnion.unite(band) as paper.PathItem
        bandUnion.remove()
        band.remove()
        bandUnion = next
      }
    }

    if (bandUnion) {
      bandData = (bandUnion as paper.PathItem & { pathData?: string }).pathData ?? null
      bandUnion.remove()
    }
  } catch {
    // Fall back to null
  }

  item.remove()

  if (!bandData) return null

  return {
    depth: shape.depth,
    mode: shape.mode,
    sourceNodeId: shape.sourceNodeId,
    node: {
      id: `${shape.sourceNodeId}__contour-band`,
      type: 'path',
      name: 'Contour Band',
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      draggable: false,
      locked: true,
      visible: true,
      opacity: 1,
      parentId: shape.node.parentId,
      data: bandData,
      fill: shape.node.fill,
      stroke: undefined,
      strokeWidth: 0,
      cncMetadata: shape.node.cncMetadata,
    },
    transforms: [], // transforms already baked into the band geometry
  }
}


/**
 * Smooth out sharp corners on a path that are artifacts of boolean operations.
 *
 * Walks each segment and checks the angle between incoming/outgoing edges.
 * When the angle is sharper than `threshold` radians, the segment's handles
 * are set to create a small bezier curve that rounds off the spike.
 */
function smoothSharpCorners(
  pathItem: paper.PathItem,
  threshold = Math.PI * 0.15,
  smoothFactor = 0.35,
): void {
  const paths: paper.Path[] =
    pathItem.className === 'CompoundPath'
      ? ([...(pathItem as paper.CompoundPath).children] as paper.Path[])
      : [pathItem as paper.Path]

  for (const path of paths) {
    const segments = path.segments
    if (!segments || segments.length < 3) continue

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const prev = segments[(i - 1 + segments.length) % segments.length]
      const next = segments[(i + 1) % segments.length]

      const inDir = segment.point.subtract(prev.point)
      const outDir = next.point.subtract(segment.point)

      const inLen = inDir.length
      const outLen = outDir.length
      if (inLen < EPSILON || outLen < EPSILON) continue

      const inNorm = inDir.normalize()
      const outNorm = outDir.normalize()
      const dot = inNorm.dot(outNorm)
      // Angle between the two edges (0 = same direction, PI = reversal)
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)))

      // Sharp corner: the turn angle is close to PI (near-reversal / spike)
      if (angle > Math.PI - threshold) {
        const handleLen = Math.min(inLen, outLen) * smoothFactor
        segment.handleIn = inNorm.multiply(-handleLen)
        segment.handleOut = outNorm.multiply(handleLen)
      }
    }
  }
}

export function computeUnionPath(shapes: PreviewAreaShape[]): string | null {
  const visibleShapes = shapes.filter((shape) => shape.node.visible)
  if (visibleShapes.length === 0) {
    return null
  }

  const s = getScope()
  s.activate()

  const items: paper.PathItem[] = []
  for (const shape of visibleShapes) {
    const item = previewShapeToPaperItem(shape)
    if (item) {
      items.push(item)
    }
  }

  if (items.length === 0) {
    return null
  }

  if (items.length === 1) {
    const pathData = (items[0] as paper.PathItem & { pathData?: string }).pathData ?? null
    items[0].remove()
    return pathData
  }

  let union: paper.PathItem = items[0]
  for (let i = 1; i < items.length; i += 1) {
    const next = union.unite(items[i])
    union.remove()
    items[i].remove()
    union = next as paper.PathItem
  }

  smoothSharpCorners(union)

  const pathData = (union as paper.PathItem & { pathData?: string }).pathData ?? null
  union.remove()
  return pathData
}

export function buildDepthPreviewPlan(
  rootIds: string[],
  nodesById: Record<string, CanvasNode | undefined>,
  fallbackDepth: number | null = null,
  toolDiameter = 1,
): DepthPreviewPlan {
  const areaShapesByKey = new Map<string, PreviewAreaShape[]>()
  const strokeShapes: PreviewStrokeShape[] = []
  const interactiveRootIds = new Set<string>()

  const collectNode = (
    nodeId: string,
    rootId: string,
    inheritedDepth: number | null,
    ancestorTransforms: LocalTransform[],
    inheritedEngraveType: NormalizedEngraveType | null,
  ): boolean => {
    const node = nodesById[nodeId]
    if (!node || !node.visible) {
      return false
    }

    const effectiveDepth = node.cncMetadata?.cutDepth ?? inheritedDepth ?? fallbackDepth
    const effectiveMode = node.cncMetadata?.engraveType
      ? resolveEngraveType(node.cncMetadata.engraveType, 'pocket')
      : (inheritedEngraveType ?? 'pocket')
    const localTransform = toLocalTransform(node)

    if (node.type === 'group') {
      const nextAncestorTransforms = [...ancestorTransforms, localTransform]
      let subtreeHasDepth = effectiveDepth !== null

      for (const childId of node.childIds) {
        subtreeHasDepth = collectNode(
          childId,
          rootId,
          effectiveDepth,
          nextAncestorTransforms,
          effectiveMode,
        ) || subtreeHasDepth
      }

      if (subtreeHasDepth) {
        interactiveRootIds.add(rootId)
      }

      return subtreeHasDepth
    }

    if (effectiveDepth === null) {
      return false
    }

    const transforms = [localTransform, ...ancestorTransforms.slice().reverse()]
    interactiveRootIds.add(rootId)

    // Stroke-only paths (open paths, or closed paths with no fill) and short lines
    // should be treated as stroke shapes, not area fills.
    if (node.type === 'path' && isOpenPathNode(node)) {
      const s = getScope()
      s.activate()
      let pathItem: paper.Path | null = null
      try {
        const parsed = new s.CompoundPath(node.data)
        // Flatten compound paths to individual sub-paths
        const subPaths = parsed.className === 'CompoundPath'
          ? ([...(parsed as paper.CompoundPath).children] as paper.Path[])
          : [parsed as paper.Path]
        for (const subPath of subPaths) {
          applyTransformChain(subPath, transforms)
          const flatPoints: number[] = []
          const segments = subPath.segments ?? []
          // Flatten curves to points
          const flatPath = subPath.clone() as paper.Path
          flatPath.flatten(1)
          for (const seg of flatPath.segments) {
            flatPoints.push(seg.point.x, seg.point.y)
          }
          flatPath.remove()
          if (flatPoints.length >= 4) {
            strokeShapes.push({
              depth: effectiveDepth,
              sourceNodeId: node.id,
              points: flatPoints,
              strokeWidth: Math.max(toolDiameter, 1),
            })
          }
        }
        parsed.remove()
      } catch { /* ignore parse errors */ }
      return true
    }

    if (node.type === 'line' && (isOpenPathNode(node) || node.points.length < 6)) {
      const outlinedPoints = node.points.flatMap((value, index) => {
        if (index % 2 !== 0) {
          return []
        }

        const point = applyTransformsToPoint(value, node.points[index + 1], transforms)
        return [point]
      })
      if (effectiveMode === 'contour') {
        strokeShapes.push({
          depth: effectiveDepth,
          sourceNodeId: node.id,
          points: outlinedPoints.flatMap((point) => [point.x, point.y]),
          strokeWidth: Math.max(toolDiameter, 1),
        })

        return true
      }

      const outlinedPath = buildStrokeOutlinePath(
        outlinedPoints,
        Math.max(toolDiameter, 1),
        node.lineCap,
        node.lineJoin,
      )

      if (outlinedPath) {
        const key = `${effectiveDepth}:${effectiveMode}`
        const bucket = areaShapesByKey.get(key) ?? []
        bucket.push({
          depth: effectiveDepth,
          mode: effectiveMode,
          sourceNodeId: node.id,
          node: {
            id: `${node.id}__stroke-outline`,
            type: 'path',
            name: `${node.name} Stroke Outline`,
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            draggable: false,
            locked: true,
            visible: true,
            opacity: 1,
            parentId: node.parentId,
            data: outlinedPath,
            fill: node.stroke ?? node.fill,
            stroke: undefined,
            strokeWidth: 0,
            cncMetadata: node.cncMetadata,
          },
          transforms: [],
        })
        areaShapesByKey.set(key, bucket)
      }

      return true
    }

    // Closed paths with no fill (stroke-only) should be treated as outlines,
    // not as fillable area shapes. Force contour mode for these.
    const resolvedMode = isOpenPathNode(node) ? 'contour' as NormalizedEngraveType : effectiveMode
    const key = `${effectiveDepth}:${resolvedMode}`
    const bucket = areaShapesByKey.get(key) ?? []

    if (resolvedMode === 'contour') {
      const bandShape = expandContourShapeToBand(
        { depth: effectiveDepth, mode: resolvedMode, sourceNodeId: node.id, node, transforms },
        Math.max(toolDiameter, 1),
      )
      if (bandShape) {
        bucket.push(bandShape)
        areaShapesByKey.set(key, bucket)
      }
    } else {
      bucket.push({
        depth: effectiveDepth,
        mode: resolvedMode,
        sourceNodeId: node.id,
        node,
        transforms,
      })
      areaShapesByKey.set(key, bucket)
    }

    return true
  }

  for (const rootId of rootIds) {
    collectNode(rootId, rootId, null, [], null)
  }

  // Merge contour bands into pocket buckets at the same depth so they
  // are boolean-unioned together into a single composite layer.
  for (const [key, shapes] of areaShapesByKey) {
    if (!key.endsWith(':contour')) continue
    const depth = key.split(':')[0]
    const pocketKey = `${depth}:pocket`
    const pocketBucket = areaShapesByKey.get(pocketKey)
    if (pocketBucket) {
      pocketBucket.push(...shapes)
    } else {
      areaShapesByKey.set(pocketKey, shapes)
    }
    areaShapesByKey.delete(key)
  }

  const layers = Array.from(areaShapesByKey.values())
    .map((shapes) => ({
      depth: shapes[0]?.depth ?? 0,
      mode: shapes[0]?.mode ?? 'pocket',
      pathData: computeUnionPath(shapes),
      sourceNodeIds: shapes.map((shape) => shape.sourceNodeId),
    }))
    .sort((left, right) => {
      if (left.depth !== right.depth) {
        return left.depth - right.depth
      }

      if (left.mode === right.mode) {
        return 0
      }

      return left.mode === 'pocket' ? -1 : 1
    })

  const passthroughRootIds = rootIds.filter((rootId) => !interactiveRootIds.has(rootId))

  strokeShapes.sort((left, right) => left.depth - right.depth)

  return {
    layers,
    strokeShapes,
    interactiveRootIds: rootIds.filter((rootId) => interactiveRootIds.has(rootId)),
    passthroughRootIds,
  }
}
