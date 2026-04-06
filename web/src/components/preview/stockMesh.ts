/**
 * Layered stock visualization with material subtraction.
 * Ported from PoC's createStockMeshLayers / computeStockBounds / extrudeSlotShape.
 */

import * as THREE from 'three'
import type { ToolpathGroup, StockBounds } from '../../types/preview'
import { unionShapes, subtractShapes, createRectangleShape } from './clipperSweep'

export function extrudeSlotShape(shape: THREE.Shape, depth: number, color: number): THREE.Mesh {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 28,
  })
  geometry.translate(0, 0, -depth)

  const material = new THREE.MeshPhongMaterial({
    color,
    transparent: true,
    opacity: 0.68,
    shininess: 70,
    side: THREE.DoubleSide,
  })

  return new THREE.Mesh(geometry, material)
}

export function createStockMeshLayers(
  bounds: StockBounds,
  toolpaths: ToolpathGroup[],
  materialThickness: number,
  fallbackDepth = 0.01,
): THREE.Group {
  const uniqueDepths =
    toolpaths.length > 0
      ? [...new Set(toolpaths.map((tp) => tp.depth))].sort((a, b) => a - b)
      : [fallbackDepth]

  const group = new THREE.Group()
  const stockMaterial = new THREE.MeshPhongMaterial({
    color: 0xcdbb8f,
    transparent: true,
    opacity: 0.82,
    shininess: 28,
    side: THREE.DoubleSide,
  })

  const totalDepth = Math.max(materialThickness, uniqueDepths[uniqueDepths.length - 1] || 0) || fallbackDepth
  const deepestCut = uniqueDepths[uniqueDepths.length - 1] || 0

  let previousDepth = 0

  for (const depth of uniqueDepths) {
    const layerThickness = depth - previousDepth
    const activeToolpaths = toolpaths.filter(
      (tp) => tp.depth >= depth && (tp.slotShapes || []).length > 0,
    )

    if (layerThickness <= 0) {
      previousDepth = depth
      continue
    }

    const mergedClearedShapes = unionShapes(
      activeToolpaths.flatMap((tp) => tp.slotShapes || []),
      80,
    )
    const stockShapes = subtractShapes(
      [createRectangleShape(bounds)],
      mergedClearedShapes,
      80,
    )

    if (stockShapes.length === 0) {
      previousDepth = depth
      continue
    }

    const geometry = new THREE.ExtrudeGeometry(stockShapes, {
      depth: layerThickness,
      bevelEnabled: false,
      curveSegments: 28,
    })
    geometry.translate(0, 0, -depth)

    const mesh = new THREE.Mesh(geometry, stockMaterial)
    group.add(mesh)

    previousDepth = depth
  }

  // Add solid material layer below the deepest cut down to material thickness
  if (totalDepth > deepestCut) {
    const belowGeometry = new THREE.ExtrudeGeometry([createRectangleShape(bounds)], {
      depth: totalDepth - deepestCut,
      bevelEnabled: false,
      curveSegments: 28,
    })
    belowGeometry.translate(0, 0, -totalDepth)

    const belowMesh = new THREE.Mesh(belowGeometry, stockMaterial)
    group.add(belowMesh)
  }

  // Bounding box outline
  const outlineGeometry = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
      totalDepth,
    ),
  )
  outlineGeometry.translate(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    -(totalDepth / 2),
  )
  const outline = new THREE.LineSegments(
    outlineGeometry,
    new THREE.LineBasicMaterial({ color: 0xf5deb3, transparent: true, opacity: 0.55 }),
  )
  group.add(outline)

  return group
}

export function computeStockBounds(toolpaths: ToolpathGroup[], padding = 1.8): StockBounds {
  const bounds: StockBounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  }

  for (const toolpath of toolpaths) {
    for (const point of toolpath.pathPoints) {
      bounds.minX = Math.min(bounds.minX, point.x)
      bounds.minY = Math.min(bounds.minY, point.y)
      bounds.maxX = Math.max(bounds.maxX, point.x)
      bounds.maxY = Math.max(bounds.maxY, point.y)
    }
  }

  bounds.minX -= padding
  bounds.minY -= padding
  bounds.maxX += padding
  bounds.maxY += padding
  return bounds
}
