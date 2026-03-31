import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { LayerTree } from "@/components/layer-tree";
import { NcViewer } from "@/components/nc-viewer";
import { OperationList } from "@/components/operation-list";
import { PreviewSidebar } from "@/components/preview-sidebar";
import { SettingsPanel } from "@/components/settings-panel";
import { SvgCanvas } from "@/components/svg-canvas";
import { TopBar } from "@/components/top-bar";
import { ViewportToolbar } from "@/components/viewport-toolbar";
import { colorForOperation } from "@/lib/colors";
import type {
  FillMode,
  FrontendOperation,
  GenerateJobResponse,
  PreparedSvgDocument,
  Settings,
  TabId,
} from "@/lib/types";
import { generateEngravingJob, loadDefaultSettings, prepareSvgDocument } from "@/lib/wasm";
import { parseGcodeProgram } from "@/components/viewer/parse-gcode";

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [preparedSvg, setPreparedSvg] = useState<PreparedSvgDocument | null>(null);
  const [operations, setOperations] = useState<FrontendOperation[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GenerateJobResponse | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("prepare");
  const [visibleSegments, setVisibleSegments] = useState(1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadDefaultSettings()
      .then((defaults) => {
        setSettings(defaults);
        setIsReady(true);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const activeOperation = useMemo(
    () => operations.find((operation) => operation.id === activeOperationId) ?? null,
    [activeOperationId, operations],
  );

  const handleSvgImport = async (file: File) => {
    if (!file.type.includes("svg") && !file.name.toLowerCase().endsWith(".svg")) {
      setError("Please provide an SVG file.");
      return;
    }

    const text = await file.text();
    const prepared = await prepareSvgDocument(text);
    setPreparedSvg(prepared);
    setSelectedIds([]);
    setGenerated(null);
    setError(null);
    setActiveTab("prepare");

    const defaultDepth = settings?.engraving.target_depth ?? 1;
    const initialOperation: FrontendOperation = {
      id: crypto.randomUUID(),
      name: "Engrave 1",
      target_depth_mm: defaultDepth,
      assigned_element_ids: prepared.selectable_element_ids,
      color: colorForOperation(0),
    };
    setOperations([initialOperation]);
    setActiveOperationId(initialOperation.id);
  };

  const handleMakePath = async () => {
    if (!preparedSvg || !settings || operations.length === 0) {
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const result = await generateEngravingJob({
        normalized_svg: preparedSvg.normalized_svg,
        settings,
        operations,
      });
      setGenerated(result);
      setVisibleSegments(Number.MAX_SAFE_INTEGER);
      setActiveTab("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0);
    if (!file) {
      return;
    }
    await handleSvgImport(file);
  };

  const updateSettingsNumber = (path: string, value: number | null) => {
    setSettings((current) => {
      if (!current) {
        return current;
      }
      const next = structuredClone(current);
      const segments = path.split(".");
      let target: unknown = next;
      for (const segment of segments.slice(0, -1)) {
        target = (target as Record<string, unknown>)[segment];
      }
      (target as Record<string, number | null>)[segments.at(-1)!] = value;
      return next;
    });
  };

  const handleToolShapeChange = (value: "Flat" | "Ball" | "V") => {
    setSettings((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        engraving: {
          ...current.engraving,
          tool_shape: value,
        },
      };
    });
  };

  const handleFillModeChange = (value: FillMode) => {
    setSettings((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        engraving: {
          ...current.engraving,
          fill_mode: value,
        },
      };
    });
  };

  const selectIds = (ids: string[], additive: boolean) => {
    setSelectedIds((current) => {
      if (!additive) {
        return ids;
      }
      const next = new Set(current);
      for (const id of ids) {
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return Array.from(next);
    });
  };

  const assignSelectionToOperation = (operationId: string) => {
    if (selectedIds.length === 0) {
      return;
    }

    setOperations((current) =>
      current.map((operation) => {
        const remaining = operation.assigned_element_ids.filter(
          (elementId) => !selectedIds.includes(elementId),
        );
        return operation.id === operationId
          ? {
              ...operation,
              assigned_element_ids: Array.from(new Set([...remaining, ...selectedIds])),
            }
          : { ...operation, assigned_element_ids: remaining };
      }),
    );
    setActiveOperationId(operationId);
  };

  const addOperation = () => {
    const nextIndex = operations.length;
    const operation: FrontendOperation = {
      id: crypto.randomUUID(),
      name: `Engrave ${nextIndex + 1}`,
      target_depth_mm: settings?.engraving.target_depth ?? 1,
      assigned_element_ids: [],
      color: colorForOperation(nextIndex),
    };
    setOperations((current) => [...current, operation]);
    setActiveOperationId(operation.id);
  };

  const deleteOperation = (operationId: string) => {
    if (operations.length === 1) {
      return;
    }
    const operation = operations.find((candidate) => candidate.id === operationId);
    const fallbackOperationId = operations.find((candidate) => candidate.id !== operationId)?.id;
    if (!fallbackOperationId) {
      return;
    }

    setOperations((current) => {
      const removedIds = operation?.assigned_element_ids ?? [];
      return current
        .filter((candidate) => candidate.id !== operationId)
        .map((candidate) =>
          candidate.id === fallbackOperationId
            ? {
                ...candidate,
                assigned_element_ids: Array.from(
                  new Set([...candidate.assigned_element_ids, ...removedIds]),
                ),
              }
            : candidate,
        );
    });
    setActiveOperationId(fallbackOperationId);
  };

  const moveOperation = (operationId: string, direction: "up" | "down") => {
    setOperations((current) => {
      const index = current.findIndex((operation) => operation.id === operationId);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  };

  const renameOperation = (operationId: string, value: string) => {
    setOperations((current) =>
      current.map((operation) =>
        operation.id === operationId ? { ...operation, name: value } : operation,
      ),
    );
  };

  const changeOperationDepth = (operationId: string, value: number) => {
    setOperations((current) =>
      current.map((operation) =>
        operation.id === operationId
          ? { ...operation, target_depth_mm: Number.isFinite(value) ? value : operation.target_depth_mm }
          : operation,
      ),
    );
  };

  const downloadNc = () => {
    if (!generated) {
      return;
    }

    const blob = new Blob([generated.gcode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "engraving-job.nc";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const parsedProgram = useMemo(() => {
    if (!generated) {
      return null;
    }
    return parseGcodeProgram(generated.gcode, generated.operation_ranges);
  }, [generated]);

  const maxSegments = parsedProgram?.segments.length ?? 1;
  const maxDepth = parsedProgram?.bounds?.minZ ?? 0;
  const previewSnapshot = generated?.preview_snapshot;
  const previewMaterialWidth = previewSnapshot?.material_width ?? settings?.engraving.material_width ?? 100;
  const previewMaterialHeight = previewSnapshot?.material_height ?? settings?.engraving.material_height ?? 100;
  const previewMaterialThickness =
    previewSnapshot?.material_thickness ?? settings?.engraving.material_thickness ?? 18;
  const previewToolDiameter = previewSnapshot?.tool_diameter ?? settings?.engraving.tool_diameter ?? 6;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isReady={isReady}
        isGenerating={isGenerating}
        hasGenerated={!!generated}
        hasSvg={!!preparedSvg && operations.length > 0}
        onImportClick={() => fileInputRef.current?.click()}
        onMakePath={() => void handleMakePath()}
        onDownload={downloadNc}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleSvgImport(file);
          }
        }}
      />

      {error && activeTab === "prepare" && (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <PanelGroup direction="horizontal" className="h-full">
          <Panel defaultSize={22} minSize={16} maxSize={35}>
            <div className="h-full overflow-y-auto border-r border-border bg-card">
              {activeTab === "prepare" ? (
                <>
                  <SettingsPanel
                    settings={settings}
                    onNumberChange={updateSettingsNumber}
                    onToolShapeChange={handleToolShapeChange}
                    onFillModeChange={handleFillModeChange}
                  />
                  <div className="border-t border-border" />
                  <OperationList
                    operations={operations}
                    activeOperationId={activeOperationId}
                    selectedCount={selectedIds.length}
                    onActivate={setActiveOperationId}
                    onAddOperation={addOperation}
                    onDeleteOperation={deleteOperation}
                    onMoveOperation={moveOperation}
                    onRenameOperation={renameOperation}
                    onDepthChange={changeOperationDepth}
                    onAssignSelected={assignSelectionToOperation}
                  />
                  <div className="border-t border-border" />
                  <LayerTree
                    tree={preparedSvg?.tree ?? null}
                    selectedIds={selectedIds}
                    onSelectIds={selectIds}
                  />
                </>
              ) : (
                <PreviewSidebar
                  generated={generated}
                  operations={operations}
                  error={error}
                />
              )}
            </div>
          </Panel>
          <PanelResizeHandle className="w-px bg-border hover:bg-primary/40 transition-colors" />
          <Panel defaultSize={78}>
            <div
              className="flex h-full flex-col"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void handleFileDrop(event)}
            >
              <ViewportToolbar
                activeTab={activeTab}
                selectedCount={selectedIds.length}
                activeOperation={activeOperation}
                materialWidth={activeTab === "preview" ? previewMaterialWidth : settings?.engraving.material_width ?? 100}
                materialHeight={activeTab === "preview" ? previewMaterialHeight : settings?.engraving.material_height ?? 100}
                materialThickness={activeTab === "preview" ? previewMaterialThickness : settings?.engraving.material_thickness ?? 18}
                toolDiameter={activeTab === "preview" ? previewToolDiameter : settings?.engraving.tool_diameter ?? 6}
                maxDepth={maxDepth}
                visibleSegments={visibleSegments}
                maxSegments={maxSegments}
                hasGenerated={!!generated}
                onVisibleSegmentsChange={setVisibleSegments}
              />
              <div className="min-h-0 flex-1">
                {activeTab === "prepare" ? (
                  <SvgCanvas
                    preparedSvg={preparedSvg}
                    operations={operations}
                    selectedIds={selectedIds}
                    activeOperationId={activeOperationId}
                    onSelectIds={selectIds}
                  />
                ) : (
                  <NcViewer
                    gcodeResult={generated}
                    activeOperationId={activeOperationId}
                    visibleSegments={visibleSegments}
                  />
                )}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

export default App;
