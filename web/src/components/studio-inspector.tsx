import { useCallback, useState } from "react";
import { Button, ButtonGroup, Chip, Input, Label, Tabs } from "@heroui/react";
import { AppIcon, Icons } from "@/lib/icons";
import type {
  AlignmentAction,
  AssignmentProfileGroup,
  FillMode,
  InspectorContext,
  InspectorTab,
  Settings,
} from "@/lib/types";
import { FILL_MODE_VISUALS } from "@/lib/material-presets";
import { cn, formatMillimeters } from "@/lib/utils";

interface StudioInspectorProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  materialContent?: React.ReactNode;
  context: InspectorContext;
  settings: Settings | null;
  svgWidthMm: number;
  svgHeightMm: number;
  svgAspectLocked: boolean;
  placementX: number;
  placementY: number;
  paddingMm: number;
  paddingValidationMessage: string | null;
  onSvgDimensionChange: (dimension: "width" | "height", value: number | null) => void;
  onSvgAspectLockChange: (value: boolean) => void;
  onPlacementChange: (x: number, y: number) => void;
  onPaddingChange: (value: number | null) => void;
  onAlign: (alignment: AlignmentAction) => void;
  onBatchDepthChange: (elementIds: string[], value: number) => void;
  onBatchFillModeChange: (elementIds: string[], value: FillMode | null) => void;
  onDefaultFillModeChange: (value: FillMode) => void;
}

export function StudioInspector({
  activeTab,
  onTabChange,
  materialContent,
  context,
  settings,
  svgWidthMm,
  svgHeightMm,
  svgAspectLocked,
  placementX,
  placementY,
  paddingMm,
  paddingValidationMessage,
  onSvgDimensionChange,
  onSvgAspectLockChange,
  onPlacementChange,
  onPaddingChange,
  onAlign,
  onBatchDepthChange,
  onBatchFillModeChange,
  onDefaultFillModeChange,
}: StudioInspectorProps) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <ShellHeader />

      <div className="px-4 pb-4">
        <Tabs
          className="w-full max-w-md"
          selectedKey={activeTab}
          onSelectionChange={(key) => {
            const next = String(key) as InspectorTab;
            if (next === "design" || next === "material") {
              onTabChange(next);
            }
          }}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="Inspector tabs">
              <Tabs.Tab id="design">
              Design
              <Tabs.Indicator />
            </Tabs.Tab>
              <Tabs.Tab id="material">
              Material
              <Tabs.Indicator />
            </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {activeTab === "design" ? (
          <DesignTab
            context={context}
            settings={settings}
            svgWidthMm={svgWidthMm}
            svgHeightMm={svgHeightMm}
            svgAspectLocked={svgAspectLocked}
            placementX={placementX}
            placementY={placementY}
            paddingMm={paddingMm}
            paddingValidationMessage={paddingValidationMessage}
            onSvgDimensionChange={onSvgDimensionChange}
            onSvgAspectLockChange={onSvgAspectLockChange}
            onPlacementChange={onPlacementChange}
            onPaddingChange={onPaddingChange}
            onAlign={onAlign}
            onBatchDepthChange={onBatchDepthChange}
            onBatchFillModeChange={onBatchFillModeChange}
            onDefaultFillModeChange={onDefaultFillModeChange}
          />
        ) : (
          materialContent
        )}
      </div>
    </div>
  );
}

function ShellHeader() {
  return (
    <div className="flex items-center justify-between px-4 py-4">
      <div className="h-9 w-9 rounded-full bg-primary/30" />
      <Button size="sm">Share</Button>
    </div>
  );
}

