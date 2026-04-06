/**
 * Yellow semi-transparent SVG shape overlay on the stock surface.
 * Ported from PoC's createTargetOverlay.
 */

import * as THREE from 'three'
import { stripDuplicateClosure, getShapePointLoops } from './clipperSweep'

export function createTargetOverlay(shape: THREE.Shape, zOffset = 0.05): THREE.Group {
  const loops = getShapePointLoops(shape, 80)
  const group = new THREE.Group()

  const fillGeometry = new THREE.ShapeGeometry(shape, 80)
  const fillMesh = new THREE.Mesh(
    fillGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xfff2a8,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
    }),
  )
  fillMesh.position.z = zOffset
  group.add(fillMesh)

  const addLoop = (points: THREE.Vector2[], color: number) => {
    const loop = stripDuplicateClosure(points)
    const geometry = new THREE.BufferGeometry().setFromPoints(
      loop.map((point) => new THREE.Vector3(point.x, point.y, zOffset + 0.01)),
    )
    const line = new THREE.LineLoop(
      geometry,
      new THREE.LineBasicMaterial({ color }),
    )
    group.add(line)
  }

  addLoop(loops.outline, 0xfff2a8)
  for (const hole of loops.holes) {
    addLoop(hole, 0xfff2a8)
  }

  return group
}
