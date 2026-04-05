import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import { engraveTypeToFillMode } from "@/editor/engraving";
import { applyRecommendedSettings, computeRecommendedAdvancedValues, RECOMMENDED_ADVANCED_PATHS, setNumberAtPath } from "@/editor/recommendations";
import { clampPlacementToArtboard } from "@/lib/editor-geometry";
import { MATERIAL_PRESETS, type MaterialPresetId } from "@/lib/material-presets";
import type { ArtObject, EngraveType, Settings, ToolShape } from "@/lib/types";

export interface MaterialSettingsView {
  width: number;
  height: number;
  thickness: number;
  materialType: MaterialPresetId;
}

export interface CuttingSettingsView {
  toolDiameter: number;
  toolShape: ToolShape;
  defaultDepthMm: number;
  defaultEngraveType: EngraveType;
  plungeFeedrate: number;
  passCount: number;
  mmPerPass: string;
  maxStepdown: number;
  stepover: number;
  cutFeedrate: number;
  travelZ: number | null;
  cutZ: number | null;
  machineWidth: number;
  machineHeight: number;
}

export type AdvancedMachiningField =
  | "maxStepdown"
  | "stepover"
  | "cutFeedrate"
  | "plungeFeedrate"
  | "travelZ"
  | "cutZ"
  | "machineWidth"
  | "machineHeight";

interface UseMachiningSettingsParams {
  settings: Settings | null;
  setSettings: Dispatch<SetStateAction<Settings | null>>;
  artObjects: ArtObject[];
  setArtObjects: Dispatch<SetStateAction<ArtObject[]>>;
  paddingMm: number;
  setPaddingMm: Dispatch<SetStateAction<number>>;
  materialPreset: MaterialPresetId;
  setMaterialPreset: Dispatch<SetStateAction<MaterialPresetId>>;
  defaultEngraveType: EngraveType;
  setDefaultEngraveType: Dispatch<SetStateAction<EngraveType>>;
  advancedOverrides: Record<string, boolean>;
  setAdvancedOverrides: Dispatch<SetStateAction<Record<string, boolean>>>;
}

