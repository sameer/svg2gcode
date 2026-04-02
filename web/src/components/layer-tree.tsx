import { useMemo, useState } from "react";
import { Chip } from "@heroui/react";

import { Input } from "@/components/ui/input";
import { AppIcon, Icons } from "@/lib/icons";
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
  projectName: string;
  projectSubtitle: string;
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
  projectName,
  projectSubtitle,
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
  const [sidebarTab, setSidebarTab] = useState<"layers" | "library">("layers");
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

  const selectedPartCount = selectionTarget === "svg" ? selectableNodes.length : selectedIds.length;

  return (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,rgba(25,25,29,0.96),rgba(20,20,24,0.98))] text-white">
      <div className="border-b border-white/6 px-5 py-5">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-3">
            <div className="text-[2.1rem] font-black tracking-[-0.08em] text-white/70">LOGO</div>
          </div>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-[0.9rem] border border-white/8 bg-white/[0.03] text-white/85">
            <AppIcon icon={Icons.grid} className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-8">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[2rem] font-semibold tracking-[-0.04em] text-white">
              {projectName}
            </h2>
            <AppIcon icon={Icons.chevronDown} className="h-4 w-4 text-white/70" />
          </div>
          <p className="mt-1 text-base text-white/42">{projectSubtitle}</p>
        </div>
      </div>

      <div className="px-5 py-5">
        <div className="flex rounded-[1.35rem] bg-white/[0.06] p-1">
          <SidebarTabButton
            active={sidebarTab === "layers"}
            icon={Icons.layers}
            label="Layers"
            onClick={() => setSidebarTab("layers")}
          />
          <SidebarTabButton
            active={sidebarTab === "library"}
            icon={Icons.library}
            label="Library"
            disabled
            onClick={() => setSidebarTab("library")}
          />
        </div>
      </div>

      {sidebarTab === "library" ? (
        <div className="px-5 pb-5 text-sm text-white/40">
          <div className="rounded-[1.35rem] border border-dashed border-white/10 bg-white/[0.03] px-4 py-5">
            Library items are part of the visual shell for now and will be wired once reusable assets exist in the editor.
          </div>
        </div>
      ) : (
        <>
          <div className="px-5">
            <div className="relative">
              <AppIcon
                icon={Icons.search}
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/34"
              />
              <Input
                className="h-12 rounded-[1.25rem] border-white/5 bg-white/[0.03] pl-11 text-sm text-white placeholder:text-white/28"
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          <div className="px-5 pt-7">
            <p className="mb-3 text-sm font-medium text-white/86">Group by</p>
            <div className="flex flex-wrap gap-2">
              <GroupingChip
                active={mode === "structure"}
                icon={Icons.structure}
                label="Structure"
                onClick={() => setMode("structure")}
              />
              <GroupingChip
                active={mode === "depth"}
                icon={Icons.depth}
                label="Depth"
                onClick={() => setMode("depth")}
              />
              <GroupingChip
                active={mode === "fill"}
                icon={Icons.code}
                label="Cut Type"
                onClick={() => setMode("fill")}
              />
            </div>
          </div>

          <div className="px-5 pt-6">
            <p className="text-[1.05rem] font-medium text-white/88">Layers</p>
          </div>

          <div className="border-b border-white/6 px-5 py-4">
            <ObjectButton
              icon={Icons.cube}
              label="Material"
              active={selectionTarget === "material"}
              onClick={() => onSelectTarget("material")}
            />
            <ObjectButton
              icon={Icons.canvas}
              label="SVG"
              active={selectionTarget === "svg" && !isDiveMode}
              onClick={() => onSelectTarget("svg")}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {!tree ? (
              <div className="mx-1 rounded-[1.35rem] border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-sm leading-relaxed text-white/45">
                Import an SVG from the add-files menu to build the layer stack.
              </div>
            ) : mode === "structure" ? (
              <div className="space-y-1">
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
              <div className="space-y-3">
                {groupedNodes.map((group) => {
                  const isCollapsed = collapsedGroups[group.key] ?? false;
                  return (
                    <div key={group.key} className="rounded-[1.35rem] bg-white/[0.04] p-1">
                      <button
                        className="flex w-full items-center justify-between rounded-[1.1rem] px-3 py-3 text-left hover:bg-white/[0.05]"
                        onClick={() =>
                          setCollapsedGroups((current) => ({
                            ...current,
                            [group.key]: !isCollapsed,
                          }))
                        }
                      >
                        <span className="inline-flex items-center gap-2">
                          <AppIcon
                            icon={isCollapsed ? Icons.chevronRight : Icons.chevronDown}
                            className="h-4 w-4 text-white/48"
                          />
                          <span className="text-sm font-medium text-white">{group.label}</span>
                        </span>
                        <Chip className="bg-white/[0.06] px-2 py-1 text-[11px] font-semibold text-white/56">
                          {group.nodes.length}
                        </Chip>
                      </button>

                      {!isCollapsed ? (
                        <div className="space-y-1 px-1 pb-1">
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

          <div className="border-t border-white/6 px-5 py-5">
            <button className="flex w-full items-center justify-between rounded-[1.25rem] border border-white/8 bg-white/[0.03] px-4 py-3.5 text-left">
              <span className="inline-flex items-center gap-3">
                <AppIcon icon={Icons.search} className="h-5 w-5 text-white/58" />
                <span className="text-[1.15rem] font-medium text-white">Search</span>
              </span>
              <span className="rounded-[0.85rem] border border-white/10 bg-white/[0.05] px-3 py-1 text-sm text-white/58">
                ⌘ K
              </span>
            </button>
            <p className="mt-3 text-xs text-white/30">
              {selectedPartCount > 0 ? `${selectedPartCount} tracked parts in this workspace.` : "No active parts yet."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function SidebarTabButton({
  active,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: typeof Icons.layers;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[1.15rem] text-lg font-medium transition",
        active ? "bg-white/[0.16] text-white" : "text-white/50 hover:bg-white/[0.04] hover:text-white",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-white/50",
      )}
      disabled={disabled}
      onClick={onClick}
    >
      <AppIcon icon={icon} className="h-4 w-4" />
      {label}
    </button>
  );
}

function GroupingChip({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Icons.structure;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition",
        active ? "bg-white/[0.12] text-white" : "bg-white/[0.05] text-white/60 hover:bg-white/[0.08] hover:text-white",
      )}
      onClick={onClick}
    >
      <AppIcon icon={icon} className="h-4 w-4" />
      {label}
    </button>
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
    <div className="space-y-1">
      <button
        className={cn(
          "flex w-full items-center justify-between rounded-[1.1rem] px-3 py-3 text-left transition hover:bg-white/[0.05]",
          isSelected && "bg-white/[0.08]",
          isActiveDiveRoot && "ring-1 ring-primary/40",
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
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
        <span className="flex min-w-0 items-center gap-2">
          <AppIcon icon={Icons.cube} className="h-4 w-4 shrink-0 text-white/52" />
          {elementColor ? (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: elementColor }} />
          ) : null}
          <span className="truncate text-[1.03rem] text-white">{node.label}</span>
        </span>

        <span className="flex items-center gap-2">
          {isActiveDiveRoot ? (
            <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary">
              Dive
            </span>
          ) : null}
          {assignment ? (
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-[#2F95FF]">
              {assignment.targetDepthMm}mm
            </span>
          ) : null}
          <span className="text-xs text-white/32">{node.selectable_descendant_ids.length}</span>
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
        "flex w-full items-center gap-3 rounded-[1.15rem] px-4 py-3 text-left transition hover:bg-white/[0.06]",
        isSelected && "bg-white/[0.1]",
      )}
      onClick={(event) =>
        onSelectIds(
          node.selectable_descendant_ids.slice(0, 1),
          event.metaKey || event.ctrlKey || event.shiftKey,
        )
      }
    >
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04]">
        <span className="h-4 w-1 rounded-full bg-[#FF667A]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[1.05rem] font-medium text-white">{node.label}</p>
      </div>
      <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-[#2F95FF]">
        {assignment ? `${assignment.targetDepthMm}mm` : "Unset"}
      </span>
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-[0.8rem] border border-white/8 bg-white/[0.03] text-white/56">
        <AppIcon icon={Icons.plusCircle} className="h-4 w-4" />
      </span>
      {elementColor ? <span className="hidden rounded-full px-2 py-1 text-[11px]" style={{ color: elementColor }} /> : null}
    </button>
  );
}

function ObjectButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Icons.cube;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "mb-2 flex w-full items-center justify-between rounded-[1.1rem] border px-3 py-3 text-left transition",
        active
          ? "border-primary/30 bg-primary/12 text-white"
          : "border-white/8 bg-white/[0.03] text-white/58 hover:bg-white/[0.05] hover:text-white",
      )}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-2 text-sm font-medium">
        <AppIcon icon={icon} className="h-4 w-4" />
        {label}
      </span>
      <span className="text-[11px] uppercase tracking-[0.16em] text-white/28">Object</span>
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
