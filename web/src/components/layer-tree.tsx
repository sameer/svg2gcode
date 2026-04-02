import { useMemo, useState } from "react";
import { Button, Input } from "@heroui/react";
import ChevronDownIcon from "@gravity-ui/icons/esm/ChevronDown.js";
import ChevronRightIcon from "@gravity-ui/icons/esm/ChevronRight.js";

import { cloneTreeWithCompositeIds, localElementColor } from "@/lib/art-objects";
import { AppIcon, Icons } from "@/lib/icons";
import type { ArtObject, DiveRootScope, EditorSelection, SvgTreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

interface LayerTreeProps {
  artObjects: ArtObject[];
  projectName: string;
  onProjectNameChange: (name: string) => void;
  selection: EditorSelection;
  activeDiveRootId: string | null;
  onSelectMaterial: () => void;
  onSelectArtObject: (artObjectId: string) => void;
  onSelectIds: (artObjectId: string, ids: string[], additive: boolean) => void;
  onActivateDiveRoot: (scope: DiveRootScope | null) => void;
  onHoverIdsChange: (ids: string[]) => void;
  onAddClick: () => void;
}

export function LayerTree({
  artObjects,
  projectName,
  onProjectNameChange,
  selection,
  activeDiveRootId,
  onSelectMaterial,
  onSelectArtObject,
  onSelectIds,
  onActivateDiveRoot,
  onHoverIdsChange,
  onAddClick,
}: LayerTreeProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const filteredArtObjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return artObjects;
    }

    return artObjects.filter((artObject) => {
      const tree = cloneTreeWithCompositeIds(artObject.preparedSvg.tree, artObject.id);
      return matchesTree(tree, normalizedQuery) || artObject.name.toLowerCase().includes(normalizedQuery);
    });
  }, [artObjects, query]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="text-xl font-bold text-foreground">Engrav Studio</div>
          <Button isIconOnly size="sm" variant="secondary" onPress={onSelectMaterial}>
            <AppIcon icon={Icons.layers} className="h-4 w-4" />
          </Button>
        </div>

        <Input
          aria-label="Project name"
          className="mt-4"
          value={projectName}
          onChange={(event) => onProjectNameChange(event.target.value)}
        />

        <Button className="mt-4 w-full justify-start" variant="secondary" onPress={onAddClick}>
          <AppIcon icon={Icons.plus} className="h-4 w-4" />
          Add art object
        </Button>
      </div>

      <div className="border-b border-border px-4 py-3">
        <Input
          aria-label="Search layers"
          placeholder="Search art objects and layers"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" onMouseLeave={() => onHoverIdsChange([])}>
        {filteredArtObjects.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
            Drag SVGs onto the canvas or use Add art object to start building the layer stack.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredArtObjects.map((artObject) => {
              const tree = cloneTreeWithCompositeIds(artObject.preparedSvg.tree, artObject.id);
              const selected =
                selection.type === "art-object" && selection.artObjectId === artObject.id;
              const selectionCount =
                selection.type === "elements" && selection.artObjectId === artObject.id
                  ? selection.elementIds.length
                  : 0;
              const isCollapsed = collapsed[artObject.id] ?? false;

              return (
                <div key={artObject.id} className="rounded-lg border border-border bg-content1">
                  <button
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-3 text-left transition hover:bg-content2",
                      selected && "bg-content3",
                    )}
                    onClick={() => onSelectArtObject(artObject.id)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        role="button"
                        tabIndex={0}
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-content2"
                        onClick={(event) => {
                          event.stopPropagation();
                          setCollapsed((current) => ({ ...current, [artObject.id]: !isCollapsed }));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            setCollapsed((current) => ({ ...current, [artObject.id]: !isCollapsed }));
                          }
                        }}
                      >
                        {isCollapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
                      </span>
                      <AppIcon icon={Icons.picture} className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate text-sm font-medium">{artObject.name}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {selectionCount > 0 ? `${selectionCount} selected` : `${tree.selectable_descendant_ids.length} parts`}
                    </span>
                  </button>

                  {!isCollapsed ? (
                    <div className="border-t border-border px-1 py-1">
                      <TreeNode
                        node={tree}
                        artObject={artObject}
                        query={query}
                        selection={selection}
                        activeDiveRootId={activeDiveRootId}
                        onSelectArtObject={onSelectArtObject}
                        onSelectIds={onSelectIds}
                        onActivateDiveRoot={onActivateDiveRoot}
                        onHoverIdsChange={onHoverIdsChange}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  artObject,
  query,
  selection,
  activeDiveRootId,
  onSelectArtObject,
  onSelectIds,
  onActivateDiveRoot,
  onHoverIdsChange,
  depth = 0,
}: {
  node: SvgTreeNode;
  artObject: ArtObject;
  query: string;
  selection: EditorSelection;
  activeDiveRootId: string | null;
  onSelectArtObject: (artObjectId: string) => void;
  onSelectIds: (artObjectId: string, ids: string[], additive: boolean) => void;
  onActivateDiveRoot: (scope: DiveRootScope | null) => void;
  onHoverIdsChange: (ids: string[]) => void;
  depth?: number;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const matchesSelf = !normalizedQuery
    ? true
    : `${node.label} ${node.tag_name} ${node.id ?? ""}`.toLowerCase().includes(normalizedQuery);
  const children = node.children
    .map((child) => (
      <TreeNode
        key={child.id ?? `${node.id}-${child.label}`}
        node={child}
        artObject={artObject}
        query={query}
        selection={selection}
        activeDiveRootId={activeDiveRootId}
        onSelectArtObject={onSelectArtObject}
        onSelectIds={onSelectIds}
        onActivateDiveRoot={onActivateDiveRoot}
        onHoverIdsChange={onHoverIdsChange}
        depth={depth + 1}
      />
    ))
    .filter(Boolean);

  if (!matchesSelf && children.length === 0) {
    return null;
  }

  const isSelected =
    (selection.type === "art-object" && selection.artObjectId === artObject.id && node.tag_name === "svg") ||
    (selection.type === "elements" && node.id != null && selection.elementIds.includes(node.id));
  const isActiveDiveRoot = activeDiveRootId === `${artObject.id}:${node.id ?? node.label}`;
  const color = node.id ? localElementColor(artObject, node.id) : null;

  return (
    <div className="space-y-1">
      <button
        className={cn("flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-content2", isSelected && "bg-content3")}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onMouseEnter={() => onHoverIdsChange(node.selectable_descendant_ids)}
        onMouseLeave={() => onHoverIdsChange([])}
        onClick={(event) => {
          if (node.tag_name === "svg") {
            onSelectArtObject(artObject.id);
            return;
          }

          if (!node.selectable && node.selectable_descendant_ids.length > 0) {
            onActivateDiveRoot({
              id: `${artObject.id}:${node.id ?? node.label}`,
              label: node.label,
              elementIds: node.selectable_descendant_ids,
              artObjectId: artObject.id,
            });
            return;
          }

          onSelectIds(
            artObject.id,
            node.selectable ? node.selectable_descendant_ids.slice(0, 1) : node.selectable_descendant_ids,
            event.metaKey || event.ctrlKey || event.shiftKey,
          );
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          {color ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /> : null}
          <span className="truncate text-sm">{node.label}</span>
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {isActiveDiveRoot ? <span>Dive</span> : null}
          {node.selectable_descendant_ids.length > 1 ? <span>{node.selectable_descendant_ids.length}</span> : null}
        </span>
      </button>
      {children}
    </div>
  );
}

function matchesTree(node: SvgTreeNode, query: string): boolean {
  if (`${node.label} ${node.tag_name} ${node.id ?? ""}`.toLowerCase().includes(query)) {
    return true;
  }
  return node.children.some((child) => matchesTree(child, query));
}
