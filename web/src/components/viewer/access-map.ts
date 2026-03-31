import { clamp } from "@/lib/utils";

import type { ParsedSegment } from "./parse-gcode";

export function buildAccessMap(
  materialWidth: number,
  materialHeight: number,
  toolDiameter: number,
  segments: ParsedSegment[],
  maxDepth: number,
) {
  const longestSide = Math.max(materialWidth, materialHeight);
  const targetPixelsPerMillimeter = clamp(10 / Math.max(toolDiameter, 0.75), 3, 10);
  const textureLongestSide = clamp(
    Math.round(longestSide * targetPixelsPerMillimeter),
    1024,
    2048,
  );
  const scale = textureLongestSide / longestSide;
  const width = Math.max(1, Math.round(materialWidth * scale));
  const height = Math.max(1, Math.round(materialHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return canvas;
  }

  const lineWidth = Math.max(toolDiameter * scale, 1.5);
  const innerWidth = Math.max(lineWidth * 0.66, 1);
  const crispLineWidth = Math.max(1.1, Math.min(3.2, lineWidth * 0.16));
  const safeDepth = Math.max(Math.abs(maxDepth), 0.01);

  for (const segment of segments) {
    if (segment.motionKind !== "cut" && segment.motionKind !== "plunge") {
      continue;
    }

    const depth = Math.abs(Math.min(segment.start.z, segment.end.z));
    if (depth <= 0) {
      continue;
    }

    const depthRatio = clamp(depth / safeDepth, 0.15, 1);
    const grooveShade = 58 - depthRatio * 12;
    const grooveAlpha = 0.22 + depthRatio * 0.18;
    const start = toCanvasPoint(segment.start.x, segment.start.y, materialHeight, scale);
    const end = toCanvasPoint(segment.end.x, segment.end.y, materialHeight, scale);

    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = `rgba(${grooveShade}, ${grooveShade - 10}, ${grooveShade - 22}, ${grooveAlpha})`;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();

    context.strokeStyle = `rgba(247, 239, 228, ${0.06 + depthRatio * 0.06})`;
    context.lineWidth = innerWidth;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();

    if (segment.motionKind === "plunge") {
      context.fillStyle = `rgba(${grooveShade}, ${grooveShade - 10}, ${grooveShade - 22}, ${grooveAlpha + 0.08})`;
      context.beginPath();
      context.arc(end.x, end.y, lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    }
  }

  for (const segment of segments) {
    if (segment.motionKind !== "cut") {
      continue;
    }

    const start = toCanvasPoint(segment.start.x, segment.start.y, materialHeight, scale);
    const end = toCanvasPoint(segment.end.x, segment.end.y, materialHeight, scale);
    context.strokeStyle = "rgba(34, 24, 18, 0.78)";
    context.lineWidth = crispLineWidth;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }

  return canvas;
}

function toCanvasPoint(x: number, y: number, materialHeight: number, scale: number) {
  return {
    x: x * scale,
    y: (materialHeight - y) * scale,
  };
}
