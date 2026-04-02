"use client";

import { Sparkles } from "@gravity-ui/icons";
import { Button, Spinner, Tabs } from "@heroui/react";

import { AppIcon, Icons } from "@/lib/icons";
import type { TabId } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TopBarProps {
  activeTab: TabId;
  canPreview: boolean;
  isBusy?: boolean;
  processLabel: string;
  processDisabled?: boolean;
  exportDisabled?: boolean;
  onTabChange: (tab: TabId) => void;
  onProcess: () => void;
  onExport: () => void;
  onPreviewBlocked?: () => void;
}

export function TopBar({
  activeTab,
  canPreview,
  isBusy = false,
  processLabel,
  processDisabled = false,
  exportDisabled = false,
  onTabChange,
  onProcess,
  onExport,
  onPreviewBlocked,
}: TopBarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto inline-flex h-16 items-center gap-3 rounded-[1.75rem] border border-white/10 bg-[rgba(19,19,23,0.9)] px-3 text-white shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
        <Tabs
          className="w-[215px]"
          selectedKey={activeTab}
          onSelectionChange={(key) => {
            const next = String(key) as TabId;
            if (next === "preview" && !canPreview) {
              onPreviewBlocked?.();
              return;
            }

            if (next === "prepare" || next === "preview") {
              onTabChange(next);
            }
          }}
        >
          <Tabs.ListContainer>
            <Tabs.List className="h-10 rounded-[1.2rem] bg-[#27272A] p-1" aria-label="Workspace tabs">
              <Tabs.Tab className="text-sm text-white" id="prepare">
                Design
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab className={cn("text-sm text-white", !canPreview && "opacity-55")} id="preview">
                Preview
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>

        <Button
          className="rounded-full text-[14px] text-white"
          size="sm"
          variant="secondary"
          isPending={isBusy}
          isDisabled={processDisabled}
          onPress={onProcess}
        >
          {({ isPending }) => (
            <>
              {isPending ? <Spinner color="current" size="sm" /> : <Sparkles className="h-4 w-4" />}
              {processLabel}
            </>
          )}
        </Button>

        <Button
          className="rounded-full text-[14px] text-white"
          size="sm"
          variant="secondary"
          isDisabled={exportDisabled}
          onPress={onExport}
        >
          <AppIcon icon={Icons.export} className="h-4 w-4" />
          Export
        </Button>
      </div>
    </div>
  );
}
