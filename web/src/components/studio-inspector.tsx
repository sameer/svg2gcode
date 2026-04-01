import { Lock, Unlock } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  AlignmentAction,
  AssignmentProfileGroup,
  FillMode,
  InspectorContext,
  InspectorTab,
  Settings,
} from "@/lib/types";
import { formatMillimeters } from "@/lib/utils";

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
}: StudioInspectorProps) {
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-1">
          <TabButton active={activeTab === "design"} onClick={() => onTabChange("design")}>
            Design
          </TabButton>
          <TabButton active={activeTab === "material"} onClick={() => onTabChange("material")}>
            Material
          </TabButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
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
          />
        ) : (
          materialContent
        )}
      </div>
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
}: Omit<StudioInspectorProps, "activeTab" | "onTabChange">) {
  if (!settings) {
    return <div className="px-4 py-3 text-sm text-muted-foreground">Loading inspector...</div>;
  }

  if (context.type === "none") {
    return (
      <div className="px-4 py-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Design
        </p>
        <p className="mt-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-5 text-sm leading-relaxed text-muted-foreground">
          Select the full SVG, dive into its parts, or pick individual shapes to edit dimensions and cut profiles here.
        </p>
      </div>
    );
  }

  if (context.type === "svg") {
    return (
      <div className="space-y-5 px-4 py-4">
        <SectionHeader
          eyebrow="Design"
          title="SVG"
          description="Resize, align, and rebalance the full artwork without losing grouped depth profiles."
        />

        <div className="space-y-3 rounded-xl border border-border bg-muted/25 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Dimensions
            </span>
            <button
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
              onClick={() => onSvgAspectLockChange(!svgAspectLocked)}
            >
              {svgAspectLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              {svgAspectLocked ? "Locked" : "Unlocked"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Width"
              unit="mm"
              value={svgWidthMm}
              onChange={(value) => onSvgDimensionChange("width", value)}
            />
            <NumberField
              label="Height"
              unit="mm"
              value={svgHeightMm}
              onChange={(value) => onSvgDimensionChange("height", value)}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-muted/25 p-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Placement
          </span>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Offset X"
              unit="mm"
              value={placementX}
              onChange={(value) =>
                onPlacementChange(value ?? placementX, placementY)
              }
            />
            <NumberField
              label="Offset Y"
              unit="mm"
              value={placementY}
              onChange={(value) =>
                onPlacementChange(placementX, value ?? placementY)
              }
            />
            <NumberField
              label="Padding"
              unit="mm"
              value={paddingMm}
              onChange={onPaddingChange}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {ALIGNMENT_BUTTONS.map(({ action, label }) => (
              <Button
                key={action}
                size="sm"
                variant="outline"
                disabled={!!paddingValidationMessage}
                onClick={() => onAlign(action)}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {paddingValidationMessage ??
              "Align the artwork to the stock edges or center while respecting the current padding."}
          </p>
        </div>

        <ProfileGroupsSection
          title="Depth Profiles"
          description="Editing a profile updates every matching part in this SVG while leaving other groups intact."
          groups={context.profileGroups}
          onDepthChange={onBatchDepthChange}
          onFillModeChange={onBatchFillModeChange}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 py-4">
      <SectionHeader
        eyebrow="Design"
        title={context.elementIds.length === 1 ? "Selected Part" : `${context.elementIds.length} Parts`}
        description="Batch edit the current selection, then refine remaining profile groups below if needed."
      />

      <div className="space-y-3 rounded-xl border border-border bg-muted/25 p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Batch Edit
        </span>
        <div className="grid grid-cols-2 gap-2">
          <MixedNumberField
            label="Depth"
            unit="mm"
            value={context.targetDepthMm}
            mixed={context.mixedDepth}
            onCommit={(value) => {
              if (value != null) {
                onBatchDepthChange(context.elementIds, value);
              }
            }}
          />
          <FillModeField
            label="Fill"
            value={context.fillMode}
            mixed={context.mixedFillMode}
            onChange={(value) => onBatchFillModeChange(context.elementIds, value)}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Mixed values stay untouched until you enter a new value.
        </p>
      </div>

      <ProfileGroupsSection
        title="Profiles In Selection"
        description="Use these grouped controls to retune all matching selected parts together."
        groups={context.profileGroups}
        onDepthChange={onBatchDepthChange}
        onFillModeChange={onBatchFillModeChange}
      />
    </div>
  );
}

function ProfileGroupsSection({
  title,
  description,
  groups,
  onDepthChange,
  onFillModeChange,
}: {
  title: string;
  description: string;
  groups: AssignmentProfileGroup[];
  onDepthChange: (elementIds: string[], value: number) => void;
  onFillModeChange: (elementIds: string[], value: FillMode | null) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">
        {groups.map((group) => (
          <div key={group.key} className="rounded-xl border border-border bg-background p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{formatMillimeters(group.targetDepthMm)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {group.fillMode ?? "Default fill"} · {group.elementIds.length} parts
                </p>
              </div>
              <span className="rounded-full border border-border bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Group
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
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
                label="Fill"
                value={group.fillMode}
                onChange={(value) => onFillModeChange(group.elementIds, value)}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
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
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
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
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          className="h-8 pr-12 text-xs"
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
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
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
  const displayValue =
    editValue ?? (mixed ? "" : value != null ? value.toFixed(2) : "");

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          className="h-8 pr-12 text-xs"
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
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const ALIGNMENT_BUTTONS: Array<{ action: AlignmentAction; label: string }> = [
  { action: "left", label: "Left" },
  { action: "center-x", label: "Center X" },
  { action: "right", label: "Right" },
  { action: "top", label: "Top" },
  { action: "center-y", label: "Center Y" },
  { action: "bottom", label: "Bottom" },
];
