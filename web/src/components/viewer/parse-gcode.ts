import type { OperationLineRange } from "@/lib/types";

export interface ParsedSegment {
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
  command: "G0" | "G1";
  lineNumber: number;
  operationId: string | null;
}

export interface ParsedProgram {
  segments: ParsedSegment[];
  bounds: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  } | null;
}

export function parseGcodeProgram(
  gcode: string,
  operationRanges: OperationLineRange[],
): ParsedProgram {
  const operationForLine = buildOperationLineMap(operationRanges);
  let modalCommand: "G0" | "G1" = "G0";
  let current = { x: 0, y: 0, z: 0 };
  const segments: ParsedSegment[] = [];
  let bounds: ParsedProgram["bounds"] = null;

  for (const [index, rawLine] of gcode.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.split(";")[0].trim();
    if (!line) {
      continue;
    }

    const tokens = line.split(/\s+/);
    let next = { ...current };
    let hasMove = false;

    for (const token of tokens) {
      if (token === "G0" || token === "G00") {
        modalCommand = "G0";
      } else if (token === "G1" || token === "G01") {
        modalCommand = "G1";
      } else if (token.startsWith("X")) {
        next.x = Number.parseFloat(token.slice(1));
        hasMove = true;
      } else if (token.startsWith("Y")) {
        next.y = Number.parseFloat(token.slice(1));
        hasMove = true;
      } else if (token.startsWith("Z")) {
        next.z = Number.parseFloat(token.slice(1));
        hasMove = true;
      }
    }

    if (!hasMove) {
      continue;
    }

    const segment: ParsedSegment = {
      start: current,
      end: next,
      command: modalCommand,
      lineNumber,
      operationId: operationForLine.get(lineNumber) ?? null,
    };
    segments.push(segment);
    current = next;

    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, segment.start.x, segment.end.x),
          minY: Math.min(bounds.minY, segment.start.y, segment.end.y),
          minZ: Math.min(bounds.minZ, segment.start.z, segment.end.z),
          maxX: Math.max(bounds.maxX, segment.start.x, segment.end.x),
          maxY: Math.max(bounds.maxY, segment.start.y, segment.end.y),
          maxZ: Math.max(bounds.maxZ, segment.start.z, segment.end.z),
        }
      : {
          minX: Math.min(segment.start.x, segment.end.x),
          minY: Math.min(segment.start.y, segment.end.y),
          minZ: Math.min(segment.start.z, segment.end.z),
          maxX: Math.max(segment.start.x, segment.end.x),
          maxY: Math.max(segment.start.y, segment.end.y),
          maxZ: Math.max(segment.start.z, segment.end.z),
        };
  }

  return { segments, bounds };
}

function buildOperationLineMap(ranges: OperationLineRange[]) {
  const map = new Map<number, string>();
  for (const range of ranges) {
    for (let line = range.start_line; line <= range.end_line; line += 1) {
      map.set(line, range.operation_id);
    }
  }
  return map;
}
