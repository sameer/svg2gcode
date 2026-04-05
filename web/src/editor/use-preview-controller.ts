import { useEffect, useMemo, useState } from "react";

import { parseGcodeProgram, sampleProgramAtDistance } from "@/components/viewer/parse-gcode";
import { clamp } from "@/lib/utils";
import type { FrontendOperation, GenerateJobResponse } from "@/lib/types";

export function usePreviewController(
  generated: GenerateJobResponse | null,
  generatedOperationsSnapshot: FrontendOperation[],
  derivedOperations: FrontendOperation[],
) {
  const [previewActiveOperationId, setPreviewActiveOperationId] = useState<string | null>(null);
  const [previewCameraMode, setPreviewCameraMode] = useState<"orthographic" | "perspective">("orthographic");
  const [previewShowStock, setPreviewShowStock] = useState(true);
  const [previewCurrentDistance, setPreviewCurrentDistance] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewLiveCutSimulation = true;
  const previewPlaybackRate = 1;

  const parsedProgram = useMemo(() => {
    if (!generated) {
      return null;
    }
    return parseGcodeProgram(generated.gcode, generated.operation_ranges);
  }, [generated]);

  useEffect(() => {
    const totalDistance = parsedProgram?.totalDistance ?? 0;
    const frameId = window.requestAnimationFrame(() => {
      setPreviewCurrentDistance(totalDistance);
      setPreviewPlaying(false);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [parsedProgram?.totalDistance]);

  useEffect(() => {
    if (!previewPlaying || !parsedProgram) {
      return;
    }

    let frameId = 0;
    let lastFrame = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - lastFrame) / 1000;
      lastFrame = now;
      const baseDistancePerSecond = Math.max(parsedProgram.totalDistance / 18, 45);

      setPreviewCurrentDistance((distance) => {
        const next = Math.min(
          parsedProgram.totalDistance,
          distance + elapsed * baseDistancePerSecond * previewPlaybackRate,
        );
        if (next >= parsedProgram.totalDistance) {
          setPreviewPlaying(false);
          return parsedProgram.totalDistance;
        }
        return next;
      });

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [parsedProgram, previewPlaybackRate, previewPlaying]);

  const previewOperations = generatedOperationsSnapshot.length > 0 ? generatedOperationsSnapshot : derivedOperations;
  const previewNavigableLines = useMemo(
    () => Array.from(new Set(parsedProgram?.segments.map((segment) => segment.lineNumber) ?? [])),
    [parsedProgram?.segments],
  );
  const previewSample = useMemo(
    () => (parsedProgram ? sampleProgramAtDistance(parsedProgram, previewCurrentDistance) : null),
    [parsedProgram, previewCurrentDistance],
  );
  const activePreviewLineNumber = previewSample?.segment?.lineNumber ?? previewNavigableLines.at(-1) ?? null;

  const focusPreviewLine = (lineNumber: number) => {
    if (!parsedProgram) {
      return;
    }

    const targetSegment =
      parsedProgram.segments.find((segment) => segment.lineNumber >= lineNumber) ??
      parsedProgram.segments.at(-1);
    if (!targetSegment) {
      return;
    }

    setPreviewPlaying(false);
    setPreviewCurrentDistance(targetSegment.cumulativeDistanceStart);
    if (targetSegment.operationId) {
      setPreviewActiveOperationId(targetSegment.operationId);
    }
  };

  const stepPreviewLine = (direction: -1 | 1) => {
    if (previewNavigableLines.length === 0) {
      return;
    }

    const currentIndex = activePreviewLineNumber
      ? Math.max(0, previewNavigableLines.findIndex((lineNumber) => lineNumber >= activePreviewLineNumber))
      : direction > 0
        ? -1
        : previewNavigableLines.length;
    const nextIndex = clamp(currentIndex + direction, 0, previewNavigableLines.length - 1);
    focusPreviewLine(previewNavigableLines[nextIndex]);
  };

  const togglePreviewPlaying = () => {
    if (!parsedProgram) {
      return;
    }

    if (previewCurrentDistance >= parsedProgram.totalDistance) {
      setPreviewCurrentDistance(0);
    }

    setPreviewPlaying((value) => !value);
  };

  return {
    parsedProgram,
    previewOperations,
    previewActiveOperationId,
    setPreviewActiveOperationId,
    previewCameraMode,
    setPreviewCameraMode,
    previewShowStock,
    setPreviewShowStock,
    previewCurrentDistance,
    setPreviewCurrentDistance,
    previewPlaying,
    setPreviewPlaying,
    previewLiveCutSimulation,
    activePreviewLineNumber,
    focusPreviewLine,
    stepPreviewLine,
    togglePreviewPlaying,
  };
}
