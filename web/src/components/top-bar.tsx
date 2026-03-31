import { Download, FileUp, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { TabId } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TopBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  isReady: boolean;
  isGenerating: boolean;
  hasGenerated: boolean;
  hasSvg: boolean;
  onImportClick: () => void;
  onMakePath: () => void;
  onDownload: () => void;
}

export function TopBar({
  activeTab,
  onTabChange,
  isReady,
  isGenerating,
  hasGenerated,
  hasSvg,
  onImportClick,
  onMakePath,
  onDownload,
}: TopBarProps) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-4 bg-slate-900 px-4">
      <span className="text-sm font-semibold text-slate-100 tracking-tight mr-2">
        SVG Studio
      </span>

      <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-0.5">
        <TabButton
          active={activeTab === "prepare"}
          onClick={() => onTabChange("prepare")}
          color="sky"
        >
          Prepare
        </TabButton>
        <TabButton
          active={activeTab === "preview"}
          onClick={() => onTabChange("preview")}
          disabled={!hasGenerated}
          color="emerald"
        >
          Preview
        </TabButton>
      </div>

      <div className="flex-1" />

      {isGenerating && (
        <span className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating...
        </span>
      )}

      {!isReady && (
        <span className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading WASM...
        </span>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-slate-300 hover:text-slate-100 hover:bg-slate-800"
          onClick={onImportClick}
        >
          <FileUp className="mr-1.5 h-3.5 w-3.5" />
          Import SVG
        </Button>
        <Button
          size="sm"
          className="h-8 bg-sky-600 text-white hover:bg-sky-500"
          onClick={onMakePath}
          disabled={!hasSvg || !isReady || isGenerating}
        >
          <Play className="mr-1.5 h-3.5 w-3.5" />
          Make Path
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-slate-300 hover:text-slate-100 hover:bg-slate-800"
          onClick={onDownload}
          disabled={!hasGenerated}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Download .nc
        </Button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  disabled,
  color,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  color: "sky" | "emerald";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeColors = {
    sky: "bg-sky-600 text-white",
    emerald: "bg-emerald-600 text-white",
  };

  return (
    <button
      className={cn(
        "rounded-md px-4 py-1.5 text-xs font-medium transition-colors",
        active
          ? activeColors[color]
          : "text-slate-400 hover:text-slate-200",
        disabled && "opacity-40 pointer-events-none",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
