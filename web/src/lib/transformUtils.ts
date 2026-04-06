import type Konva from 'konva'

import type { CanvasNode } from '../types/editor'

type TransformPatch = Partial<CanvasNode>

const scalePoints = (points: number[], scaleX: number, scaleY: number): number[] =>
  points.map((value, index) => value * (index % 2 === 0 ? scaleX : scaleY))

export function getNodeTransformPatch(
  nodeDefinition: CanvasNode,
  runtimeNode: Konva.Node,
): TransformPatch {
  const basePatch: TransformPatch = {
    x: runtimeNode.x(),
    y: runtimeNode.y(),
    rotation: runtimeNode.rotation(),
  }

  if (nodeDefinition.type === 'group') {
    return {
      ...basePatch,
      scaleX: runtimeNode.scaleX(),
      scaleY: runtimeNode.scaleY(),
    }
  }

  if (nodeDefinition.type === 'rect') {
    return {
      ...basePatch,
      width: Math.max(1, nodeDefinition.width * runtimeNode.scaleX()),
      height: Math.max(1, nodeDefinition.height * runtimeNode.scaleY()),
      scaleX: 1,
      scaleY: 1,
    }
  }

  if (nodeDefinition.type === 'circle') {
    return {
      ...basePatch,
      scaleX: runtimeNode.scaleX(),
      scaleY: runtimeNode.scaleY(),
    }
  }

  if (nodeDefinition.type === 'line') {
    return {
      ...basePatch,
      points: scalePoints(nodeDefinition.points, runtimeNode.scaleX(), runtimeNode.scaleY()),
      scaleX: 1,
      scaleY: 1,
    }
  }

  return {
    ...basePatch,
    scaleX: runtimeNode.scaleX(),
    scaleY: runtimeNode.scaleY(),
  }
}
