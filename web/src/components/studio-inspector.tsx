import { Button, ButtonGroup, Chip, Input, Label, Tabs } from "@heroui/react";

import { AppIcon, Icons } from "@/lib/icons";
import type {
  AlignmentAction,
  ArtObject,
  AssignmentProfileGroup,
  FillMode,
  InspectorContext,
  InspectorTab,
  Settings,
} from "@/lib/types";
import { cn, formatMillimeters } from "@/lib/utils";

interface StudioInspectorProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  materialContent?: React.ReactNode;
  context: InspectorContext;
  activeArtObject: ArtObject | null;
  allProfileGroups: AssignmentProfileGroup[];
  activeProfileKey: string | null;
  settings: Settings | null;
  paddingValidationMessage: string | null;
  onSvgDimensionChange: (dimension: "width" | "height", value: number | null) => void;
  onSvgAspectLockChange: (value: boolean) => void;
  onPlacementChange: (x: number, y: number) => void;
  onAlign: (alignment: AlignmentAction) => void;
  onBatchDepthChange: (elementIds: string[], value: number) => void;
  onBatchFillModeChange: (elementIds: string[], value: FillMode) => void;
  onProfilePreview: (profileKey: string | null) => void;
  onProfilePreviewClear: () => void;
  onProfileSelect: (elementIds: string[]) => void;
}

