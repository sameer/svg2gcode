import type { FillMode } from "@/lib/types";

import oakTexture from "@/assets/wood_types/oak-veneered-mdf-400-mm-architextures.jpg";
import mdfTexture from "@/assets/wood_types/mdf-medium-density-fibreboard-400-mm-architextures.jpg";
import osbTexture from "@/assets/wood_types/osb-1498-mm-architextures.jpg";

export type MaterialPresetId = "Oak" | "MDF" | "OSB";

export interface MaterialPresetDefinition {
  id: MaterialPresetId;
  label: string;
  texture: string;
  defaultDepthMm: number;
  defaultPasses: number;
}

export const MATERIAL_PRESETS: Record<MaterialPresetId, MaterialPresetDefinition> = {
  Oak: {
    id: "Oak",
    label: "Oak",
    texture: oakTexture,
    defaultDepthMm: 1.6,
    defaultPasses: 2,
  },
  MDF: {
    id: "MDF",
    label: "MDF",
    texture: mdfTexture,
    defaultDepthMm: 1.2,
    defaultPasses: 2,
  },
  OSB: {
    id: "OSB",
    label: "OSB",
    texture: osbTexture,
    defaultDepthMm: 2,
    defaultPasses: 3,
  },
};

export const MATERIAL_PRESET_LIST = [
  MATERIAL_PRESETS.Oak,
  MATERIAL_PRESETS.MDF,
  MATERIAL_PRESETS.OSB,
] as const;

export interface FillModeVisualDefinition {
  mode: FillMode;
  label: string;
  previewClassName: string;
}

export const FILL_MODE_VISUALS: FillModeVisualDefinition[] = [
  {
    mode: "Pocket",
    label: "Pocket",
    previewClassName:
      "bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.32)_0_2px,rgba(255,255,255,0.08)_2px_5px)]",
  },
  {
    mode: "Contour",
    label: "Contour",
    previewClassName:
      "bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.25)_0_38%,rgba(255,255,255,0.06)_38%_100%)]",
  },
];
