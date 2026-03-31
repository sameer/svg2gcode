/**
 * Detects distinct fill/stroke colors from a normalized SVG and groups
 * selectable element IDs by their effective color.
 */

/** Normalize any CSS color string to a canonical hex form using a canvas context. */
function normalizeColor(raw: string): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) {
    return raw.toLowerCase().trim();
  }
  ctx.fillStyle = "#000000";
  ctx.fillStyle = raw;
  return ctx.fillStyle;
}

/** Walk up the DOM looking for the nearest fill or stroke color. */
function getInheritedColor(element: Element): string | null {
  let current: Element | null = element;
  while (current && current instanceof SVGElement) {
    const fill = current.getAttribute("fill");
    if (fill && fill !== "none" && fill !== "inherit") {
      return fill;
    }
    const stroke = current.getAttribute("stroke");
    if (stroke && stroke !== "none" && stroke !== "inherit") {
      return stroke;
    }
    // Check style attribute
    const style = current.getAttribute("style");
    if (style) {
      const fillMatch = style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/);
      if (fillMatch && fillMatch[1].trim() !== "none" && fillMatch[1].trim() !== "inherit") {
        return fillMatch[1].trim();
      }
      const strokeMatch = style.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/);
      if (strokeMatch && strokeMatch[1].trim() !== "none" && strokeMatch[1].trim() !== "inherit") {
        return strokeMatch[1].trim();
      }
    }
    current = current.parentElement;
  }
  return null;
}

export interface ColorGroup {
  color: string;
  normalizedColor: string;
  elementIds: string[];
}

/**
 * Parse a normalized SVG string and group selectable elements by their
 * effective color. Returns an array of color groups sorted by element count
 * (largest first).
 */
export function detectElementColors(normalizedSvg: string): ColorGroup[] {
  const container = document.createElement("div");
  container.innerHTML = normalizedSvg;

  const elements = container.querySelectorAll<SVGElement>("[data-s2g-id]");
  const colorMap = new Map<string, { color: string; ids: string[] }>();

  for (const element of elements) {
    const id = element.getAttribute("data-s2g-id");
    if (!id) {
      continue;
    }

    const rawColor = getInheritedColor(element);
    if (!rawColor) {
      // Default to black for elements with no explicit color
      const normalized = "#000000";
      const entry = colorMap.get(normalized);
      if (entry) {
        entry.ids.push(id);
      } else {
        colorMap.set(normalized, { color: "#000000", ids: [id] });
      }
      continue;
    }

    const normalized = normalizeColor(rawColor);
    const entry = colorMap.get(normalized);
    if (entry) {
      entry.ids.push(id);
    } else {
      colorMap.set(normalized, { color: rawColor, ids: [id] });
    }
  }

  return Array.from(colorMap.entries())
    .map(([normalizedColor, { color, ids }]) => ({
      color,
      normalizedColor,
      elementIds: ids,
    }))
    .sort((a, b) => b.elementIds.length - a.elementIds.length);
}

/**
 * Returns a map of elementId → normalizedColor for use in the layer tree.
 */
export function buildElementColorMap(normalizedSvg: string): Map<string, string> {
  const groups = detectElementColors(normalizedSvg);
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const id of group.elementIds) {
      map.set(id, group.normalizedColor);
    }
  }
  return map;
}
