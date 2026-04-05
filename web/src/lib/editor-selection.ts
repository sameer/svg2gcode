import { buildCompositeElementId, splitCompositeElementId } from "@/lib/art-objects";
import type {
  ArtObject,
  DiveRootScope,
  EditorFocusScope,
  EditorInteractionMode,
  SvgTreeNode,
} from "@/lib/types";

type IndexedTreeNode = {
  key: string | null;
  node: SvgTreeNode;
  parentKey: string | null;
  compositeId: string | null;
  descendantElementIds: string[];
  children: IndexedTreeNode[];
};

export interface ArtObjectSelectionIndex {
  artObjectId: string;
  artObjectName: string;
  root: IndexedTreeNode;
  nodesByKey: Map<string, IndexedTreeNode>;
  leafNodesByCompositeId: Map<string, IndexedTreeNode>;
}

export interface SelectableUnit {
  id: string;
  artObjectId: string;
  scopeNodeId: string | null;
  label: string;
  kind: "group" | "element";
  elementIds: string[];
}

const GROUP_UNIT_PREFIX = "group:";

export function buildTreeNodeKey(path: number[]) {
  return path.join(".");
}

export function buildFocusScopeId(artObjectId: string, scopeNodeId: string | null) {
  return `${artObjectId}:${scopeNodeId ?? "root"}`;
}

export function buildGroupUnitId(artObjectId: string, scopeNodeId: string) {
  return `${GROUP_UNIT_PREFIX}${artObjectId}:${scopeNodeId}`;
}

export function getSelectableUnitOwnerArtObjectId(unitId: string) {
  if (unitId.startsWith(GROUP_UNIT_PREFIX)) {
    const remainder = unitId.slice(GROUP_UNIT_PREFIX.length);
    const separatorIndex = remainder.indexOf(":");
    return separatorIndex === -1 ? null : remainder.slice(0, separatorIndex);
  }

  return splitCompositeElementId(unitId).artObjectId || null;
}

export function getEffectiveInteractionMode(
  interactionMode: EditorInteractionMode,
  directSelectionModifierActive: boolean,
): EditorInteractionMode {
  return interactionMode === "direct" || directSelectionModifierActive ? "direct" : "group";
}

export function buildArtObjectSelectionIndex(artObject: ArtObject): ArtObjectSelectionIndex {
  const nodesByKey = new Map<string, IndexedTreeNode>();
  const leafNodesByCompositeId = new Map<string, IndexedTreeNode>();

  const buildNode = (
    node: SvgTreeNode,
    path: number[],
    parentKey: string | null,
  ): IndexedTreeNode => {
    const key = path.length > 0 ? buildTreeNodeKey(path) : null;
    const compositeId = node.id ? buildCompositeElementId(artObject.id, node.id) : null;
    const indexedNode: IndexedTreeNode = {
      key,
      node,
      parentKey,
      compositeId,
      descendantElementIds: node.selectable_descendant_ids.map((elementId) =>
        buildCompositeElementId(artObject.id, elementId),
      ),
      children: node.children.map((child, childIndex) =>
        buildNode(child, [...path, childIndex], key),
      ),
    };

    if (key) {
      nodesByKey.set(key, indexedNode);
    }
    if (compositeId && node.selectable) {
      leafNodesByCompositeId.set(compositeId, indexedNode);
    }

    return indexedNode;
  };

  return {
    artObjectId: artObject.id,
    artObjectName: artObject.name,
    root: buildNode(artObject.preparedSvg.tree, [], null),
    nodesByKey,
    leafNodesByCompositeId,
  };
}

export function isScopeNodeIdValid(index: ArtObjectSelectionIndex, scopeNodeId: string | null) {
  return scopeNodeId === null || index.nodesByKey.has(scopeNodeId);
}

export function isSelectableUnitIdValid(index: ArtObjectSelectionIndex, unitId: string) {
  if (unitId.startsWith(GROUP_UNIT_PREFIX)) {
    const parsed = parseGroupUnitId(unitId);
    return parsed?.artObjectId === index.artObjectId && index.nodesByKey.has(parsed.scopeNodeId);
  }

  return index.leafNodesByCompositeId.has(unitId);
}

export function getFocusScopeInfo(
  index: ArtObjectSelectionIndex,
  scopeNodeId: string | null,
): DiveRootScope {
  const scopeNode = getScopeNode(index, scopeNodeId);

  return {
    id: buildFocusScopeId(index.artObjectId, scopeNodeId),
    label: scopeNodeId ? scopeNode.node.label : index.artObjectName,
    elementIds: scopeNode.descendantElementIds,
    artObjectId: index.artObjectId,
    scopeNodeId,
  };
}

export function getSelectableUnitsInScope(
  index: ArtObjectSelectionIndex,
  scopeNodeId: string | null,
  interactionMode: EditorInteractionMode,
): SelectableUnit[] {
  const scopeNode = getScopeNode(index, scopeNodeId);

  if (interactionMode === "direct") {
    return collectSelectableLeafUnits(index, scopeNode);
  }

  return scopeNode.children
    .filter((child) => child.descendantElementIds.length > 0)
    .map((child) => buildGroupModeUnit(index, child))
    .filter((unit): unit is SelectableUnit => Boolean(unit));
}

