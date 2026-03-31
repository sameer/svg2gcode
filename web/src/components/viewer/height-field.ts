import { clamp } from "@/lib/utils";

import type { ParsedSegment } from "./parse-gcode";

export interface HeightField {
  width: number;
  height: number;
  cols: number;
  rows: number;
  values: Float32Array;
}

export function buildHeightField(
  materialWidth: number,
  materialHeight: number,
  toolDiameter: number,
  segments: ParsedSegment[],
) {
  const targetCellSize = Math.max(toolDiameter / 6, 0.05);
  const cols = clamp(Math.round(materialWidth / targetCellSize) + 1, 250, 1200);
  const rows = clamp(Math.round(materialHeight / targetCellSize) + 1, 250, 1200);
  const values = new Float32Array(cols * rows).fill(0);
  const radius = Math.max(toolDiameter * 0.5, targetCellSize * 0.5);

  for (const segment of segments) {
    const depth = Math.min(segment.start.z, segment.end.z);
    const xyDistance = Math.hypot(
      segment.end.x - segment.start.x,
      segment.end.y - segment.start.y,
    );

    if (segment.command !== "G1" || depth >= 0 || xyDistance === 0) {
      continue;
    }

    const cellSize = Math.min(materialWidth / (cols - 1), materialHeight / (rows - 1));
    const samples = Math.max(2, Math.ceil(xyDistance / Math.max(cellSize * 0.4, 0.1)));
    for (let sampleIndex = 0; sampleIndex <= samples; sampleIndex += 1) {
      const t = sampleIndex / samples;
      const x = segment.start.x + (segment.end.x - segment.start.x) * t;
      const y = segment.start.y + (segment.end.y - segment.start.y) * t;
      stampCircularCut(values, cols, rows, materialWidth, materialHeight, x, y, radius, depth);
    }
  }

  return {
    width: materialWidth,
    height: materialHeight,
    cols,
    rows,
    values,
  } satisfies HeightField;
}

function stampCircularCut(
  values: Float32Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  depth: number,
) {
  const colRadius = Math.max(1, Math.ceil((radius / width) * (cols - 1)));
  const rowRadius = Math.max(1, Math.ceil((radius / height) * (rows - 1)));
  const centerCol = ((centerX / width) * (cols - 1)) | 0;
  const centerRow = ((centerY / height) * (rows - 1)) | 0;

  for (let row = Math.max(0, centerRow - rowRadius); row <= Math.min(rows - 1, centerRow + rowRadius); row += 1) {
    for (let col = Math.max(0, centerCol - colRadius); col <= Math.min(cols - 1, centerCol + colRadius); col += 1) {
      const x = (col / (cols - 1)) * width;
      const y = (row / (rows - 1)) * height;
      if (Math.hypot(x - centerX, y - centerY) <= radius) {
        const index = row * cols + col;
        values[index] = Math.min(values[index], depth);
      }
    }
  }
}
