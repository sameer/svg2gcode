import type { CanvasNode, GroupNode, InteractionMode } from '../types/editor'

export const isGroupNode = (node: CanvasNode | undefined): node is GroupNode =>
  Boolean(node) && node?.type === 'group'

export function getAncestorIds(
  nodeId: string,
  nodesById: Record<string, CanvasNode>,
): string[] {
  const ancestors: string[] = []
  let current = nodesById[nodeId]

  while (current?.parentId) {
    ancestors.push(current.parentId)
    current = nodesById[current.parentId]
  }

  return ancestors
}

export function isDescendantOf(
  nodeId: string,
  ancestorId: string,
  nodesById: Record<string, CanvasNode>,
): boolean {
  if (nodeId === ancestorId) {
    return true
  }

  let current = nodesById[nodeId]
  while (current?.parentId) {
    if (current.parentId === ancestorId) {
      return true
    }
    current = nodesById[current.parentId]
  }

  return false
}

export function getSubtreeIds(
  nodeId: string,
  nodesById: Record<string, CanvasNode>,
): string[] {
  const ids = [nodeId]
  const node = nodesById[nodeId]

  if (!isGroupNode(node)) {
    return ids
  }

  node.childIds.forEach((childId) => {
    ids.push(...getSubtreeIds(childId, nodesById))
  })

  return ids
}

export function getScopeRootId(focusGroupId: string | null): string | null {
  return focusGroupId
}

export function getEffectiveInteractionMode(
  interactionMode: InteractionMode,
  directSelectionModifierActive: boolean,
): InteractionMode {
  return interactionMode === 'direct' || directSelectionModifierActive ? 'direct' : 'group'
}

export function getEffectiveFocusGroupId(
  focusGroupId: string | null,
  interactionMode: InteractionMode,
  directSelectionModifierActive: boolean,
): string | null {
  return getEffectiveInteractionMode(interactionMode, directSelectionModifierActive) === 'direct'
    ? null
    : focusGroupId
}

export function getFocusScopeContainerId(
  focusNodeId: string | null,
  nodesById: Record<string, CanvasNode>,
): string | null {
  if (!focusNodeId) {
    return null
  }

  const focusNode = nodesById[focusNodeId]
  if (!focusNode) {
    return null
  }

  return focusNode.type === 'group' ? focusNode.id : focusNode.parentId
}

export function getSelectableIdsInScope(
  rootIds: string[],
  nodesById: Record<string, CanvasNode>,
  focusNodeId: string | null,
  interactionMode: InteractionMode,
): string[] {
  const scopeContainerId = getFocusScopeContainerId(focusNodeId, nodesById)
  const scopeNode = scopeContainerId ? nodesById[scopeContainerId] : undefined

  if (interactionMode === 'group') {
    if (scopeContainerId) {
      return isGroupNode(scopeNode) ? scopeNode.childIds : []
    }

    return rootIds
  }

  const scopeIds = scopeContainerId
    ? getSubtreeIds(scopeContainerId, nodesById).filter((id) => id !== scopeContainerId)
    : rootIds.flatMap((id) => getSubtreeIds(id, nodesById))

  return scopeIds.filter((id) => nodesById[id]?.type !== 'group')
}

export function resolveSelectionTarget(
  nodeId: string,
  nodesById: Record<string, CanvasNode>,
  focusNodeId: string | null,
  interactionMode: InteractionMode,
): string {
  if (interactionMode === 'direct') {
    return nodeId
  }

  const scopeContainerId = getFocusScopeContainerId(focusNodeId, nodesById)
  const current = nodesById[nodeId]

  let currentParentId = current?.parentId ?? null
  let highestGroupInScope: string | null = null

  while (currentParentId) {
    if (currentParentId === scopeContainerId) {
      break
    }

    const ancestor = nodesById[currentParentId]
    if (ancestor?.type === 'group') {
      highestGroupInScope = currentParentId
    }

    currentParentId = ancestor?.parentId ?? null
  }

  return highestGroupInScope ?? nodeId
}

export function isNodeInteractiveInFocus(
  nodeId: string,
  focusGroupId: string | null,
  nodesById: Record<string, CanvasNode>,
): boolean {
  if (!focusGroupId) {
    return true
  }

  return isDescendantOf(nodeId, focusGroupId, nodesById) || nodeId === focusGroupId
}

export function getFocusRenderMode(
  nodeId: string,
  focusNodeId: string | null,
  nodesById: Record<string, CanvasNode>,
): 'active' | 'ancestor' | 'dimmed' {
  const scopeContainerId = getFocusScopeContainerId(focusNodeId, nodesById)

  if (!focusNodeId || !scopeContainerId) {
    return 'active'
  }

  if (
    nodeId === scopeContainerId ||
    isDescendantOf(nodeId, scopeContainerId, nodesById)
  ) {
    return 'active'
  }

  if (isDescendantOf(scopeContainerId, nodeId, nodesById)) {
    return 'ancestor'
  }

  return 'dimmed'
}
