import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Settings } from "@/lib/types";

interface SettingsPanelProps {
  settings: Settings | null;
  onNumberChange: (path: string, value: number | null) => void;
  onToolShapeChange: (value: "Flat" | "Ball" | "V") => void;
}

export function SettingsPanel({
  settings,
  onNumberChange,
  onToolShapeChange,
}: SettingsPanelProps) {
  if (!settings) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <SettingsGroup title="Stock" defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Width" unit="mm" value={settings.engraving.material_width} onChange={(v) => onNumberChange("engraving.material_width", v)} />
          <NumberField label="Height" unit="mm" value={settings.engraving.material_height} onChange={(v) => onNumberChange("engraving.material_height", v)} />
          <NumberField label="Thickness" unit="mm" value={settings.engraving.material_thickness} onChange={(v) => onNumberChange("engraving.material_thickness", v)} />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Tool" defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Diameter" unit="mm" value={settings.engraving.tool_diameter} onChange={(v) => onNumberChange("engraving.tool_diameter", v)} />
          <div className="grid gap-1.5">
            <Label className="text-xs">Shape</Label>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={settings.engraving.tool_shape}
              onChange={(e) => onToolShapeChange(e.target.value as "Flat" | "Ball" | "V")}
            >
              <option value="Flat">Flat</option>
              <option value="Ball">Ball</option>
              <option value="V">V</option>
            </select>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Toolpath Defaults" defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Max Stepdown" unit="mm" value={settings.engraving.max_stepdown} onChange={(v) => onNumberChange("engraving.max_stepdown", v)} />
          <NumberField label="Stepover" unit="mm" value={settings.engraving.stepover} onChange={(v) => onNumberChange("engraving.stepover", v)} />
          <NumberField label="Default Depth" unit="mm" value={settings.engraving.target_depth} onChange={(v) => onNumberChange("engraving.target_depth", v)} />
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/70">Default depth is applied to new operations. Change per-operation depths below.</p>
      </SettingsGroup>

      <SettingsGroup title="Feed Rates">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Cut Feed" unit="mm/min" value={settings.engraving.cut_feedrate} onChange={(v) => onNumberChange("engraving.cut_feedrate", v)} />
          <NumberField label="Plunge Feed" unit="mm/min" value={settings.engraving.plunge_feedrate} onChange={(v) => onNumberChange("engraving.plunge_feedrate", v)} />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Machine" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Travel Z" unit="mm" value={settings.machine.travel_z} onChange={(v) => onNumberChange("machine.travel_z", v)} />
          <NumberField label="Cut Z" unit="mm" value={settings.machine.cut_z} onChange={(v) => onNumberChange("machine.cut_z", v)} />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Placement">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Offset X" unit="mm" value={settings.engraving.placement_x} onChange={(v) => onNumberChange("engraving.placement_x", v)} />
          <NumberField label="Offset Y" unit="mm" value={settings.engraving.placement_y} onChange={(v) => onNumberChange("engraving.placement_y", v)} />
          <NumberField label="SVG Width Override" unit="mm" value={settings.engraving.svg_width_override} onChange={(v) => onNumberChange("engraving.svg_width_override", v)} />
        </div>
      </SettingsGroup>
    </div>
  );
}

function SettingsGroup({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {title}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
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
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          step="0.01"
          className="h-8 pr-12 text-xs"
          value={value ?? ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number.parseFloat(e.target.value))
          }
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
}
