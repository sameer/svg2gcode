import { Chip } from "@heroui/react";

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
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-white/8 bg-white/[0.035] px-4 text-xs text-muted-foreground backdrop-blur-xl">
        <Chip className="border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {selectedCount} selected
        </Chip>
        {activeOperation && (
          <>
            <Chip className="border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: activeOperation.color ?? "#2563eb" }}
                />
                {activeOperation.name}
                <span className="text-muted-foreground/70">
                  {activeOperation.assigned_element_ids.length} parts
                </span>
              </span>
            </Chip>
          </>
        )}
        <span className="ml-auto text-[10px] uppercase tracking-[0.24em] text-muted-foreground/80">
          Drop SVG to import
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-white/8 bg-white/[0.035] px-4 text-xs backdrop-blur-xl">
      <Stat label="Stock" value={`${formatMillimeters(materialWidth)} x ${formatMillimeters(materialHeight)}`} />
      <Stat label="Thickness" value={formatMillimeters(materialThickness)} />
      <Stat label="Tool" value={formatMillimeters(toolDiameter)} />
      <Stat label="Depth" value={formatMillimeters(Math.abs(maxDepth))} />
      <span className="ml-auto text-[10px] uppercase tracking-[0.24em] text-muted-foreground/80">
        Path-first preview
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Chip className="border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold text-foreground">
      <span className="mr-2 uppercase tracking-[0.2em] text-muted-foreground/70">{label}</span>
      <span>{value}</span>
    </Chip>
  );
}
