import { create } from 'zustand'

import { getSelectableIdsInScope, getSubtreeIds, isGroupNode } from './lib/editorTree'
import type {
  ArtboardState,
  CanvasNode,
  CanvasNodeBase,
  CncMetadata,
  ImportStatus,
  InteractionMode,
  MachiningSettings,
  MarqueeRect,
  PendingSvgImport,
  ViewportState,
} from './types/editor'
import { parseGcodeProgram } from '@svg2gcode/bridge/viewer'
import { groupSegments, computeGroupSweep } from './components/preview/segmentsToToolpaths'
import { insertTabs } from './lib/gcodeTabInsertion'
import type { CameraType, PreviewState, ViewMode } from './types/preview'
import { DEFAULT_MATERIAL } from './lib/materialPresets'
import type { MaterialPreset } from './lib/materialPresets'

type HistorySnapshot = {
  nodesById: Record<string, CanvasNode>
  rootIds: string[]
  selectedIds: string[]
  artboard: ArtboardState
}

const MAX_HISTORY = 50

export interface EditorStore {
  nodesById: Record<string, CanvasNode>
  rootIds: string[]
  selectedIds: string[]
  selectedStage: boolean
  focusGroupId: string | null
  interactionMode: InteractionMode
  directSelectionModifierActive: boolean
  clipboard: { rootIds: string[]; nodesById: Record<string, CanvasNode> } | null
  history: { past: HistorySnapshot[]; future: HistorySnapshot[] }
  artboard: ArtboardState
  machiningSettings: MachiningSettings
  viewport: ViewportState
  ui: {
    marquee: MarqueeRect | null
    isTransforming: boolean
    pendingImport: PendingSvgImport | null
    importStatus: ImportStatus | null
  }
  setInteractionMode: (mode: InteractionMode) => void
  setDirectSelectionModifierActive: (active: boolean) => void
  setFocusGroup: (groupId: string | null) => void
  clearFocusGroup: () => void
  selectStage: () => void
  selectOne: (id: string) => void
  selectMany: (ids: string[]) => void
  toggleSelection: (id: string) => void
  clearSelection: () => void
  updateNodeTransform: (
    nodeId: string,
    patch: Partial<CanvasNode>,
  ) => void
  updateCncMetadata: (nodeId: string, patch: Partial<CncMetadata>) => void
  pushHistory: () => void
  undo: () => void
  redo: () => void
  deleteSelected: () => void
  copySelected: () => void
  pasteClipboard: () => void
  duplicateSelected: (offsetX?: number, offsetY?: number) => void
  duplicateInPlace: () => void
  selectAll: () => void
  setArtboardSize: (patch: Partial<ArtboardState>) => void
  setMachiningSettings: (patch: Partial<MachiningSettings>) => void
  setViewport: (patch: Partial<ViewportState>) => void
  resetViewport: () => void
  setMarquee: (marquee: MarqueeRect | null) => void
  setIsTransforming: (isTransforming: boolean) => void
  stagePendingImport: (pendingImport: PendingSvgImport) => void
  clearPendingImport: () => void
  placePendingImport: (position: { x: number; y: number }) => void
  setImportStatus: (status: ImportStatus | null) => void

  // Preview state
  preview: PreviewState
  setViewMode: (mode: ViewMode) => void
  setCameraType: (type: CameraType) => void
  setPlaybackDistance: (distance: number) => void
  setIsPlaying: (playing: boolean) => void
  togglePlayback: () => void
  setPlaybackRate: (rate: number) => void
  setLoopPlayback: (loop: boolean) => void
  setShowSvgOverlay: (show: boolean) => void
  setShowStock: (show: boolean) => void
  setShowRapidMoves: (show: boolean) => void
  setMaterialPreset: (preset: MaterialPreset) => void
  initPreview: (result: import('@svg2gcode/bridge').GenerateJobResponse) => Promise<void>
  clearPreview: () => void
}

