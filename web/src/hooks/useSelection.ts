import { useMemo } from 'react'

import {
  getEffectiveFocusGroupId,
  getEffectiveInteractionMode,
  getSelectableIdsInScope,
  getSubtreeIds,
  isDescendantOf,
  resolveSelectionTarget,
} from '../lib/editorTree'
import { useEditorStore } from '../store'

export function useSelection() {
  const nodesById = useEditorStore((state) => state.nodesById)
  const rootIds = useEditorStore((state) => state.rootIds)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const selectedStage = useEditorStore((state) => state.selectedStage)
  const focusGroupId = useEditorStore((state) => state.focusGroupId)
  const interactionMode = useEditorStore((state) => state.interactionMode)
  const directSelectionModifierActive = useEditorStore(
    (state) => state.directSelectionModifierActive,
  )
  const selectStage = useEditorStore((state) => state.selectStage)
  const selectOne = useEditorStore((state) => state.selectOne)
  const selectMany = useEditorStore((state) => state.selectMany)
  const toggleSelection = useEditorStore((state) => state.toggleSelection)
  const clearSelection = useEditorStore((state) => state.clearSelection)
  const setFocusGroup = useEditorStore((state) => state.setFocusGroup)
  const clearFocusGroup = useEditorStore((state) => state.clearFocusGroup)
  const activeInteractionMode = getEffectiveInteractionMode(
    interactionMode,
    directSelectionModifierActive,
  )
  const effectiveFocusGroupId = getEffectiveFocusGroupId(
    focusGroupId,
    interactionMode,
    directSelectionModifierActive,
  )

  const selectableIds = useMemo(
    () =>
      getSelectableIdsInScope(
        rootIds,
        nodesById,
        effectiveFocusGroupId,
        activeInteractionMode,
      ).filter(
        (id) => nodesById[id]?.visible,
      ),
    [activeInteractionMode, effectiveFocusGroupId, nodesById, rootIds],
  )

  return {
    selectedIds,
    selectedStage,
    focusGroupId,
    interactionMode,
    activeInteractionMode,
    effectiveFocusGroupId,
    selectStage,
    selectableIds,
    selectNode: (nodeId: string, additive = false) => {
      const targetId = resolveSelectionTarget(
        nodeId,
        nodesById,
        effectiveFocusGroupId,
        activeInteractionMode,
      )

      if (additive) {
        toggleSelection(targetId)
        return targetId
      }

      selectOne(targetId)
      return targetId
    },
    selectMany,
    clearSelection,
    exitFocusMode: clearFocusGroup,
    enterFocusMode: (nodeId: string) => {
      if (activeInteractionMode === 'direct') {
        return
      }

      setFocusGroup(nodeId)
    },
    isInFocusScope: (nodeId: string) => {
      if (!effectiveFocusGroupId) {
        return true
      }

      return isDescendantOf(nodeId, effectiveFocusGroupId, nodesById)
    },
    isSelected: (nodeId: string) => selectedIds.includes(nodeId),
    getMarqueeCandidateIds: () => selectableIds,
    getVisibleSubtreeIds: (nodeId: string) => getSubtreeIds(nodeId, nodesById),
  }
}
