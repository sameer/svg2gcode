import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FillMode, Settings } from "@/lib/types";

interface SettingsPanelProps {
  settings: Settings | null;
  recommendedAdvanced: Record<string, number>;
  advancedOverrides: Record<string, boolean>;
  onNumberChange: (
    path: string,
    value: number | null,
    source: "basic" | "advanced",
  ) => void;
  onToolShapeChange: (value: "Flat" | "Ball" | "V") => void;
  onFillModeChange: (value: FillMode) => void;
  onResetAdvancedRecommendations: () => void;
}

export function SettingsPanel({
  settings,
  recommendedAdvanced,
  advancedOverrides,
  onNumberChange,
  onToolShapeChange,
  onFillModeChange,
  onResetAdvancedRecommendations,
}: SettingsPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const advancedOverrideCount = useMemo(
    () => Object.values(advancedOverrides).filter(Boolean).length,
    [advancedOverrides],
  );

  if (!settings) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <section className="px-4 pb-4 pt-4">
        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Basic
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            These are the default cutting choices. Advanced tuning will never silently block the final depth you set here.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Stock
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Width"
                unit="mm"
                value={settings.engraving.material_width}
                onChange={(value) => onNumberChange("engraving.material_width", value, "basic")}
              />
              <NumberField
                label="Height"
                unit="mm"
                value={settings.engraving.material_height}
                onChange={(value) => onNumberChange("engraving.material_height", value, "basic")}
              />
              <NumberField
                label="Thickness"
                unit="mm"
                value={settings.engraving.material_thickness}
                onChange={(value) => onNumberChange("engraving.material_thickness", value, "basic")}
              />
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cutting
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Tool Diameter"
                unit="mm"
                value={settings.engraving.tool_diameter}
                onChange={(value) => onNumberChange("engraving.tool_diameter", value, "basic")}
              />
              <div className="grid gap-1.5">
                <Label className="text-xs">Fill Mode</Label>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={settings.engraving.fill_mode ?? "Pocket"}
                  onChange={(event) => onFillModeChange(event.target.value as FillMode)}
                >
                  <option value="Pocket">Pocket</option>
                  <option value="Contour">Contour</option>
                </select>
              </div>
              <NumberField
                label="Default Depth"
                unit="mm"
                value={settings.engraving.target_depth}
                onChange={(value) => onNumberChange("engraving.target_depth", value, "basic")}
              />
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Placement
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Offset X"
                unit="mm"
                value={settings.engraving.placement_x}
                onChange={(value) => onNumberChange("engraving.placement_x", value, "basic")}
              />
              <NumberField
                label="Offset Y"
                unit="mm"
                value={settings.engraving.placement_y}
                onChange={(value) => onNumberChange("engraving.placement_y", value, "basic")}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="border-t border-border" />

      <section>
        <button
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          {advancedOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Advanced
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pass planning, feeds, machine envelope, and sizing overrides.
            </p>
          </div>
          {advancedOverrideCount > 0 && (
            <span className="ml-auto rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900">
              {advancedOverrideCount} override{advancedOverrideCount > 1 ? "s" : ""}
            </span>
          )}
        </button>

        {advancedOpen && (
          <div className="space-y-4 px-4 pb-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/35 px-3 py-2">
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 text-amber-500" />
                <div>
                  <p className="text-xs font-medium text-foreground">
                    Recommended values stay linked to Basic settings
                  </p>
                  <p className="text-[11px] text-muted-foreground">
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
                Reset To Recommended
              </Button>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pass Planning
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Max Stepdown"
                  unit="mm"
                  value={settings.engraving.max_stepdown}
                  helper={`Recommended ${recommendedAdvanced["engraving.max_stepdown"]?.toFixed(2)} mm. Only affects pass count, not final depth.`}
                  onChange={(value) => onNumberChange("engraving.max_stepdown", value, "advanced")}
                />
                <NumberField
                  label="Stepover"
                  unit="mm"
                  value={settings.engraving.stepover}
                  helper={
                    settings.engraving.fill_mode === "Contour"
                      ? "Ignored for contour mode. It only matters for pocket fills."
                      : `Recommended ${recommendedAdvanced["engraving.stepover"]?.toFixed(2)} mm based on tool diameter.`
                  }
                  onChange={(value) => onNumberChange("engraving.stepover", value, "advanced")}
                />
                <NumberField
                  label="Cut Feed"
                  unit="mm/min"
                  value={settings.engraving.cut_feedrate}
                  helper={`Recommended ${recommendedAdvanced["engraving.cut_feedrate"]?.toFixed(0)} mm/min.`}
                  onChange={(value) => onNumberChange("engraving.cut_feedrate", value, "advanced")}
                />
                <NumberField
                  label="Plunge Feed"
                  unit="mm/min"
                  value={settings.engraving.plunge_feedrate}
                  helper={`Recommended ${recommendedAdvanced["engraving.plunge_feedrate"]?.toFixed(0)} mm/min.`}
                  onChange={(value) => onNumberChange("engraving.plunge_feedrate", value, "advanced")}
                />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Machine And Sizing
              </h3>
              <div className="grid grid-cols-2 gap-2">
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
                  helper="Used by machine output, not by engraving target depth planning."
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
                <NumberField
                  label="SVG Width Override"
                  unit="mm"
                  value={settings.engraving.svg_width_override}
                  onChange={(value) => onNumberChange("engraving.svg_width_override", value, "advanced")}
                />
                <div className="grid gap-1.5">
                  <Label className="text-xs">Tool Shape</Label>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={settings.engraving.tool_shape}
                    onChange={(event) => onToolShapeChange(event.target.value as "Flat" | "Ball" | "V")}
                  >
                    <option value="Flat">Flat</option>
                    <option value="Ball">Ball</option>
                    <option value="V">V</option>
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    Flat is the currently supported engraving CAM shape.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
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
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          step="0.01"
          className="h-8 pr-12 text-xs"
          value={value ?? ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? null : Number.parseFloat(event.target.value))
          }
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
          {unit}
        </span>
      </div>
      {helper && <p className="text-[11px] leading-relaxed text-muted-foreground">{helper}</p>}
    </div>
  );
}
