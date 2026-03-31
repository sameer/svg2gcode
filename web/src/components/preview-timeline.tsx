import { Pause, Play, RotateCcw, SkipBack, SkipForward, Eye, EyeOff } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { clamp, formatMillimeters } from "@/lib/utils";

import type { OperationSpan, ParsedEvent, ParsedProgram } from "./viewer/parse-gcode";

interface PreviewTimelineProps {
  program: ParsedProgram | null;
  currentDistance: number;
  isPlaying: boolean;
  playbackRate: number;
  showStock: boolean;
  activeOperationId: string | null;
  onDistanceChange: (distance: number) => void;
  onTogglePlaying: () => void;
  onPlaybackRateChange: (rate: number) => void;
  onShowStockChange: (value: boolean) => void;
}

const PLAYBACK_RATES = [0.5, 1, 2, 4] as const;

export function PreviewTimeline({
  program,
  currentDistance,
  isPlaying,
  playbackRate,
  showStock,
  activeOperationId,
  onDistanceChange,
  onTogglePlaying,
  onPlaybackRateChange,
  onShowStockChange,
}: PreviewTimelineProps) {
  const [hoveredEvent, setHoveredEvent] = useState<ParsedEvent | null>(null);

  const totalDistance = program?.totalDistance ?? 0;
  const progress = totalDistance > 0 ? clamp(currentDistance / totalDistance, 0, 1) : 0;
  const activeSpan = useMemo(
    () =>
      program?.operationSpans.find(
        (span) =>
          currentDistance >= span.startDistance && currentDistance <= span.endDistance,
      ) ?? null,
    [currentDistance, program?.operationSpans],
  );

  if (!program) {
    return null;
  }

  return (
    <div className="shrink-0 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" onClick={() => onDistanceChange(0)}>
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button size="icon" onClick={onTogglePlaying}>
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button size="icon" variant="outline" onClick={() => onDistanceChange(totalDistance)}>
          <SkipForward className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDistanceChange(totalDistance)}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Full Path
        </Button>
        <Button
          size="sm"
          variant={showStock ? "secondary" : "outline"}
          onClick={() => onShowStockChange(!showStock)}
        >
          {showStock ? <Eye className="mr-1 h-3.5 w-3.5" /> : <EyeOff className="mr-1 h-3.5 w-3.5" />}
          Stock
        </Button>

        <div className="ml-2 flex items-center gap-1 rounded-full border border-border bg-background p-1">
          {PLAYBACK_RATES.map((rate) => (
            <button
              key={rate}
              className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                playbackRate === rate
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              onClick={() => onPlaybackRateChange(rate)}
            >
              {rate}x
            </button>
          ))}
        </div>

        <div className="ml-auto text-right">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {activeSpan?.operationName ?? "Preview"}
          </p>
          <p className="text-xs font-medium text-foreground">
            {formatMillimeters(progress * totalDistance)} / {formatMillimeters(totalDistance)}
          </p>
        </div>
      </div>

      <div className="relative mt-3 rounded-xl border border-border bg-muted/45 px-3 py-4">
        <div className="relative h-10">
          <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-background shadow-inner" />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary/14"
            style={{ width: `${progress * 100}%` }}
          />

          {program.operationSpans.map((span) => (
            <OperationSpanMarker
              key={span.operationId}
              span={span}
              totalDistance={totalDistance}
              active={activeOperationId ? activeOperationId === span.operationId : activeSpan?.operationId === span.operationId}
              dimmed={!!activeOperationId && activeOperationId !== span.operationId}
              onClick={() => onDistanceChange(span.startDistance)}
            />
          ))}

          {program.events.map((event) => (
            <EventMarker
              key={`${event.kind}-${event.lineNumber}`}
              event={event}
              totalDistance={totalDistance}
              dimmed={!!activeOperationId && event.operationId !== activeOperationId}
              onHover={setHoveredEvent}
              onClick={() => onDistanceChange(event.distance)}
            />
          ))}

          <input
            type="range"
            className="absolute inset-x-0 top-1/2 z-20 h-10 w-full -translate-y-1/2 cursor-pointer appearance-none bg-transparent"
            min={0}
            max={Math.max(totalDistance, 1)}
            step={Math.max(totalDistance / 2000, 0.001)}
            value={clamp(currentDistance, 0, Math.max(totalDistance, 1))}
            onChange={(event) => onDistanceChange(Number(event.target.value))}
          />

          <div
            className="absolute top-1/2 z-30 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow"
            style={{ left: `${progress * 100}%` }}
          />
        </div>

        {hoveredEvent && (
          <div
            className="pointer-events-none absolute top-0 z-40 -translate-y-[115%] rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-lg"
            style={{ left: `${(hoveredEvent.distance / Math.max(totalDistance, 1)) * 100}%` }}
          >
            <p className="font-semibold text-foreground">
              {hoveredEvent.kind === "plunge" ? "Plunge" : "Retract"}
            </p>
            <p className="text-muted-foreground">
              {hoveredEvent.operationName ?? "Unassigned"} • line {hoveredEvent.lineNumber}
            </p>
            <p className="text-muted-foreground">
              X {hoveredEvent.position.x.toFixed(2)} • Y {hoveredEvent.position.y.toFixed(2)} • Z {hoveredEvent.position.z.toFixed(2)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function OperationSpanMarker({
  span,
  totalDistance,
  active,
  dimmed,
  onClick,
}: {
  span: OperationSpan;
  totalDistance: number;
  active: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  const left = (span.startDistance / Math.max(totalDistance, 1)) * 100;
  const width = Math.max(
    ((span.endDistance - span.startDistance) / Math.max(totalDistance, 1)) * 100,
    0.6,
  );

  return (
    <button
      className={`absolute top-1/2 z-10 h-3 -translate-y-1/2 rounded-full transition-opacity ${
        dimmed ? "opacity-25" : active ? "opacity-100" : "opacity-65"
      }`}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        backgroundColor: span.color ?? "#3b82f6",
      }}
      onClick={onClick}
      title={span.operationName}
    />
  );
}

function EventMarker({
  event,
  totalDistance,
  dimmed,
  onHover,
  onClick,
}: {
  event: ParsedEvent;
  totalDistance: number;
  dimmed: boolean;
  onHover: (event: ParsedEvent | null) => void;
  onClick: () => void;
}) {
  const left = (event.distance / Math.max(totalDistance, 1)) * 100;

  return (
    <button
      className={`absolute top-1/2 z-20 -translate-x-1/2 -translate-y-[120%] text-[10px] font-black ${
        dimmed ? "opacity-25" : event.kind === "plunge" ? "text-orange-500" : "text-sky-500"
      }`}
      style={{ left: `${left}%` }}
      onMouseEnter={() => onHover(event)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(event)}
      onBlur={() => onHover(null)}
      onClick={onClick}
      title={`${event.kind} at line ${event.lineNumber}`}
    >
      ▼
    </button>
  );
}
