import type { SvgDocumentMetrics } from "./types";
import { clamp } from "./utils";

/**
 * Parse SVG document metrics from a normalized SVG string.
 * Browser-only: uses DOMParser.
 */
export function parseSvgDocumentMetrics(normalizedSvg: string): SvgDocumentMetrics | null {
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
  svgHeightOverride?: number | null | undefined,
) {
  if (svgWidthOverride && svgWidthOverride > 0) {
    return svgWidthOverride;
  }
  if (svgHeightOverride && svgHeightOverride > 0) {
    return svgHeightOverride * svgMetrics.aspectRatio;
  }
  return svgMetrics.width;
}

export function getSvgHeightMm(
  svgMetrics: SvgDocumentMetrics,
  svgWidthOverride: number | null | undefined,
  svgHeightOverride?: number | null | undefined,
) {
  if (svgHeightOverride && svgHeightOverride > 0) {
    return svgHeightOverride;
  }
  return getSvgWidthMm(svgMetrics, svgWidthOverride, svgHeightOverride) / svgMetrics.aspectRatio;
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

function buildMetrics(x: number, y: number, width: number, height: number): SvgDocumentMetrics {
  return { x, y, width, height, aspectRatio: width / height };
}
