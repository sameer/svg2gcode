import { clamp } from "../utils";
import type { ParsedSegment } from "./parse-gcode";

export function clipSegmentToDistance(
  segment: ParsedSegment,
  currentDistance: number,
): ParsedSegment | null {
  if (currentDistance <= segment.cumulativeDistanceStart) {
    return null;
  }
  if (currentDistance >= segment.cumulativeDistanceEnd) {
    return segment;
  }

  const t = clamp(
    (currentDistance - segment.cumulativeDistanceStart) / Math.max(segment.distance, 1.0e-9),
    0,
    1,
  );
  const midpoint = interpolatePoint(segment, t);

  return {
    ...segment,
    end: midpoint,
    distance: segment.distance * t,
    cumulativeDistanceEnd: currentDistance,
  };
}

export function splitSegmentAtDistance(
  segment: ParsedSegment,
  currentDistance: number,
) {
  if (currentDistance <= segment.cumulativeDistanceStart) {
    return { past: null, future: segment };
  }
  if (currentDistance >= segment.cumulativeDistanceEnd) {
    return { past: segment, future: null };
  }

  const t = clamp(
    (currentDistance - segment.cumulativeDistanceStart) / Math.max(segment.distance, 1.0e-9),
    0,
    1,
  );
  const midpoint = interpolatePoint(segment, t);

  return {
    past: {
      ...segment,
      end: midpoint,
      distance: segment.distance * t,
      cumulativeDistanceEnd: currentDistance,
    } satisfies ParsedSegment,
    future: {
      ...segment,
      start: midpoint,
      distance: segment.distance * (1 - t),
      cumulativeDistanceStart: currentDistance,
    } satisfies ParsedSegment,
  };
}

function interpolatePoint(segment: ParsedSegment, t: number) {
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * t,
    y: segment.start.y + (segment.end.y - segment.start.y) * t,
    z: segment.start.z + (segment.end.z - segment.start.z) * t,
  };
}
