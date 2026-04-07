import { useMemo } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Circle, Group, Line, Path, Rect } from 'react-konva'

import {
  getEffectiveFocusGroupId,
  getEffectiveInteractionMode,
  getFocusRenderMode,
  resolveSelectionTarget,
} from './lib/editorTree'
import {
  buildDepthPreviewPlan,
} from './lib/booleanUnion'
import {
  getCncVisualOverrides,
  getEngravePreviewFill,
  getEngravePreviewStroke,
  isOpenPathNode,
} from './lib/cncVisuals'
import { useSelection } from './hooks/useSelection'
import { useEditorStore } from './store'
import type { CanvasNode, CncMetadata, GroupNode, PathNode } from './types/editor'

export interface ShapeRendererProps {
  nodeId: string
  registerNodeRef: (nodeId: string, node: Konva.Node | null) => void
  parentDimmed?: boolean
  interactionBlocked?: boolean
  showCncOverrides?: boolean
  outlineOnly?: boolean
  hitboxOnly?: boolean
  parentCncMetadata?: CncMetadata
  onNodeDragStart?: (nodeId: string, konvaNode: Konva.Node) => void
  onNodeDragMove?: (nodeId: string, konvaNode: Konva.Node) => void
  onNodeDragEnd?: (nodeId: string, konvaNode: Konva.Node) => void
}

interface SharedShapeProps {
  node: CanvasNode
  opacity: number
  listening: boolean
  draggable: boolean
  isSelected: boolean
  showCncOverrides?: boolean
  outlineOnly?: boolean
  hitboxOnly?: boolean
  parentCncMetadata?: CncMetadata
  toolDiameter?: number
  registerNodeRef: (nodeId: string, node: Konva.Node | null) => void
  onPointerDown: (event: KonvaEventObject<MouseEvent | TouchEvent>) => void
  onClick: (event: KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDoubleClick: (event: KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragStart: (event: KonvaEventObject<DragEvent>) => void
  onDragMove: (event: KonvaEventObject<DragEvent>) => void
  onDragEnd: (event: KonvaEventObject<DragEvent>) => void
}

function SvgPathNode({
  node,
  opacity,
  listening,
  draggable,
  isSelected,
  showCncOverrides,
  outlineOnly,
  parentCncMetadata,
  toolDiameter,
  registerNodeRef,
  onPointerDown,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragMove,
  onDragEnd,
}: SharedShapeProps & { node: PathNode }) {
  const cncOverrides = showCncOverrides !== false
    ? getCncVisualOverrides(node.cncMetadata, parentCncMetadata)
    : {}
  const isOpenPath = toolDiameter != null && isOpenPathNode(node)
  const useCncStroke = isOpenPath && showCncOverrides !== false
  const baseStrokeWidth = useCncStroke ? toolDiameter! : node.strokeWidth
  const baseStroke = useCncStroke && !node.stroke ? 'rgba(30, 20, 10, 0.65)' : node.stroke
  const visualProps = Object.assign(
    { fill: outlineOnly ? '' : node.fill, stroke: baseStroke, strokeWidth: baseStrokeWidth },
    cncOverrides,
  )
  if (outlineOnly) {
    delete visualProps.fill
  }

  return (
    <Path
      ref={(instance) => registerNodeRef(node.id, instance)}
      x={node.x}
      y={node.y}
      data={node.data}
      rotation={node.rotation}
      scaleX={node.scaleX}
      scaleY={node.scaleY}
      draggable={draggable}
      visible={node.visible}
      opacity={opacity}
      listening={listening}
      hitStrokeWidth={Math.max((baseStrokeWidth ?? 2) * 2, 12)}
      shadowColor={isSelected ? '#73bbff' : undefined}
      shadowBlur={isSelected ? 10 : 0}
      {...visualProps}
      onMouseDown={onPointerDown}
      onTouchStart={onPointerDown}
      onClick={onClick}
      onTap={onClick}
      onDblClick={onDoubleClick}
      onDblTap={onDoubleClick}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    />
  )
}

export function ShapeRenderer({
  nodeId,
  registerNodeRef,
  parentDimmed = false,
  interactionBlocked = false,
  showCncOverrides = true,
  outlineOnly = false,
  hitboxOnly = false,
  parentCncMetadata,
  onNodeDragStart,
  onNodeDragMove,
  onNodeDragEnd,
}: ShapeRendererProps) {
  const node = useEditorStore((state) => state.nodesById[nodeId])
  const nodesById = useEditorStore((state) => state.nodesById)
  const focusGroupId = useEditorStore((state) => state.focusGroupId)
  const interactionMode = useEditorStore((state) => state.interactionMode)
  const directSelectionModifierActive = useEditorStore((state) => state.directSelectionModifierActive)
  const pendingImport = useEditorStore((state) => state.ui.pendingImport)
  const toolDiameter = useEditorStore((state) => state.machiningSettings.toolDiameter)
  const updateNodeTransform = useEditorStore((state) => state.updateNodeTransform)
  const { enterFocusMode, isSelected, selectNode } = useSelection()

  if (!node || !node.visible) {
    return null
  }

  const activeInteractionMode = getEffectiveInteractionMode(interactionMode, directSelectionModifierActive)
  const effectiveFocusGroupId = getEffectiveFocusGroupId(
    focusGroupId,
    interactionMode,
    directSelectionModifierActive,
  )
  const effectiveRenderMode = getFocusRenderMode(nodeId, effectiveFocusGroupId, nodesById)
  const isDimmed = parentDimmed || effectiveRenderMode === 'dimmed'
  const opacity = hitboxOnly ? 0 : (isDimmed ? node.opacity * 0.22 : node.opacity)
  const resolvedSelectionTarget = resolveSelectionTarget(
    node.id,
    nodesById,
    effectiveFocusGroupId,
    activeInteractionMode,
  )

  const listening = !pendingImport && !isDimmed
  const isDirectlyInteractive =
    activeInteractionMode === 'direct' || resolvedSelectionTarget === node.id
  const draggable =
    listening &&
    !interactionBlocked &&
    isDirectlyInteractive &&
    node.draggable &&
    !node.locked &&
    !(activeInteractionMode === 'direct' && node.type === 'group')

  const onPointerDown = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!listening || interactionBlocked) return
    if ('button' in event.evt && event.evt.button !== 0) return
    if (!isDirectlyInteractive) return

    const additive = 'shiftKey' in event.evt ? event.evt.shiftKey || event.evt.ctrlKey : false
    if (!additive && isSelected(resolvedSelectionTarget)) {
      event.cancelBubble = true
      return
    }

    selectNode(node.id, additive)
    event.cancelBubble = true
  }

