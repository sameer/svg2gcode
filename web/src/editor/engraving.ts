import type { EngraveType, FillMode } from "@/lib/types";

export const ENGRAVE_TYPE_OPTIONS: EngraveType[] = ["outline", "pocket", "raster", "skeleton"];

export function engraveTypeToFillMode(engraveType: EngraveType | null | undefined): FillMode | null {
  if (engraveType === "pocket") {
    return "Pocket";
  }
  if (engraveType === "outline") {
    return "Contour";
  }
  return null;
}

export function fillModeToEngraveType(fillMode: FillMode | null | undefined): EngraveType {
  return fillMode === "Pocket" ? "pocket" : "outline";
}

export function engraveTypeLabel(engraveType: EngraveType) {
  if (engraveType === "outline") {
    return "Outline";
  }
  if (engraveType === "pocket") {
    return "Pocket";
  }
  if (engraveType === "raster") {
    return "Raster";
  }
  return "Skeleton";
}

export function isSupportedEngraveType(engraveType: EngraveType | null | undefined) {
  return engraveType == null || engraveType === "outline" || engraveType === "pocket";
}
