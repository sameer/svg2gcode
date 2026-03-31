import type { FrontendOperation, TabId } from "@/lib/types";
import { formatMillimeters } from "@/lib/utils";

interface ViewportToolbarProps {
  activeTab: TabId;
  selectedCount: number;
  activeOperation: FrontendOperation | null;
  materialWidth: number;
  materialHeight: number;
  materialThickness: number;
  toolDiameter: number;
  maxDepth: number;
}

export function ViewportToolbar({
  activeTab,
  selectedCount,
  activeOperation,
  materialWidth,
  materialHeight,
  materialThickness,
  toolDiameter,
  maxDepth,
}: ViewportToolbarProps) {
  if (activeTab === "prepare") {
    return (
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-muted/50 px-4 text-xs text-muted-foreground">
        <span>{selectedCount} selected</span>
        {activeOperation && (
          <>
            <span className="text-border">|</span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: activeOperation.color ?? "#2563eb" }}
              />
              {activeOperation.name}
              <span className="text-muted-foreground/60">
                ({activeOperation.assigned_element_ids.length} parts)
              </span>
            </span>
          </>
        )}
        <span className="ml-auto text-muted-foreground/60">
          Drop SVG to import
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-4 border-b border-border bg-muted/50 px-4 text-xs">
      <Stat label="Stock" value={`${formatMillimeters(materialWidth)} x ${formatMillimeters(materialHeight)}`} />
      <Stat label="Thickness" value={formatMillimeters(materialThickness)} />
      <Stat label="Tool" value={formatMillimeters(toolDiameter)} />
      <Stat label="Depth" value={formatMillimeters(Math.abs(maxDepth))} />
      <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Path-first preview
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-muted-foreground">
      <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}
