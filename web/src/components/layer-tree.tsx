import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { SvgTreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

interface LayerTreeProps {
  tree: SvgTreeNode | null;
  selectedIds: string[];
  onSelectIds: (ids: string[], additive: boolean) => void;
}

export function LayerTree({ tree, selectedIds, onSelectIds }: LayerTreeProps) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Layers & Parts
      </button>
      {open && (
        <div className="px-2 pb-3">
          {tree ? (
            <TreeNode node={tree} selectedIds={selectedIds} depth={0} onSelectIds={onSelectIds} />
          ) : (
            <p className="px-2 text-xs text-muted-foreground">Import an SVG to inspect its structure.</p>
          )}
        </div>
      )}
    </div>
  );
}

function TreeNode({
  node,
  selectedIds,
  depth,
  onSelectIds,
}: {
  node: SvgTreeNode;
  selectedIds: string[];
  depth: number;
  onSelectIds: (ids: string[], additive: boolean) => void;
}) {
  const selectedCount = node.selectable_descendant_ids.filter((id) => selectedIds.includes(id)).length;
  const isSelected = selectedCount > 0;

  return (
    <div className="space-y-0.5">
      <button
        className={cn(
          "flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent",
          isSelected && "bg-accent/70 text-foreground",
        )}
        style={{ paddingLeft: `${8 + depth * 10}px` }}
        onClick={(event) =>
          onSelectIds(
            node.selectable ? node.selectable_descendant_ids.slice(0, 1) : node.selectable_descendant_ids,
            event.metaKey || event.ctrlKey || event.shiftKey,
          )
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.label}</span>
        </span>
        <span className="text-[10px] text-muted-foreground">
          {node.selectable_descendant_ids.length}
        </span>
      </button>
      {node.children.length > 0 && (
        <div className="space-y-0.5">
          {node.children.map((child) => (
            <TreeNode
              key={`${child.id ?? child.label}-${depth}`}
              node={child}
              selectedIds={selectedIds}
              depth={depth + 1}
              onSelectIds={onSelectIds}
            />
          ))}
        </div>
      )}
    </div>
  );
}
