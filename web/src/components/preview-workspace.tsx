import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { NcViewer } from "@/components/nc-viewer";
import { PreviewInspector } from "@/components/preview-inspector";
import { PreviewSidebar } from "@/components/preview-sidebar";
import { PreviewTimeline } from "@/components/preview-timeline";
import { TopBar } from "@/components/top-bar";
import type { FrontendOperation, GenerateJobResponse } from "@/lib/types";
import type { ParsedProgram } from "@/components/viewer/parse-gcode";

interface PreviewWorkspaceProps {
  projectName: string;
  projectSubtitle: string;
  generated: GenerateJobResponse | null;
  parsedProgram: ParsedProgram | null;
  previewOperations: FrontendOperation[];
  error: string | null;
  activePreviewLineNumber: number | null;
  previewActiveOperationId: string | null;
  onLineSelect: (lineNumber: number) => void;
  onStepLine: (direction: -1 | 1) => void;
  onOperationSelect: (operationId: string | null) => void;
  activeTab: "prepare" | "preview";
  canPreview: boolean;
  isBusy: boolean;
  processLabel: string;
  processDisabled: boolean;
  exportDisabled: boolean;
  onTabChange: (tab: "prepare" | "preview") => void;
  onProcess: () => void;
  onExport: () => void;
  onPreviewBlocked: () => void;
  previewCurrentDistance: number;
  previewShowStock: boolean;
  previewLiveCutSimulation: boolean;
  previewCameraMode: "orthographic" | "perspective";
  isPlaying: boolean;
  onDistanceChange: (distance: number) => void;
  onTogglePlaying: () => void;
  onCameraModeChange: (mode: "orthographic" | "perspective") => void;
  onShowStockChange: (value: boolean) => void;
}

export function PreviewWorkspace(props: PreviewWorkspaceProps) {
  return (
    <PanelGroup direction="horizontal" className="h-full gap-0">
      <Panel defaultSize={20} minSize={16} maxSize={28}>
        <div className="h-full overflow-hidden bg-content1">
          <PreviewSidebar
            projectName={props.projectName}
            projectSubtitle={props.projectSubtitle}
            generated={props.generated}
            program={props.parsedProgram}
            operations={props.previewOperations}
            error={props.error}
            activeLineNumber={props.activePreviewLineNumber}
            activeOperationId={props.previewActiveOperationId}
            onLineSelect={props.onLineSelect}
            onStepLine={props.onStepLine}
            onOperationSelect={props.onOperationSelect}
          />
        </div>
      </Panel>
      <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/30" />
      <Panel defaultSize={55} minSize={38}>
        <div className="relative flex h-full flex-col overflow-hidden bg-content1">
          <TopBar
            activeTab={props.activeTab}
            canPreview={props.canPreview}
            isBusy={props.isBusy}
            processLabel={props.processLabel}
            processDisabled={props.processDisabled}
            exportDisabled={props.exportDisabled}
            onTabChange={props.onTabChange}
            onProcess={props.onProcess}
            onExport={props.onExport}
            onPreviewBlocked={props.onPreviewBlocked}
          />
          <div className="min-h-0 flex-1">
            <NcViewer
              gcodeResult={props.generated}
              activeOperationId={props.previewActiveOperationId}
              currentDistance={props.previewCurrentDistance}
              showStock={props.previewShowStock}
              liveCutSimulation={props.previewLiveCutSimulation}
              cameraMode={props.previewCameraMode}
            />
          </div>
          <PreviewTimeline
            program={props.parsedProgram}
            currentDistance={props.previewCurrentDistance}
            isPlaying={props.isPlaying}
            activeOperationId={props.previewActiveOperationId}
            onDistanceChange={props.onDistanceChange}
            onTogglePlaying={props.onTogglePlaying}
          />
        </div>
      </Panel>
      <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/30" />
      <Panel defaultSize={25} minSize={18} maxSize={32}>
        <div className="h-full overflow-hidden bg-content1">
          <PreviewInspector
            generated={props.generated}
            operations={props.previewOperations}
            activeOperationId={props.previewActiveOperationId}
            cameraMode={props.previewCameraMode}
            showStock={props.previewShowStock}
            onOperationSelect={props.onOperationSelect}
            onCameraModeChange={props.onCameraModeChange}
            onShowStockChange={props.onShowStockChange}
          />
        </div>
      </Panel>
    </PanelGroup>
  );
}