export function StudioInspector({
  activeTab,
  onTabChange,
  materialContent,
  context,
  activeArtObject,
  allProfileGroups,
  activeProfileKey,
  settings,
  paddingValidationMessage,
  onSvgDimensionChange,
  onSvgAspectLockChange,
  onPlacementChange,
  onAlign,
  onBatchDepthChange,
  onBatchFillModeChange,
  onProfilePreview,
  onProfilePreviewClear,
  onProfileSelect,
}: StudioInspectorProps) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center justify-between px-4 py-4">
        <div className="h-9 w-9 rounded-full bg-primary/30" />
        <Button size="sm">Share</Button>
      </div>

      <div className="px-4 pb-4">
        <Tabs className="w-full max-w-md" selectedKey={activeTab} onSelectionChange={(key) => onTabChange(String(key) as InspectorTab)}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="Inspector tabs">
              <Tabs.Tab id="design">Design<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="material">Material<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {activeTab === "material" ? (
          materialContent
        ) : (
          <div className="space-y-5">
            <section className="space-y-4">
              <SectionHeading title="Selected art" />
              {activeArtObject ? (
                <>
                  <div className="rounded-md border border-border bg-content1 px-3 py-3">
                    <p className="text-sm font-medium text-foreground">{activeArtObject.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatMillimeters(activeArtObject.widthMm)} × {formatMillimeters(activeArtObject.heightMm)}
                    </p>
                  </div>

                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Alignment</p>
                    <div className="grid grid-cols-2 gap-3">
                      <AlignmentCluster onAlign={onAlign} disabled={!!paddingValidationMessage} />
                      <AlignmentCluster vertical onAlign={onAlign} disabled={!!paddingValidationMessage} />
                    </div>
                    {paddingValidationMessage ? <p className="mt-2 text-xs text-amber-700">{paddingValidationMessage}</p> : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <InsetLabelField
                      label="Y"
                      value={activeArtObject.placementY}
                      suffix="mm"
                      onChange={(value) => onPlacementChange(activeArtObject.placementX, value ?? activeArtObject.placementY)}
                    />
                    <InsetLabelField
                      label="X"
                      value={activeArtObject.placementX}
                      suffix="mm"
                      onChange={(value) => onPlacementChange(value ?? activeArtObject.placementX, activeArtObject.placementY)}
                    />
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3">
                    <InsetLabelField
                      label="W"
                      value={activeArtObject.widthMm}
                      suffix="mm"
                      onChange={(value) => onSvgDimensionChange("width", value)}
                    />
                    <InsetLabelField
                      label="H"
                      value={activeArtObject.heightMm}
                      suffix="mm"
                      onChange={(value) => onSvgDimensionChange("height", value)}
                    />
                    <button
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border transition",
                        activeArtObject.aspectLocked ? "text-foreground" : "text-muted-foreground",
                      )}
                      onClick={() => onSvgAspectLockChange(!activeArtObject.aspectLocked)}
                    >
                      <AppIcon icon={activeArtObject.aspectLocked ? Icons.lock : Icons.lockOpen} className="h-5 w-5" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-dashed border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
                  Select an art object to edit its placement and dimensions.
                </div>
              )}
            </section>

            <section className="space-y-4">
              <SectionHeading
                title="Cut depths"
                rightContent={
                  <Chip size="sm" variant={context.type === "selection" ? "primary" : "soft"}>
                    {context.type === "selection" ? `${context.elementIds.length} selected` : `${allProfileGroups.length} groups`}
                  </Chip>
                }
              />
              <ProfileGroupsSection
                groups={context.type === "selection" ? context.profileGroups : allProfileGroups}
                selectionActive={context.type === "selection"}
                activeProfileKey={activeProfileKey}
                onPreview={onProfilePreview}
                onPreviewClear={onProfilePreviewClear}
                onSelect={onProfileSelect}
                onDepthChange={onBatchDepthChange}
                onFillModeChange={onBatchFillModeChange}
              />
            </section>

            {!settings ? <div className="text-sm text-white/50">Loading inspector…</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileGroupsSection({
  groups,
  selectionActive,
  activeProfileKey,
  onPreview,
  onPreviewClear,
  onSelect,
  onDepthChange,
  onFillModeChange,
}: {
  groups: AssignmentProfileGroup[];
  selectionActive: boolean;
  activeProfileKey: string | null;
  onPreview: (profileKey: string | null) => void;
  onPreviewClear: () => void;
  onSelect: (elementIds: string[]) => void;
  onDepthChange: (elementIds: string[], value: number) => void;
  onFillModeChange: (elementIds: string[], value: FillMode) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
        No assigned parts yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div
          key={group.key}
          className={cn("rounded-md border border-border bg-content1 p-3", activeProfileKey === group.key && "ring-1 ring-primary/30")}
        >
          <div className="flex items-center gap-2.5">
            <span className="h-4 w-4 rounded-[4px]" style={{ backgroundColor: group.color }} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-none text-foreground">{formatMillimeters(group.targetDepthMm)}</p>
              <p className="mt-1 text-xs leading-none text-muted-foreground">{group.elementIds.length} parts</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onPress={() => (activeProfileKey === group.key ? onPreviewClear() : onPreview(group.key))}
            >
              {activeProfileKey === group.key ? "Hide" : "Preview"}
            </Button>
            {!selectionActive ? (
              <Button size="sm" variant="ghost" onPress={() => onSelect(group.elementIds)}>
                Select
              </Button>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <NumberField
              label="Depth"
              unit="mm"
              value={group.targetDepthMm}
              onChange={(value) => {
                if (value != null) {
                  onDepthChange(group.elementIds, value);
                }
              }}
            />
            <FillModeField
              label="Part fill"
              value={group.fillMode}
              onChange={(value) => onFillModeChange(group.elementIds, value)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ title, rightContent }: { title: string; rightContent?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div>{rightContent}</div>
    </div>
  );
}

function AlignmentCluster({
  vertical = false,
  disabled = false,
  onAlign,
}: {
  vertical?: boolean;
  disabled?: boolean;
  onAlign: (alignment: AlignmentAction) => void;
}) {
  const actions = vertical
    ? [
        { action: "top" as const, icon: Icons.alignTop },
        { action: "center-y" as const, icon: Icons.alignCenterVertical },
        { action: "bottom" as const, icon: Icons.alignBottom },
      ]
    : [
        { action: "left" as const, icon: Icons.alignLeft },
        { action: "center-x" as const, icon: Icons.alignCenterHorizontal },
        { action: "right" as const, icon: Icons.alignRight },
      ];

  return (
    <ButtonGroup size="sm" variant="secondary" isDisabled={disabled}>
      {actions.map(({ action, icon }, index) => (
        <Button key={action} isIconOnly onPress={() => onAlign(action)}>
          {index > 0 ? <ButtonGroup.Separator /> : null}
          <AppIcon icon={icon} className="h-5 w-5" />
        </Button>
      ))}
    </ButtonGroup>
  );
}

function FillModeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FillMode | null;
  onChange: (value: FillMode) => void;
}) {
  return (
    <div className="grid min-w-0 w-full gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <select
        className="h-10 rounded-md border border-border bg-content2 px-3 text-sm text-foreground"
        value={value ?? "Pocket"}
        onChange={(event) => onChange(event.target.value as FillMode)}
      >
        <option value="Pocket">Pocket</option>
        <option value="Contour">Contour</option>
      </select>
    </div>
  );
}

function InsetLabelField({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={String(value)}
        onChange={(event) => onChange(Number.isFinite(Number(event.target.value)) ? Number(event.target.value) : null)}
      />
      {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

function NumberField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value == null ? "" : String(value)}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? parsed : null);
        }}
      />
      <span className="text-xs text-muted-foreground">{unit}</span>
    </div>
  );
}
