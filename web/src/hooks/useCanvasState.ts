import { useMemo } from 'react'

import { useEditorStore } from '../store'

interface ViewportSize {
  width: number
  height: number
}

export function useCanvasState(containerSize?: ViewportSize) {
  const artboard = useEditorStore((state) => state.artboard)
  const rootIds = useEditorStore((state) => state.rootIds)
  const nodesById = useEditorStore((state) => state.nodesById)
  const focusGroupId = useEditorStore((state) => state.focusGroupId)
  const marquee = useEditorStore((state) => state.ui.marquee)

  const stageSize = useMemo(
    () => ({
      width: Math.max(400, containerSize?.width ?? window.innerWidth),
      height: Math.max(300, containerSize?.height ?? window.innerHeight),
    }),
    [containerSize?.width, containerSize?.height],
  )

  const artboardRect = useMemo(
    () => ({
      x: Math.round((stageSize.width - artboard.width) / 2 + artboard.x),
      y: Math.round((stageSize.height - artboard.height) / 2 + artboard.y),
      width: artboard.width,
      height: artboard.height,
    }),
    [artboard.height, artboard.width, artboard.x, artboard.y, stageSize.height, stageSize.width],
  )

  const focusPath = useMemo(() => {
    if (!focusGroupId) {
      return []
    }

    const path: string[] = []
    let current = nodesById[focusGroupId]

    while (current?.parentId) {
      path.push(current.parentId)
      current = nodesById[current.parentId]
    }

    return path
  }, [focusGroupId, nodesById])

  return {
    artboard,
    artboardRect,
    focusGroupId,
    focusPath,
    marquee,
    nodesById,
    rootIds,
    stageSize,
  }
}
