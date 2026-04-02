import { useMemo, useState } from "react";

import { AppIcon, Icons } from "@/lib/icons";
import { clamp } from "@/lib/utils";

import type { OperationSpan, ParsedEvent, ParsedProgram } from "./viewer/parse-gcode";

interface PreviewTimelineProps {
  program: ParsedProgram | null;
  currentDistance: number;
  isPlaying: boolean;
  activeOperationId: string | null;
  onDistanceChange: (distance: number) => void;
  onTogglePlaying: () => void;
}

export function PreviewTimeline({
  program,
  currentDistance,
  isPlaying,
  activeOperationId,
  onDistanceChange,
  onTogglePlaying,
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
    <div className="pointer-events-none absolute inset-x-8 bottom-7 z-30 flex justify-center">
      <div className="pointer-events-auto w-full max-w-[920px] rounded-[1.9rem] border border-white/8 bg-[rgba(22,22,27,0.92)] px-6 py-5 shadow-[0_28px_70px_rgba(0,0,0,0.48)] backdrop-blur-2xl">
        <div className="flex items-center gap-3">
          <TransportButton icon={Icons.prev} onClick={() => onDistanceChange(0)} />
          <TransportButton
            icon={isPlaying ? Icons.pause : Icons.play}
            active
            onClick={onTogglePlaying}
          />
          <TransportButton icon={Icons.next} onClick={() => onDistanceChange(totalDistance)} />

          <div className="ml-3 flex items-center gap-3">
            {program.operationSpans.slice(0, 6).map((span) => (
              <button
                key={span.operationId}
                className="h-4 w-4 rounded-full transition"
                style={{
                  backgroundColor: span.color ?? "#67B8FF",
                  opacity:
                    !activeOperationId || activeOperationId === span.operationId ? 1 : 0.4,
                }}
                onClick={() => onDistanceChange(span.startDistance)}
                title={span.operationName}
              />
            ))}
          </div>

          <div className="ml-auto min-w-0 text-right">
            <p className="text-xs uppercase tracking-[0.18em] text-white/32">
              {activeSpan?.operationName ?? "Preview"}
            </p>
          </div>
        </div>

        <div className="relative mt-5 h-12">
          <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-black/40" />

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
            className="absolute top-1/2 z-30 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-[0.95rem] border-2 border-white/80 bg-[#7BFFAF] shadow-[0_0_18px_rgba(123,255,175,0.3)]"
            style={{ left: `${progress * 100}%` }}
          />

          {hoveredEvent ? (
            <div
              className="pointer-events-none absolute bottom-full z-40 mb-3 rounded-[1rem] border border-white/10 bg-[rgba(19,19,23,0.98)] px-3 py-2 text-xs shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
              style={{ left: `${(hoveredEvent.distance / Math.max(totalDistance, 1)) * 100}%` }}
            >
              <p className="font-semibold text-white">
                {hoveredEvent.kind === "plunge" ? "Plunge" : "Retract"}
              </p>
              <p className="text-white/55">
                {hoveredEvent.operationName ?? "Unassigned"} • line {hoveredEvent.lineNumber}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TransportButton({
  icon,
  active = false,
  onClick,
}: {
  icon: typeof Icons.play;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={
        active
          ? "inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.12] text-white"
          : "inline-flex h-11 w-11 items-center justify-center rounded-full text-white/78 transition hover:bg-white/[0.06] hover:text-white"
      }
      onClick={onClick}
    >
      <AppIcon icon={icon} className="h-5 w-5" />
    </button>
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
      className={active ? "absolute top-1/2 z-10 h-3 -translate-y-1/2 rounded-full" : "absolute top-1/2 z-10 h-3 -translate-y-1/2 rounded-full"}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        backgroundColor: span.color ?? "#3b82f6",
        opacity: dimmed ? 0.28 : active ? 1 : 0.66,
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
      className="absolute top-1/2 z-20 -translate-x-1/2 -translate-y-[125%]"
      style={{
        left: `${left}%`,
        opacity: dimmed ? 0.25 : 1,
        color: event.kind === "plunge" ? "#FF6B6B" : "#67B8FF",
      }}
      onMouseEnter={() => onHover(event)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(event)}
      onBlur={() => onHover(null)}
      onClick={onClick}
      title={`${event.kind} at line ${event.lineNumber}`}
    >
      ●
    </button>
  );
}
