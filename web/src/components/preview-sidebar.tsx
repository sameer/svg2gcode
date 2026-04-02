import { useEffect, useMemo, useRef } from "react";

import { AppIcon, Icons } from "@/lib/icons";
import type { FrontendOperation, GenerateJobResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { ParsedProgram } from "./viewer/parse-gcode";

interface PreviewSidebarProps {
  projectName: string;
  projectSubtitle: string;
  generated: GenerateJobResponse | null;
  program: ParsedProgram | null;
  operations: FrontendOperation[];
  error: string | null;
  activeLineNumber: number | null;
  activeOperationId: string | null;
  onLineSelect: (lineNumber: number) => void;
  onStepLine: (direction: -1 | 1) => void;
  onOperationSelect: (operationId: string | null) => void;
}

export function PreviewSidebar({
  projectName,
  projectSubtitle,
  generated,
  program,
  operations,
  error,
  activeLineNumber,
  activeOperationId,
  onLineSelect,
  onStepLine,
  onOperationSelect,
}: PreviewSidebarProps) {
  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeLineNumber]);

  const lines = useMemo(() => generated?.gcode.split(/\r?\n/) ?? [], [generated?.gcode]);
  const operationByLine = useMemo(() => {
    const map = new Map<number, { operationId: string | null; operationName: string | null; color: string | null }>();
    for (const segment of program?.segments ?? []) {
      if (!map.has(segment.lineNumber)) {
        map.set(segment.lineNumber, {
          operationId: segment.operationId,
          operationName: segment.operationName,
          color: segment.operationColor,
        });
      }
    }
    return map;
  }, [program?.segments]);

  if (!generated) {
    return (
      <div className="flex h-full flex-col bg-[linear-gradient(180deg,rgba(25,25,29,0.96),rgba(20,20,24,0.98))] px-5 py-5 text-white">
        <div className="rounded-[1.35rem] border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-sm leading-relaxed text-white/45">
          Generate a path from the Design workspace to open the 3D review panels.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,rgba(25,25,29,0.96),rgba(20,20,24,0.98))] text-white">
      <div className="border-b border-white/6 px-5 py-5">
        <div className="flex items-center justify-between">
          <div className="text-[2.1rem] font-black tracking-[-0.08em] text-white/70">LOGO</div>
        </div>
        <div className="mt-8">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[2rem] font-semibold tracking-[-0.04em] text-white">
              {projectName}
            </h2>
            <AppIcon icon={Icons.chevronDown} className="h-4 w-4 text-white/70" />
          </div>
          <p className="mt-1 text-base text-white/42">{projectSubtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-5 py-5">
        <div className="text-sm uppercase tracking-[0.18em] text-white/46">GCODE</div>
        <div className="text-[1.05rem] text-white/52">
          {activeLineNumber ?? 0} of {lines.length}
        </div>
        <button className="ml-auto text-white/68" onClick={() => onStepLine(-1)}>
          <AppIcon icon={Icons.chevronLeft} className="h-5 w-5" />
        </button>
        <button className="text-white/68" onClick={() => onStepLine(1)}>
          <AppIcon icon={Icons.chevronRight} className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="space-y-1 pb-5">
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const operation = operationByLine.get(lineNumber);
            const isActive = activeLineNumber === lineNumber;
            const isDimmed =
              !!activeOperationId &&
              operation?.operationId &&
              operation.operationId !== activeOperationId;

            return (
              <button
                key={`${lineNumber}-${line}`}
                ref={isActive ? activeLineRef : null}
                className={cn(
                  "flex w-full items-start gap-3 rounded-[1rem] px-3 py-2 text-left font-mono text-[0.98rem] transition",
                  isActive ? "bg-[#CAFFC6] text-[#233125]" : "text-white/78 hover:bg-white/[0.04]",
                  isDimmed && "opacity-35",
                )}
                onClick={() => onLineSelect(lineNumber)}
              >
                <span className="w-10 shrink-0 text-right text-white/28">{lineNumber}</span>
                {operation?.color ? (
                  <span
                    className={cn("mt-[0.38rem] h-2.5 w-2.5 shrink-0 rounded-full", isActive && "opacity-90")}
                    style={{ backgroundColor: operation.color }}
                  />
                ) : (
                  <span className="mt-[0.38rem] h-2.5 w-2.5 shrink-0 rounded-full bg-transparent" />
                )}
                <span className="min-w-0 break-all">{line || " "}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-white/6 px-5 py-5">
        <p className="mb-4 text-[1.15rem] font-medium text-white/92">Warnings</p>
        <div className="space-y-3">
          {generated.warnings.length > 0 ? (
            generated.warnings.map((warning) => (
              <div
                key={warning}
                className="rounded-[1.35rem] bg-[#2b241a] px-4 py-4 text-[#f3c265]"
              >
                <div className="flex items-start gap-3">
                  <AppIcon icon={Icons.warning} className="mt-1 h-4 w-4 shrink-0" />
                  <div>
                    <p className="text-[1.05rem] font-medium">Toolpath problem</p>
                    <p className="mt-1 text-sm leading-relaxed text-[#d3b07a]">{warning}</p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[1.35rem] bg-white/[0.04] px-4 py-4 text-sm text-white/42">
              No warnings on the current program.
            </div>
          )}

          {error ? (
            <div className="rounded-[1.35rem] bg-red-500/12 px-4 py-4 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          {operations.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {operations.map((operation) => {
                const active = activeOperationId === operation.id;
                return (
                  <button
                    key={operation.id}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm transition",
                      active ? "bg-white/[0.12] text-white" : "bg-white/[0.05] text-white/55 hover:text-white",
                    )}
                    onClick={() => onOperationSelect(active ? null : operation.id)}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: operation.color ?? "#67B8FF" }}
                    />
                    {operation.name}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
