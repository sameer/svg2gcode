/**
 * Scene helpers: GPU cleanup, grid, axes, tool marker, lighting.
 * Ported from PoC's clearGroup, disposeMaterial, and scene setup code.
 */

import * as THREE from 'three'

export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      entry.dispose()
    }
    return
  }
  material.dispose()
}

export function clearGroup(group: THREE.Group): void {
  const disposedMaterials = new Set<THREE.Material>()
  for (const child of [...group.children]) {
    group.remove(child)
    child.traverse((node) => {
      const meshNode = node as THREE.Mesh
      if (meshNode.geometry) {
        meshNode.geometry.dispose()
      }
      if (meshNode.material && !disposedMaterials.has(meshNode.material as THREE.Material)) {
        disposedMaterials.add(meshNode.material as THREE.Material)
        disposeMaterial(meshNode.material as THREE.Material | THREE.Material[])
      }
    })
  }
}

export function createLighting(): THREE.Group {
  const group = new THREE.Group()
  group.add(new THREE.AmbientLight(0xffffff, 0.35))

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1)
  keyLight.position.set(8, -6, 12)
  group.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0x88aaff, 0.45)
  fillLight.position.set(-10, 8, 7)
  group.add(fillLight)

  return group
}

export function createGrid(materialWidth: number, materialHeight: number): THREE.Group {
  const group = new THREE.Group()

  const gridSize = Math.max(materialWidth, materialHeight) * 1.5
  const divisions = Math.round(gridSize / 10)
  const grid = new THREE.GridHelper(gridSize, divisions, 0x666666, 0x383838)
  grid.rotation.x = Math.PI / 2
  grid.position.set(materialWidth / 2, materialHeight / 2, 0)
  group.add(grid)

  const axes = new THREE.AxesHelper(Math.min(materialWidth, materialHeight) * 0.15)
  group.add(axes)

  return group
}

export interface ToolMarker {
  group: THREE.Group
  circle: THREE.Mesh
  line: THREE.Line
}

export function createToolMarker(toolRadius: number): ToolMarker {
  const group = new THREE.Group()
  group.visible = false

  const circleGeo = new THREE.CircleGeometry(1, 32)
  const circleMat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide,
  })
  const circle = new THREE.Mesh(circleGeo, circleMat)
  circle.scale.set(toolRadius, toolRadius, 1)
  circle.position.z = 0.03
  group.add(circle)

  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0.03),
    new THREE.Vector3(0, 0, 5),
  ])
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.6,
  })
  const line = new THREE.Line(lineGeo, lineMat)
  group.add(line)

  return { group, circle, line }
}

export function createActivePathLine(): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 1,
    }),
  )
  line.visible = false
  return line
}
