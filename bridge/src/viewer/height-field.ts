import { clamp } from "../utils";
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
  const targetCellSize = Math.max(toolDiameter / 10, 0.03);
  const cols = clamp(Math.round(materialWidth / targetCellSize) + 1, 420, 1800);
  const rows = clamp(Math.round(materialHeight / targetCellSize) + 1, 420, 1800);
  const values = new Float32Array(cols * rows).fill(0);
  const radius = Math.max(toolDiameter * 0.5, targetCellSize * 0.5);
  const cellSize = Math.min(
    materialWidth / Math.max(1, cols - 1),
    materialHeight / Math.max(1, rows - 1),
  );

  for (const segment of segments) {
    const depth = Math.min(segment.start.z, segment.end.z);
    const xyDistance = Math.hypot(
      segment.end.x - segment.start.x,
      segment.end.y - segment.start.y,
    );

    if ((segment.motionKind !== "cut" && segment.motionKind !== "plunge") || depth >= 0) {
      continue;
    }

    if (xyDistance <= 1.0e-9) {
      stampCircularCut(
        values, cols, rows, materialWidth, materialHeight,
        segment.end.x, segment.end.y, radius, Math.min(segment.end.z, 0), cellSize,
      );
      continue;
    }

    const samples = Math.max(4, Math.ceil(xyDistance / Math.max(cellSize * 0.14, 0.035)));
    for (let sampleIndex = 0; sampleIndex <= samples; sampleIndex += 1) {
      const t = sampleIndex / samples;
      const x = segment.start.x + (segment.end.x - segment.start.x) * t;
      const y = segment.start.y + (segment.end.y - segment.start.y) * t;
      const sampleDepth = segment.start.z + (segment.end.z - segment.start.z) * t;
      stampCircularCut(
        values, cols, rows, materialWidth, materialHeight,
        x, y, radius, Math.min(sampleDepth, 0), cellSize,
      );
    }
  }

  return { width: materialWidth, height: materialHeight, cols, rows, values } satisfies HeightField;
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
  cellSize: number,
) {
  const feather = Math.max(cellSize * 0.75, radius * 0.07);
  const stampRadius = radius + feather;
  const colRadius = Math.max(1, Math.ceil((stampRadius / width) * (cols - 1)));
  const rowRadius = Math.max(1, Math.ceil((stampRadius / height) * (rows - 1)));
  const centerCol = ((centerX / width) * (cols - 1)) | 0;
  const centerRow = ((centerY / height) * (rows - 1)) | 0;

  for (let row = Math.max(0, centerRow - rowRadius); row <= Math.min(rows - 1, centerRow + rowRadius); row += 1) {
    for (let col = Math.max(0, centerCol - colRadius); col <= Math.min(cols - 1, centerCol + colRadius); col += 1) {
      const x = (col / (cols - 1)) * width;
      const y = (row / (rows - 1)) * height;
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance > stampRadius) {
        continue;
      }

      const blend = smoothstep(radius + feather, Math.max(0, radius - feather), distance);
      const index = row * cols + col;
      values[index] = Math.min(values[index], depth * blend);
    }
  }
}

function smoothstep(edge0: number, edge1: number, x: number) {
  if (edge0 === edge1) {
    return x <= edge1 ? 1 : 0;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