export function resolveSelectableUnitIdsForHits(
  index: ArtObjectSelectionIndex,
  scopeNodeId: string | null,
  interactionMode: EditorInteractionMode,
  hitElementIds: string[],
): string[] {
  const scopeNode = getScopeNode(index, scopeNodeId);
  const resolved = new Set<string>();

  for (const hitElementId of hitElementIds) {
    if (!scopeNode.descendantElementIds.includes(hitElementId)) {
      continue;
    }

    if (interactionMode === "direct") {
      if (index.leafNodesByCompositeId.has(hitElementId)) {
        resolved.add(hitElementId);
      }
      continue;
    }

    const unit = resolveGroupModeUnitForHit(index, scopeNode, hitElementId);
    if (unit) {
      resolved.add(unit.id);
    }
  }

  return Array.from(resolved);
}

export function expandSelectableUnitIds(
  index: ArtObjectSelectionIndex,
  unitIds: string[],
): string[] {
  const expanded = new Set<string>();

  for (const unitId of unitIds) {
    if (unitId.startsWith(GROUP_UNIT_PREFIX)) {
      const parsed = parseGroupUnitId(unitId);
      if (!parsed || parsed.artObjectId !== index.artObjectId) {
        continue;
      }

      const node = index.nodesByKey.get(parsed.scopeNodeId);
      if (!node) {
        continue;
      }

      node.descendantElementIds.forEach((elementId) => expanded.add(elementId));
      continue;
    }

    if (index.leafNodesByCompositeId.has(unitId)) {
      expanded.add(unitId);
    }
  }

  return Array.from(expanded);
}

export function findDrilldownFocusScope(
  index: ArtObjectSelectionIndex,
  currentScopeNodeId: string | null,
  hitElementId: string,
): EditorFocusScope | null {
  const resolvedUnitIds = resolveSelectableUnitIdsForHits(
    index,
    currentScopeNodeId,
    "group",
    [hitElementId],
  );
  const nextGroupUnitId = resolvedUnitIds.find((unitId) => unitId.startsWith(GROUP_UNIT_PREFIX));
  if (!nextGroupUnitId) {
    return null;
  }

  const parsed = parseGroupUnitId(nextGroupUnitId);
  if (!parsed || parsed.artObjectId !== index.artObjectId) {
    return null;
  }

  return {
    artObjectId: index.artObjectId,
    scopeNodeId: parsed.scopeNodeId,
  };
}

function getScopeNode(index: ArtObjectSelectionIndex, scopeNodeId: string | null) {
  if (!scopeNodeId) {
    return index.root;
  }

  return index.nodesByKey.get(scopeNodeId) ?? index.root;
}

function collectSelectableLeafUnits(
  index: ArtObjectSelectionIndex,
  node: IndexedTreeNode,
): SelectableUnit[] {
  const units: SelectableUnit[] = [];

  if (node.node.selectable && node.compositeId) {
    units.push({
      id: node.compositeId,
      artObjectId: index.artObjectId,
      scopeNodeId: node.key,
      label: node.node.label,
      kind: "element",
      elementIds: [node.compositeId],
    });
  }

  for (const child of node.children) {
    units.push(...collectSelectableLeafUnits(index, child));
  }

  return units;
}

function buildGroupModeUnit(
  index: ArtObjectSelectionIndex,
  node: IndexedTreeNode,
): SelectableUnit | null {
  if (node.node.selectable && node.compositeId) {
    return {
      id: node.compositeId,
      artObjectId: index.artObjectId,
      scopeNodeId: node.key,
      label: node.node.label,
      kind: "element",
      elementIds: [node.compositeId],
    };
  }

  if (!node.key) {
    return null;
  }

  return {
    id: buildGroupUnitId(index.artObjectId, node.key),
    artObjectId: index.artObjectId,
    scopeNodeId: node.key,
    label: node.node.label,
    kind: "group",
    elementIds: node.descendantElementIds,
  };
}

function resolveGroupModeUnitForHit(
  index: ArtObjectSelectionIndex,
  scopeNode: IndexedTreeNode,
  hitElementId: string,
) {
  for (const child of scopeNode.children) {
    if (!child.descendantElementIds.includes(hitElementId)) {
      continue;
    }

    return buildGroupModeUnit(index, child);
  }

  return null;
}

function parseGroupUnitId(unitId: string) {
  if (!unitId.startsWith(GROUP_UNIT_PREFIX)) {
    return null;
  }

  const remainder = unitId.slice(GROUP_UNIT_PREFIX.length);
  const separatorIndex = remainder.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  return {
    artObjectId: remainder.slice(0, separatorIndex),
    scopeNodeId: remainder.slice(separatorIndex + 1),
  };
}
