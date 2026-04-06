import type Konva from 'konva'

import type { MarqueeRect } from '../types/editor'

export interface SnapGuide {
  orientation: 'V' | 'H'
  lineGuide: number
  delta: number
}

interface LineGuideStops {
  vertical: number[]
  horizontal: number[]
}

const getNodeRect = (node: Konva.Node): MarqueeRect =>
  node.getClientRect({ skipShadow: true, skipStroke: false })

const getSnapPoints = (box: MarqueeRect) => ({
  vertical: [box.x, box.x + box.width / 2, box.x + box.width],
  horizontal: [box.y, box.y + box.height / 2, box.y + box.height],
})

export function getBoundsForNodes(nodes: Konva.Node[]): MarqueeRect | null {
  if (nodes.length === 0) {
    return null
  }

  const boxes = nodes.map(getNodeRect)

  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  const maxX = Math.max(...boxes.map((box) => box.x + box.width))
  const maxY = Math.max(...boxes.map((box) => box.y + box.height))

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function getLineGuideStops(
  scopeRect: MarqueeRect,
  guideNodes: Konva.Node[],
): LineGuideStops {
  const vertical = [scopeRect.x, scopeRect.x + scopeRect.width / 2, scopeRect.x + scopeRect.width]
  const horizontal = [
    scopeRect.y,
    scopeRect.y + scopeRect.height / 2,
    scopeRect.y + scopeRect.height,
  ]

  guideNodes.forEach((guideNode) => {
    const box = getNodeRect(guideNode)
    const snapPoints = getSnapPoints(box)

    vertical.push(...snapPoints.vertical)
    horizontal.push(...snapPoints.horizontal)
  })

  return {
    vertical: vertical.map((value) => Math.round(value)),
    horizontal: horizontal.map((value) => Math.round(value)),
  }
}

export function getGuides(
  lineGuideStops: LineGuideStops,
  box: MarqueeRect,
  guidelineOffset: number,
): SnapGuide[] {
  const verticalMatches: Array<{ lineGuide: number; diff: number; delta: number }> = []
  const horizontalMatches: Array<{ lineGuide: number; diff: number; delta: number }> = []
  const snapPoints = getSnapPoints(box)

  lineGuideStops.vertical.forEach((lineGuide) => {
    snapPoints.vertical.forEach((snapPoint) => {
      const roundedSnapPoint = Math.round(snapPoint)
      const diff = Math.abs(lineGuide - roundedSnapPoint)

      if (diff < guidelineOffset) {
        verticalMatches.push({
          lineGuide,
          diff,
          delta: lineGuide - snapPoint,
        })
      }
    })
  })

  lineGuideStops.horizontal.forEach((lineGuide) => {
    snapPoints.horizontal.forEach((snapPoint) => {
      const roundedSnapPoint = Math.round(snapPoint)
      const diff = Math.abs(lineGuide - roundedSnapPoint)

      if (diff < guidelineOffset) {
        horizontalMatches.push({
          lineGuide,
          diff,
          delta: lineGuide - snapPoint,
        })
      }
    })
  })

  const guides: SnapGuide[] = []
  const nearestVertical = verticalMatches.sort((a, b) => a.diff - b.diff)[0]
  const nearestHorizontal = horizontalMatches.sort((a, b) => a.diff - b.diff)[0]

  if (nearestVertical) {
    guides.push({
      orientation: 'V',
      lineGuide: nearestVertical.lineGuide,
      delta: nearestVertical.delta,
    })
  }

  if (nearestHorizontal) {
    guides.push({
      orientation: 'H',
      lineGuide: nearestHorizontal.lineGuide,
      delta: nearestHorizontal.delta,
    })
  }

  return guides
}