  const onClick = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!listening || !isDirectlyInteractive || interactionBlocked) return
    if ('button' in event.evt && event.evt.button !== 0) return
    event.cancelBubble = true
  }

  const onDoubleClick = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!listening || !isDirectlyInteractive || interactionBlocked) return
    if ('button' in event.evt && event.evt.button !== 0) return
    event.cancelBubble = true
    if (activeInteractionMode === 'direct') return
    enterFocusMode(node.id)
  }

  const onDragStart = (event: KonvaEventObject<DragEvent>) => {
    event.cancelBubble = true
    onNodeDragStart?.(node.id, event.target as Konva.Node)
  }

  const onDragMove = (event: KonvaEventObject<DragEvent>) => {
    event.cancelBubble = true
    onNodeDragMove?.(node.id, event.target as Konva.Node)
  }

  const onDragEnd = (event: KonvaEventObject<DragEvent>) => {
    event.cancelBubble = true
    if (onNodeDragEnd) {
      onNodeDragEnd(node.id, event.target as Konva.Node)
      return
    }

    updateNodeTransform(node.id, { x: event.target.x(), y: event.target.y() })
  }

  const commonProps = {
    node,
    opacity,
    listening,
    draggable,
    isSelected: isSelected(node.id),
    showCncOverrides,
    outlineOnly,
    hitboxOnly,
    parentCncMetadata,
    toolDiameter,
    registerNodeRef,
    onPointerDown,
    onClick,
    onDoubleClick,
    onDragStart,
    onDragMove,
    onDragEnd,
  }

  if (node.type === 'group') {
    const groupNode = node as GroupNode

    return (
      <Group
        ref={(instance) => registerNodeRef(node.id, instance)}
        x={groupNode.x}
        y={groupNode.y}
        rotation={groupNode.rotation}
        scaleX={groupNode.scaleX}
        scaleY={groupNode.scaleY}
        draggable={draggable}
        visible={groupNode.visible}
        opacity={opacity}
        listening={listening}
        onMouseDown={onPointerDown}
        onTouchStart={onPointerDown}
        onClick={onClick}
        onTap={onClick}
        onDblClick={onDoubleClick}
        onDblTap={onDoubleClick}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      >
        {groupNode.childIds.map((childId) => (
          <ShapeRenderer
            key={childId}
            nodeId={childId}
            registerNodeRef={registerNodeRef}
            parentDimmed={isDimmed}
            interactionBlocked={interactionBlocked}
            showCncOverrides={showCncOverrides}
            outlineOnly={outlineOnly}
            parentCncMetadata={groupNode.cncMetadata}
            onNodeDragStart={onNodeDragStart}
            onNodeDragMove={onNodeDragMove}
            onNodeDragEnd={onNodeDragEnd}
            hitboxOnly={hitboxOnly}
          />
        ))}
      </Group>
    )
  }

  if (node.type === 'rect') {
    const cncOverrides = showCncOverrides
      ? getCncVisualOverrides(node.cncMetadata, parentCncMetadata)
      : {}
    const visualProps = Object.assign(
      { fill: outlineOnly ? '' : node.fill, stroke: node.stroke, strokeWidth: node.strokeWidth },
      cncOverrides,
    )
    if (outlineOnly) delete visualProps.fill

    return (
      <Rect
        ref={(instance) => registerNodeRef(node.id, instance)}
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        cornerRadius={node.cornerRadius}
        rotation={node.rotation}
        scaleX={node.scaleX}
        scaleY={node.scaleY}
        draggable={draggable}
        visible={node.visible}
        opacity={opacity}
        listening={listening}
        shadowColor={commonProps.isSelected ? '#73bbff' : undefined}
        shadowBlur={commonProps.isSelected ? 10 : 0}
        {...visualProps}
        onMouseDown={onPointerDown}
        onTouchStart={onPointerDown}
        onClick={onClick}
        onTap={onClick}
        onDblClick={onDoubleClick}
        onDblTap={onDoubleClick}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      />
    )
  }

  if (node.type === 'circle') {
    const cncOverrides = showCncOverrides
      ? getCncVisualOverrides(node.cncMetadata, parentCncMetadata)
      : {}
    const visualProps = Object.assign(
      { fill: node.fill, stroke: node.stroke, strokeWidth: node.strokeWidth },
      cncOverrides,
    )

    return (
      <Circle
        ref={(instance) => registerNodeRef(node.id, instance)}
        x={node.x}
        y={node.y}
        radius={node.radius}
        rotation={node.rotation}
        scaleX={node.scaleX}
        scaleY={node.scaleY}
        draggable={draggable}
        visible={node.visible}
        opacity={opacity}
        listening={listening}
        shadowColor={commonProps.isSelected ? '#73bbff' : undefined}
        shadowBlur={commonProps.isSelected ? 10 : 0}
        {...visualProps}
        onMouseDown={onPointerDown}
        onTouchStart={onPointerDown}
        onClick={onClick}
        onTap={onClick}
        onDblClick={onDoubleClick}
        onDblTap={onDoubleClick}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      />
    )
  }

  if (node.type === 'line') {
    const cncOverrides = showCncOverrides
      ? getCncVisualOverrides(node.cncMetadata, parentCncMetadata)
      : {}
    const isOpenPath = toolDiameter != null && isOpenPathNode(node)
    const useCncStroke = isOpenPath && showCncOverrides
    const baseStrokeWidth = useCncStroke ? toolDiameter! : node.strokeWidth
    const baseStroke = useCncStroke && !node.stroke ? 'rgba(30, 20, 10, 0.65)' : node.stroke
    const visualProps = Object.assign(
      {
        stroke: baseStroke,
        strokeWidth: baseStrokeWidth,
        fill: node.fill,
        lineCap: useCncStroke ? 'round' : node.lineCap,
        lineJoin: useCncStroke ? 'round' : node.lineJoin,
      },
      cncOverrides,
    )
    const hitWidth = Math.max((baseStrokeWidth ?? 2) * 2, 12)

    return (
      <Line
        ref={(instance) => registerNodeRef(node.id, instance)}
        x={node.x}
        y={node.y}
        points={node.points}
        closed={node.closed}
        fillRule={node.fillRule}
        lineCap={node.lineCap}
        lineJoin={node.lineJoin}
        rotation={node.rotation}
        scaleX={node.scaleX}
        scaleY={node.scaleY}
        draggable={draggable}
        visible={node.visible}
        opacity={opacity}
        listening={listening}
        hitStrokeWidth={hitWidth}
        shadowColor={commonProps.isSelected ? '#73bbff' : undefined}
        shadowBlur={commonProps.isSelected ? 10 : 0}
        {...visualProps}
        onMouseDown={onPointerDown}
        onTouchStart={onPointerDown}
        onClick={onClick}
        onTap={onClick}
        onDblClick={onDoubleClick}
        onDblTap={onDoubleClick}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      />
    )
  }

  return <SvgPathNode {...commonProps} node={node} />
}