function DesignTab({
  context,
  settings,
  svgWidthMm,
  svgHeightMm,
  svgAspectLocked,
  placementX,
  placementY,
  paddingMm,
  paddingValidationMessage,
  onSvgDimensionChange,
  onSvgAspectLockChange,
  onPlacementChange,
  onPaddingChange,
  onAlign,
  onBatchDepthChange,
  onBatchFillModeChange,
  onDefaultFillModeChange,
}: Omit<StudioInspectorProps, "activeTab" | "onTabChange" | "materialContent">) {
  if (!settings) {
    return <div className="text-sm text-white/50">Loading inspector…</div>;
  }

  const selectionCount = context.type === "none" ? 0 : context.elementIds.length;
  const mixedDepth = context.type === "selection" ? context.mixedDepth : false;
  const mixedFill = context.type === "selection" ? context.mixedFillMode : false;
  const depthBadge =
    context.type === "selection"
      ? context.targetDepthMm != null
        ? `${context.targetDepthMm} mm`
        : "Mixed"
      : `${settings.engraving.target_depth} mm`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <BadgePill accent={selectionCount > 0}>{selectionCount} selected</BadgePill>
        <BadgePill>{depthBadge}</BadgePill>
        <BadgePill>{paddingMm} mm</BadgePill>
      </div>

      <section className="space-y-4">
        <SectionHeading title="Position" />
        <div>
          <p className="mb-2 text-xs text-muted-foreground">Alignment</p>
          <div className="grid grid-cols-2 gap-3">
            <AlignmentCluster onAlign={onAlign} disabled={!!paddingValidationMessage} />
            <AlignmentCluster
              vertical
              onAlign={onAlign}
              disabled={!!paddingValidationMessage}
            />
          </div>
          {paddingValidationMessage ? (
            <p className="mt-2 text-xs text-amber-700">{paddingValidationMessage}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <InsetLabelField
            label="Y"
            value={placementY}
            suffix="mm"
            onChange={(value) => onPlacementChange(placementX, value ?? placementY)}
          />
          <InsetLabelField
            label="X"
            value={placementX}
            suffix="mm"
            onChange={(value) => onPlacementChange(value ?? placementX, placementY)}
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading title="Layout" />
        <div>
          <p className="mb-3 text-sm text-muted-foreground">Dimensions</p>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3">
            <InsetLabelField
              label="W"
              value={svgWidthMm}
              suffix="mm"
              onChange={(value) => onSvgDimensionChange("width", value)}
            />
            <InsetLabelField
              label="H"
              value={svgHeightMm}
              suffix="mm"
              onChange={(value) => onSvgDimensionChange("height", value)}
            />
            <button
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border transition",
                svgAspectLocked ? "text-foreground" : "text-muted-foreground",
              )}
              onClick={() => onSvgAspectLockChange(!svgAspectLocked)}
            >
              <AppIcon
                icon={svgAspectLocked ? Icons.lock : Icons.lockOpen}
                className="h-5 w-5"
              />
            </button>
          </div>
          <div className="mt-3 max-w-[12rem]">
            <NumberField
              label="Padding"
              value={paddingMm}
              unit="mm"
              onChange={onPaddingChange}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading title="Defaults" />
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">Fill type</Label>
          <div className="flex flex-wrap gap-3">
            {FILL_MODE_VISUALS.map((option) => (
              <VisualModeOption
                key={option.mode}
                label={option.label}
                previewClassName={option.previewClassName}
                isSelected={settings.engraving.fill_mode === option.mode}
                onClick={() => onDefaultFillModeChange(option.mode)}
              />
            ))}
          </div>
        </div>
      </section>

      {context.type === "none" ? (
        <div className="rounded-md border border-dashed border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
          Select one or more parts to edit cut settings.
        </div>
      ) : context.type === "selection" ? (
        <section className="space-y-4">
          <SectionHeading title="Cut depths" actionLabel="+" />
          <div className="grid grid-cols-2 gap-3">
            <MixedNumberField
              label="Depth"
              unit="mm"
              value={context.targetDepthMm}
              mixed={mixedDepth}
              onCommit={(value) => {
                if (value != null) {
                  onBatchDepthChange(context.elementIds, value);
                }
              }}
            />
            <FillModeField
              label="Part fill"
              value={context.fillMode}
              mixed={mixedFill}
              onChange={(value) => onBatchFillModeChange(context.elementIds, value)}
            />
          </div>
          <ProfileGroupsSection
            groups={context.profileGroups}
            onDepthChange={onBatchDepthChange}
            onFillModeChange={onBatchFillModeChange}
          />
        </section>
      ) : (
        <section className="space-y-4">
          <SectionHeading title="Cut depths" actionLabel="+" />
          <ProfileGroupsSection
            groups={context.profileGroups}
            onDepthChange={onBatchDepthChange}
            onFillModeChange={onBatchFillModeChange}
          />
        </section>
      )}
    </div>
  );
}

