/**
 * Core Minkowski sweep engine ported from the proof-of-concept visualize.html.
 *
 * Uses Clipper polygon boolean operations to create accurate swept tool volumes:
 * - Circle footprints at every path vertex
 * - Rectangle bridges between adjacent vertices
 * - Union into single seamless boundary
 * - Properly assigns holes to outer polygons
 */

import * as THREE from 'three'
import ClipperLib from 'clipper-lib'

const CLIPPER_SCALE = 1000

// ── Point utilities ──

function almostEqualPoints(a: THREE.Vector2, b: THREE.Vector2, epsilon = 1e-4): boolean {
  return a.distanceTo(b) < epsilon
}

export function stripDuplicateClosure(points: THREE.Vector2[]): THREE.Vector2[] {
  if (points.length > 2 && almostEqualPoints(points[0], points[points.length - 1])) {
    return points.slice(0, -1)
  }
  return points.slice()
}

export function computeSignedArea(points: THREE.Vector2[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return area / 2
}

export function ensureCounterClockwise(points: THREE.Vector2[]): THREE.Vector2[] {
  if (computeSignedArea(points) < 0) {
    return points.slice().reverse()
  }
  return points.slice()
}

export function isPointInsidePolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

// ── Clipper <-> Three.js coordinate conversion ──

type ClipperPoint = { X: number; Y: number }
type ClipperPath = ClipperPoint[]

function vectorPointsToClipperPath(points: THREE.Vector2[]): ClipperPath {
  return ensureCounterClockwise(stripDuplicateClosure(points)).map((point) => ({
    X: Math.round(point.x * CLIPPER_SCALE),
    Y: Math.round(point.y * CLIPPER_SCALE),
  }))
}

function clipperPathToVectorPoints(path: ClipperPath): THREE.Vector2[] {
  return path.map((point) => new THREE.Vector2(point.X / CLIPPER_SCALE, point.Y / CLIPPER_SCALE))
}

// ── Shape creation helpers ──

export function createPathFromPoints(points: THREE.Vector2[]): THREE.Path {
  const path = new THREE.Path()
  path.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x, points[i].y)
  }
  path.closePath()
  return path
}

export function createShapeFromPoints(points: THREE.Vector2[]): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i].x, points[i].y)
  }
  shape.closePath()
  return shape
}

export function getShapePointLoops(
  shape: THREE.Shape,
  divisions = 48,
): { outline: THREE.Vector2[]; holes: THREE.Vector2[][] } {
  const extracted = shape.extractPoints(divisions)
  return {
    outline: extracted.shape,
    holes: extracted.holes,
  }
}

export function createRectangleShape(bounds: {
  minX: number
  minY: number
  maxX: number
  maxY: number
}): THREE.Shape {
  const { minX, minY, maxX, maxY } = bounds
  const shape = new THREE.Shape()
  shape.moveTo(minX, minY)
  shape.lineTo(maxX, minY)
  shape.lineTo(maxX, maxY)
  shape.lineTo(minX, maxY)
  shape.closePath()
  return shape
}

// ── Shape <-> Clipper paths conversion ──

function shapeToClipperPaths(shape: THREE.Shape, divisions = 48): ClipperPath[] {
  const loops = getShapePointLoops(shape, divisions)
  const paths = [vectorPointsToClipperPath(loops.outline)]

  for (const hole of loops.holes) {
    paths.push(vectorPointsToClipperPath(hole).reverse())
  }

  return paths
}

/**
 * Convert Clipper solution paths back to THREE.Shape objects,
 * properly assigning holes to their containing outer polygons.
 */
export function clipperPathsToShapes(paths: ClipperPath[]): THREE.Shape[] {
  const polygons = paths.map((path) => {
    const points = clipperPathToVectorPoints(path)
    return { points, area: computeSignedArea(points) }
  })

  const outers = polygons.filter((polygon) => polygon.area >= 0)
  const holes = polygons.filter((polygon) => polygon.area < 0)

  const shapes = outers.map((outer) => ({
    shape: createShapeFromPoints(outer.points),
    points: outer.points,
  }))

  for (const hole of holes) {
    const holePoints = hole.points.slice().reverse()
    // Sample multiple points for robust containment test (majority vote)
    const sampleIndices = [
      0,
      Math.floor(holePoints.length / 3),
      Math.floor((2 * holePoints.length) / 3),
    ]
    const owner = shapes.find((candidate) => {
      let insideCount = 0
      for (const idx of sampleIndices) {
        if (isPointInsidePolygon(holePoints[idx], candidate.points)) {
          insideCount++
        }
      }
      return insideCount > sampleIndices.length / 2
    })
    if (owner) {
      owner.shape.holes.push(createPathFromPoints(holePoints))
    }
  }

  return shapes.map((entry) => entry.shape)
}

