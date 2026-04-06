import type { SvgDocumentMetrics } from "./types";
import { clamp } from "./utils";

/** CSS default DPI per spec — unitless/px SVG dimensions use this. */
const CSS_DEFAULT_DPI = 96;

/**
 * Parse an SVG length string (e.g. "100", "50mm", "2in") and return
 * the value converted to millimeters.
 */
function parseLengthToMm(raw: string): number | null {
  const match = raw.trim().match(/^([0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)\s*(mm|cm|in|pt|pc|px|)?$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (match[2] || "").toLowerCase();

  switch (unit) {
    case "mm":
      return value;
    case "cm":
      return value * 10;
    case "in":
      return value * 25.4;
    case "pt":
      return (value / 72) * 25.4;
    case "pc":
      return (value / 6) * 25.4;
    case "px":
    case "": // unitless = user units = px at 96 DPI
      return (value / CSS_DEFAULT_DPI) * 25.4;
    default:
      return null;
  }
}

/**
 * Parse SVG document metrics from a normalized SVG string.
 * Returns dimensions in millimeters.
 * Browser-only: uses DOMParser.
 */
export function parseSvgDocumentMetrics(normalizedSvg: string): SvgDocumentMetrics | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(normalizedSvg, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) {
    return null;
  }

  // Parse viewBox for aspect ratio and internal coordinate system
  let vbX = 0, vbY = 0, vbWidth = 0, vbHeight = 0;
  let hasViewBox = false;
  const viewBox = svgEl.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      [vbX, vbY, vbWidth, vbHeight] = parts;
      hasViewBox = true;
    }
  }

  // Parse width/height with unit awareness → convert to mm
  const widthAttr = svgEl.getAttribute("width");
  const heightAttr = svgEl.getAttribute("height");
  const widthMm = widthAttr ? parseLengthToMm(widthAttr) : null;
  const heightMm = heightAttr ? parseLengthToMm(heightAttr) : null;

  if (widthMm && heightMm) {
    return buildMetrics(
      hasViewBox ? vbX : 0,
      hasViewBox ? vbY : 0,
      hasViewBox ? vbWidth : widthMm,
      hasViewBox ? vbHeight : heightMm,
      widthMm,
      heightMm,
    );
  }

  if (hasViewBox) {
    // viewBox only (no width/height): convert viewBox via DPI
    const fallbackWidthMm = (vbWidth / CSS_DEFAULT_DPI) * 25.4;
    const fallbackHeightMm = (vbHeight / CSS_DEFAULT_DPI) * 25.4;

    let physW: number, physH: number;
    if (widthMm) {
      physW = widthMm;
      physH = widthMm * (vbHeight / vbWidth);
    } else if (heightMm) {
      physH = heightMm;
      physW = heightMm * (vbWidth / vbHeight);
    } else {
      physW = fallbackWidthMm;
      physH = fallbackHeightMm;
    }

    return buildMetrics(vbX, vbY, vbWidth, vbHeight, physW, physH);
  }

  // No viewBox, no valid dimensions
  if (!widthMm && !heightMm) return null;

  const w = widthMm ?? heightMm!;
  const h = heightMm ?? widthMm!;
  return buildMetrics(0, 0, w, h, w, h);
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
  return svgMetrics.widthMm;
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

function buildMetrics(
  x: number, y: number,
  width: number, height: number,
  widthMm: number, heightMm: number,
): SvgDocumentMetrics {
  return { x, y, width, height, widthMm, heightMm, aspectRatio: widthMm / heightMm };
}