export function useMachiningSettings({
  settings,
  setSettings,
  artObjects,
  setArtObjects,
  paddingMm,
  setPaddingMm,
  materialPreset,
  setMaterialPreset,
  defaultEngraveType,
  setDefaultEngraveType,
  advancedOverrides,
  setAdvancedOverrides,
}: UseMachiningSettingsParams) {
  const recommendedAdvanced = useMemo<Record<string, number>>(
    () => (settings ? computeRecommendedAdvancedValues(settings, defaultEngraveType) : {}),
    [defaultEngraveType, settings],
  );
  const recommendedAdvancedFields = useMemo(
    () => ({
      maxStepdown: recommendedAdvanced["engraving.max_stepdown"],
      stepover: recommendedAdvanced["engraving.stepover"],
      cutFeedrate: recommendedAdvanced["engraving.cut_feedrate"],
      plungeFeedrate: recommendedAdvanced["engraving.plunge_feedrate"],
    }),
    [recommendedAdvanced],
  );

  const material = useMemo<MaterialSettingsView | null>(
    () =>
      settings
        ? {
            width: settings.engraving.material_width,
            height: settings.engraving.material_height,
            thickness: settings.engraving.material_thickness,
            materialType: materialPreset,
          }
        : null,
    [materialPreset, settings],
  );

  const cutting = useMemo<CuttingSettingsView | null>(() => {
    if (!settings) {
      return null;
    }
    const depth = settings.engraving.target_depth ?? 1;
    const stepdown = settings.engraving.max_stepdown ?? 1;
    const passCount = Math.max(1, Math.ceil(depth / Math.max(stepdown, 0.01)));

    return {
      toolDiameter: settings.engraving.tool_diameter,
      toolShape: settings.engraving.tool_shape,
      defaultDepthMm: settings.engraving.target_depth,
      defaultEngraveType,
      plungeFeedrate: settings.engraving.plunge_feedrate,
      passCount,
      mmPerPass: (depth / passCount).toFixed(2),
      maxStepdown: settings.engraving.max_stepdown,
      stepover: settings.engraving.stepover,
      cutFeedrate: settings.engraving.cut_feedrate,
      travelZ: settings.machine.travel_z,
      cutZ: settings.machine.cut_z,
      machineWidth: settings.engraving.machine_width,
      machineHeight: settings.engraving.machine_height,
    };
  }, [defaultEngraveType, settings]);

  const handleMaterialDimensionChange = useCallback(
    (dimension: "width" | "height", value: number | null) => {
      setSettings((current) => {
        if (!current) {
          return current;
        }

        const minimum = getMinimumMaterialDimension(artObjects, paddingMm, dimension);
        const field = dimension === "width" ? "material_width" : "material_height";
        const requested = Math.max(1, value ?? current.engraving[field]);
        return {
          ...current,
          engraving: {
            ...current.engraving,
            [field]: Math.max(requested, minimum),
          },
        };
      });

      setArtObjects((current) =>
        current.map((artObject) => clampArtObjectToMaterial(artObject, dimension, value, settings)),
      );
    },
    [artObjects, paddingMm, setArtObjects, setSettings, settings],
  );

  const handleNumberFieldChange = useCallback(
    (path: string, value: number | null, source: "basic" | "advanced") => {
      const nextOverrides =
        source === "advanced" && RECOMMENDED_ADVANCED_PATHS.has(path)
          ? { ...advancedOverrides, [path]: true }
          : advancedOverrides;
      if (nextOverrides !== advancedOverrides) {
        setAdvancedOverrides(nextOverrides);
      }

      setSettings((current) => {
        if (!current) {
          return current;
        }
        const next = setNumberAtPath(current, path, value);
        return applyRecommendedSettings(next, nextOverrides, defaultEngraveType);
      });
    },
    [advancedOverrides, defaultEngraveType, setAdvancedOverrides, setSettings],
  );

  const setAdvancedField = useCallback(
    (field: AdvancedMachiningField, value: number | null) => {
      const pathByField: Record<AdvancedMachiningField, string> = {
        maxStepdown: "engraving.max_stepdown",
        stepover: "engraving.stepover",
        cutFeedrate: "engraving.cut_feedrate",
        plungeFeedrate: "engraving.plunge_feedrate",
        travelZ: "machine.travel_z",
        cutZ: "machine.cut_z",
        machineWidth: "engraving.machine_width",
        machineHeight: "engraving.machine_height",
      };
      handleNumberFieldChange(pathByField[field], value, "advanced");
    },
    [handleNumberFieldChange],
  );

  const setMaterialThickness = useCallback(
    (value: number | null) => handleNumberFieldChange("engraving.material_thickness", value, "basic"),
    [handleNumberFieldChange],
  );

  const setToolDiameter = useCallback(
    (value: number | null) => handleNumberFieldChange("engraving.tool_diameter", value, "basic"),
    [handleNumberFieldChange],
  );

  const setToolShape = useCallback(
    (value: ToolShape) => {
      setSettings((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          engraving: {
            ...current.engraving,
            tool_shape: value,
          },
        };
      });
    },
    [setSettings],
  );

  const setDefaultDepth = useCallback(
    (value: number | null) => handleNumberFieldChange("engraving.target_depth", value, "basic"),
    [handleNumberFieldChange],
  );

  const setDefaultEngrave = useCallback(
    (value: EngraveType) => {
      setDefaultEngraveType(value);
      setSettings((current) => {
        if (!current) {
          return current;
        }
        const fillMode = engraveTypeToFillMode(value);
        return applyRecommendedSettings(
          {
            ...current,
            engraving: {
              ...current.engraving,
              fill_mode: fillMode ?? current.engraving.fill_mode,
            },
          },
          advancedOverrides,
          value,
        );
      });
    },
    [advancedOverrides, setDefaultEngraveType, setSettings],
  );

  const setPassCount = useCallback(
    (value: number | null) => {
      if (!settings) {
        return;
      }
      const nextPasses = Math.max(1, Math.round(value ?? 1));
      handleNumberFieldChange(
        "engraving.max_stepdown",
        settings.engraving.target_depth / nextPasses,
        "advanced",
      );
    },
    [handleNumberFieldChange, settings],
  );

  const setMaterialType = useCallback(
    (value: MaterialPresetId) => {
      const preset = MATERIAL_PRESETS[value];
      const maxStepdown = Number((preset.defaultDepthMm / preset.defaultPasses).toFixed(2));
      const nextOverrides = {
        ...advancedOverrides,
        "engraving.max_stepdown": true,
      };

      setMaterialPreset(value);
      setAdvancedOverrides(nextOverrides);
      setSettings((current) => {
        if (!current) {
          return current;
        }
        return applyRecommendedSettings(
          {
            ...current,
            engraving: {
              ...current.engraving,
              target_depth: preset.defaultDepthMm,
              max_stepdown: maxStepdown,
            },
          },
          nextOverrides,
          defaultEngraveType,
        );
      });
    },
    [advancedOverrides, defaultEngraveType, setAdvancedOverrides, setMaterialPreset, setSettings],
  );

  const resetAdvancedRecommendations = useCallback(() => {
    setAdvancedOverrides({});
    setSettings((current) => (current ? applyRecommendedSettings(current, {}, defaultEngraveType) : current));
  }, [defaultEngraveType, setAdvancedOverrides, setSettings]);

  return {
    material,
    cutting,
    paddingMm,
    recommendedAdvanced: recommendedAdvancedFields,
    advancedOverrides,
    setPaddingMm: (value: number | null) => setPaddingMm(Math.max(0, value ?? 0)),
    setMaterialDimension: handleMaterialDimensionChange,
    setMaterialThickness,
    setMaterialType,
    setToolDiameter,
    setToolShape,
    setDefaultDepth,
    setDefaultEngrave,
    setPassCount,
    setAdvancedField,
    resetAdvancedRecommendations,
  };
}

