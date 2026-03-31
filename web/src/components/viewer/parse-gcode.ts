import { clamp } from "@/lib/utils";
import type { OperationLineRange } from "@/lib/types";

export type MotionKind = "rapid" | "plunge" | "cut" | "retract";

export interface ParsedSegment {
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
  command: "G0" | "G1";
  motionKind: MotionKind;
  lineNumber: number;
  operationId: string | null;
  operationName: string | null;
  operationColor: string | null;
  feedrate: number | null;
  distance: number;
  cumulativeDistanceStart: number;
  cumulativeDistanceEnd: number;
}

export interface ParsedEvent {
  kind: "plunge" | "retract";
  lineNumber: number;
  distance: number;
  operationId: string | null;
  operationName: string | null;
  position: { x: number; y: number; z: number };
}

export interface OperationSpan {
  operationId: string;
  operationName: string;
  color: string | null;
  startDistance: number;
  endDistance: number;
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
  totalDistance: number;
  events: ParsedEvent[];
  operationSpans: OperationSpan[];
}

export interface PlaybackSample {
  distance: number;
  segmentIndex: number;
  segment: ParsedSegment | null;
  position: { x: number; y: number; z: number };
  motionKind: MotionKind;
  operationId: string | null;
}

export function parseGcodeProgram(
  gcode: string,
  operationRanges: OperationLineRange[],
): ParsedProgram {
  const operationForLine = buildOperationLineMap(operationRanges);
  let modalCommand: "G0" | "G1" = "G0";
  let modalFeedrate: number | null = null;
  let current = { x: 0, y: 0, z: 0 };
  let totalDistance = 0;
  const segments: ParsedSegment[] = [];
  const events: ParsedEvent[] = [];
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
      } else if (token.startsWith("F")) {
        modalFeedrate = Number.parseFloat(token.slice(1));
      }
    }

    if (!hasMove) {
      continue;
    }

    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const dz = next.z - current.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= 1.0e-9) {
      current = next;
      continue;
    }

    const operation = operationForLine.get(lineNumber) ?? null;
    const motionKind = classifyMotion(modalCommand, current, next);
    const segment: ParsedSegment = {
      start: current,
      end: next,
      command: modalCommand,
      motionKind,
      lineNumber,
      operationId: operation?.operation_id ?? null,
      operationName: operation?.operation_name ?? null,
      operationColor: operation?.color ?? null,
      feedrate: modalFeedrate,
      distance,
      cumulativeDistanceStart: totalDistance,
      cumulativeDistanceEnd: totalDistance + distance,
    };
    totalDistance += distance;
    segments.push(segment);
    current = next;

    if (motionKind === "plunge" || motionKind === "retract") {
      events.push({
        kind: motionKind,
        lineNumber,
        distance: segment.cumulativeDistanceEnd,
        operationId: segment.operationId,
        operationName: segment.operationName,
        position: next,
      });
    }

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

  return {
    segments,
    bounds,
    totalDistance,
    events,
    operationSpans: buildOperationSpans(segments, operationRanges),
  };
}

export function sampleProgramAtDistance(
  program: ParsedProgram,
  requestedDistance: number,
): PlaybackSample {
  if (program.segments.length === 0) {
    return {
      distance: 0,
      segmentIndex: -1,
      segment: null,
      position: { x: 0, y: 0, z: 0 },
      motionKind: "rapid",
      operationId: null,
    };
  }

  const distance = clamp(requestedDistance, 0, program.totalDistance);
  const finalSegment = program.segments.at(-1)!;
  if (distance >= program.totalDistance) {
    return {
      distance,
      segmentIndex: program.segments.length - 1,
      segment: finalSegment,
      position: finalSegment.end,
      motionKind: finalSegment.motionKind,
      operationId: finalSegment.operationId,
    };
  }

  const segmentIndex = program.segments.findIndex(
    (segment) => distance <= segment.cumulativeDistanceEnd,
  );
  const segment = program.segments[Math.max(0, segmentIndex)];
  const spanDistance = segment.distance || 1;
  const t = clamp(
    (distance - segment.cumulativeDistanceStart) / spanDistance,
    0,
    1,
  );

  return {
    distance,
    segmentIndex,
    segment,
    position: {
      x: segment.start.x + (segment.end.x - segment.start.x) * t,
      y: segment.start.y + (segment.end.y - segment.start.y) * t,
      z: segment.start.z + (segment.end.z - segment.start.z) * t,
    },
    motionKind: segment.motionKind,
    operationId: segment.operationId,
  };
}

function classifyMotion(
  command: "G0" | "G1",
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
): MotionKind {
  const xyDistance = Math.hypot(end.x - start.x, end.y - start.y);
  const dz = end.z - start.z;

  if (xyDistance <= 1.0e-9 && dz < 0) {
    return "plunge";
  }
  if (xyDistance <= 1.0e-9 && dz > 0) {
    return "retract";
  }
  if (command === "G0") {
    return "rapid";
  }
  return "cut";
}

function buildOperationLineMap(ranges: OperationLineRange[]) {
  const map = new Map<number, OperationLineRange>();
  for (const range of ranges) {
    for (let line = range.start_line; line <= range.end_line; line += 1) {
      map.set(line, range);
    }
  }
  return map;
}

function buildOperationSpans(
  segments: ParsedSegment[],
  ranges: OperationLineRange[],
): OperationSpan[] {
  return ranges.flatMap((range) => {
    const matchingSegments = segments.filter(
      (segment) =>
        segment.lineNumber >= range.start_line && segment.lineNumber <= range.end_line,
    );
    if (matchingSegments.length === 0) {
      return [];
    }

    return [
      {
        operationId: range.operation_id,
        operationName: range.operation_name,
        color: range.color,
        startDistance: matchingSegments[0].cumulativeDistanceStart,
        endDistance: matchingSegments.at(-1)!.cumulativeDistanceEnd,
      },
    ];
  });
}
