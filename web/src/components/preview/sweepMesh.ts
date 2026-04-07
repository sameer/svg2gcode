/**
 * Merged sweep volume meshes - shows the swept tool volumes as blue extruded geometry.
 * Ported from PoC's createMergedSweepMeshes.
 */

import * as THREE from 'three'
import type { ToolpathGroup } from '../../types/preview'
import { extrudeSlotShape } from './stockMesh'

export function createMergedSweepMeshes(
  toolpaths: ToolpathGroup[],
  color = 0x4aa8ff,
): THREE.Group {
  const group = new THREE.Group()

  for (const tp of toolpaths) {
    const shapes = tp.slotShapes || []
    if (shapes.length === 0) continue
    const depth = Math.abs(tp.depth) || 0.01
    for (const shape of shapes) {
      group.add(extrudeSlotShape(shape, depth, color, false))
    }
  }

  return group
}
