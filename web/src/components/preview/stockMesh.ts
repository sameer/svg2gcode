/**
 * Layered stock visualization with boolean subtraction.
 * Uses grid tiling to keep per-tile polygon complexity low enough for earcut.
 */

import * as THREE from 'three'
import type { ToolpathGroup, StockBounds } from '../../types/preview'
import { unionShapes, subtractShapes, createRectangleShape } from './clipperSweep'

export function extrudeSlotShape(
  shape: THREE.Shape,
  depth: number,
  color: number,
  depthWrite = true,
): THREE.Mesh {
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
    depthWrite,
  })

  return new THREE.Mesh(geometry, material)
}

/** Number of tiles per axis for grid-based stock subtraction */
const TILE_COUNT = 6

export function createStockMeshLayers(
  bounds: StockBounds,
  toolpaths: ToolpathGroup[],
  materialThickness: number,
  texture?: THREE.Texture,
  fallbackDepth = 0.01,
): THREE.Group {
  const uniqueDepths =
    toolpaths.length > 0
      ? [...new Set(toolpaths.map((tp) => tp.depth))].sort((a, b) => a - b)
      : [fallbackDepth]

  const group = new THREE.Group()
  if (texture) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(1 / 400, 1 / 400)
  }

  const stockMaterial = new THREE.MeshPhongMaterial({
    color: texture ? 0xffffff : 0xcdbb8f,
    map: texture ?? null,
    transparent: true,
    opacity: 0.82,
    shininess: 28,
    side: THREE.DoubleSide,
  })

  // Inject world-Z depth darkening: cut floors/walls darken proportionally to depth
  stockMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uMaxDepth = { value: totalDepth }

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
varying float vWorldZ;`,
    )
    shader.vertexShader = shader.vertexShader.replace(
      '#include <fog_vertex>',
      `#include <fog_vertex>
vWorldZ = (modelMatrix * vec4(position, 1.0)).z;`,
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
varying float vWorldZ;
uniform float uMaxDepth;`,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
if (vWorldZ < -0.05) {
  float t = clamp(-vWorldZ / max(uMaxDepth, 0.001), 0.0, 1.0);
  gl_FragColor.rgb *= (1.0 - sqrt(t) * 0.6);
}`,
    )
  }

  const totalDepth = Math.max(materialThickness, uniqueDepths[uniqueDepths.length - 1] || 0) || fallbackDepth
  const deepestCut = uniqueDepths[uniqueDepths.length - 1] || 0

  const tileW = (bounds.maxX - bounds.minX) / TILE_COUNT
  const tileH = (bounds.maxY - bounds.minY) / TILE_COUNT

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

    const allClearedShapes = activeToolpaths.flatMap((tp) => tp.slotShapes || [])
    if (allClearedShapes.length === 0) {
      // No cuts at this depth — full stock layer
      const fullShape = createRectangleShape(bounds)
      const geo = new THREE.ExtrudeGeometry(fullShape, {
        depth: layerThickness,
        bevelEnabled: false,
        curveSegments: 4,
      })
      geo.translate(0, 0, -depth)
      group.add(new THREE.Mesh(geo, stockMaterial))
      previousDepth = depth
      continue
    }

    // Merge all cleared shapes once (Clipper handles this well)
    const mergedClearedShapes = unionShapes(allClearedShapes, 48)

    // Subtract from each tile independently to keep earcut complexity low
    for (let row = 0; row < TILE_COUNT; row++) {
      for (let col = 0; col < TILE_COUNT; col++) {
        const tileBounds = {
          minX: bounds.minX + col * tileW,
          minY: bounds.minY + row * tileH,
          maxX: bounds.minX + (col + 1) * tileW,
          maxY: bounds.minY + (row + 1) * tileH,
        }

        const tileShapes = subtractShapes(
          [createRectangleShape(tileBounds)],
          mergedClearedShapes,
          48,
        )

        for (const shape of tileShapes) {
          const geo = new THREE.ExtrudeGeometry(shape, {
            depth: layerThickness,
            bevelEnabled: false,
            curveSegments: 12,
          })
          geo.translate(0, 0, -depth)
          group.add(new THREE.Mesh(geo, stockMaterial))
        }
      }
    }

    previousDepth = depth
  }

  // Add solid material layer below the deepest cut down to material thickness
  if (totalDepth > deepestCut) {
    const belowGeometry = new THREE.ExtrudeGeometry(createRectangleShape(bounds), {
      depth: totalDepth - deepestCut,
      bevelEnabled: false,
      curveSegments: 4,
    })
    belowGeometry.translate(0, 0, -totalDepth)
    group.add(new THREE.Mesh(belowGeometry, stockMaterial))
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
