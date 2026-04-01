import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import type {
  CanvasSelectionTarget,
  DiveRootScope,
  ElementAssignment,
  LayerGroupingMode,
  SvgTreeNode,
} from "@/lib/types";
import { cn, formatMillimeters } from "@/lib/utils";

interface LayerTreeProps {
  tree: SvgTreeNode | null;
  selectedIds: string[];
  selectionTarget: CanvasSelectionTarget;
  isDiveMode: boolean;
  activeDiveRootId: string | null;
  assignments: Record<string, ElementAssignment>;
  elementColors?: Map<string, string>;
  onSelectIds: (ids: string[], additive: boolean) => void;
  onSelectTarget: (target: CanvasSelectionTarget) => void;
  onActivateDiveRoot: (scope: DiveRootScope | null) => void;
}

export function LayerTree({
  tree,
  selectedIds,
  selectionTarget,
  isDiveMode,
  activeDiveRootId,
  assignments,
  elementColors,
  onSelectIds,
  onSelectTarget,
  onActivateDiveRoot,
}: LayerTreeProps) {
  const [mode, setMode] = useState<LayerGroupingMode>("structure");
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const selectableNodes = useMemo(() => flattenSelectableNodes(tree), [tree]);
  const filteredNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return selectableNodes;
    }

    return selectableNodes.filter((node) => {
      const label = `${node.label} ${node.tag_name} ${node.id ?? ""}`.toLowerCase();
      return label.includes(normalizedQuery);
    });
  }, [query, selectableNodes]);

  const groupedNodes = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; nodes: typeof filteredNodes }>();
    for (const node of filteredNodes) {
      const assignment = node.id ? assignments[node.id] : null;
      const key =
        mode === "depth"
          ? `depth:${assignment?.targetDepthMm ?? 0}`
          : `fill:${assignment?.fillMode ?? "default"}`;
      const label =
        mode === "depth"
          ? formatMillimeters(assignment?.targetDepthMm ?? 0)
          : assignment?.fillMode ?? "Default fill";
      const existing = groups.get(key);
      if (existing) {
        existing.nodes.push(node);
      } else {
        groups.set(key, { key, label, nodes: [node] });
      }
    }
    return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [assignments, filteredNodes, mode]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Layers
        </p>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-9 text-xs"
            placeholder="Search parts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="mt-3 flex gap-2 rounded-lg bg-muted/50 p-1">
          {(["structure", "depth", "fill"] as const).map((value) => (
            <button
              key={value}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium capitalize transition",
                mode === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setMode(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-border px-3 py-3">
        <ObjectButton
          label="Material"
          active={selectionTarget === "material"}
          onClick={() => onSelectTarget("material")}
        />
        <ObjectButton
          label="SVG"
          active={selectionTarget === "svg" && !isDiveMode}
          onClick={() => onSelectTarget("svg")}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {!tree ? (
          <p className="px-2 text-xs text-muted-foreground">Import an SVG to inspect its structure.</p>
        ) : mode === "structure" ? (
          <div className="space-y-0.5">
            <StructureTree
              node={tree}
              selectedIds={selectedIds}
              assignments={assignments}
              elementColors={elementColors}
              query={query}
              activeDiveRootId={activeDiveRootId}
              onSelectIds={onSelectIds}
              onSelectTarget={onSelectTarget}
              onActivateDiveRoot={onActivateDiveRoot}
            />
          </div>
        ) : (
          <div className="space-y-2">
            {groupedNodes.map((group) => {
              const isCollapsed = collapsedGroups[group.key] ?? false;
              return (
                <div key={group.key} className="rounded-xl border border-border bg-muted/20">
                  <button
                    className="flex w-full items-center justify-between px-3 py-2 text-left"
                    onClick={() =>
                      setCollapsedGroups((current) => ({
                        ...current,
                        [group.key]: !isCollapsed,
                      }))
                    }
                  >
                    <span className="flex items-center gap-2">
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="text-xs font-medium text-foreground">{group.label}</span>
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {group.nodes.length}
                    </span>
                  </button>
                  {!isCollapsed ? (
                    <div className="space-y-0.5 border-t border-border px-2 py-2">
                      {group.nodes.map((node) => (
                        <PartRow
                          key={node.id ?? node.label}
                          node={node}
                          selectedIds={selectedIds}
                          assignments={assignments}
                          elementColors={elementColors}
                          onSelectIds={onSelectIds}
                        />
                      ))}
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

function StructureTree({
  node,
  selectedIds,
  assignments,
  elementColors,
  query,
  activeDiveRootId,
  onSelectIds,
  onSelectTarget,
  onActivateDiveRoot,
  depth = 0,
  path = "0",
}: {
  node: SvgTreeNode;
  selectedIds: string[];
  assignments: Record<string, ElementAssignment>;
  elementColors?: Map<string, string>;
  query: string;
  activeDiveRootId: string | null;
  onSelectIds: (ids: string[], additive: boolean) => void;
  onSelectTarget: (target: CanvasSelectionTarget) => void;
  onActivateDiveRoot: (scope: DiveRootScope | null) => void;
  depth?: number;
  path?: string;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const matchesSelf = !normalizedQuery
    ? true
    : `${node.label} ${node.tag_name} ${node.id ?? ""}`.toLowerCase().includes(normalizedQuery);
  const nodeKey = node.id ?? path;
  const children = node.children
    .map((child, index) => (
      <StructureTree
        key={`${child.id ?? child.label}-${path}-${index}`}
        node={child}
        selectedIds={selectedIds}
        assignments={assignments}
        elementColors={elementColors}
        query={query}
        activeDiveRootId={activeDiveRootId}
        onSelectIds={onSelectIds}
        onSelectTarget={onSelectTarget}
        onActivateDiveRoot={onActivateDiveRoot}
        depth={depth + 1}
        path={`${path}.${index}`}
      />
    ))
    .filter(Boolean);

  if (!matchesSelf && children.length === 0) {
    return null;
  }

  const selectedCount = node.selectable_descendant_ids.filter((id) => selectedIds.includes(id)).length;
  const isSelected = selectedCount > 0;
  const isActiveDiveRoot = activeDiveRootId === nodeKey;
  const assignment = node.id ? assignments[node.id] : null;
  const elementColor = node.id ? elementColors?.get(node.id) ?? null : null;

  return (
    <div className="space-y-0.5">
      <button
        className={cn(
          "flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent/70",
          isSelected && "bg-accent/70 text-foreground",
          isActiveDiveRoot && "ring-1 ring-primary/50",
        )}
        style={{ paddingLeft: `${8 + depth * 10}px` }}
        onClick={(event) => {
          if (node.tag_name === "svg") {
            onSelectTarget("svg");
            return;
          }

          if (!node.selectable && node.selectable_descendant_ids.length > 0) {
            onActivateDiveRoot({
              id: nodeKey,
              label: node.label,
              elementIds: node.selectable_descendant_ids,
            });
            return;
          }

          onSelectIds(
            node.selectable ? node.selectable_descendant_ids.slice(0, 1) : node.selectable_descendant_ids,
            event.metaKey || event.ctrlKey || event.shiftKey,
          );
        }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          {elementColor ? (
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: elementColor }} />
          ) : null}
          <span className="truncate">{node.label}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {isActiveDiveRoot ? (
            <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary">
              Dive
            </span>
          ) : null}
          {assignment ? (
            <span className="rounded px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
              {assignment.targetDepthMm}mm
            </span>
          ) : null}
          <span className="text-[10px] text-muted-foreground">{node.selectable_descendant_ids.length}</span>
        </span>
      </button>
      {children}
    </div>
  );
}

function PartRow({
  node,
  selectedIds,
  assignments,
  elementColors,
  onSelectIds,
}: {
  node: SvgTreeNode;
  selectedIds: string[];
  assignments: Record<string, ElementAssignment>;
  elementColors?: Map<string, string>;
  onSelectIds: (ids: string[], additive: boolean) => void;
}) {
  const isSelected = node.id ? selectedIds.includes(node.id) : false;
  const assignment = node.id ? assignments[node.id] : null;
  const elementColor = node.id ? elementColors?.get(node.id) ?? null : null;

  return (
    <button
      className={cn(
        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/70",
        isSelected && "bg-accent/70 text-foreground",
      )}
      onClick={(event) =>
        onSelectIds(
          node.selectable_descendant_ids.slice(0, 1),
          event.metaKey || event.ctrlKey || event.shiftKey,
        )
      }
    >
      <span className="flex min-w-0 items-center gap-2">
        {elementColor ? (
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: elementColor }} />
        ) : null}
        <span className="truncate">{node.label}</span>
      </span>
      <span className="text-[10px] text-muted-foreground">
        {assignment ? `${assignment.targetDepthMm}mm` : "Unassigned"}
      </span>
    </button>
  );
}

function ObjectButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "mb-2 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs font-medium transition",
        active
          ? "border-primary bg-primary/8 text-foreground"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Object
      </span>
    </button>
  );
}

function flattenSelectableNodes(tree: SvgTreeNode | null) {
  if (!tree) {
    return [];
  }

  const nodes: SvgTreeNode[] = [];
  const visit = (node: SvgTreeNode) => {
    if (node.id && node.selectable_descendant_ids.length > 0) {
      nodes.push(node);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(tree);
  return nodes;
}
