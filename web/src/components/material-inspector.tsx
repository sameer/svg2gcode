import { useCallback, useMemo, useState } from "react";
import { Button, ButtonGroup, Chip, Input, Label } from "@heroui/react";
import { AppIcon, Icons } from "@/lib/icons";
import type { AlignmentAction, DistributionAction, Settings } from "@/lib/types";
import { MATERIAL_PRESET_LIST, type MaterialPresetId } from "@/lib/material-presets";
import flatRouterBit from "@/assets/router bits/flat_router_bit.png";
import roundRouterBit from "@/assets/router bits/round_router_bit.png";
import vCarveBit from "@/assets/router bits/v_carve_bit.png";

interface MaterialInspectorProps {
  settings: Settings | null;
  materialPreset: MaterialPresetId;
  paddingMm: number;
  selectedArtObjectCount: number;
  recommendedAdvanced: Record<string, number>;
  advancedOverrides: Record<string, boolean>;
  onMaterialSizeChange: (dimension: "width" | "height", value: number | null) => void;
  onPaddingChange: (value: number | null) => void;
  onAlign: (value: AlignmentAction) => void;
  onDistribute: (value: DistributionAction) => void;
  onNumberChange: (
    path: string,
    value: number | null,
    source: "basic" | "advanced",
  ) => void;
  onToolShapeChange: (value: "Flat" | "Ball" | "V") => void;
  onMaterialPresetChange: (value: MaterialPresetId) => void;
  onResetAdvancedRecommendations: () => void;
}

