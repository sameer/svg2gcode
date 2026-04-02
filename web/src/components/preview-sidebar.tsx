import { useEffect, useMemo, useRef } from "react";
import { Alert, Button, Tag, TagGroup } from "@heroui/react";

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
      <div className="flex h-full flex-col bg-background px-4 py-4">
        <div className="rounded-md border border-dashed border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
          Generate a path from the Design workspace to open the 3D review panels.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="text-xl font-bold text-foreground">LOGO</div>
        </div>
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-foreground">
              {projectName}
            </h2>
            <AppIcon icon={Icons.chevronDown} className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{projectSubtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">GCODE</div>
        <div className="text-sm text-muted-foreground">
          {activeLineNumber ?? 0} of {lines.length}
        </div>
        <Button className="ml-auto" isIconOnly size="sm" variant="ghost" onPress={() => onStepLine(-1)}>
          <AppIcon icon={Icons.chevronLeft} className="h-5 w-5" />
        </Button>
        <Button isIconOnly size="sm" variant="ghost" onPress={() => onStepLine(1)}>
          <AppIcon icon={Icons.chevronRight} className="h-5 w-5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3">
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
                  "flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left font-mono text-sm transition",
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

      <div className="border-t border-border px-4 py-4">
        <p className="mb-3 text-sm font-semibold text-foreground">Warnings</p>
        <div className="space-y-3">
          {generated.warnings.length > 0 ? (
            generated.warnings.map((warning) => (
              <Alert key={warning} status="warning">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Toolpath problem</Alert.Title>
                  <Alert.Description>{warning}</Alert.Description>
                </Alert.Content>
              </Alert>
            ))
          ) : (
            <div className="rounded-md border border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
              No warnings on the current program.
            </div>
          )}

          {error ? (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Error</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {operations.length > 0 ? (
            <TagGroup aria-label="Operations" className="pt-1" selectionMode="single">
              <TagGroup.List className="flex flex-wrap gap-2">
              {operations.map((operation) => {
                const active = activeOperationId === operation.id;
                return (
                  <Tag
                    key={operation.id}
                    id={operation.id}
                    className={cn(active ? "bg-content3" : undefined)}
                    onPress={() => onOperationSelect(active ? null : operation.id)}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: operation.color ?? "#67B8FF" }}
                    />
                    {operation.name}
                  </Tag>
                );
              })}
              </TagGroup.List>
            </TagGroup>
          ) : null}
        </div>
      </div>
    </div>
  );
}