export interface EngravePreviewStackProps {
  rootIds: string[]
  defaultDepth: number | null
  toolDiameter: number
  registerNodeRef: (nodeId: string, node: Konva.Node | null) => void
  interactionBlocked?: boolean
  showCncOverrides?: boolean
  outlineOnly?: boolean
  onNodeDragStart?: (nodeId: string, konvaNode: Konva.Node) => void
  onNodeDragMove?: (nodeId: string, konvaNode: Konva.Node) => void
  onNodeDragEnd?: (nodeId: string, konvaNode: Konva.Node) => void
}

export function EngravePreviewStack({
  rootIds,
  defaultDepth,
  toolDiameter,
  registerNodeRef,
  interactionBlocked,
  showCncOverrides = true,
  outlineOnly = false,
  onNodeDragStart,
  onNodeDragMove,
  onNodeDragEnd,
}: EngravePreviewStackProps) {
  const nodesById = useEditorStore((state) => state.nodesById)
  const previewPlan = useMemo(
    () => buildDepthPreviewPlan(rootIds, nodesById, defaultDepth, toolDiameter),
    [defaultDepth, rootIds, nodesById, toolDiameter],
  )

  return (
    <>
      {previewPlan.layers.map(({ depth, mode, pathData }) =>
        pathData ? (
          <Path
            key={`depth-layer-${depth}-${mode}`}
            data={pathData}
            fill={getEngravePreviewFill(depth)}
            fillEnabled={true}
            stroke={getEngravePreviewStroke(depth)}
            strokeEnabled={showCncOverrides}
            strokeWidth={showCncOverrides ? 1 : 0}
            globalCompositeOperation="multiply"
            listening={false}
          />
        ) : null,
      )}

      {previewPlan.strokeShapes.map((shape) => (
        <Line
          key={`depth-stroke-${shape.sourceNodeId}`}
          points={shape.points}
          stroke={getEngravePreviewStroke(shape.depth)}
          strokeWidth={shape.strokeWidth}
          lineCap="round"
          lineJoin="round"
          globalCompositeOperation="multiply"
          listening={false}
        />
      ))}

      {previewPlan.interactiveRootIds.map((nodeId) => (
        <ShapeRenderer
          key={`depth-hitbox-${nodeId}`}
          nodeId={nodeId}
          registerNodeRef={registerNodeRef}
          interactionBlocked={interactionBlocked}
          showCncOverrides={false}
          hitboxOnly={true}
          onNodeDragStart={onNodeDragStart}
          onNodeDragMove={onNodeDragMove}
          onNodeDragEnd={onNodeDragEnd}
        />
      ))}

      {previewPlan.passthroughRootIds.map((nodeId) => (
        <ShapeRenderer
          key={`depth-passthrough-${nodeId}`}
          nodeId={nodeId}
          registerNodeRef={registerNodeRef}
          interactionBlocked={interactionBlocked}
          showCncOverrides={showCncOverrides}
          outlineOnly={outlineOnly}
          onNodeDragStart={onNodeDragStart}
          onNodeDragMove={onNodeDragMove}
          onNodeDragEnd={onNodeDragEnd}
        />
      ))}
    </>
  )
}