function generateId(): string {
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function cloneSubtree(
  rootId: string,
  nodesById: Record<string, CanvasNode>,
  dx: number,
  dy: number,
  newParentId: string | null,
): { newRootId: string; clonedNodes: Record<string, CanvasNode> } {
  const root = nodesById[rootId]
  if (!root) return { newRootId: rootId, clonedNodes: {} }

  const newRootId = generateId()
  const clonedNodes: Record<string, CanvasNode> = {}

  if (root.type === 'group') {
    const childClones = root.childIds.map((childId) =>
      cloneSubtree(childId, nodesById, 0, 0, newRootId),
    )
    childClones.forEach((c) => Object.assign(clonedNodes, c.clonedNodes))
    clonedNodes[newRootId] = {
      ...root,
      id: newRootId,
      x: root.x + dx,
      y: root.y + dy,
      childIds: childClones.map((c) => c.newRootId),
      parentId: newParentId,
    }
  } else {
    clonedNodes[newRootId] = {
      ...root,
      id: newRootId,
      x: root.x + dx,
      y: root.y + dy,
      parentId: newParentId,
    } as CanvasNode
  }

  return { newRootId, clonedNodes }
}

type BaseNodeDefaults = Pick<
  CanvasNodeBase,
  'rotation' | 'scaleX' | 'scaleY' | 'draggable' | 'locked' | 'visible' | 'opacity' | 'parentId'
>

type CanvasNodeSeed = Omit<CanvasNode, keyof BaseNodeDefaults>

const createBaseNode = <T extends CanvasNodeSeed>(node: T): T & BaseNodeDefaults => ({
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  draggable: true,
  locked: false,
  visible: true,
  opacity: 1,
  parentId: null,
  ...node,
})

const initialNodes: Record<string, CanvasNode> = {}

const initialRootIds: string[] = []
const initialViewport: ViewportState = {
  x: 0,
  y: 0,
  scale: 1,
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  nodesById: initialNodes,
  rootIds: initialRootIds,
  selectedIds: [],
  selectedStage: false,
  focusGroupId: null,
  interactionMode: 'group',
  directSelectionModifierActive: false,
  clipboard: null,
  history: { past: [], future: [] },
  artboard: {
    width: 960,
    height: 640,
    thickness: 18,
    x: 0,
    y: 0,
  },
  machiningSettings: {
    toolDiameter: 3,
    toolShape: 'Flat',
    defaultDepthMm: 3,
    passCount: 1,
    maxStepdown: null,
    stepover: null,
    maxFillPasses: null,
    cutFeedrate: null,
    plungeFeedrate: null,
    travelZ: null,
    cutZ: null,
    machineWidth: null,
    machineHeight: null,
    tabsEnabled: false,
    tabWidth: 4,
    tabHeight: 1.5,
    tabSpacing: 50,
  },
  viewport: initialViewport,
  ui: {
    marquee: null,
    isTransforming: false,
    pendingImport: null,
    importStatus: null,
  },
  setInteractionMode: (mode) => {
    set({ interactionMode: mode })
  },
  setDirectSelectionModifierActive: (directSelectionModifierActive) => {
    set({ directSelectionModifierActive })
  },
  setFocusGroup: (groupId) => {
    set({
      focusGroupId: groupId,
      selectedIds: groupId ? [groupId] : [],
      selectedStage: false,
    })
  },
  clearFocusGroup: () => {
    set({ focusGroupId: null, selectedIds: [], selectedStage: false })
  },
  selectStage: () => {
    set({ selectedIds: [], selectedStage: true })
  },
  selectOne: (id) => {
    set({ selectedIds: [id], selectedStage: false })
  },
  selectMany: (ids) => {
    set({ selectedIds: Array.from(new Set(ids)), selectedStage: false })
  },
  toggleSelection: (id) => {
    const { selectedIds } = get()
    set({
      selectedIds: selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
      selectedStage: false,
    })
  },
  clearSelection: () => {
    set({ selectedIds: [], selectedStage: false })
  },
  updateNodeTransform: (nodeId, patch) => {
    set((state) => ({
      ...(state.nodesById[nodeId]
        ? {
            nodesById: {
              ...state.nodesById,
              [nodeId]: {
                ...state.nodesById[nodeId],
                ...patch,
              } as CanvasNode,
            },
          }
        : {}),
    }))
  },
  updateCncMetadata: (nodeId, patch) => {
    get().pushHistory()
    set((state) => {
      const existing = state.nodesById[nodeId]
      if (!existing) return {}
      return {
        nodesById: {
          ...state.nodesById,
          [nodeId]: {
            ...existing,
            cncMetadata: { ...existing.cncMetadata, ...patch },
          } as CanvasNode,
        },
      }
    })
  },
  pushHistory: () => {
    const { nodesById, rootIds, selectedIds, artboard } = get()
    const snapshot: HistorySnapshot = { nodesById, rootIds, selectedIds, artboard }
    set((state) => ({
      history: {
        past: [...state.history.past.slice(-(MAX_HISTORY - 1)), snapshot],
        future: [],
      },
    }))
  },
  undo: () => {
    const { history, nodesById, rootIds, selectedIds, artboard } = get()
    if (history.past.length === 0) return
    const past = [...history.past]
    const snapshot = past.pop()!
    const current: HistorySnapshot = { nodesById, rootIds, selectedIds, artboard }
    set({
      nodesById: snapshot.nodesById,
      rootIds: snapshot.rootIds,
      selectedIds: snapshot.selectedIds,
      artboard: snapshot.artboard,
      focusGroupId: null,
      history: { past, future: [current, ...history.future] },
    })
  },
  redo: () => {
    const { history, nodesById, rootIds, selectedIds, artboard } = get()
    if (history.future.length === 0) return
    const [snapshot, ...future] = history.future
    const current: HistorySnapshot = { nodesById, rootIds, selectedIds, artboard }
    set({
      nodesById: snapshot.nodesById,
      rootIds: snapshot.rootIds,
      selectedIds: snapshot.selectedIds,
      artboard: snapshot.artboard,
      focusGroupId: null,
      history: { past: [...history.past, current], future },
    })
  },
  deleteSelected: () => {
    const { nodesById, rootIds, selectedIds } = get()
    if (selectedIds.length === 0) {
      return
    }

    get().pushHistory()

    const idsToDelete = new Set<string>()
    selectedIds.forEach((id) => {
      getSubtreeIds(id, nodesById).forEach((subtreeId) => {
        idsToDelete.add(subtreeId)
      })
    })

    const nextNodes = Object.fromEntries(
      Object.entries(nodesById)
        .filter(([id]) => !idsToDelete.has(id))
        .map(([id, node]) => {
          if (!isGroupNode(node)) {
            return [id, node]
          }

          return [
            id,
            {
              ...node,
              childIds: node.childIds.filter((childId) => !idsToDelete.has(childId)),
            },
          ]
        }),
    ) as Record<string, CanvasNode>

    const nextRootIds = rootIds.filter((id) => !idsToDelete.has(id))

    set({
      nodesById: nextNodes,
      rootIds: nextRootIds,
      selectedIds: [],
      selectedStage: false,
      focusGroupId:
        get().focusGroupId && idsToDelete.has(get().focusGroupId as string)
          ? null
          : get().focusGroupId,
    })
  },
  copySelected: () => {
    const { nodesById, selectedIds } = get()
    if (selectedIds.length === 0) return

    const clipboardNodesById: Record<string, CanvasNode> = {}
    selectedIds.forEach((id) => {
      getSubtreeIds(id, nodesById).forEach((subtreeId) => {
        clipboardNodesById[subtreeId] = { ...nodesById[subtreeId] }
      })
    })

    const clipboardRootIds = selectedIds.filter((id) => {
      const node = nodesById[id]
      return !node?.parentId || !selectedIds.includes(node.parentId)
    })

    set({ clipboard: { rootIds: clipboardRootIds, nodesById: clipboardNodesById } })
  },
  pasteClipboard: () => {
    const { nodesById, rootIds, clipboard } = get()
    if (!clipboard) return

    get().pushHistory()

    const newRootIds: string[] = []
    const newNodesById: Record<string, CanvasNode> = {}

    clipboard.rootIds.forEach((rootId) => {
      const { newRootId, clonedNodes } = cloneSubtree(rootId, clipboard.nodesById, 20, 20, null)
      newRootIds.push(newRootId)
      Object.assign(newNodesById, clonedNodes)
    })

    set({
      nodesById: { ...nodesById, ...newNodesById },
      rootIds: [...rootIds, ...newRootIds],
      selectedIds: newRootIds,
      selectedStage: false,
    })
  },
  duplicateSelected: (offsetX = 20, offsetY = 20) => {
    const { nodesById, rootIds, selectedIds } = get()
    if (selectedIds.length === 0) return

    get().pushHistory()

    const topLevelIds = selectedIds.filter((id) => {
      const node = nodesById[id]
      return !node?.parentId || !selectedIds.includes(node.parentId)
    })

    const newRootIds: string[] = []
    const updatedNodesById: Record<string, CanvasNode> = { ...nodesById }
    let updatedRootIds = [...rootIds]

    topLevelIds.forEach((id) => {
      const node = nodesById[id]
      const parentId = node?.parentId ?? null
      const { newRootId, clonedNodes } = cloneSubtree(id, nodesById, offsetX, offsetY, parentId)
      newRootIds.push(newRootId)
      Object.assign(updatedNodesById, clonedNodes)

      if (!parentId) {
        updatedRootIds = [...updatedRootIds, newRootId]
      } else {
        const parent = updatedNodesById[parentId]
        if (parent && isGroupNode(parent)) {
          updatedNodesById[parentId] = {
            ...parent,
            childIds: [...parent.childIds, newRootId],
          }
        }
      }
    })

    set({
      nodesById: updatedNodesById,
      rootIds: updatedRootIds,
      selectedIds: newRootIds,
      selectedStage: false,
    })
  },
  duplicateInPlace: () => {
    const { nodesById, rootIds, selectedIds } = get()
    if (selectedIds.length === 0) return

    const topLevelIds = selectedIds.filter((id) => {
      const node = nodesById[id]
      return !node?.parentId || !selectedIds.includes(node.parentId)
    })

    const updatedNodesById: Record<string, CanvasNode> = { ...nodesById }
    let updatedRootIds = [...rootIds]

    topLevelIds.forEach((id) => {
      const node = nodesById[id]
      const parentId = node?.parentId ?? null
      const { newRootId, clonedNodes } = cloneSubtree(id, nodesById, 0, 0, parentId)
      Object.assign(updatedNodesById, clonedNodes)

      if (!parentId) {
        updatedRootIds = [...updatedRootIds, newRootId]
      } else {
        const parent = updatedNodesById[parentId]
        if (parent && isGroupNode(parent)) {
          updatedNodesById[parentId] = {
            ...parent,
            childIds: [...parent.childIds, newRootId],
          }
        }
      }
    })

    // Keep selectedIds on the originals so Konva keeps dragging them
    set({ nodesById: updatedNodesById, rootIds: updatedRootIds })
  },
  selectAll: () => {
    const { rootIds, focusGroupId, nodesById, interactionMode } = get()
    const ids = getSelectableIdsInScope(rootIds, nodesById, focusGroupId, interactionMode)
    set({ selectedIds: ids, selectedStage: false })
  },
  setArtboardSize: (patch) => {
    get().pushHistory()
    set((state) => ({
      artboard: {
        ...state.artboard,
        ...patch,
      },
    }))
  },
  setMachiningSettings: (patch) => {
    set((state) => ({
      machiningSettings: {
        ...state.machiningSettings,
        ...patch,
      },
    }))
  },
  setViewport: (patch) => {
    set((state) => ({
      viewport: {
        ...state.viewport,
        ...patch,
      },
    }))
  },
  resetViewport: () => {
    set({
      viewport: initialViewport,
    })
  },
  setMarquee: (marquee) => {
    set((state) => ({
      ui: {
        ...state.ui,
        marquee,
      },
    }))
  },
  setIsTransforming: (isTransforming) => {
    set((state) => ({
      ui: {
        ...state.ui,
        isTransforming,
      },
    }))
  },
  stagePendingImport: (pendingImport) => {
    set((state) => ({
      selectedIds: [],
      selectedStage: false,
      focusGroupId: null,
      ui: {
        ...state.ui,
        pendingImport,
        importStatus: {
          tone: 'info',
          message: `Click on the artboard to place "${pendingImport.name}". Press Escape to cancel.`,
        },
      },
    }))
  },
  clearPendingImport: () => {
    set((state) => ({
      ui: {
        ...state.ui,
        pendingImport: null,
      },
    }))
  },
  placePendingImport: (position) => {
    const { nodesById, rootIds, ui } = get()
    const pendingImport = ui.pendingImport

    if (!pendingImport) {
      return
    }

    get().pushHistory()

    const rootNode = pendingImport.nodesById[pendingImport.rootId]
    if (!rootNode || rootNode.type !== 'group') {
      return
    }

    const { machiningSettings } = get()
    const nextRootNode = {
      ...rootNode,
      x: position.x,
      y: position.y,
      originalSvg: pendingImport.originalSvg,
      cncMetadata: {
        ...rootNode.cncMetadata,
        cutDepth: machiningSettings.defaultDepthMm,
        engraveType: 'pocket' as const,
      },
    }

    set((state) => ({
      nodesById: {
        ...nodesById,
        ...pendingImport.nodesById,
        [pendingImport.rootId]: nextRootNode,
      },
      rootIds: [...rootIds, pendingImport.rootId],
      selectedIds: [pendingImport.rootId],
      selectedStage: false,
      focusGroupId: null,
      ui: {
        ...state.ui,
        pendingImport: null,
        importStatus: {
          tone: 'success',
          message: `Imported "${pendingImport.name}" onto the artboard.`,
        },
      },
    }))
  },
  setImportStatus: (importStatus) => {
    set((state) => ({
      ui: {
        ...state.ui,
        importStatus,
      },
    }))
  },

  // Preview state
  preview: {
    viewMode: 'design',
    cameraType: 'perspective',
    playbackDistance: 0,
    isPlaying: false,
    playbackRate: 60,
    loopPlayback: true,
    showSvgOverlay: true,
    showStock: true,
    showRapidMoves: false,
    materialPreset: DEFAULT_MATERIAL,
    initProgress: null,
    parsedProgram: null,
    toolpaths: null,
    stockBounds: null,
    gcodeText: null,
    previewSnapshot: null,
  },
  setViewMode: (mode) => {
    set((state) => ({
      preview: { ...state.preview, viewMode: mode, isPlaying: false },
    }))
  },
  setCameraType: (type) => {
    set((state) => ({
      preview: { ...state.preview, cameraType: type },
    }))
  },
  setPlaybackDistance: (distance) => {
    set((state) => ({
      preview: { ...state.preview, playbackDistance: distance },
    }))
  },
  setIsPlaying: (playing) => {
    set((state) => ({
      preview: { ...state.preview, isPlaying: playing },
    }))
  },
  togglePlayback: () => {
    set((state) => {
      const { preview } = state
      if (!preview.parsedProgram) return {}
      // If at end, reset to beginning
      if (!preview.isPlaying && preview.playbackDistance >= preview.parsedProgram.totalDistance) {
        return { preview: { ...preview, isPlaying: true, playbackDistance: 0 } }
      }
      return { preview: { ...preview, isPlaying: !preview.isPlaying } }
    })
  },
  setPlaybackRate: (rate) => {
    set((state) => ({
      preview: { ...state.preview, playbackRate: rate },
    }))
  },
  setLoopPlayback: (loop) => {
    set((state) => ({
      preview: { ...state.preview, loopPlayback: loop },
    }))
  },
  setShowSvgOverlay: (show) => {
    set((state) => ({
      preview: { ...state.preview, showSvgOverlay: show },
    }))
  },
  setShowStock: (show) => {
    set((state) => ({
      preview: { ...state.preview, showStock: show },
    }))
  },
  setShowRapidMoves: (show) => {
    set((state) => ({
      preview: { ...state.preview, showRapidMoves: show },
    }))
  },
  setMaterialPreset: (preset) => {
    set((state) => ({
      preview: { ...state.preview, materialPreset: preset },
    }))
  },
  initPreview: async (result) => {
    const { machiningSettings, artboard } = get()

    const setProgress = (initProgress: number) =>
      set((state) => ({ preview: { ...state.preview, initProgress } }))

    setProgress(0)

    // Post-process GCode to insert tabs on through-cuts when enabled
    let gcode = result.gcode
    if (machiningSettings.tabsEnabled) {
      gcode = insertTabs(gcode, {
        materialThickness: artboard.thickness,
        tabWidth: machiningSettings.tabWidth,
        tabHeight: machiningSettings.tabHeight,
        tabSpacing: machiningSettings.tabSpacing,
      })
    }

    setProgress(5)
    const program = parseGcodeProgram(gcode, result.operation_ranges)

    setProgress(10)
    const toolRadius = result.preview_snapshot.tool_diameter / 2
    const rawGroups = groupSegments(program.segments, toolRadius)

    // Compute sweep shapes incrementally, yielding to the event loop for UI updates
    const toolpaths = []
    for (let i = 0; i < rawGroups.length; i++) {
      toolpaths.push(computeGroupSweep(rawGroups[i]))
      const pct = 10 + Math.round((i + 1) / rawGroups.length * 85)
      setProgress(pct)
      // Yield every few groups so the progress bar can repaint
      if (i % 3 === 0) {
        await new Promise((r) => setTimeout(r, 0))
      }
    }

    const stockBounds = {
      minX: 0,
      minY: 0,
      maxX: result.preview_snapshot.material_width,
      maxY: result.preview_snapshot.material_height,
    }

    set((state) => ({
      preview: {
        ...state.preview,
        viewMode: 'preview3d',
        initProgress: null,
        parsedProgram: program,
        toolpaths,
        stockBounds,
        gcodeText: gcode,
        previewSnapshot: result.preview_snapshot,
        playbackDistance: 0,
        isPlaying: false,
      },
    }))
  },
  clearPreview: () => {
    set((state) => ({
      preview: {
        ...state.preview,
        viewMode: 'design',
        initProgress: null,
        parsedProgram: null,
        toolpaths: null,
        stockBounds: null,
        gcodeText: null,
        previewSnapshot: null,
        playbackDistance: 0,
        isPlaying: false,
      },
    }))
  },
}))
