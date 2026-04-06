import { useCallback, useEffect, useRef, useState } from 'react'
import Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Group, Layer, Rect, Stage, Transformer } from 'react-konva'

import { AppIcon, Icons } from './lib/icons'
import { isTypingTarget } from './lib/domEvents'
import { MATERIAL_PRESETS, DEFAULT_MATERIAL } from './lib/materialPresets'
import type { MaterialPreset } from './lib/materialPresets'
import { useImageAsset } from './hooks/useImageAsset'
import {
  getEffectiveFocusGroupId,
  getEffectiveInteractionMode,
  getFocusScopeContainerId,
  getSubtreeIds,
} from './lib/editorTree'
import { getBoundsForNodes, getGuides, getLineGuideStops } from './lib/objectSnapping'
import { getNodeTransformPatch } from './lib/transformUtils'
import { EngravePreviewStack, ShapeRenderer } from './ShapeRenderer'
import { useCanvasState } from './hooks/useCanvasState'
import { useSelection } from './hooks/useSelection'
import { useEditorStore } from './store'
import type { MarqueeRect, ViewportState } from './types/editor'

interface Point {
  x: number
  y: number
}

interface MarqueeHighlight {
  id: string
  rect: MarqueeRect
}

interface CanvasProps {
  allowStageSelection?: boolean
  materialPreset?: MaterialPreset
  onMaterialChange?: (preset: MaterialPreset) => void
}

const GUIDELINE_OFFSET = 5
const GUIDELINE_NAME = 'snap-guideline'
const MIN_ARTBOARD_SIZE = 240
const MAX_ARTBOARD_SIZE = 2000
const MIN_SCALE = 0.25
const MAX_SCALE = 4
const WHEEL_SCALE_BY = 1.02

const isEmptyCanvasTarget = (target: Konva.Node): boolean => {
  const name = target.name?.() ?? ''
  return (
    target.getClassName() === 'Stage' ||
    target.getClassName() === 'Layer' ||
    name.includes('canvas-empty') ||
    name.includes('artboard-base')
  )
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum)

const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(scale.toFixed(4))))

const normalizeRect = (start: Point, end: Point): MarqueeRect => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
})

const intersects = (a: MarqueeRect, b: MarqueeRect): boolean =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y

const containsPoint = (rect: MarqueeRect, point: Point): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height

const getNodeScreenRect = (node: Konva.Node | null): MarqueeRect | null => {
  if (!node) {
    return null
  }

  const box = node.getClientRect({ skipShadow: true, skipStroke: false })
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  }
}

const scaleViewportFromAnchor = (
  viewport: ViewportState,
  nextScale: number,
  anchor: Point,
): ViewportState => {
  const clampedScale = clampScale(nextScale)
  if (Math.abs(clampedScale - viewport.scale) < 0.0001) {
    return viewport
  }

  const anchorInScene = {
    x: (anchor.x - viewport.x) / viewport.scale,
    y: (anchor.y - viewport.y) / viewport.scale,
  }

  return {
    scale: clampedScale,
    x: anchor.x - anchorInScene.x * clampedScale,
    y: anchor.y - anchorInScene.y * clampedScale,
  }
}