export function MaterialInspector({
  settings,
  materialPreset,
  paddingMm,
  selectedArtObjectCount,
  recommendedAdvanced,
  advancedOverrides,
  onMaterialSizeChange,
  onPaddingChange,
  onAlign,
  onDistribute,
  onNumberChange,
  onToolShapeChange,
  onMaterialPresetChange,
  onResetAdvancedRecommendations,
}: MaterialInspectorProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedOverrideCount = useMemo(
    () => Object.values(advancedOverrides).filter(Boolean).length,
    [advancedOverrides],
  );
  const recommendation = useCallback(
    (path: string, digits: number, unit: string) => {
      const value = recommendedAdvanced[path];
      if (!Number.isFinite(value)) {
        return undefined;
      }
      return `Rec ${value.toFixed(digits)} ${unit}`;
    },
    [recommendedAdvanced],
  );

  if (!settings) {
    return <div className="text-sm text-muted-foreground">Loading settings…</div>;
  }

  const depth = settings.engraving.target_depth ?? 1;
  const stepdown = settings.engraving.max_stepdown ?? 3;
  const passes = Math.max(1, Math.ceil(depth / stepdown));
  const mmPerPass = (depth / passes).toFixed(2);

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionHeader title="Material" />
        <div className="flex flex-wrap gap-2">
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
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">Preset</Label>
          <div className="flex flex-wrap gap-3">
            {MATERIAL_PRESET_LIST.map((preset) => (
              <MaterialPresetOption
                key={preset.id}
                label={preset.label}
                texture={preset.texture}
                isSelected={materialPreset === preset.id}
                onClick={() => onMaterialPresetChange(preset.id)}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title="Router bit" />
        <div className="flex flex-wrap gap-3">
          <NumberField
            className="w-[10.5rem]"
            label="Diameter"
            unit="mm"
            value={settings.engraving.tool_diameter}
            onChange={(value) => onNumberChange("engraving.tool_diameter", value, "basic")}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Shape</Label>
            <div className="flex gap-3">
              <ToolShapeOption
                shape="Flat"
                image={flatRouterBit}
                isSelected={settings.engraving.tool_shape === "Flat"}
                onClick={() => onToolShapeChange("Flat")}
              />
              <ToolShapeOption
                shape="Ball"
                image={roundRouterBit}
                isSelected={settings.engraving.tool_shape === "Ball"}
                onClick={() => onToolShapeChange("Ball")}
              />
              <ToolShapeOption
                shape="V"
                image={vCarveBit}
                isSelected={settings.engraving.tool_shape === "V"}
                onClick={() => onToolShapeChange("V")}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title="Placement" />
        <div className="flex flex-wrap gap-3">
          <NumberField
            className="w-[10.5rem]"
            label="Padding"
            unit="mm"
            value={paddingMm}
            onChange={onPaddingChange}
          />
          <NumberField
            className="w-[10.5rem]"
            label="Passes"
            unit="x"
            value={passes}
            onChange={(value) => {
              const nextPasses = Math.max(1, Math.round(value ?? passes));
              onNumberChange("engraving.max_stepdown", depth / nextPasses, "advanced");
            }}
          />
          <ReadOnlyField className="w-[10.5rem]" label="Per pass" value={`${mmPerPass} mm`} />
        </div>
        <div className="rounded-md border border-border bg-content1 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Arrange selection</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedArtObjectCount > 1
                  ? `${selectedArtObjectCount} art objects selected`
                  : "Select multiple art objects to align or distribute them"}
              </p>
            </div>
            <Chip size="sm" variant="soft">
              {selectedArtObjectCount}
            </Chip>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <ArrangeCluster
              title="Align"
              disabled={selectedArtObjectCount < 2}
              actions={[
                { label: "Left", value: "left", icon: Icons.alignLeft },
                { label: "Center X", value: "center-x", icon: Icons.alignCenterHorizontal },
                { label: "Right", value: "right", icon: Icons.alignRight },
                { label: "Top", value: "top", icon: Icons.alignTop },
                { label: "Center Y", value: "center-y", icon: Icons.alignCenterVertical },
                { label: "Bottom", value: "bottom", icon: Icons.alignBottom },
              ]}
              onPress={(value) => onAlign(value as AlignmentAction)}
            />
            <ArrangeCluster
              title="Distribute"
              disabled={selectedArtObjectCount < 2}
              actions={[
                { label: "Horizontal", value: "horizontal", icon: Icons.alignCenterHorizontal },
                { label: "Vertical", value: "vertical", icon: Icons.alignCenterVertical },
              ]}
              onPress={(value) => onDistribute(value as DistributionAction)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border bg-content1 px-3 py-3">
        <button
          className="flex w-full items-center gap-3 text-left"
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          <AppIcon
            icon={advancedOpen ? Icons.chevronDown : Icons.chevronRight}
            className="h-4 w-4 text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Advanced</p>
          </div>
          {advancedOverrideCount > 0 ? (
            <Chip size="sm" color="warning" variant="soft">
              {advancedOverrideCount} overrides
            </Chip>
          ) : null}
        </button>

        {advancedOpen ? (
          <div className="space-y-3 pt-3">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-content2 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {advancedOverrideCount > 0
                  ? `${advancedOverrideCount} fields are manually set`
                  : "Using recommended values"}
              </p>
              <Button
                size="sm"
                variant="secondary"
                onPress={onResetAdvancedRecommendations}
                isDisabled={advancedOverrideCount === 0}
              >
                Reset
              </Button>
            </div>

            <div className="flex flex-wrap gap-3">
              <NumberField
                className="w-[10.5rem]"
                label="Max Stepdown"
                unit="mm"
                value={settings.engraving.max_stepdown}
                helper={recommendation("engraving.max_stepdown", 2, "mm")}
                onChange={(value) => onNumberChange("engraving.max_stepdown", value, "advanced")}
              />
              <NumberField
                className="w-[10.5rem]"
                label="Stepover"
                unit="mm"
                value={settings.engraving.stepover}
                helper={recommendation("engraving.stepover", 2, "mm")}
                onChange={(value) => onNumberChange("engraving.stepover", value, "advanced")}
              />
              <NumberField
                className="w-[10.5rem]"
                label="Cut Feed"
                unit="mm/min"
                value={settings.engraving.cut_feedrate}
                helper={recommendation("engraving.cut_feedrate", 0, "mm/min")}
                onChange={(value) => onNumberChange("engraving.cut_feedrate", value, "advanced")}
              />
              <NumberField
                className="w-[10.5rem]"
                label="Plunge Feed"
                unit="mm/min"
                value={settings.engraving.plunge_feedrate}
                helper={recommendation("engraving.plunge_feedrate", 0, "mm/min")}
                onChange={(value) => onNumberChange("engraving.plunge_feedrate", value, "advanced")}
              />
              <NumberField
                className="w-[10.5rem]"
                label="Travel Z"
                unit="mm"
                value={settings.machine.travel_z}
                onChange={(value) => onNumberChange("machine.travel_z", value, "advanced")}
              />
              <NumberField
                className="w-[10.5rem]"
                label="Cut Z"
                unit="mm"
                value={settings.machine.cut_z}
                onChange={(value) => onNumberChange("machine.cut_z", value, "advanced")}
              />
              <NumberField
                className="w-[10.5rem]"
                label="Machine Width"
                unit="mm"
                value={settings.engraving.machine_width}
                onChange={(value) => onNumberChange("engraving.machine_width", value, "advanced")}
              />
              <NumberField
                className="w-[10.5rem]"
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
}: {
  title: string;
}) {
  return (
    <div className="leading-none">
      <p className="text-sm font-semibold text-foreground">{title}</p>
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`grid gap-1 ${className ?? "w-[10.5rem]"}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex h-9 items-center rounded-md border border-border bg-content2 px-3 text-sm text-foreground">
        {value}
      </div>
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
    <div className="flex h-9 w-[7.75rem] items-center rounded-md border border-border bg-content1 px-2">
      <div className="w-5 text-xs text-muted-foreground">{label}</div>
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
      <div className="pl-1 text-xs text-muted-foreground">{unit}</div>
    </div>
  );
}

function NumberField({
  label,
  unit,
  value,
  helper,
  onChange,
  className,
}: {
  label: string;
  unit: string;
  value: number | null;
  helper?: string;
  onChange: (value: number | null) => void;
  className?: string;
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
    <div className={`grid gap-1 ${className ?? "w-[10.5rem]"}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          className="h-9 w-full pr-10 text-sm"
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
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {unit}
        </span>
      </div>
      {helper ? <p className="text-[11px] text-muted-foreground">{helper}</p> : null}
    </div>
  );
}

function ArrangeCluster({
  title,
  actions,
  disabled,
  onPress,
}: {
  title: string;
  actions: { label: string; value: string; icon: React.ComponentProps<typeof AppIcon>["icon"] }[];
  disabled: boolean;
  onPress: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label className="text-xs text-muted-foreground">{title}</Label>
      <div className="flex flex-wrap gap-2">
        {actions.map(({ label, value, icon }) => (
          <ButtonGroup key={value} size="sm" variant="secondary" isDisabled={disabled}>
            <Button onPress={() => onPress(value)}>
              <AppIcon icon={icon} className="h-4 w-4" />
              {label}
            </Button>
          </ButtonGroup>
        ))}
      </div>
    </div>
  );
}

function ToolShapeOption({
  shape,
  image,
  isSelected,
  onClick,
}: {
  shape: "Flat" | "Ball" | "V";
  image: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  const label = shape === "V" ? "V-Carve" : shape;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1"
    >
      <div
        className={`
          relative h-10 w-10 overflow-hidden rounded-full border-2 transition-all
          ${isSelected 
            ? "border-primary ring-2 ring-primary ring-offset-1 ring-offset-background" 
            : "border-border hover:border-muted-foreground"
          }
        `}
      >
        <img
          src={image}
          alt={label}
          className="pointer-events-none absolute left-1/2 h-[64px] max-w-none -translate-x-1/2 object-contain"
          style={{ top: "2px" }}
        />
      </div>
      <span className={`text-[10px] ${isSelected ? "font-medium text-foreground" : "text-muted-foreground"}`}>
        {label}
      </span>
    </button>
  );
}

function MaterialPresetOption({
  label,
  texture,
  isSelected,
  onClick,
}: {
  label: string;
  texture: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1">
      <div
        className={`
          relative h-12 w-12 overflow-hidden rounded-full border-2 transition-all
          ${isSelected ? "border-primary ring-2 ring-primary ring-offset-1 ring-offset-background" : "border-border hover:border-muted-foreground"}
        `}
      >
        <img src={texture} alt={label} className="h-full w-full object-cover" />
      </div>
      <span className={`text-[10px] ${isSelected ? "font-medium text-foreground" : "text-muted-foreground"}`}>
        {label}
      </span>
    </button>
  );
}
