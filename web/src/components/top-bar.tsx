import { Chip } from "@heroui/react";

import { AppIcon, Icons } from "@/lib/icons";
import type { TabId } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Button } from "./ui/button";

interface TopBarProps {
  activeTab: TabId;
  hasGenerated: boolean;
  isBusy?: boolean;
  onTabChange: (tab: TabId) => void;
  onExport: () => void;
}

export function TopBar({
  activeTab,
  hasGenerated,
  isBusy = false,
  onTabChange,
  onExport,
}: TopBarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-8 z-30 flex justify-center px-6">
      <div className="pointer-events-auto inline-flex items-center gap-3 rounded-[1.75rem] border border-white/8 bg-[rgba(25,25,29,0.92)] p-3 shadow-[0_28px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
        <div className="inline-flex items-center gap-1 rounded-[1.25rem] bg-white/[0.05] p-1">
          <WorkspaceButton
            label="Design"
            icon={Icons.canvas}
            active={activeTab === "prepare"}
            onClick={() => onTabChange("prepare")}
          />
          <WorkspaceButton
            label="3D preview"
            icon={Icons.cube}
            active={activeTab === "preview"}
            disabled={!hasGenerated}
            onClick={() => onTabChange("preview")}
          />
        </div>

        <Button
          size="sm"
          className="h-12 rounded-[1.2rem] px-5 text-[0.95rem]"
          onClick={onExport}
        >
          <AppIcon icon={Icons.export} className="h-4 w-4" />
          Export
        </Button>

        {isBusy ? (
          <Chip className="border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
            Processing
          </Chip>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceButton({
  label,
  icon,
  active,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: typeof Icons.canvas;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-[1rem] px-4 text-base font-medium transition",
        active
          ? "bg-white/[0.16] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          : "text-white/60 hover:bg-white/[0.06] hover:text-white",
        disabled && "cursor-not-allowed opacity-35 hover:bg-transparent hover:text-white/60",
      )}
      disabled={disabled}
      onClick={onClick}
    >
      <AppIcon icon={icon} className="h-4 w-4" />
      {label}
    </button>
  );
}
