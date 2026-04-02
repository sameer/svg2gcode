import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, Description, Dropdown, Header, Input, Label, SearchField, Separator, Tag, TagGroup, Tabs } from "@heroui/react";
import EllipsisVerticalIcon from "@gravity-ui/icons/esm/EllipsisVertical.js";
import ChevronDownIcon from "@gravity-ui/icons/esm/ChevronDown.js";
import ChevronRightIcon from "@gravity-ui/icons/esm/ChevronRight.js";
import GeoIcon from "@gravity-ui/icons/esm/Geo.js";
import Layers3DiagonalIcon from "@gravity-ui/icons/esm/Layers3Diagonal.js";
import PencilIcon from "@gravity-ui/icons/esm/Pencil.js";
import SquareArticleIcon from "@gravity-ui/icons/esm/SquareArticle.js";
import SquarePlusIcon from "@gravity-ui/icons/esm/SquarePlus.js";
import TrashBinIcon from "@gravity-ui/icons/esm/TrashBin.js";
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
  onProjectNameChange: (name: string) => void;
  selectedIds: string[];
  selectionTarget: CanvasSelectionTarget;
  activeDiveRootId: string | null;
  assignments: Record<string, ElementAssignment>;
  elementColors?: Map<string, string>;
  onSelectIds: (ids: string[], additive: boolean) => void;
  onSelectTarget: (target: CanvasSelectionTarget) => void;
  onActivateDiveRoot: (scope: DiveRootScope | null) => void;
  onHoverIdsChange: (ids: string[]) => void;
}

