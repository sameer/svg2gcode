import type { Settings } from "@svg2gcode/bridge"
import type { ArtboardState, MachiningSettings } from "../types/editor"

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
      ...(machining.maxStepdown != null && { max_stepdown: machining.maxStepdown }),
      ...(machining.stepover != null && { stepover: machining.stepover }),
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
  }
}