export function Canvas({ allowStageSelection = false, materialPreset = DEFAULT_MATERIAL }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setContainerSize({ width: Math.max(400, width), height: Math.max(300, height) })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const stageSize = containerSize
  const { artboardRect, marquee, nodesById, rootIds } = useCanvasState(containerSize)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const selectedStage = useEditorStore((state) => state.selectedStage)
  const focusGroupId = useEditorStore((state) => state.focusGroupId)
  const interactionMode = useEditorStore((state) => state.interactionMode)
  const directSelectionModifierActive = useEditorStore(
    (state) => state.directSelectionModifierActive,
  )
  const viewport = useEditorStore((state) => state.viewport)
  const pendingImport = useEditorStore((state) => state.ui.pendingImport)
  const toolDiameter = useEditorStore((state) => state.machiningSettings.toolDiameter)
  const defaultDepthMm = useEditorStore((state) => state.machiningSettings.defaultDepthMm)
  const setViewport = useEditorStore((state) => state.setViewport)
  const resetViewport = useEditorStore((state) => state.resetViewport)
  const setMarquee = useEditorStore((state) => state.setMarquee)
  const clearSelection = useEditorStore((state) => state.clearSelection)
  const clearFocusGroup = useEditorStore((state) => state.clearFocusGroup)
  const setIsTransforming = useEditorStore((state) => state.setIsTransforming)
  const setArtboardSize = useEditorStore((state) => state.setArtboardSize)
  const updateNodeTransform = useEditorStore((state) => state.updateNodeTransform)
  const duplicateInPlace = useEditorStore((state) => state.duplicateInPlace)
  const pushHistory = useEditorStore((state) => state.pushHistory)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const canUndo = useEditorStore((state) => state.history.past.length > 0)
  const canRedo = useEditorStore((state) => state.history.future.length > 0)
  const placePendingImport = useEditorStore((state) => state.placePendingImport)
  const setInteractionMode = useEditorStore((state) => state.setInteractionMode)
  const { getMarqueeCandidateIds, selectMany, selectStage, selectableIds } = useSelection()
  const stageRef = useRef<Konva.Stage | null>(null)
  const artboardRef = useRef<Konva.Rect | null>(null)
  const guideLayerRef = useRef<Konva.Layer | null>(null)
  const transformerRef = useRef<Konva.Transformer | null>(null)
  const artboardTargetRef = useRef<Konva.Rect | null>(null)
  const nodeRefs = useRef(new Map<string, Konva.Node>())
  const dragStartPositions = useRef<Record<string, { x: number; y: number }>>({})
  const isAltKeyDownRef = useRef(false)
  const isDuplicateDragRef = useRef(false)
  const marqueeStartRef = useRef<Point | null>(null)
  const marqueeRectRef = useRef<MarqueeRect | null>(null)
  const didMarqueeDragRef = useRef(false)
  const justFinishedMarqueeRef = useRef(false)
  const justFinishedPanRef = useRef(false)
  const panPointerRef = useRef<Point | null>(null)
  const panResetTimeoutRef = useRef<number | null>(null)
  const isPanningRef = useRef(false)
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [panToolActive, setPanToolActive] = useState(false)
  const [showOutlines, setShowOutlines] = useState(true)
  const [showEngravePreview, setShowEngravePreview] = useState(false)
  const [isZoomEditing, setIsZoomEditing] = useState(false)
  const [zoomDraft, setZoomDraft] = useState('')
  const zoomInputRef = useRef<HTMLInputElement | null>(null)
  const presetDef = MATERIAL_PRESETS.find((p) => p.id === materialPreset) ?? MATERIAL_PRESETS[0]
  const woodTexture = useImageAsset(presetDef.textureSrc)
  const effectiveFocusGroupId = getEffectiveFocusGroupId(
    focusGroupId,
    interactionMode,
    directSelectionModifierActive,
  )
  const focusScopeContainerId = getFocusScopeContainerId(effectiveFocusGroupId, nodesById)

  const interactionBlocked = isSpacePressed || isPanning || panToolActive
  const zoomPercent = Math.round(viewport.scale * 100)

  const registerNodeRef = (nodeId: string, node: Konva.Node | null) => {
    if (node) {
      nodeRefs.current.set(nodeId, node)
      return
    }

    nodeRefs.current.delete(nodeId)
  }

  const clearSnapGuides = () => {
    const guideLayer = guideLayerRef.current
    if (!guideLayer) {
      return
    }

    guideLayer.find(`.${GUIDELINE_NAME}`).forEach((line) => line.destroy())
    guideLayer.batchDraw()
  }

  const getMarqueeHitHighlights = useCallback(
    (currentMarquee: MarqueeRect): MarqueeHighlight[] =>
      getMarqueeCandidateIds().flatMap((nodeId) => {
        const node = nodeRefs.current.get(nodeId)
        if (!node || !node.isVisible()) {
          return []
        }

        const rect = getNodeScreenRect(node)
        if (!rect || !intersects(currentMarquee, rect)) {
          return []
        }

        return [{ id: nodeId, rect }]
      }),
    [getMarqueeCandidateIds],
  )

  const [marqueeHighlights, setMarqueeHighlights] = useState<MarqueeHighlight[]>([])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setMarqueeHighlights(marquee ? getMarqueeHitHighlights(marquee) : [])
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [getMarqueeHitHighlights, marquee])

  const queuePanClickSuppressionReset = () => {
    if (panResetTimeoutRef.current !== null) {
      window.clearTimeout(panResetTimeoutRef.current)
    }

    panResetTimeoutRef.current = window.setTimeout(() => {
      justFinishedPanRef.current = false
      panResetTimeoutRef.current = null
    }, 0)
  }

  const drawSnapGuides = (
    guides: ReturnType<typeof getGuides>,
    scopeRect: MarqueeRect,
  ) => {
    const guideLayer = guideLayerRef.current
    if (!guideLayer) {
      return
    }

    clearSnapGuides()

    guides.forEach((guide) => {
      const line =
        guide.orientation === 'H'
          ? new Konva.Line({
              points: [
                scopeRect.x,
                guide.lineGuide,
                scopeRect.x + scopeRect.width,
                guide.lineGuide,
              ],
              stroke: 'rgb(0, 161, 255)',
              strokeWidth: 1,
              name: GUIDELINE_NAME,
              dash: [4, 6],
              listening: false,
            })
          : new Konva.Line({
              points: [
                guide.lineGuide,
                scopeRect.y,
                guide.lineGuide,
                scopeRect.y + scopeRect.height,
              ],
              stroke: 'rgb(0, 161, 255)',
              strokeWidth: 1,
              name: GUIDELINE_NAME,
              dash: [4, 6],
              listening: false,
            })

      guideLayer.add(line)
    })

    guideLayer.batchDraw()
  }

  const screenToScene = (point: Point): Point => ({
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  })

  const zoomAroundPoint = (nextScale: number, anchor: Point) => {
    const currentViewport = useEditorStore.getState().viewport
    const nextViewport = scaleViewportFromAnchor(currentViewport, nextScale, anchor)
    if (
      nextViewport.scale === currentViewport.scale &&
      nextViewport.x === currentViewport.x &&
      nextViewport.y === currentViewport.y
    ) {
      return
    }

    setViewport(nextViewport)
  }

  const startPan = (event: MouseEvent) => {
    event.preventDefault()
    isPanningRef.current = true
    setIsPanning(true)
    justFinishedPanRef.current = false
    panPointerRef.current = { x: event.clientX, y: event.clientY }
    marqueeStartRef.current = null
    marqueeRectRef.current = null
    didMarqueeDragRef.current = false
    setMarquee(null)
  }

  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) {
      return
    }

    const artboardTarget = artboardTargetRef.current
    const nodes =
      selectedStage && allowStageSelection && artboardTarget
        ? [artboardTarget]
        : selectedIds
            .map((id) => nodeRefs.current.get(id))
            .filter((node): node is Konva.Node => Boolean(node))

    transformer.nodes(nodes)
    transformer.getLayer()?.batchDraw()
  }, [allowStageSelection, selectedIds, selectedStage, viewport.scale, viewport.x, viewport.y])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        isAltKeyDownRef.current = true
      }

      if (event.code !== 'Space' || isTypingTarget(event.target)) {
        return
      }

      event.preventDefault()
      setIsSpacePressed(true)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        isAltKeyDownRef.current = false
      }

      if (event.code !== 'Space') {
        return
      }

      setIsSpacePressed(false)
    }

    const onBlur = () => {
      isAltKeyDownRef.current = false
      setIsSpacePressed(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    const stopPan = () => {
      if (!isPanningRef.current) {
        return
      }

      isPanningRef.current = false
      setIsPanning(false)
      panPointerRef.current = null
      justFinishedPanRef.current = true
      queuePanClickSuppressionReset()
    }

    const onMouseMove = (event: MouseEvent) => {
      if (!isPanningRef.current) {
        return
      }

      event.preventDefault()

      const lastPointer = panPointerRef.current
      if (!lastPointer) {
        panPointerRef.current = { x: event.clientX, y: event.clientY }
        return
      }

      const dx = event.clientX - lastPointer.x
      const dy = event.clientY - lastPointer.y

      if (dx === 0 && dy === 0) {
        return
      }

      panPointerRef.current = { x: event.clientX, y: event.clientY }
      const currentViewport = useEditorStore.getState().viewport
      setViewport({
        x: currentViewport.x + dx,
        y: currentViewport.y + dy,
      })
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', stopPan)
    window.addEventListener('blur', stopPan)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stopPan)
      window.removeEventListener('blur', stopPan)
      if (panResetTimeoutRef.current !== null) {
        window.clearTimeout(panResetTimeoutRef.current)
      }
    }
  }, [setViewport])

  const syncArtboardTargetToState = (artboardTarget: Konva.Rect) => {
    const width = clamp(
      Math.round(artboardTarget.width() * artboardTarget.scaleX()),
      MIN_ARTBOARD_SIZE,
      MAX_ARTBOARD_SIZE,
    )
    const height = clamp(
      Math.round(artboardTarget.height() * artboardTarget.scaleY()),
      MIN_ARTBOARD_SIZE,
      MAX_ARTBOARD_SIZE,
    )
    const x = Math.round(artboardTarget.x())
    const y = Math.round(artboardTarget.y())

    artboardTarget.width(width)
    artboardTarget.height(height)
    artboardTarget.scaleX(1)
    artboardTarget.scaleY(1)

    setArtboardSize({
      width,
      height,
      x: x - Math.round((stageSize.width - width) / 2),
      y: y - Math.round((stageSize.height - height) / 2),
    })
  }

  const handleNodeDragStart = (nodeId: string) => {
    const ids = selectedIds.includes(nodeId) ? selectedIds : [nodeId]
    const positions: Record<string, { x: number; y: number }> = {}
    ids.forEach((id) => {
      const node = nodeRefs.current.get(id)
      if (node) {
        positions[id] = { x: node.x(), y: node.y() }
      }
    })
    dragStartPositions.current = positions
    pushHistory()
    isDuplicateDragRef.current = isAltKeyDownRef.current
    if (isDuplicateDragRef.current) {
      duplicateInPlace()
    }
    clearSnapGuides()
  }

  const handleNodeDragMove = (nodeId: string, konvaNode: Konva.Node) => {
    if (selectedIds.length > 1) {
      const startPos = dragStartPositions.current[nodeId]
      if (!startPos) {
        return
      }

      const dx = konvaNode.x() - startPos.x
      const dy = konvaNode.y() - startPos.y

      selectedIds.forEach((id) => {
        if (id === nodeId) {
          return
        }

        const otherNode = nodeRefs.current.get(id)
        const otherStart = dragStartPositions.current[id]
        if (otherNode && otherStart) {
          otherNode.x(otherStart.x + dx)
          otherNode.y(otherStart.y + dy)
          updateNodeTransform(id, { x: otherStart.x + dx, y: otherStart.y + dy })
        }
      })
    }

    applyObjectSnapping(nodeId)
    updateNodeTransform(nodeId, { x: konvaNode.x(), y: konvaNode.y() })
  }

  const handleNodeDragEnd = (nodeId: string, konvaNode: Konva.Node) => {
    clearSnapGuides()
    isDuplicateDragRef.current = false

    if (selectedIds.length <= 1) {
      updateNodeTransform(nodeId, { x: konvaNode.x(), y: konvaNode.y() })
    } else {
      selectedIds.forEach((id) => {
        const node = nodeRefs.current.get(id)
        if (node) {
          updateNodeTransform(id, { x: node.x(), y: node.y() })
        }
      })
    }

    dragStartPositions.current = {}
  }

  const getFocusScopeRect = (): MarqueeRect => {
    const artboardScopeRect = getNodeScreenRect(artboardRef.current) ?? artboardRect
    if (!effectiveFocusGroupId || !focusScopeContainerId) {
      return artboardScopeRect
    }

    return getNodeScreenRect(nodeRefs.current.get(focusScopeContainerId) ?? null) ?? artboardScopeRect
  }

  const applyObjectSnapping = (nodeId: string) => {
    const movingIds = selectedIds.includes(nodeId) ? selectedIds : [nodeId]
    const movingNodes = movingIds
      .map((id) => nodeRefs.current.get(id))
      .filter((node): node is Konva.Node => Boolean(node))

    if (movingNodes.length === 0) {
      clearSnapGuides()
      return
    }

    const movingBounds = getBoundsForNodes(movingNodes)
    if (!movingBounds) {
      clearSnapGuides()
      return
    }

    const excludedIds = new Set(movingIds.flatMap((id) => getSubtreeIds(id, nodesById)))
    const guideNodes = selectableIds
      .filter((id) => !excludedIds.has(id))
      .map((id) => nodeRefs.current.get(id))
      .filter((node): node is Konva.Node => node != null)
      .filter((node) => node.isVisible())

    const scopeRect = getFocusScopeRect()
    const guides = getGuides(
      getLineGuideStops(scopeRect, guideNodes),
      movingBounds,
      GUIDELINE_OFFSET,
    )

    if (guides.length === 0) {
      clearSnapGuides()
      return
    }

    const delta = guides.reduce(
      (result, guide) => ({
        x: guide.orientation === 'V' ? guide.delta : result.x,
        y: guide.orientation === 'H' ? guide.delta : result.y,
      }),
      { x: 0, y: 0 },
    )

    movingNodes.forEach((node) => {
      const absolutePosition = node.absolutePosition()
      node.absolutePosition({
        x: absolutePosition.x + delta.x,
        y: absolutePosition.y + delta.y,
      })
    })

    drawSnapGuides(guides, scopeRect)
  }

  const finishMarqueeSelection = (additive: boolean) => {
    const currentMarquee = marqueeRectRef.current
    if (!currentMarquee || currentMarquee.width < 3 || currentMarquee.height < 3) {
      marqueeRectRef.current = null
      setMarquee(null)
      marqueeStartRef.current = null
      didMarqueeDragRef.current = false
      return
    }

    const hits = getMarqueeHitHighlights(currentMarquee).map(({ id }) => id)

    if (hits.length === 0 && !additive) {
      clearSelection()
    } else if (additive) {
      selectMany(Array.from(new Set([...selectedIds, ...hits])))
    } else {
      selectMany(hits)
    }

    justFinishedMarqueeRef.current = true
    marqueeRectRef.current = null
    setMarquee(null)
    marqueeStartRef.current = null
    didMarqueeDragRef.current = false
  }

  const onPointerDown = (event: KonvaEventObject<MouseEvent>) => {
    if (event.evt.button === 1 || (event.evt.button === 0 && (isSpacePressed || panToolActive))) {
      startPan(event.evt)
      return
    }

    const stage = stageRef.current
    if (
      interactionBlocked ||
      !stage ||
      event.evt.button !== 0 ||
      pendingImport ||
      !isEmptyCanvasTarget(event.target)
    ) {
      return
    }

    const position = stage.getPointerPosition()
    if (!position) {
      return
    }

    marqueeStartRef.current = position
    marqueeRectRef.current = { x: position.x, y: position.y, width: 0, height: 0 }
    didMarqueeDragRef.current = false
    setMarquee({ x: position.x, y: position.y, width: 0, height: 0 })
  }

  const onPointerMove = () => {
    const stage = stageRef.current
    if (!stage || pendingImport || !marqueeStartRef.current || interactionBlocked) {
      return
    }

    const position = stage.getPointerPosition()
    if (!position) {
      return
    }

    const newMarquee = normalizeRect(marqueeStartRef.current, position)
    marqueeRectRef.current = newMarquee
    setMarquee(newMarquee)
    didMarqueeDragRef.current = true
  }

  const onPointerUp = (event: KonvaEventObject<MouseEvent>) => {
    if (pendingImport || !marqueeStartRef.current) {
      return
    }

    const additive = event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey
    if (!didMarqueeDragRef.current) {
      setMarquee(null)
      marqueeStartRef.current = null
      if (!additive) {
        clearSelection()
      }
      return
    }

    finishMarqueeSelection(additive)
  }

  const onStageClick = (event: KonvaEventObject<MouseEvent>) => {
    if (justFinishedPanRef.current) {
      return
    }

    const stage = stageRef.current
    const position = stage?.getPointerPosition()

    if (pendingImport) {
      if (!position) {
        return
      }

      const scenePosition = screenToScene(position)
      if (!containsPoint(artboardRect, scenePosition)) {
        return
      }

      const minX = artboardRect.x
      const maxX = artboardRect.x + artboardRect.width - pendingImport.width
      const minY = artboardRect.y
      const maxY = artboardRect.y + artboardRect.height - pendingImport.height

      placePendingImport({
        x: clamp(scenePosition.x - pendingImport.width / 2, minX, Math.max(minX, maxX)),
        y: clamp(scenePosition.y - pendingImport.height / 2, minY, Math.max(minY, maxY)),
      })
      return
    }

    if (interactionBlocked || !isEmptyCanvasTarget(event.target)) {
      return
    }

    if (justFinishedMarqueeRef.current) {
      justFinishedMarqueeRef.current = false
      return
    }

    const additiveSelectionPressed =
      event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey

    if (effectiveFocusGroupId) {
      if (!position || !containsPoint(getFocusScopeRect(), position)) {
        clearFocusGroup()
        if (allowStageSelection && !additiveSelectionPressed) {
          selectStage()
        }
        return
      }

      if (!additiveSelectionPressed && !marqueeStartRef.current) {
        clearSelection()
      }

      return
    }

    if (!additiveSelectionPressed && !marqueeStartRef.current) {
      if (allowStageSelection) {
        selectStage()
      } else {
        clearSelection()
      }
    }
  }

  const onTransformStart = () => {
    pushHistory()
    clearSnapGuides()
    setIsTransforming(true)
  }

  const onTransformEnd = () => {
    if (selectedStage && allowStageSelection) {
      const artboardTarget = artboardTargetRef.current
      if (artboardTarget) {
        syncArtboardTargetToState(artboardTarget)
      }

      setIsTransforming(false)
      return
    }

    const selectedNodeRefs = selectedIds
      .map((id) => nodeRefs.current.get(id))
      .filter((node): node is Konva.Node => Boolean(node))

    selectedNodeRefs.forEach((node, index) => {
      const nodeId = selectedIds[index]
      if (!nodeId) {
        return
      }

      const nodeDefinition = nodesById[nodeId]
      if (!nodeDefinition) {
        return
      }

      updateNodeTransform(nodeId, getNodeTransformPatch(nodeDefinition, node))

      if (nodeDefinition.type !== 'group') {
        node.scaleX(1)
        node.scaleY(1)
      }
    })

    setIsTransforming(false)
  }

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    if (isPanningRef.current) {
      return
    }

    event.evt.preventDefault()

    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!pointer) {
      return
    }

    const currentViewport = useEditorStore.getState().viewport
    let zoomDirection = event.evt.deltaY > 0 ? -1 : 1
    if (event.evt.ctrlKey) {
      zoomDirection = -zoomDirection
    }

    const nextScale =
      zoomDirection > 0
        ? currentViewport.scale * WHEEL_SCALE_BY
        : currentViewport.scale / WHEEL_SCALE_BY

    zoomAroundPoint(nextScale, pointer)
  }

  const beginZoomEdit = () => {
    setZoomDraft(String(Math.round(viewport.scale * 100)))
    setIsZoomEditing(true)
  }

  const cancelZoomEdit = () => {
    setIsZoomEditing(false)
    setZoomDraft('')
  }

  const applyZoomDraft = () => {
    const normalized = zoomDraft.replace(',', '.').trim()
    if (!normalized) {
      cancelZoomEdit()
      return
    }
    const parsed = parseFloat(normalized)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      cancelZoomEdit()
      return
    }
    zoomAroundPoint(parsed / 100, { x: stageSize.width / 2, y: stageSize.height / 2 })
    setIsZoomEditing(false)
    setZoomDraft('')
  }

  useEffect(() => {
    if (isZoomEditing) {
      zoomInputRef.current?.select()
    }
  }, [isZoomEditing])

  const effectiveInteractionMode = getEffectiveInteractionMode(
    interactionMode,
    directSelectionModifierActive,
  )

  const cursor = isPanning || panToolActive ? (isPanning ? 'grabbing' : 'grab') : isSpacePressed ? 'grab' : 'default'

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-background"
      style={{ cursor }}
    >
      {/* Dot grid background */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:32px_32px]" />

      {/* Bottom floating toolbar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-7 z-20 flex justify-center px-6">
        <div className="pointer-events-auto flex items-center gap-2 rounded-[1.75rem] border border-white/10 bg-[rgba(19,19,23,0.9)] px-4 py-3 text-white shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
          {/* Direct selection toggle */}
          <button
            type="button"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${effectiveInteractionMode === 'direct' ? 'bg-white/[0.14] text-white' : 'text-white/75 hover:text-white'}`}
            onClick={() => setInteractionMode(interactionMode === 'direct' ? 'group' : 'direct')}
            title="Direct selection (D)"
          >
            <AppIcon icon={Icons.cursor} className="h-5 w-5" />
          </button>

          {/* Pan tool toggle */}
          <button
            type="button"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${panToolActive ? 'bg-white/[0.14] text-white' : 'text-white/75 hover:text-white'}`}
            onClick={() => setPanToolActive((v) => !v)}
            title="Pan (H)"
          >
            <AppIcon icon={Icons.hand} className="h-5 w-5" />
          </button>

          {/* Outlines toggle */}
          <button
            type="button"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${showOutlines ? 'bg-white/[0.14] text-white' : 'text-white/75 hover:text-white'}`}
            onClick={() => setShowOutlines((v) => !v)}
            title="Toggle CNC outlines"
          >
            <AppIcon icon={showOutlines ? Icons.eye : Icons.eyeOff} className="h-5 w-5" />
          </button>

          {/* Engrave preview toggle */}
          <button
            type="button"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${showEngravePreview ? 'bg-white/[0.14] text-white' : 'text-white/75 hover:text-white'}`}
            onClick={() => setShowEngravePreview((v) => !v)}
            title="Engrave preview — simulates routed pockets on wood"
          >
            <AppIcon icon={Icons.engravePreview} className="h-5 w-5" />
          </button>

          {/* Undo / Redo */}
          <div className="mx-1 h-6 w-px bg-white/10" />
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition text-white/75 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"
            disabled={!canUndo}
            onClick={() => undo()}
            title="Undo (⌘Z)"
          >
            <AppIcon icon={Icons.undo} className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition text-white/75 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"
            disabled={!canRedo}
            onClick={() => redo()}
            title="Redo (⌘⇧Z)"
          >
            <AppIcon icon={Icons.redo} className="h-5 w-5" />
          </button>

          {/* Zoom controls */}
          <div className="ml-2 flex items-center gap-3 rounded-[1.2rem] bg-white/[0.05] px-4 py-2">
            <button
              type="button"
              className="text-white/72 hover:text-white disabled:opacity-40"
              disabled={viewport.scale <= MIN_SCALE}
              onClick={(e) => {
                e.stopPropagation()
                if (isZoomEditing) cancelZoomEdit()
                zoomAroundPoint(viewport.scale / 1.15, { x: stageSize.width / 2, y: stageSize.height / 2 })
              }}
              aria-label="Zoom out"
            >
              <AppIcon icon={Icons.minus} className="h-4 w-4" />
            </button>

            {isZoomEditing ? (
              <div className="flex min-w-14 items-center justify-center text-[1rem] text-white">
                <input
                  ref={zoomInputRef}
                  inputMode="decimal"
                  aria-label="Zoom percentage"
                  className="w-12 border-none bg-transparent text-center text-white outline-none"
                  value={zoomDraft}
                  onChange={(e) => setZoomDraft(e.target.value)}
                  onBlur={applyZoomDraft}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') { e.preventDefault(); applyZoomDraft() }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelZoomEdit() }
                  }}
                />
                <span className="pl-1 text-white/72">%</span>
              </div>
            ) : (
              <button
                type="button"
                className="min-w-14 text-center text-[1rem] text-white"
                onClick={(e) => { e.stopPropagation(); beginZoomEdit() }}
              >
                {zoomPercent}%
              </button>
            )}

            <button
              type="button"
              className="text-white/72 hover:text-white disabled:opacity-40"
              disabled={viewport.scale >= MAX_SCALE}
              onClick={(e) => {
                e.stopPropagation()
                if (isZoomEditing) cancelZoomEdit()
                zoomAroundPoint(viewport.scale * 1.15, { x: stageSize.width / 2, y: stageSize.height / 2 })
              }}
              aria-label="Zoom in"
            >
              <AppIcon icon={Icons.plus} className="h-4 w-4" />
            </button>
          </div>

          {/* Fit button */}
          <button
            type="button"
            className="min-w-12 px-3 font-medium uppercase tracking-[0.08em] text-white/80 hover:text-white"
            onClick={() => {
              if (isZoomEditing) cancelZoomEdit()
              resetViewport()
            }}
          >
            Fit
          </button>
        </div>
      </div>

      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        className="!cursor-inherit"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onClick={onStageClick}
        onWheel={handleWheel}
      >
        <Layer>
          <Rect
            name="canvas-empty stage-backdrop"
            x={0}
            y={0}
            width={stageSize.width}
            height={stageSize.height}
            fill="rgba(0,0,0,0)"
          />
        </Layer>

        <Layer x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale}>
          {allowStageSelection && selectedStage ? (
            <Rect
              ref={artboardTargetRef}
              x={artboardRect.x}
              y={artboardRect.y}
              width={artboardRect.width}
              height={artboardRect.height}
              fill="rgba(255, 255, 255, 0.01)"
              draggable={!pendingImport && !interactionBlocked}
              onMouseDown={(event) => {
                event.cancelBubble = true
              }}
              onTouchStart={(event) => {
                event.cancelBubble = true
              }}
              onClick={(event) => {
                event.cancelBubble = true
              }}
              onTap={(event) => {
                event.cancelBubble = true
              }}
              onDragStart={(event) => {
                event.cancelBubble = true
                setIsTransforming(true)
              }}
              onDragMove={(event) => {
                event.cancelBubble = true
                syncArtboardTargetToState(event.target as Konva.Rect)
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true
                syncArtboardTargetToState(event.target as Konva.Rect)
                setIsTransforming(false)
              }}
              onTransform={(event) => {
                event.cancelBubble = true
                syncArtboardTargetToState(event.target as Konva.Rect)
              }}
            />
          ) : null}

          <Group x={artboardRect.x} y={artboardRect.y}>
            <Rect
              ref={artboardRef}
              name="canvas-empty artboard-base"
              x={0}
              y={0}
              width={artboardRect.width}
              height={artboardRect.height}
              fill={woodTexture ? undefined : '#6a4b33'}
              fillPatternImage={woodTexture ?? undefined}
              fillPatternRepeat="repeat"
              fillPatternScaleX={presetDef.textureScale}
              fillPatternScaleY={presetDef.textureScale}
              stroke={selectedStage ? 'rgba(115,187,255,0.95)' : 'rgba(132,94,62,0.55)'}
              strokeWidth={selectedStage ? 1.4 / viewport.scale : 1 / viewport.scale}
              cornerRadius={2 / viewport.scale}
              shadowColor="rgba(0,0,0,0.35)"
              shadowBlur={24}
              shadowOffsetY={8}
            />

            {effectiveFocusGroupId && focusScopeContainerId ? (
              <Rect
                name="canvas-empty focus-overlay"
                x={0}
                y={0}
                width={artboardRect.width}
                height={artboardRect.height}
                fill="rgba(20, 14, 9, 0.35)"
                listening={false}
              />
            ) : null}

            {showEngravePreview
              ? (
                <EngravePreviewStack
                  rootIds={rootIds}
                  defaultDepth={defaultDepthMm}
                  toolDiameter={toolDiameter}
                  registerNodeRef={registerNodeRef}
                  interactionBlocked={interactionBlocked}
                  showCncOverrides={showOutlines}
                  onNodeDragStart={handleNodeDragStart}
                  onNodeDragMove={handleNodeDragMove}
                  onNodeDragEnd={handleNodeDragEnd}
                />
              )
              : rootIds.map((nodeId) => (
                <ShapeRenderer
                  key={nodeId}
                  nodeId={nodeId}
                  registerNodeRef={registerNodeRef}
                  interactionBlocked={interactionBlocked}
                  showCncOverrides={showOutlines}
                  onNodeDragStart={handleNodeDragStart}
                  onNodeDragMove={handleNodeDragMove}
                  onNodeDragEnd={handleNodeDragEnd}
                />
              ))}
          </Group>

          <Transformer
            ref={transformerRef}
            rotateEnabled={!selectedStage}
            flipEnabled={false}
            boundBoxFunc={(oldBox, newBox) => {
              const minSize =
                selectedStage && allowStageSelection ? MIN_ARTBOARD_SIZE : 8
              const maxSize =
                selectedStage && allowStageSelection ? MAX_ARTBOARD_SIZE : Number.POSITIVE_INFINITY

              if (
                Math.abs(newBox.width) < minSize ||
                Math.abs(newBox.height) < minSize ||
                Math.abs(newBox.width) > maxSize ||
                Math.abs(newBox.height) > maxSize
              ) {
                return oldBox
              }

              return newBox
            }}
            anchorStroke="#9a3412"
            anchorFill="#fff7ed"
            borderStroke="#ea580c"
            borderDash={[5, 4]}
            onTransformStart={onTransformStart}
            onTransformEnd={onTransformEnd}
          />
        </Layer>

        <Layer ref={guideLayerRef} listening={false}>
          {marqueeHighlights.map(({ id, rect }) => (
            <Rect
              key={id}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              stroke="#1a73e8"
              strokeWidth={1.5}
              cornerRadius={4}
              dash={[4, 3]}
              shadowColor="rgba(26, 115, 232, 0.22)"
              shadowBlur={8}
              listening={false}
            />
          ))}
          {marquee ? (
            <Rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.width}
              height={marquee.height}
              fill="rgba(56,189,248,0.15)"
              stroke="#38bdf8"
              strokeWidth={1}
              dash={[6, 4]}
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
    </div>
  )
}