// ── Clipper circle footprint ──

function createCircleClipperPath(
  center: { x: number; y: number },
  radius: number,
  segments = 24,
): ClipperPath {
  const circlePoints: ClipperPath = []
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    circlePoints.push({
      X: Math.round((center.x + Math.cos(angle) * radius) * CLIPPER_SCALE),
      Y: Math.round((center.y + Math.sin(angle) * radius) * CLIPPER_SCALE),
    })
  }
  return circlePoints
}

// ── THE MAGIC: TRUE MINKOWSKI SWEEP ──

/**
 * Creates the swept tool volume boundary for a given toolpath.
 *
 * Algorithm:
 * 1. Drop a circular footprint at every path vertex
 * 2. Stretch a rectangle between every pair of connected vertices
 * 3. Union everything into a single seamless boundary via Clipper
 */
export function createTrueCncSweepShape(
  pathPoints: { x: number; y: number }[],
  radius: number,
  closed = false,
): THREE.Shape[] {
  if (pathPoints.length === 0) return []
  if (pathPoints.length === 1) {
    return clipperPathsToShapes([createCircleClipperPath(pathPoints[0], radius)])
  }

  const clipper = new ClipperLib.Clipper()
  const subjectPaths: ClipperPath[] = []

  // 1. Drop a circle footprint at every single vertex
  for (let i = 0; i < pathPoints.length; i++) {
    subjectPaths.push(createCircleClipperPath(pathPoints[i], radius))
  }

  // 2. Stretch a rectangle between every connected vertex
  const limit = closed ? pathPoints.length : pathPoints.length - 1
  for (let i = 0; i < limit; i++) {
    const p1 = pathPoints[i]
    const p2 = pathPoints[(i + 1) % pathPoints.length]

    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-8) continue

    const len = Math.sqrt(lenSq)
    const dirX = dx / len
    const dirY = dy / len
    const nx = -dirY * radius
    const ny = dirX * radius

    const rectPoints: ClipperPath = [
      { X: Math.round((p1.x + nx) * CLIPPER_SCALE), Y: Math.round((p1.y + ny) * CLIPPER_SCALE) },
      { X: Math.round((p1.x - nx) * CLIPPER_SCALE), Y: Math.round((p1.y - ny) * CLIPPER_SCALE) },
      { X: Math.round((p2.x - nx) * CLIPPER_SCALE), Y: Math.round((p2.y - ny) * CLIPPER_SCALE) },
      { X: Math.round((p2.x + nx) * CLIPPER_SCALE), Y: Math.round((p2.y + ny) * CLIPPER_SCALE) },
    ]
    subjectPaths.push(rectPoints)
  }

  // 3. Union them all together into one seamless boundary
  clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true)
  const solution = new ClipperLib.Paths()
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )
  ClipperLib.Clipper.CleanPolygons(solution, CLIPPER_SCALE * 0.001)

  return clipperPathsToShapes(solution)
}

// ── Boolean operations on THREE.Shape arrays ──

export function unionShapes(shapes: THREE.Shape[], divisions = 48): THREE.Shape[] {
  if (shapes.length === 0) return []

  const clipper = new ClipperLib.Clipper()
  const subjectPaths: ClipperPath[] = []

  for (const shape of shapes) {
    subjectPaths.push(...shapeToClipperPaths(shape, divisions))
  }

  clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true)

  const solution = new ClipperLib.Paths()
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )
  ClipperLib.Clipper.CleanPolygons(solution, CLIPPER_SCALE * 0.001)

  return clipperPathsToShapes(solution)
}

export function subtractShapes(
  subjectShapes: THREE.Shape[],
  clipShapes: THREE.Shape[],
  divisions = 48,
): THREE.Shape[] {
  if (subjectShapes.length === 0) return []

  const clipper = new ClipperLib.Clipper()
  const subjectPaths = subjectShapes.flatMap((shape) => shapeToClipperPaths(shape, divisions))
  const clipPaths = clipShapes.flatMap((shape) => shapeToClipperPaths(shape, divisions))

  clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true)

  if (clipPaths.length > 0) {
    clipper.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true)
  }

  const solution = new ClipperLib.Paths()
  clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )
  ClipperLib.Clipper.CleanPolygons(solution, CLIPPER_SCALE * 0.001)

  return clipperPathsToShapes(solution)
}
