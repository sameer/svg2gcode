import type { Settings } from "@svg2gcode/bridge"
import type { ArtboardState, MachiningSettings } from "../types/editor"

function roundStepdown(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export function resolveEffectiveMaxStepdown(
  machining: Pick<MachiningSettings, "passCount" | "maxStepdown">,
  deepestTargetDepth: number,
): number | null {
  if (machining.maxStepdown != null) {
    return machining.maxStepdown > 0 ? machining.maxStepdown : null
  }

  if (!Number.isFinite(deepestTargetDepth) || deepestTargetDepth <= 0) {
    return null
  }

  const passCount = Math.max(1, Math.round(machining.passCount || 1))
  return roundStepdown(deepestTargetDepth / passCount)
}

/**
 * Merge editor state onto a bridge Settings object.
 * Starts from the provided base (typically from loadDefaultSettings()),
 * then overlays values from the editor's artboard and machining settings.
 * Null values in machining settings are left as the base default.
 */
export function buildBridgeSettings(
  base: Settings,
  artboard: ArtboardState,
  machining: MachiningSettings,
): Settings {
  return {
    ...base,
    engraving: {
      ...base.engraving,
      material_width: artboard.width,
      material_height: artboard.height,
      material_thickness: artboard.thickness,
      tool_diameter: machining.toolDiameter,
      tool_shape: machining.toolShape,
      target_depth: machining.defaultDepthMm,
      // Overlay optional fields only when set
      ...(machining.stepover != null && { stepover: machining.stepover }),
      max_fill_passes: machining.maxFillPasses,
      ...(machining.cutFeedrate != null && { cut_feedrate: machining.cutFeedrate }),
      ...(machining.plungeFeedrate != null && { plunge_feedrate: machining.plungeFeedrate }),
      ...(machining.machineWidth != null && { machine_width: machining.machineWidth }),
      ...(machining.machineHeight != null && { machine_height: machining.machineHeight }),
      // Art objects handle their own placement, so zero these out
      placement_x: 0,
      placement_y: 0,
    },
    machine: {
      ...base.machine,
      ...(machining.travelZ != null && { travel_z: machining.travelZ }),
      ...(machining.cutZ != null && { cut_z: machining.cutZ }),
    },
    // Tab settings — scaffolded for future bridge/WASM consumption
    ...(machining.tabsEnabled && {
      tabs: {
        enabled: true,
        width: machining.tabWidth,
        height: machining.tabHeight,
        spacing: machining.tabSpacing,
      },
    }),
  }
}
