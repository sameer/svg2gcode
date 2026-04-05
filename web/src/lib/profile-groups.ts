import { engraveTypeLabel, engraveTypeToFillMode, fillModeToEngraveType } from "@/editor/engraving";
import { colorForOperation } from "@/lib/colors";
import type { AssignmentProfileGroup, ElementAssignment, FillMode, FrontendOperation } from "@/lib/types";

export function getAssignmentProfileKey(
  targetDepthMm: number,
  fillMode: FillMode | null,
  engraveType: ElementAssignment["engraveType"],
) {
  return `${targetDepthMm}::${engraveType ?? "default"}::${fillMode ?? "default"}`;
}

export function groupAssignmentsForIds(
  assignments: Record<string, ElementAssignment>,
  elementIds: string[],
) {
  const groups = new Map<
    string,
    {
      targetDepthMm: number;
      engraveType: ElementAssignment["engraveType"];
      fillMode: FillMode | null;
      elementIds: string[];
    }
  >();

  for (const elementId of elementIds) {
    const assignment = assignments[elementId];
    if (!assignment) {
      continue;
    }

    const engraveType = assignment.engraveType ?? fillModeToEngraveType(assignment.fillMode);
    const fillMode = assignment.fillMode ?? engraveTypeToFillMode(engraveType);
    const key = getAssignmentProfileKey(assignment.targetDepthMm, fillMode, engraveType);
    const existing = groups.get(key);
    if (existing) {
      existing.elementIds.push(elementId);
    } else {
      groups.set(key, {
        targetDepthMm: assignment.targetDepthMm,
        engraveType,
        fillMode,
        elementIds: [elementId],
      });
    }
  }

  return Array.from(groups.entries())
    .map(([key, group], index): AssignmentProfileGroup => ({
      key,
      targetDepthMm: group.targetDepthMm,
      engraveType: group.engraveType,
      fillMode: group.fillMode,
      elementIds: group.elementIds,
      color: colorForOperation(index),
    }))
    .sort((left, right) => {
      if (left.targetDepthMm !== right.targetDepthMm) {
        return left.targetDepthMm - right.targetDepthMm;
      }
      return `${left.engraveType ?? ""}${left.fillMode ?? ""}`.localeCompare(
        `${right.engraveType ?? ""}${right.fillMode ?? ""}`,
      );
    });
}

export function deriveOperationsFromProfileGroups(groups: AssignmentProfileGroup[]): FrontendOperation[] {
  return groups.map((group) => ({
    id: `profile-${group.key}`,
    name: `${formatDepthLabel(group.targetDepthMm)}${
      group.engraveType ? ` · ${engraveTypeLabel(group.engraveType)}` : group.fillMode ? ` · ${group.fillMode}` : ""
    }`,
    target_depth_mm: group.targetDepthMm,
    assigned_element_ids: group.elementIds,
    color: group.color,
    engrave_type: group.engraveType,
    fill_mode: group.fillMode,
  }));
}

function formatDepthLabel(value: number) {
  return `${roundMm(value)}mm`;
}

function roundMm(value: number) {
  return Math.round(value * 100) / 100;
}
