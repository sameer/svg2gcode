import type { AlignmentAction } from "@/lib/types";
import { clamp } from "@/lib/utils";

export interface SvgDocumentMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number;
}

export interface CanvasGeometry {
  svgWidthMm: number;
  svgHeightMm: number;
  svgLeftMm: number;
  svgTopMm: number;
  maxPlacementX: number;
  maxPlacementY: number;
  minArtboardWidthMm: number;
  minArtboardHeightMm: number;
  horizontalPaddingFits: boolean;
  verticalPaddingFits: boolean;
  paddingFits: boolean;
}

interface CanvasGeometryInput {
  artboardWidthMm: number;
  artboardHeightMm: number;
  placementX: number;
  placementY: number;
  svgWidthOverride: number | null;
  paddingMm: number;
  svgMetrics: SvgDocumentMetrics;
}

export function parseSvgDocumentMetrics(normalizedSvg: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(normalizedSvg, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) {
    return null;
  }

  const viewBox = svgEl.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return buildMetrics(parts[0], parts[1], parts[2], parts[3]);
    }
  }

  const width = parseFloat(svgEl.getAttribute("width") ?? "100");
  const height = parseFloat(svgEl.getAttribute("height") ?? "100");
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return buildMetrics(0, 0, width, height);
}

export function getSvgWidthMm(
  svgMetrics: SvgDocumentMetrics,
  svgWidthOverride: number | null | undefined,
) {
  return svgWidthOverride && svgWidthOverride > 0 ? svgWidthOverride : svgMetrics.width;
}

export function getSvgHeightMm(
  svgMetrics: SvgDocumentMetrics,
  svgWidthOverride: number | null | undefined,
) {
  return getSvgWidthMm(svgMetrics, svgWidthOverride) / svgMetrics.aspectRatio;
}

export function getCanvasGeometry({
  artboardWidthMm,
  artboardHeightMm,
  placementX,
  placementY,
  svgWidthOverride,
  paddingMm,
  svgMetrics,
}: CanvasGeometryInput): CanvasGeometry {
  const svgWidthMm = getSvgWidthMm(svgMetrics, svgWidthOverride);
  const svgHeightMm = getSvgHeightMm(svgMetrics, svgWidthOverride);
  const clampedPlacement = clampPlacementToArtboard({
    artboardWidthMm,
    artboardHeightMm,
    placementX,
    placementY,
    svgWidthMm,
    svgHeightMm,
  });

  const minArtboardWidthMm = svgWidthMm + paddingMm * 2;
  const minArtboardHeightMm = svgHeightMm + paddingMm * 2;

  return {
    svgWidthMm,
    svgHeightMm,
    svgLeftMm: clampedPlacement.x,
    svgTopMm: artboardHeightMm - clampedPlacement.y - svgHeightMm,
    maxPlacementX: Math.max(0, artboardWidthMm - svgWidthMm),
    maxPlacementY: Math.max(0, artboardHeightMm - svgHeightMm),
    minArtboardWidthMm,
    minArtboardHeightMm,
    horizontalPaddingFits: minArtboardWidthMm <= artboardWidthMm,
    verticalPaddingFits: minArtboardHeightMm <= artboardHeightMm,
    paddingFits: minArtboardWidthMm <= artboardWidthMm && minArtboardHeightMm <= artboardHeightMm,
  };
}

export function clampPlacementToArtboard({
  artboardWidthMm,
  artboardHeightMm,
  placementX,
  placementY,
  svgWidthMm,
  svgHeightMm,
}: {
  artboardWidthMm: number;
  artboardHeightMm: number;
  placementX: number;
  placementY: number;
  svgWidthMm: number;
  svgHeightMm: number;
}) {
  return {
    x: clamp(placementX, 0, Math.max(0, artboardWidthMm - svgWidthMm)),
    y: clamp(placementY, 0, Math.max(0, artboardHeightMm - svgHeightMm)),
  };
}

export function getAlignedPlacement(
  action: AlignmentAction,
  geometry: CanvasGeometry,
  artboardWidthMm: number,
  artboardHeightMm: number,
  currentPlacementX: number,
  currentPlacementY: number,
  paddingMm: number,
) {
  if (
    (isHorizontalAction(action) && !geometry.horizontalPaddingFits) ||
    (!isHorizontalAction(action) && !geometry.verticalPaddingFits)
  ) {
    return null;
  }

  switch (action) {
    case "left":
      return { x: paddingMm, y: currentPlacementY };
    case "center-x":
      return { x: (artboardWidthMm - geometry.svgWidthMm) / 2, y: currentPlacementY };
    case "right":
      return { x: artboardWidthMm - geometry.svgWidthMm - paddingMm, y: currentPlacementY };
    case "bottom":
      return { x: currentPlacementX, y: paddingMm };
    case "center-y":
      return { x: currentPlacementX, y: (artboardHeightMm - geometry.svgHeightMm) / 2 };
    case "top":
      return { x: currentPlacementX, y: artboardHeightMm - geometry.svgHeightMm - paddingMm };
    default:
      return null;
  }
}

export function getMaxSvgWidthFromPlacement(
  artboardWidthMm: number,
  artboardHeightMm: number,
  placementX: number,
  placementY: number,
  svgMetrics: SvgDocumentMetrics,
) {
  const maxFromWidth = Math.max(1, artboardWidthMm - placementX);
  const maxFromHeight = Math.max(1, (artboardHeightMm - placementY) * svgMetrics.aspectRatio);
  return Math.max(1, Math.min(maxFromWidth, maxFromHeight));
}

export function getPaddingValidationMessage(geometry: CanvasGeometry, paddingMm: number) {
  if (paddingMm <= 0 || geometry.paddingFits) {
    return null;
  }

  if (!geometry.horizontalPaddingFits && !geometry.verticalPaddingFits) {
    return "Padding is larger than the available width and height around the SVG.";
  }
  if (!geometry.horizontalPaddingFits) {
    return "Padding is larger than the available horizontal space around the SVG.";
  }
  return "Padding is larger than the available vertical space around the SVG.";
}

function isHorizontalAction(action: AlignmentAction) {
  return action === "left" || action === "center-x" || action === "right";
}

function buildMetrics(x: number, y: number, width: number, height: number): SvgDocumentMetrics {
  return {
    x,
    y,
    width,
    height,
    aspectRatio: width / height,
  };
}