function getMinimumMaterialDimension(
  artObjects: ArtObject[],
  paddingMm: number,
  dimension: "width" | "height",
) {
  if (artObjects.length === 0) {
    return 1;
  }

  if (dimension === "width") {
    return Math.max(...artObjects.map((artObject) => artObject.placementX + artObject.widthMm + paddingMm));
  }

  return Math.max(...artObjects.map((artObject) => artObject.placementY + artObject.heightMm + paddingMm));
}

function clampArtObjectToMaterial(
  artObject: ArtObject,
  dimension: "width" | "height",
  value: number | null,
  settings: Settings | null,
) {
  if (!settings) {
    return artObject;
  }

  const materialWidth =
    dimension === "width" ? Math.max(1, value ?? settings.engraving.material_width) : settings.engraving.material_width;
  const materialHeight =
    dimension === "height" ? Math.max(1, value ?? settings.engraving.material_height) : settings.engraving.material_height;
  const widthMm = Math.min(artObject.widthMm, materialWidth);
  const heightMm = Math.min(artObject.heightMm, materialHeight);
  const clampedPlacement = clampPlacementToArtboard({
    artboardWidthMm: materialWidth,
    artboardHeightMm: materialHeight,
    placementX: artObject.placementX,
    placementY: artObject.placementY,
    svgWidthMm: widthMm,
    svgHeightMm: heightMm,
  });

  return {
    ...artObject,
    widthMm,
    heightMm,
    placementX: clampedPlacement.x,
    placementY: clampedPlacement.y,
  };
}
