import type { EngraveType, Settings } from "@/lib/types";
import { clamp } from "@/lib/utils";

export const RECOMMENDED_ADVANCED_PATHS = new Set([
  "engraving.max_stepdown",
  "engraving.stepover",
  "engraving.cut_feedrate",
  "engraving.plunge_feedrate",
]);

export function setNumberAtPath(settings: Settings, path: string, value: number | null) {
  const next = structuredClone(settings);
  const segments = path.split(".");
  let target: unknown = next;
  for (const segment of segments.slice(0, -1)) {
    target = (target as Record<string, unknown>)[segment];
  }
  (target as Record<string, number | null>)[segments.at(-1)!] = value;
  return next;
}

export function computeRecommendedAdvancedValues(
  settings: Settings,
  defaultEngraveType: EngraveType,
) {
  const toolDiameter = Math.max(settings.engraving.tool_diameter, 0.5);
  const isPocket = defaultEngraveType === "pocket";
  const stepover = Number(
    (isPocket
      ? clamp(toolDiameter * 0.48, 0.2, toolDiameter * 0.8)
      : clamp(toolDiameter * 0.5, 0.2, toolDiameter)).toFixed(2),
  );
  const maxStepdown = Number(clamp(toolDiameter * 0.4, 0.3, 2.5).toFixed(2));
  const cutFeedrate = Number(clamp(180 + toolDiameter * 90, 180, 540).toFixed(0));
  const plungeFeedrate = Number(clamp(cutFeedrate * 0.4, 90, 220).toFixed(0));

  return {
    "engraving.max_stepdown": maxStepdown,
    "engraving.stepover": stepover,
    "engraving.cut_feedrate": cutFeedrate,
    "engraving.plunge_feedrate": plungeFeedrate,
  };
}

export function applyRecommendedSettings(
  settings: Settings,
  overrides: Record<string, boolean>,
  defaultEngraveType: EngraveType,
) {
  const next = structuredClone(settings);
  const recommended = computeRecommendedAdvancedValues(next, defaultEngraveType);

  for (const [path, value] of Object.entries(recommended)) {
    if (overrides[path]) {
      continue;
    }
    const segments = path.split(".");
    let target: unknown = next;
    for (const segment of segments.slice(0, -1)) {
      target = (target as Record<string, unknown>)[segment];
    }
    (target as Record<string, number | null>)[segments.at(-1)!] = value;
  }

  return next;
}
