import { useCallback, useMemo, useState } from "react";
import { Chip } from "@heroui/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppIcon, Icons } from "@/lib/icons";
import type { FillMode, Settings } from "@/lib/types";

interface MaterialInspectorProps {
  settings: Settings | null;
  recommendedAdvanced: Record<string, number>;
  advancedOverrides: Record<string, boolean>;
  onMaterialSizeChange: (dimension: "width" | "height", value: number | null) => void;
  onNumberChange: (
    path: string,
    value: number | null,
    source: "basic" | "advanced",
  ) => void;
  onToolShapeChange: (value: "Flat" | "Ball" | "V") => void;
  onFillModeChange: (value: FillMode) => void;
  onResetAdvancedRecommendations: () => void;
}

export function MaterialInspector({
  settings,
  recommendedAdvanced,
  advancedOverrides,
  onMaterialSizeChange,
  onNumberChange,
  onToolShapeChange,
  onFillModeChange,
  onResetAdvancedRecommendations,
}: MaterialInspectorProps) {
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const advancedOverrideCount = useMemo(
    () => Object.values(advancedOverrides).filter(Boolean).length,
    [advancedOverrides],
  );

  if (!settings) {
    return <div className="text-sm text-white/50">Loading settings…</div>;
  }

  const depth = settings.engraving.target_depth ?? 1;
  const stepdown = settings.engraving.max_stepdown ?? 3;
  const passes = Math.max(1, Math.ceil(depth / stepdown));
  const mmPerPass = (depth / passes).toFixed(2);

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <SectionHeader
          title="Material"
          description="Global machine and stock defaults live here so the design controls can stay focused on placement."
        />
        <div className="grid grid-cols-3 gap-3">
          <PillField
            label="W"
            value={settings.engraving.material_width}
            unit="mm"
            onChange={(value) => onMaterialSizeChange("width", value)}
          />
          <PillField
            label="H"
            value={settings.engraving.material_height}
            unit="mm"
            onChange={(value) => onMaterialSizeChange("height", value)}
          />
          <PillField
            label="T"
            value={settings.engraving.material_thickness}
            unit="mm"
            onChange={(value) => onNumberChange("engraving.material_thickness", value, "basic")}
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader title="Router bit" />
        <div className="flex rounded-[1.2rem] bg-white/[0.05]">
          <MetricChip icon={Icons.camera} value={`${settings.engraving.tool_diameter}mm`} />
          <MetricChip icon={Icons.positionY} value={`${settings.engraving.target_depth}mm`} />
          <MetricChip icon={Icons.code} value={settings.engraving.tool_shape} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Tool Diameter"
            unit="mm"
            value={settings.engraving.tool_diameter}
            onChange={(value) => onNumberChange("engraving.tool_diameter", value, "basic")}
          />
          <div className="grid gap-1.5">
            <Label className="text-xs text-white/45">Tool Shape</Label>
            <select
              className="h-12 rounded-[1rem] border border-white/8 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-primary/35"
              value={settings.engraving.tool_shape}
              onChange={(event) => onToolShapeChange(event.target.value as "Flat" | "Ball" | "V")}
            >
              <option value="Flat">Flat</option>
              <option value="Ball">Ball</option>
              <option value="V">V</option>
            </select>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader title="Defaults" />
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Default Depth"
            unit="mm"
            value={settings.engraving.target_depth}
            onChange={(value) => onNumberChange("engraving.target_depth", value, "basic")}
          />
          <div className="grid gap-1.5">
            <Label className="text-xs text-white/45">Default Fill</Label>
            <select
              className="h-12 rounded-[1rem] border border-white/8 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-primary/35"
              value={settings.engraving.fill_mode ?? "Pocket"}
              onChange={(event) => onFillModeChange(event.target.value as FillMode)}
            >
              <option value="Pocket">Pocket</option>
              <option value="Contour">Contour</option>
            </select>
          </div>
          <NumberField
            label="Passes"
            unit="x"
            value={passes}
            onChange={(value) => {
              const nextPasses = Math.max(1, Math.round(value ?? passes));
              onNumberChange("engraving.max_stepdown", depth / nextPasses, "advanced");
            }}
          />
          <div className="rounded-[1rem] border border-white/8 bg-white/[0.04] px-4 py-3">
            <p className="text-xs text-white/45">Per pass</p>
            <p className="mt-1 text-lg font-medium text-white">{mmPerPass}mm</p>
          </div>
        </div>
      </section>

      <section className="rounded-[1.35rem] bg-white/[0.04] px-4 py-4">
        <button
          className="flex w-full items-center gap-3 text-left"
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          <AppIcon
            icon={advancedOpen ? Icons.chevronDown : Icons.chevronRight}
            className="h-4 w-4 text-white/50"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[1.05rem] font-medium text-white">Advanced</p>
            <p className="text-sm text-white/38">Feeds, stepover, envelope, and machine output tuning.</p>
          </div>
          {advancedOverrideCount > 0 ? (
            <Chip className="bg-amber-500/12 px-3 py-1 text-[11px] font-semibold text-amber-200">
              {advancedOverrideCount} overrides
            </Chip>
          ) : null}
        </button>

        {advancedOpen ? (
          <div className="space-y-5 pt-5">
            <div className="flex items-start justify-between gap-4 rounded-[1.15rem] border border-white/8 bg-white/[0.03] px-4 py-4">
              <div className="flex items-start gap-3">
                <AppIcon icon={Icons.info} className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium text-white">Recommended values stay linked</p>
                  <p className="text-xs leading-relaxed text-white/38">
                    Editing an advanced field takes manual control until you reset it.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={onResetAdvancedRecommendations}
                disabled={advancedOverrideCount === 0}
              >
                Reset
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Max Stepdown"
                unit="mm"
                value={settings.engraving.max_stepdown}
                helper={`Recommended ${recommendedAdvanced["engraving.max_stepdown"]?.toFixed(2)} mm`}
                onChange={(value) => onNumberChange("engraving.max_stepdown", value, "advanced")}
              />
              <NumberField
                label="Stepover"
                unit="mm"
                value={settings.engraving.stepover}
                helper={`Recommended ${recommendedAdvanced["engraving.stepover"]?.toFixed(2)} mm`}
                onChange={(value) => onNumberChange("engraving.stepover", value, "advanced")}
              />
              <NumberField
                label="Cut Feed"
                unit="mm/min"
                value={settings.engraving.cut_feedrate}
                helper={`Recommended ${recommendedAdvanced["engraving.cut_feedrate"]?.toFixed(0)} mm/min`}
                onChange={(value) => onNumberChange("engraving.cut_feedrate", value, "advanced")}
              />
              <NumberField
                label="Plunge Feed"
                unit="mm/min"
                value={settings.engraving.plunge_feedrate}
                helper={`Recommended ${recommendedAdvanced["engraving.plunge_feedrate"]?.toFixed(0)} mm/min`}
                onChange={(value) => onNumberChange("engraving.plunge_feedrate", value, "advanced")}
              />
              <NumberField
                label="Travel Z"
                unit="mm"
                value={settings.machine.travel_z}
                onChange={(value) => onNumberChange("machine.travel_z", value, "advanced")}
              />
              <NumberField
                label="Cut Z"
                unit="mm"
                value={settings.machine.cut_z}
                onChange={(value) => onNumberChange("machine.cut_z", value, "advanced")}
              />
              <NumberField
                label="Machine Width"
                unit="mm"
                value={settings.engraving.machine_width}
                onChange={(value) => onNumberChange("engraving.machine_width", value, "advanced")}
              />
              <NumberField
                label="Machine Height"
                unit="mm"
                value={settings.engraving.machine_height}
                onChange={(value) => onNumberChange("engraving.machine_height", value, "advanced")}
              />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <p className="text-[1.15rem] font-medium text-white">{title}</p>
      {description ? <p className="mt-1 text-sm leading-relaxed text-white/38">{description}</p> : null}
    </div>
  );
}

function MetricChip({
  icon,
  value,
}: {
  icon: typeof Icons.camera;
  value: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 py-4 text-lg text-white">
      <AppIcon icon={icon} className="h-4 w-4 text-white/66" />
      {value}
    </div>
  );
}

function PillField({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
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

  const displayValue = editValue ?? String(value);

  return (
    <div className="flex h-14 items-center rounded-[1.15rem] bg-white/[0.05]">
      <div className="min-w-[3rem] px-4 text-sm text-white/46">{label}</div>
      <Input
        type="text"
        inputMode="decimal"
        className="h-full border-0 bg-transparent px-0 text-[1.15rem] text-white focus-visible:ring-0"
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
      <div className="pr-4 text-[1.15rem] text-white/62">{unit}</div>
    </div>
  );
}

function NumberField({
  label,
  unit,
  value,
  helper,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | null;
  helper?: string;
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

  const displayValue = editValue ?? (value != null ? String(value) : "");

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-white/45">{label}</Label>
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          className="h-12 rounded-[1rem] border-white/8 bg-white/[0.04] pr-14 text-sm text-white placeholder:text-white/24"
          value={displayValue}
          onFocus={(event) => {
            setEditValue(value != null ? String(value) : "");
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
      {helper ? <p className="text-[11px] leading-relaxed text-white/34">{helper}</p> : null}
    </div>
  );
}
