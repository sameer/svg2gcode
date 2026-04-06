/**
 * Merged sweep volume meshes - shows the swept tool volumes as blue extruded geometry.
 * Ported from PoC's createMergedSweepMeshes.
 */

import * as THREE from 'three'
import type { ToolpathGroup } from '../../types/preview'
import { unionShapes } from './clipperSweep'
import { extrudeSlotShape } from './stockMesh'

export function createMergedSweepMeshes(
  toolpaths: ToolpathGroup[],
  color = 0x4aa8ff,
): THREE.Group {
  const slotShapes = toolpaths.flatMap((tp) => tp.slotShapes || [])
  if (slotShapes.length === 0) {
    return new THREE.Group()
  }

  const shapes = unionShapes(slotShapes, 80)
  const group = new THREE.Group()

  // Use the depth from the first toolpath (all should share same depth in a group)
  const depth = toolpaths[0]?.depth || 0.01

  for (const shape of shapes) {
    group.add(extrudeSlotShape(shape, depth, color))
  }

  return group
}
