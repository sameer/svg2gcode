import { Button, Tabs } from "@heroui/react";
import { AppIcon, Icons } from "@/lib/icons";
import type { FrontendOperation, GenerateJobResponse } from "@/lib/types";
import { cn, formatMillimeters } from "@/lib/utils";

interface PreviewInspectorProps {
  generated: GenerateJobResponse | null;
  operations: FrontendOperation[];
  activeOperationId: string | null;
  cameraMode: "orthographic" | "perspective";
  showStock: boolean;
  onOperationSelect: (operationId: string | null) => void;
  onCameraModeChange: (mode: "orthographic" | "perspective") => void;
  onShowStockChange: (value: boolean) => void;
}

export function PreviewInspector({
  generated,
  operations,
  activeOperationId,
  cameraMode,
  showStock,
  onOperationSelect,
  onCameraModeChange,
  onShowStockChange,
}: PreviewInspectorProps) {
  const snapshot = generated?.preview_snapshot;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center justify-between px-4 py-4">
        <div className="h-9 w-9 rounded-full bg-primary/30" />
        <Button size="sm">Share</Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        <Section title="Router bit">
          <div className="flex rounded-md border border-border bg-content1">
            <MetricCell icon={Icons.camera} value={`${snapshot?.tool_diameter ?? 6}mm`} />
            <MetricCell icon={Icons.positionY} value={`${snapshot?.material_height ?? 40}mm`} />
            <MetricCell icon={Icons.code} value="Flat" />
          </div>
        </Section>

        <Section
          title="Stock"
          icon={showStock ? Icons.eye : Icons.eyeOff}
          onIconClick={() => onShowStockChange(!showStock)}
        >
          <div className="grid grid-cols-3 gap-3">
            <MetricPill label="W" value={`${snapshot?.material_width ?? 40}mm`} />
            <MetricPill label="H" value={`${snapshot?.material_height ?? 40}mm`} />
            <MetricPill label="T" value={`${snapshot?.material_thickness ?? 18}mm`} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {["#d8d9dd", "#d99a42", "#d9c29a"].map((swatch, index) => (
              <button
                key={swatch}
                className={cn(
                  "h-12 rounded-md border border-border",
                  index === 0 && "ring-1 ring-primary/30",
                )}
                style={{
                  background:
                    index === 0
                      ? "radial-gradient(circle at 35% 30%, #ffffff, #c7c8cc 50%, #8d9197)"
                      : index === 1
                        ? "radial-gradient(circle at 35% 30%, #ffd89e, #df9942 55%, #9a5d13)"
                        : "radial-gradient(circle at 35% 30%, #f5deb3, #d9bb7c 58%, #9d7b4c)",
                }}
                disabled
              />
            ))}
          </div>
        </Section>

        <Section title="Cut Depths" icon={Icons.eye}>
          <div className="space-y-3">
            {operations.map((operation) => {
              const isActive = activeOperationId === operation.id;
              return (
                <button
                  key={operation.id}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left transition",
                    isActive ? "bg-content3" : "bg-content1 hover:bg-content2",
                  )}
                  onClick={() => onOperationSelect(isActive ? null : operation.id)}
                >
                  <span
                    className="h-5 w-5 rounded-[5px]"
                    style={{ backgroundColor: operation.color ?? "#67B8FF" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {formatMillimeters(operation.target_depth_mm)}
                    </p>
                  </div>
                  <div className="border-l border-border pl-3 text-right text-xs text-muted-foreground">
                    {operation.assigned_element_ids.length} parts
                  </div>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Camera" icon={Icons.camera}>
          <Tabs
            className="w-full max-w-md"
            selectedKey={cameraMode}
            onSelectionChange={(key) => {
              const next = String(key);
              if (next === "orthographic" || next === "perspective") {
                onCameraModeChange(next);
              }
            }}
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="Camera mode">
                <Tabs.Tab id="orthographic">
                Orthographic
                <Tabs.Indicator />
              </Tabs.Tab>
                <Tabs.Tab id="perspective">
                Perspective
                <Tabs.Indicator />
              </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  onIconClick,
  children,
}: {
  title: string;
  icon?: typeof Icons.eye;
  onIconClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {icon ? (
          <Button isIconOnly size="sm" variant="ghost" onPress={onIconClick}>
            <AppIcon icon={icon} className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function MetricCell({
  icon,
  value,
}: {
  icon: typeof Icons.camera;
  value: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 py-2 text-sm text-foreground">
      <AppIcon icon={icon} className="h-4 w-4 text-muted-foreground" />
      {value}
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-9 items-center rounded-md border border-border bg-content1 px-3">
      <span className="mr-2 text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
