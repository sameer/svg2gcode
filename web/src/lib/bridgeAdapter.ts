import {
  prepareSvgDocument,
  createArtObject,
  composeArtObjectsSvg,
  getDerivedOperationsForArtObjects,
  engraveTypeToFillMode,
  type ArtObject,
  type Settings,
  type EngraveType as BridgeEngraveType,
} from "@svg2gcode/bridge"

import type {
  ArtboardState,
  CanvasNode,
  GroupNode,
  MachiningSettings,
} from "../types/editor"
import { getSubtreeIds, isGroupNode } from "./editorTree"
import { exportToSVG } from "./svgExport"
import { buildBridgeSettings } from "./bridgeSettingsAdapter"

/**
 * Convert the editor's canvas state into bridge ArtObjects for GCode generation.
 *
 * For each root-level group with an `originalSvg`:
 * 1. Parse the original SVG through the WASM bridge (prepareSvgDocument)
 * 2. Create an ArtObject with auto-assigned element assignments
 * 3. Override element assignments based on the editor's CNC metadata
 *
 * For root nodes without `originalSvg` (manually created shapes), we export
 * them to SVG first, then run the same pipeline.
 */
export async function editorStateToArtObjects(
  nodesById: Record<string, CanvasNode>,
  rootIds: string[],
  artboard: ArtboardState,
  machiningSettings: MachiningSettings,
  baseSettings: Settings,
): Promise<ArtObject[]> {
  const settings = buildBridgeSettings(baseSettings, artboard, machiningSettings)
  const artObjects: ArtObject[] = []

  for (const rootId of rootIds) {
    const rootNode = nodesById[rootId]
    if (!rootNode || !rootNode.visible) continue

    const svgText = getSvgTextForNode(rootNode, rootId, nodesById, artboard)
    if (!svgText) continue

    const preparedSvg = await prepareSvgDocument(svgText)

    const defaultEngraveType = resolveDefaultEngraveType(rootNode)
    const artObject = createArtObject({
      artObjectId: rootId,
      name: rootNode.name,
      preparedSvg,
      settings,
      defaultEngraveType,
      existingArtObjects: artObjects,
    })

    // Override placement from the editor's canvas position
    const nodeHeight = getNodeHeight(rootNode, nodesById)
    artObject.placementX = rootNode.x
    artObject.placementY = artboard.height - rootNode.y - nodeHeight

    // Override element assignments from editor CNC metadata
    applyEditorCncMetadata(artObject, rootNode, nodesById, machiningSettings)

    artObjects.push(artObject)
  }

  return artObjects
}

/**
 * Full GCode generation pipeline: editor state → ArtObjects → composed SVG → operations.
 * Returns the inputs needed for `generateEngravingJob`.
 */