export function LayerTree({
  tree,
  projectName,
  onProjectNameChange,
  selectedIds,
  selectionTarget,
  activeDiveRootId,
  assignments,
  elementColors,
  onSelectIds,
  onSelectTarget,
  onActivateDiveRoot,
  onHoverIdsChange,
}: LayerTreeProps) {
  const [mode, setMode] = useState<LayerGroupingMode>("structure");
  const [query, setQuery] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"layers" | "library">("layers");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [collapsedStructureNodes, setCollapsedStructureNodes] = useState<Record<string, boolean>>({});
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState(projectName);
  const projectNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditingProjectName) {
      return;
    }

    const timer = window.setTimeout(() => {
      projectNameInputRef.current?.focus();
      projectNameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isEditingProjectName]);

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

  const commitProjectNameDraft = () => {
    const normalized = projectNameDraft.trim();
    if (normalized.length > 0 && normalized !== projectName) {
      onProjectNameChange(normalized);
    }
    setProjectNameDraft((current) => (current.trim().length > 0 ? current.trim() : projectName));
    setIsEditingProjectName(false);
  };

  const startEditingProjectName = () => {
    setProjectNameDraft(projectName);
    setIsEditingProjectName(true);
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-3">
            <div className="text-xl font-bold text-foreground">Engrav Studio</div>
          </div>
          <Button isIconOnly size="sm" variant="secondary">
            <AppIcon icon={Icons.pause} className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-2">
            {isEditingProjectName ? (
              <Input
                ref={projectNameInputRef}
                aria-label="Project name"
                className="max-w-[220px]"
                value={projectNameDraft}
                onChange={(event) => setProjectNameDraft(event.target.value)}
                onBlur={commitProjectNameDraft}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitProjectNameDraft();
                  }
                  if (event.key === "Escape") {
                    setProjectNameDraft(projectName);
                    setIsEditingProjectName(false);
                  }
                }}
              />
            ) : (
              <button
                className="max-w-[220px] truncate rounded-md border border-border bg-content1 px-3 py-1.5 text-left text-lg font-semibold text-foreground transition hover:bg-content2"
                onClick={startEditingProjectName}
                title="Rename project"
              >
                {projectName}
              </button>
            )}
            <Dropdown>
              <Dropdown.Trigger>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Project menu">
                  <EllipsisVerticalIcon className="h-4 w-4" />
                </Button>
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label="Project menu"
                  onAction={(key) => {
                    if (key === "rename-project") {
                      startEditingProjectName();
                      return;
                    }
                    console.log(`Selected: ${key}`);
                  }}
                >
                  <Dropdown.Section>
                    <Header>Actions</Header>
                    <Dropdown.Item id="new-project" textValue="New project">
                      <div className="flex h-8 items-start justify-center pt-px">
                        <SquarePlusIcon className="size-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className="flex flex-col">
                        <Label>New project</Label>
                        <Description>Create a new project</Description>
                      </div>
                    </Dropdown.Item>
                    <Dropdown.Item id="rename-project" textValue="Rename project">
                      <div className="flex h-8 items-start justify-center pt-px">
                        <PencilIcon className="size-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className="flex flex-col">
                        <Label>Rename project</Label>
                        <Description>Change this project name</Description>
                      </div>
                    </Dropdown.Item>
                  </Dropdown.Section>
                  <Separator />
                  <Dropdown.Section>
                    <Header>Danger zone</Header>
                    <Dropdown.Item id="delete-project" textValue="Delete project" variant="danger">
                      <div className="flex h-8 items-start justify-center pt-px">
                        <TrashBinIcon className="size-4 shrink-0 text-danger" />
                      </div>
                      <div className="flex flex-col">
                        <Label>Delete project</Label>
                        <Description>Move project to trash</Description>
                      </div>
                    </Dropdown.Item>
                  </Dropdown.Section>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </div>
      </div>

      <div className="px-4 py-3">
        <Tabs
          className="w-full max-w-md"
          selectedKey={sidebarTab}
          onSelectionChange={(key) => {
            const next = String(key) as "layers" | "library";
            if (next === "layers" || next === "library") {
              setSidebarTab(next);
            }
          }}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="Sidebar tabs">
              <Tabs.Tab id="layers">
              Layers
              <Tabs.Indicator />
            </Tabs.Tab>
              <Tabs.Tab id="library" isDisabled>
              Library
              <Tabs.Indicator />
            </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </div>

      {sidebarTab === "library" ? (
        <div className="px-4 pb-4 text-sm text-muted-foreground">
          <div className="rounded-md border border-dashed border-border bg-content1 px-3 py-3">
            Library items are part of the visual shell for now and will be wired once reusable assets exist in the editor.
          </div>
        </div>
      ) : (
        <>
          <div className="px-4 pt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Group by</p>
            <TagGroup aria-label="Group layers by" selectionMode="single">
              <TagGroup.List className="flex flex-wrap gap-2">
                <Tag
                  className={cn(mode === "structure" ? "bg-content3" : undefined)}
                  id="group-structure"
                  size="md"
                  onPress={() => setMode("structure")}
                >
                  <SquareArticleIcon className="h-4 w-4" />
                  Structure
                </Tag>
                <Tag
                  className={cn(mode === "depth" ? "bg-content3" : undefined)}
                  id="group-depth"
                  size="md"
                  onPress={() => setMode("depth")}
                >
                  <Layers3DiagonalIcon className="h-4 w-4" />
                  Depth
                </Tag>
                <Tag
                  className={cn(mode === "fill" ? "bg-content3" : undefined)}
                  id="group-cut-type"
                  size="md"
                  onPress={() => setMode("fill")}
                >
                  <GeoIcon className="h-4 w-4" />
                  Cut Type
                </Tag>
              </TagGroup.List>
            </TagGroup>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" onMouseLeave={() => onHoverIdsChange([])}>
            {!tree ? (
              <div className="mx-1 rounded-md border border-dashed border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
                Drag an SVG onto the canvas or use Add files (SVG) to build the layer stack.
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
                  collapsedNodeMap={collapsedStructureNodes}
                  onToggleCollapse={(nodeKey) =>
                    setCollapsedStructureNodes((current) => ({
                      ...current,
                      [nodeKey]: !(current[nodeKey] ?? false),
                    }))
                  }
                  onHoverIdsChange={onHoverIdsChange}
                />
              </div>
            ) : (
              <div className="space-y-3">
                {groupedNodes.map((group) => {
                  const isCollapsed = collapsedGroups[group.key] ?? false;
                  return (
                    <div key={group.key} className="rounded-md border border-border bg-content1 p-1">
                      <button
                        className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left hover:bg-content2"
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
                            className="h-4 w-4 text-muted-foreground"
                          />
                          <span className="text-sm font-medium text-foreground">{group.label}</span>
                        </span>
                        <Chip size="sm" variant="soft">
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
                              onHoverIdsChange={onHoverIdsChange}
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

          <div className="border-t border-border px-4 py-3">
            <SearchField
              aria-label="Search layers"
              fullWidth
              name="search-layers"
            >
              <SearchField.Group>
                <SearchField.SearchIcon>
                  <svg height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
                    <path
                      clipRule="evenodd"
                      d="M12.5 4c0 .174-.071.513-.885.888S9.538 5.5 8 5.5s-2.799-.237-3.615-.612C3.57 4.513 3.5 4.174 3.5 4s.071-.513.885-.888S6.462 2.5 8 2.5s2.799.237 3.615.612c.814.375.885.714.885.888m-1.448 2.66C10.158 6.888 9.115 7 8 7s-2.158-.113-3.052-.34l1.98 2.905c.21.308.322.672.322 1.044v3.37q.088.02.25.021c.422 0 .749-.14.95-.316c.185-.162.3-.38.3-.684v-2.39c0-.373.112-.737.322-1.045zM8 1c3.314 0 6 1 6 3a3.24 3.24 0 0 1-.563 1.826l-3.125 4.584a.35.35 0 0 0-.062.2V13c0 1.5-1.25 2.5-2.75 2.5s-1.75-1-1.75-1v-3.89a.35.35 0 0 0-.061-.2L2.563 5.826A3.24 3.24 0 0 1 2 4c0-2 2.686-3 6-3m-.88 12.936q-.015-.008-.013-.01z"
                      fill="currentColor"
                      fillRule="evenodd"
                    />
                  </svg>
                </SearchField.SearchIcon>
                <SearchField.Input
                  placeholder="Search layers"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <SearchField.ClearButton>
                  <svg height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
                    <path
                      clipRule="evenodd"
                      d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14M6.53 5.47a.75.75 0 0 0-1.06 1.06L6.94 8L5.47 9.47a.75.75 0 1 0 1.06 1.06L8 9.06l1.47 1.47a.75.75 0 1 0 1.06-1.06L9.06 8l1.47-1.47a.75.75 0 0 0-1.06-1.06L8 6.94z"
                      fill="currentColor"
                      fillRule="evenodd"
                    />
                  </svg>
                </SearchField.ClearButton>
              </SearchField.Group>
            </SearchField>
            <p className="mt-2 text-xs text-muted-foreground">
              {selectedPartCount > 0 ? `${selectedPartCount} tracked parts in this workspace.` : "No active parts yet."}
            </p>
          </div>
        </>
      )}
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
  collapsedNodeMap,
  onToggleCollapse,
  onHoverIdsChange,
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
  collapsedNodeMap: Record<string, boolean>;
  onToggleCollapse: (nodeKey: string) => void;
  onHoverIdsChange: (ids: string[]) => void;
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
        collapsedNodeMap={collapsedNodeMap}
        onToggleCollapse={onToggleCollapse}
        onHoverIdsChange={onHoverIdsChange}
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
  const hasChildren = children.length > 0;
  const isCollapsed = collapsedNodeMap[nodeKey] ?? false;
  const showCount = node.selectable_descendant_ids.length > 1;

  return (
    <div className="space-y-1">
      <button
        className={cn(
          "flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition hover:bg-content2",
          isSelected && "bg-content3",
          isActiveDiveRoot && "ring-1 ring-primary/40",
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onMouseEnter={() => onHoverIdsChange(node.selectable_descendant_ids)}
        onMouseLeave={() => onHoverIdsChange([])}
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
          {hasChildren ? (
            <span
              role="button"
              tabIndex={0}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-content2"
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapse(nodeKey);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleCollapse(nodeKey);
                }
              }}
              aria-label={isCollapsed ? "Expand layer" : "Collapse layer"}
            >
              {isCollapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
            </span>
          ) : (
            <span className="inline-flex h-5 w-5 items-center justify-center">
              <AppIcon icon={Icons.cube} className="h-4 w-4 shrink-0 text-muted-foreground" />
            </span>
          )}
          {assignment ? (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
              style={{ backgroundColor: elementColor ?? "#374151" }}
            >
              {assignment.targetDepthMm}mm
            </span>
          ) : null}
          <span className="truncate text-sm text-foreground">{node.label}</span>
        </span>

        <span className="flex items-center gap-2">
          {isActiveDiveRoot ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              Dive
            </span>
          ) : null}
          {showCount ? <span className="text-xs text-muted-foreground">{node.selectable_descendant_ids.length}</span> : null}
        </span>
      </button>
      {!isCollapsed ? children : null}
    </div>
  );
}

function PartRow({
  node,
  selectedIds,
  assignments,
  elementColors,
  onSelectIds,
  onHoverIdsChange,
}: {
  node: SvgTreeNode;
  selectedIds: string[];
  assignments: Record<string, ElementAssignment>;
  elementColors?: Map<string, string>;
  onSelectIds: (ids: string[], additive: boolean) => void;
  onHoverIdsChange: (ids: string[]) => void;
}) {
  const isSelected = node.id ? selectedIds.includes(node.id) : false;
  const assignment = node.id ? assignments[node.id] : null;
  const elementColor = node.id ? elementColors?.get(node.id) ?? null : null;

  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition hover:bg-content2",
        isSelected && "bg-content3",
      )}
      onMouseEnter={() => onHoverIdsChange(node.selectable_descendant_ids)}
      onMouseLeave={() => onHoverIdsChange([])}
      onClick={(event) =>
        onSelectIds(
          node.selectable_descendant_ids.slice(0, 1),
          event.metaKey || event.ctrlKey || event.shiftKey,
        )
      }
    >
      {assignment ? (
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
          style={{ backgroundColor: elementColor ?? "#374151" }}
        >
          {assignment.targetDepthMm}mm
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{node.label}</p>
      </div>
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
