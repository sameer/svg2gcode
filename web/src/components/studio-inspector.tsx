import { useCallback, useState } from "react";
import { Chip } from "@heroui/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppIcon, Icons } from "@/lib/icons";
import type {
  AlignmentAction,
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
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,rgba(25,25,29,0.96),rgba(20,20,24,0.98))] text-white">
      <ShellHeader />

      <div className="px-5 pb-5">
        <div className="flex rounded-[1.35rem] bg-white/[0.06] p-1">
          <InspectorTabButton
            active={activeTab === "design"}
            label="Design"
            onClick={() => onTabChange("design")}
          />
          <InspectorTabButton
            active={activeTab === "material"}
            label="Material"
            onClick={() => onTabChange("material")}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
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

function ShellHeader() {
  return (
    <div className="flex items-center justify-between px-5 py-7">
      <div className="h-11 w-11 rounded-full bg-[radial-gradient(circle_at_35%_35%,#fff7cf,#ff9848_58%,#ff5225)] shadow-[0_10px_30px_rgba(255,122,60,0.24)]" />
      <Button className="h-12 rounded-[1.25rem] px-6 text-lg">Share</Button>
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
    <div className="space-y-7">
      <div className="flex flex-wrap gap-2">
        <BadgePill accent={selectionCount > 0}>{selectionCount} selected</BadgePill>
        <BadgePill>{depthBadge}</BadgePill>
        <BadgePill>{paddingMm} mm</BadgePill>
      </div>

      <section className="space-y-4">
        <SectionHeading title="Position" />
        <div>
          <p className="mb-3 text-sm text-white/70">Alignment</p>
          <div className="grid grid-cols-2 gap-3">
            <AlignmentCluster onAlign={onAlign} disabled={!!paddingValidationMessage} />
            <AlignmentCluster
              vertical
              onAlign={onAlign}
              disabled={!!paddingValidationMessage}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-white/36">
            {paddingValidationMessage ?? "Common alignment controls are grouped here so you can position the artwork without bouncing between cards."}
          </p>
        </div>

        <div>
          <p className="mb-3 text-sm text-white/70">Rotation</p>
          <div className="flex items-center rounded-[1.2rem] bg-white/[0.05]">
            <DisabledIconButton icon={Icons.rotateLeft} />
            <div className="flex h-14 min-w-0 flex-1 items-center justify-center border-x border-white/6 text-lg text-white/48">
              0
            </div>
            <DisabledIconButton icon={Icons.rotateRight} />
            <DisabledIconButton icon={Icons.reset} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <CompactField
            label="Y"
            value={placementY}
            suffix="mm"
            icon={Icons.positionY}
            onChange={(value) => onPlacementChange(placementX, value ?? placementY)}
          />
          <CompactField
            label="X"
            value={placementX}
            suffix="mm"
            icon={Icons.positionX}
            onChange={(value) => onPlacementChange(value ?? placementX, placementY)}
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading title="Layout" />
        <div>
          <p className="mb-3 text-sm text-white/70">Dimensions</p>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
            <CompactField
              label="W"
              value={svgWidthMm}
              suffix="mm"
              icon={Icons.width}
              onChange={(value) => onSvgDimensionChange("width", value)}
            />
            <CompactField
              label="H"
              value={svgHeightMm}
              suffix="mm"
              icon={Icons.positionY}
              onChange={(value) => onSvgDimensionChange("height", value)}
            />
            <button
              className={cn(
                "inline-flex h-14 w-14 items-center justify-center rounded-[1.1rem] bg-white/[0.05] text-white transition",
                svgAspectLocked ? "text-white" : "text-white/42",
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
            <CompactField
              label="Padding"
              value={paddingMm}
              suffix="mm"
              icon={Icons.grid}
              onChange={onPaddingChange}
            />
          </div>
        </div>
      </section>

      {context.type === "none" ? (
        <div className="rounded-[1.35rem] border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-sm leading-relaxed text-white/42">
          Select the SVG or one or more parts to edit cut depth, fill mode, and placement settings here.
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
              label="Fill"
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
          className="rounded-[1.35rem] bg-white/[0.05] px-4 py-4"
        >
          <div className="flex items-center gap-3">
            <span
              className="h-4 w-4 rounded-[4px]"
              style={{ backgroundColor: group.fillMode === "Contour" ? "#67B8FF" : "#FF667A" }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[1.05rem] font-medium text-white">
                {formatMillimeters(group.targetDepthMm)}
              </p>
              <p className="text-sm text-white/36">{group.elementIds.length} parts</p>
            </div>
            <div className="text-sm text-white/42">{group.fillMode ?? "Default"}</div>
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
              label="Fill"
              value={group.fillMode}
              onChange={(value) => onFillModeChange(group.elementIds, value)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function InspectorTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "h-12 flex-1 rounded-[1.15rem] text-lg font-medium transition",
        active ? "bg-white/[0.16] text-white" : "text-white/55 hover:bg-white/[0.04] hover:text-white",
      )}
      onClick={onClick}
    >
      {label}
    </button>
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
      <h3 className="text-[1.15rem] font-medium text-white">{title}</h3>
      {actionLabel ? <button className="text-3xl leading-none text-white/72">{actionLabel}</button> : null}
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
      className={cn(
        "px-3 py-1 text-[0.95rem] font-medium",
        accent ? "bg-primary text-white" : "bg-white/[0.06] text-white/72",
      )}
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
    <div className="flex rounded-[1.2rem] bg-white/[0.05] p-1">
      {actions.map(({ action, icon }, index) => (
        <button
          key={action}
          className={cn(
            "inline-flex h-12 flex-1 items-center justify-center text-white transition hover:bg-white/[0.08]",
            index > 0 && "border-l border-white/6",
            disabled && "cursor-not-allowed text-white/22 hover:bg-transparent",
          )}
          disabled={disabled}
          onClick={() => onAlign(action)}
        >
          <AppIcon icon={icon} className="h-5 w-5" />
        </button>
      ))}
    </div>
  );
}

function DisabledIconButton({ icon }: { icon: typeof Icons.rotateLeft }) {
  return (
    <button
      className="inline-flex h-14 w-14 items-center justify-center text-white/26"
      disabled
    >
      <AppIcon icon={icon} className="h-5 w-5" />
    </button>
  );
}

function CompactField({
  label,
  value,
  suffix,
  icon,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  icon: typeof Icons.positionX;
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

  const displayValue = editValue ?? value.toFixed(3).replace(/\.?0+$/, "");

  return (
    <div className="flex h-14 items-center rounded-[1.15rem] bg-white/[0.05]">
      <div className="inline-flex min-w-[3.25rem] items-center justify-center gap-1 text-sm text-white/46">
        <AppIcon icon={icon} className="h-4 w-4" />
        {label}
      </div>
      <Input
        type="text"
        inputMode="decimal"
        className="h-full border-0 bg-transparent px-0 text-[1.1rem] text-white focus-visible:ring-0"
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
      <div className="pr-4 text-[1.1rem] text-white/62">{suffix}</div>
    </div>
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
      <Label className="text-xs text-white/45">{label}</Label>
      <select
        className="h-12 rounded-[1rem] border border-white/8 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-primary/35"
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
      <Label className="text-xs text-white/45">{label}</Label>
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          className="h-12 rounded-[1rem] border-white/8 bg-white/[0.04] pr-12 text-sm text-white"
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
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40">
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
    <div className="grid gap-1.5">
      <Label className="text-xs text-white/45">{label}</Label>
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          className="h-12 rounded-[1rem] border-white/8 bg-white/[0.04] pr-12 text-sm text-white"
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
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40">
          {unit}
        </span>
      </div>
    </div>
  );
}