export async function prepareGenerationInputs(
  nodesById: Record<string, CanvasNode>,
  rootIds: string[],
  artboard: ArtboardState,
  machiningSettings: MachiningSettings,
  baseSettings: Settings,
) {
  const settings = buildBridgeSettings(baseSettings, artboard, machiningSettings)
  const artObjects = await editorStateToArtObjects(
    nodesById,
    rootIds,
    artboard,
    machiningSettings,
    baseSettings,
  )

  if (artObjects.length === 0) {
    throw new Error("No visible objects on the artboard to generate GCode from.")
  }

  const composedSvg = composeArtObjectsSvg(artObjects, settings)
  const operations = getDerivedOperationsForArtObjects(artObjects)

  return { normalized_svg: composedSvg, settings, operations }
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function getSvgTextForNode(
  node: CanvasNode,
  nodeId: string,
  nodesById: Record<string, CanvasNode>,
  artboard: ArtboardState,
): string | null {
  // Prefer the stored original SVG from import
  if (isGroupNode(node) && node.originalSvg) {
    return node.originalSvg
  }

  // Fallback: export this single node as SVG
  // Create a minimal nodesById with just this subtree
  const subtreeIds = getSubtreeIds(nodeId, nodesById)
  const subtreeNodes: Record<string, CanvasNode> = {}
  for (const id of subtreeIds) {
    const subtreeNode = nodesById[id]
    if (subtreeNode) {
      subtreeNodes[id] = id === nodeId
        ? { ...subtreeNode, x: 0, y: 0 }
        : subtreeNode
    }
  }

  return exportToSVG(subtreeNodes, [nodeId], {
    ...artboard,
    x: 0,
    y: 0,
  })
}

function resolveDefaultEngraveType(node: CanvasNode): BridgeEngraveType {
  const engraveType = node.cncMetadata?.engraveType
  if (engraveType === "pocket" || engraveType === "outline") {
    return engraveType
  }
  if (engraveType === "contour") {
    return "outline"
  }
  return "pocket"
}

function getNodeHeight(node: CanvasNode, nodesById: Record<string, CanvasNode>): number {
  if (isGroupNode(node)) {
    // Approximate height from children bounds
    let maxY = 0
    for (const childId of (node as GroupNode).childIds) {
      const child = nodesById[childId]
      if (!child) continue
      const childBottom = child.y + getNodeHeight(child, nodesById) * child.scaleY
      maxY = Math.max(maxY, childBottom)
    }
    return maxY * node.scaleY
  }

  switch (node.type) {
    case "rect":
      return node.height
    case "circle":
      return node.radius * 2
    case "path":
    case "line":
      return 0 // Bounds already baked into position during import
  }
}

/**
 * Walk the editor's node subtree and apply CNC metadata (cutDepth, engraveType)
 * onto the ArtObject's element assignments.
 *
 * Since the editor's node IDs and the bridge's element IDs (from data-s2g-id)
 * are independent, we match by traversal order: leaf elements in both trees
 * come from the same SVG and appear in the same document order.
 */
function applyEditorCncMetadata(
  artObject: ArtObject,
  rootNode: CanvasNode,
  nodesById: Record<string, CanvasNode>,
  machiningSettings: MachiningSettings,
) {
  // Collect leaf nodes with CNC metadata in document order
  const leafMetadata = collectLeafCncMetadata(rootNode, nodesById)

  // The bridge's selectable element IDs are in document order too
  const compositeIds = Object.keys(artObject.elementAssignments)

  // If we have metadata from the editor, apply it positionally
  // If the editor has metadata on the root group, apply it as default to all elements
  const rootDepth = rootNode.cncMetadata?.cutDepth ?? machiningSettings.defaultDepthMm
  const rootEngraveType = resolveDefaultEngraveType(rootNode)
  const rootFillMode = engraveTypeToFillMode(rootEngraveType)

  for (let i = 0; i < compositeIds.length; i++) {
    const compositeId = compositeIds[i]!
    const assignment = artObject.elementAssignments[compositeId]
    if (!assignment) continue

    // Check if there's a positional match from editor leaf metadata
    const leafMeta = leafMetadata[i]
    if (leafMeta) {
      assignment.targetDepthMm = leafMeta.cutDepth ?? rootDepth
      assignment.engraveType = leafMeta.engraveType ?? rootEngraveType
      assignment.fillMode = engraveTypeToFillMode(assignment.engraveType) ?? rootFillMode
    } else {
      // Fall back to root defaults
      assignment.targetDepthMm = rootDepth
      assignment.engraveType = rootEngraveType
      assignment.fillMode = rootFillMode
    }
  }
}

interface LeafMeta {
  cutDepth: number | undefined
  engraveType: BridgeEngraveType | null
}

function collectLeafCncMetadata(
  node: CanvasNode,
  nodesById: Record<string, CanvasNode>,
): LeafMeta[] {
  if (isGroupNode(node)) {
    const result: LeafMeta[] = []
    for (const childId of (node as GroupNode).childIds) {
      const child = nodesById[childId]
      if (child && child.visible) {
        result.push(...collectLeafCncMetadata(child, nodesById))
      }
    }
    return result
  }

  // Leaf node — resolve engrave type to bridge format
  const editorType = node.cncMetadata?.engraveType
  let bridgeType: BridgeEngraveType | null = null
  if (editorType === "contour" || editorType === "outline") {
    bridgeType = "outline"
  } else if (editorType === "pocket") {
    bridgeType = "pocket"
  }

  return [{
    cutDepth: node.cncMetadata?.cutDepth,
    engraveType: bridgeType,
  }]
}
