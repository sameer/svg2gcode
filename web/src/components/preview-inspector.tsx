import { Button } from "@/components/ui/button";
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
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,rgba(25,25,29,0.96),rgba(20,20,24,0.98))] text-white">
      <div className="flex items-center justify-between px-5 py-7">
        <div className="h-11 w-11 rounded-full bg-[radial-gradient(circle_at_35%_35%,#fff7cf,#ff9848_58%,#ff5225)] shadow-[0_10px_30px_rgba(255,122,60,0.24)]" />
        <Button className="h-12 rounded-[1.25rem] px-6 text-lg">Share</Button>
      </div>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 pb-6">
        <Section title="Router bit">
          <div className="flex rounded-[1.2rem] bg-white/[0.05]">
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
                  "h-16 rounded-[1rem] border border-white/8",
                  index === 0 && "ring-1 ring-white/10",
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
                    "flex w-full items-center gap-4 rounded-[1.25rem] px-4 py-4 text-left transition",
                    isActive ? "bg-white/[0.1]" : "bg-white/[0.05] hover:bg-white/[0.07]",
                  )}
                  onClick={() => onOperationSelect(isActive ? null : operation.id)}
                >
                  <span
                    className="h-5 w-5 rounded-[5px]"
                    style={{ backgroundColor: operation.color ?? "#67B8FF" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[1.05rem] font-medium text-white">
                      {formatMillimeters(operation.target_depth_mm)}
                    </p>
                  </div>
                  <div className="border-l border-white/6 pl-4 text-right text-[1.05rem] text-white/42">
                    {operation.assigned_element_ids.length} parts
                  </div>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Camera" icon={Icons.camera}>
          <div className="flex rounded-[1.2rem] bg-white/[0.05] p-1">
            <CameraModeButton
              active={cameraMode === "orthographic"}
              label="Orthographic"
              onClick={() => onCameraModeChange("orthographic")}
            />
            <CameraModeButton
              active={cameraMode === "perspective"}
              label="Perspective"
              onClick={() => onCameraModeChange("perspective")}
            />
          </div>
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
        <h3 className="text-[1.15rem] font-medium text-white">{title}</h3>
        {icon ? (
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/64"
            onClick={onIconClick}
          >
            <AppIcon icon={icon} className="h-4 w-4" />
          </button>
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
    <div className="flex flex-1 items-center justify-center gap-2 py-4 text-lg text-white">
      <AppIcon icon={icon} className="h-4 w-4 text-white/66" />
      {value}
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-14 items-center rounded-[1.15rem] bg-white/[0.05] px-4">
      <span className="mr-3 text-sm text-white/45">{label}</span>
      <span className="text-[1.1rem] text-white">{value}</span>
    </div>
  );
}

function CameraModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "h-12 flex-1 rounded-[1.1rem] text-lg font-medium transition",
        active ? "bg-white/[0.16] text-white" : "text-white/55 hover:bg-white/[0.04] hover:text-white",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
