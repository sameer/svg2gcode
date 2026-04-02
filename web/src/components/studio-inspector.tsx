import { useCallback, useState } from "react";
import { ChevronDown } from "@gravity-ui/icons";
import { Button, ButtonGroup, Chip, Dropdown, Input, Label, Tabs } from "@heroui/react";

import { AppIcon, Icons } from "@/lib/icons";
import { FILL_MODE_VISUALS } from "@/lib/material-presets";
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
  const selectionCount = context.type === "none" ? 0 : context.elementIds.length;
  const selectionActive = context.type === "selection";

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
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {selectionActive ? (
                      <BadgePill accent>
                        <span className="text-xs">Editing {selectionCount} selected</span>
                      </BadgePill>
                    ) : (
                      <BadgePill>{`${allProfileGroups.length} groups`}</BadgePill>
                    )}
                  </div>
                }
              />
              <ProfileGroupsSection
                groups={context.type === "selection" ? context.profileGroups : allProfileGroups}
                selectionActive={selectionActive}
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
      {groups.map((group) => {
        const cardAccent = accentColor(group.color, activeProfileKey === group.key ? 0.08 : 0);
        const borderAccent = accentColor(group.color, activeProfileKey === group.key ? 0.45 : 0);

        return (
          <div
            role="button"
            tabIndex={0}
            key={group.key}
            className="w-full cursor-pointer rounded-md border bg-content1 p-2.5 text-left transition duration-150 hover:bg-white/[0.03]"
            style={{
              backgroundColor: cardAccent ?? undefined,
              borderColor: borderAccent ?? undefined,
              boxShadow:
                activeProfileKey === group.key
                  ? `0 0 0 1px ${accentColor(group.color, 0.18)}`
                  : undefined,
            }}
            onClick={() => {
              if (activeProfileKey === group.key) {
                onPreviewClear();
              } else {
                onPreview(group.key);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (activeProfileKey === group.key) {
                  onPreviewClear();
                } else {
                  onPreview(group.key);
                }
              }
            }}
          >
          <div className="flex items-center gap-2.5">
            <span className="h-4 w-4 rounded-[4px]" style={{ backgroundColor: group.color }} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-none text-foreground">{formatMillimeters(group.targetDepthMm)}</p>
              <p className="mt-1 text-xs leading-none text-muted-foreground">{group.elementIds.length} parts</p>
            </div>
            {!selectionActive ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 min-w-0 border border-white/12 bg-white/[0.06] px-2.5 text-xs font-medium text-white hover:bg-white/[0.12]"
                onClick={(event) => event.stopPropagation()}
                onPress={() => onSelect(group.elementIds)}
              >
                Select
              </Button>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5" onClick={(event) => event.stopPropagation()}>
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
              mixed={selectionActive && group.fillMode == null}
              onChange={(value) => onFillModeChange(group.elementIds, value)}
            />
          </div>
        </div>
        );
      })}
    </div>
  );
}

function accentColor(hex: string, alpha: number) {
  if (alpha <= 0) {
    return null;
  }

  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function SectionHeading({ title, rightContent }: { title: string; rightContent?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div>{rightContent}</div>
    </div>
  );
}

function BadgePill({
  children,
  accent = false,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Chip size="sm" color={accent ? "accent" : "default"} variant={accent ? "primary" : "soft"}>
      {children}
    </Chip>
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
  mixed = false,
  onChange,
}: {
  label: string;
  value: FillMode | null;
  mixed?: boolean;
  onChange: (value: FillMode) => void;
}) {
  const selectValue = mixed ? "__mixed__" : value ?? "Pocket";

  return (
    <div className="grid min-w-0 w-full gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <FillModeDropdown
        value={value}
        mixed={mixed}
        onChange={onChange}
        selectValue={selectValue}
      />
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
  const [editValue, setEditValue] = useState<string | null>(null);

  const commit = useCallback(
    (raw: string) => {
      const parsed = Number.parseFloat(raw);
      if (raw.trim() === "") {
        onChange(null);
      } else if (Number.isFinite(parsed)) {
        onChange(parsed);
      }
      setEditValue(null);
    },
    [onChange],
  );

  const displayValue = editValue ?? value.toFixed(2).replace(/\.?0+$/, "");

  return (
    <div className="flex h-9 w-full min-w-0 items-center rounded-md border border-border bg-content1 px-2">
      <div className="inline-flex min-w-[1rem] shrink-0 items-center justify-center text-xs text-muted-foreground">
        {label}
      </div>
      <Input
        type="text"
        inputMode="decimal"
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 text-sm"
        value={displayValue}
        onFocus={(event) => {
          setEditValue(String(value));
          requestAnimationFrame(() => event.target.select());
        }}
        onChange={(event) => setEditValue(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setEditValue(null);
            event.currentTarget.blur();
          }
        }}
      />
      {suffix ? <div className="shrink-0 pl-2 text-xs text-muted-foreground">{suffix}</div> : null}
    </div>
  );
}

function FillModeDropdown({
  value,
  mixed,
  selectValue,
  onChange,
}: {
  value: FillMode | null;
  mixed: boolean;
  selectValue: string;
  onChange: (value: FillMode) => void;
}) {
  const selectedOption = mixed
    ? null
    : FILL_MODE_VISUALS.find((option) => option.mode === (value ?? "Pocket")) ?? null;

  return (
    <Dropdown>
      <Dropdown.Trigger>
        <Button
          variant="ghost"
          className="h-8 w-full justify-between rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <span className="flex items-center gap-2">
            {mixed ? (
              <span className="text-sm text-muted-foreground">Mixed</span>
            ) : selectedOption ? (
              <>
                <span
                  className={cn("h-4 w-6 rounded-sm border border-border/70 bg-content2", selectedOption.previewClassName)}
                />
                <span>{selectedOption.label}</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Pocket</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu
          aria-label="Fill mode"
          selectedKeys={new Set([selectValue])}
          selectionMode="single"
          onAction={(key) => {
            const nextValue = String(key);
            if (nextValue === "__mixed__") {
              return;
            }
            onChange(nextValue as FillMode);
          }}
        >
          {mixed ? <Dropdown.Item id="__mixed__">Mixed</Dropdown.Item> : null}
          {FILL_MODE_VISUALS.map((option) => (
            <Dropdown.Item key={option.mode} id={option.mode} textValue={option.label}>
              <span className="flex items-center gap-2">
                <span
                  className={cn("h-4 w-6 rounded-sm border border-border/70 bg-content2", option.previewClassName)}
                />
                <span>{option.label}</span>
              </span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
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
  const [editValue, setEditValue] = useState<string | null>(null);

  const commit = useCallback(
    (raw: string) => {
      const parsed = Number.parseFloat(raw);
      if (raw.trim() === "") {
        onChange(null);
      } else if (Number.isFinite(parsed)) {
        onChange(parsed);
      }
      setEditValue(null);
    },
    [onChange],
  );

  const displayValue = editValue ?? (value == null ? "" : value.toFixed(2));

  return (
    <div className="grid min-w-0 w-full gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative min-w-0">
        <Input
          type="text"
          inputMode="decimal"
          className="h-8 min-w-0 w-full pr-10 text-sm"
          value={displayValue}
          onFocus={(event) => {
            setEditValue(value == null ? "" : value.toFixed(2));
            requestAnimationFrame(() => event.target.select());
          }}
          onChange={(event) => setEditValue(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setEditValue(null);
              event.currentTarget.blur();
            }
          }}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
}
