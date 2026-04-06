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

const initialNodes: Record<string, CanvasNode> = {
  'frame-group': createBaseNode({
    id: 'frame-group',
    type: 'group',
    name: 'Frame Group',
    x: 120,
    y: 120,
    childIds: ['frame-body', 'frame-detail-group'],
  }),
  'frame-body': createBaseNode({
    id: 'frame-body',
    type: 'rect',
    name: 'Frame Body',
    x: 0,
    y: 0,
    width: 260,
    height: 160,
    fill: '#f3ede2',
    stroke: '#31241b',
    strokeWidth: 2,
    cornerRadius: 18,
    parentId: 'frame-group',
  }),
  'frame-detail-group': createBaseNode({
    id: 'frame-detail-group',
    type: 'group',
    name: 'Frame Detail Group',
    x: 154,
    y: 42,
    childIds: ['frame-detail-circle', 'frame-detail-path'],
    parentId: 'frame-group',
  }),
  'frame-detail-circle': createBaseNode({
    id: 'frame-detail-circle',
    type: 'circle',
    name: 'Frame Detail Circle',
    x: 0,
    y: 0,
    radius: 28,
    fill: '#d46f4d',
    stroke: '#31241b',
    strokeWidth: 2,
    parentId: 'frame-detail-group',
  }),
  'frame-detail-path': createBaseNode({
    id: 'frame-detail-path',
    type: 'path',
    name: 'Frame Detail Path',
    x: -18,
    y: 34,
    data: 'M0 8 L22 0 L44 8 L28 28 L16 28 Z',
    fill: '#4c8a67',
    stroke: '#20352a',
    strokeWidth: 1.5,
    parentId: 'frame-detail-group',
  }),
  'guide-line': createBaseNode({
    id: 'guide-line',
    type: 'line',
    name: 'Guide Line',
    x: 430,
    y: 134,
    points: [0, 0, 180, 24, 220, 96],
    stroke: '#285c63',
    strokeWidth: 5,
    lineCap: 'round',
    lineJoin: 'round',
  }),
  'fixture-group': createBaseNode({
    id: 'fixture-group',
    type: 'group',
    name: 'Fixture Group',
    x: 410,
    y: 330,
    childIds: ['fixture-base', 'fixture-cutout-group'],
  }),
  'fixture-base': createBaseNode({
    id: 'fixture-base',
    type: 'rect',
    name: 'Fixture Base',
    x: 0,
    y: 0,
    width: 210,
    height: 100,
    fill: '#dfe7f2',
    stroke: '#25415a',
    strokeWidth: 2,
    cornerRadius: 14,
    parentId: 'fixture-group',
  }),
  'fixture-cutout-group': createBaseNode({
    id: 'fixture-cutout-group',
    type: 'group',
    name: 'Fixture Cutout Group',
    x: 124,
    y: 24,
    childIds: ['fixture-cutout-circle', 'fixture-cutout-path'],
    parentId: 'fixture-group',
  }),
  'fixture-cutout-circle': createBaseNode({
    id: 'fixture-cutout-circle',
    type: 'circle',
    name: 'Fixture Cutout Circle',
    x: 16,
    y: 16,
    radius: 22,
    fill: '#ffffff',
    stroke: '#25415a',
    strokeWidth: 2,
    parentId: 'fixture-cutout-group',
  }),
  'fixture-cutout-path': createBaseNode({
    id: 'fixture-cutout-path',
    type: 'path',
    name: 'Fixture Cutout Path',
    x: 52,
    y: 0,
    data: 'M0 0 L34 0 L34 34 L17 22 L0 34 Z',
    fill: '#7fb3d5',
    stroke: '#25415a',
    strokeWidth: 2,
    parentId: 'fixture-cutout-group',
  }),
  'solo-circle': createBaseNode({
    id: 'solo-circle',
    type: 'circle',
    name: 'Solo Circle',
    x: 710,
    y: 210,
    radius: 44,
    fill: '#f9c74f',
    stroke: '#7d4c10',
    strokeWidth: 2,
  }),
}

const initialRootIds = ['frame-group', 'guide-line', 'fixture-group', 'solo-circle']
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
    cutFeedrate: null,
    plungeFeedrate: null,
    travelZ: null,
    cutZ: null,
    machineWidth: null,
    machineHeight: null,
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
}))