function ProfileGroupsSection({
  groups,
  onDepthChange,
  onFillModeChange,
}: {
  groups: AssignmentProfileGroup[];
  onDepthChange: (elementIds: string[], value: number) => void;
  onFillModeChange: (elementIds: string[], value: FillMode | null) => void;
}) {
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div
          key={group.key}
          className="rounded-md border border-border bg-content1 p-3"
        >
          <div className="flex items-center gap-3">
            <span
              className="h-4 w-4 rounded-[4px]"
              style={{ backgroundColor: group.fillMode === "Contour" ? "#67B8FF" : "#FF667A" }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {formatMillimeters(group.targetDepthMm)}
              </p>
              <p className="text-xs text-muted-foreground">{group.elementIds.length} parts</p>
            </div>
            <div className="text-xs text-muted-foreground">{group.fillMode ?? "Default"}</div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
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

function SectionHeading({
  title,
  actionLabel,
}: {
  title: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {actionLabel ? <Button size="sm" variant="ghost">{actionLabel}</Button> : null}
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
    <Chip
      size="sm"
      color={accent ? "accent" : "default"}
      variant={accent ? "primary" : "soft"}
    >
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
        <Button
          key={action}
          isIconOnly
          onPress={() => onAlign(action)}
        >
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
  onChange: (value: FillMode | null) => void;
}) {
  const selectValue = mixed ? "__mixed__" : value ?? "";

  return (
    <div className="grid min-w-0 w-full gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <select
        className="h-9 min-w-0 w-full rounded-md border border-input bg-background px-2 text-sm"
        value={selectValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (nextValue === "__mixed__") {
            return;
          }
          onChange(nextValue === "" ? null : (nextValue as FillMode));
        }}
      >
        {mixed ? <option value="__mixed__">Mixed</option> : null}
        <option value="">Default</option>
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
  suffix: string;
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
      <div className="shrink-0 pl-2 text-xs text-muted-foreground">{suffix}</div>
    </div>
  );
}

function VisualModeOption({
  label,
  previewClassName,
  isSelected,
  onClick,
}: {
  label: string;
  previewClassName: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-[7.25rem] items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition",
        isSelected
          ? "border-primary bg-primary/12 text-foreground"
          : "border-border bg-content1 text-muted-foreground hover:border-primary/45",
      )}
    >
      <span className={cn("h-4 w-6 rounded-sm border border-border/70 bg-content2", previewClassName)} />
      <span className="font-medium">{label}</span>
    </button>
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
  value: number;
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

  const displayValue = editValue ?? value.toFixed(2);

  return (
    <div className="grid min-w-0 w-full gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative min-w-0">
        <Input
          type="text"
          inputMode="decimal"
          className="h-9 min-w-0 w-full pr-10 text-sm"
          value={displayValue}
          onFocus={(event) => {
            setEditValue(value.toFixed(2));
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

function MixedNumberField({
  label,
  unit,
  value,
  mixed,
  onCommit,
}: {
  label: string;
  unit: string;
  value: number | null;
  mixed: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [editValue, setEditValue] = useState<string | null>(null);
  const displayValue = editValue ?? (mixed ? "" : value != null ? value.toFixed(2) : "");

  return (
    <div className="grid min-w-0 w-full gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative min-w-0">
        <Input
          type="text"
          inputMode="decimal"
          className="h-9 min-w-0 w-full pr-10 text-sm"
          placeholder={mixed ? "Mixed" : "0.00"}
          value={displayValue}
          onFocus={(event) => {
            setEditValue(mixed ? "" : value != null ? value.toFixed(2) : "");
            requestAnimationFrame(() => event.target.select());
          }}
          onChange={(event) => setEditValue(event.target.value)}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            if (raw === "") {
              setEditValue(null);
              return;
            }
            const parsed = Number.parseFloat(raw);
            if (Number.isFinite(parsed)) {
              onCommit(parsed);
            }
            setEditValue(null);
          }}
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
