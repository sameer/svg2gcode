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
import { parseGcodeProgram } from "@/components/viewer/parse-gcode";
import { colorForOperation } from "@/lib/colors";
import { buildElementColorMap, detectElementColors } from "@/lib/color-detection";
import {
  clampPlacementToArtboard,
  getAlignedPlacement,
  getCanvasGeometry,
  getMaxSvgWidthFromPlacement,
  getPaddingValidationMessage,
  getSvgHeightMm,
  getSvgWidthMm,
  parseSvgDocumentMetrics,
  type SvgDocumentMetrics,
} from "@/lib/editor-geometry";
import type {
  AlignmentAction,
  FillMode,
  FrontendOperation,
  GenerateJobResponse,
  PreparedSvgDocument,
  Settings,
  TabId,
} from "@/lib/types";
import { clamp } from "@/lib/utils";
import { generateEngravingJob, loadDefaultSettings, prepareSvgDocument } from "@/lib/wasm";

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [advancedOverrides, setAdvancedOverrides] = useState<Record<string, boolean>>({});
  const [preparedSvg, setPreparedSvg] = useState<PreparedSvgDocument | null>(null);
  const [operations, setOperations] = useState<FrontendOperation[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GenerateJobResponse | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("prepare");
  const [elementColors, setElementColors] = useState<Map<string, string>>(new Map());
  const [paddingMm, setPaddingMm] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadDefaultSettings()
      .then((defaults) => {
        setSettings(applyRecommendedSettings(defaults, {}));
        setAdvancedOverrides({});
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
  const svgMetrics = useMemo(
    () => (preparedSvg ? parseSvgDocumentMetrics(preparedSvg.normalized_svg) : null),
    [preparedSvg],
  );
  const editorGeometry = useMemo(() => {
    if (!settings || !svgMetrics) {
      return null;
    }

    return getCanvasGeometry({
      artboardWidthMm: settings.engraving.material_width,
      artboardHeightMm: settings.engraving.material_height,
      placementX: settings.engraving.placement_x,
      placementY: settings.engraving.placement_y,
      svgWidthOverride: settings.engraving.svg_width_override,
      paddingMm,
      svgMetrics,
    });
  }, [paddingMm, settings, svgMetrics]);
  const paddingValidationMessage = useMemo(
    () => (editorGeometry ? getPaddingValidationMessage(editorGeometry, paddingMm) : null),
    [editorGeometry, paddingMm],
  );

  const handleSvgImport = async (file: File) => {
    if (!file.type.includes("svg") && !file.name.toLowerCase().endsWith(".svg")) {
      setError("Please provide an SVG file.");
      return;
    }

    const text = await file.text();
    const prepared = await prepareSvgDocument(text);
    const importedMetrics = parseSvgDocumentMetrics(prepared.normalized_svg);
    setPreparedSvg(prepared);
    setSelectedIds([]);
    setGenerated(null);
    setError(null);
    setActiveTab("prepare");
    setPaddingMm(10);
    setSettings((current) => {
      if (!current || !importedMetrics) {
        return current;
      }

      return {
        ...current,
        engraving: {
          ...current.engraving,
          material_width: Math.max(current.engraving.material_width, importedMetrics.width + 20),
          material_height: Math.max(current.engraving.material_height, importedMetrics.height + 20),
          svg_width_override: null,
          placement_x: 10,
          placement_y: 10,
        },
      };
    });

    const defaultDepth = settings?.engraving.target_depth ?? 1;
    const colorGroups = detectElementColors(prepared.normalized_svg);
    setElementColors(buildElementColorMap(prepared.normalized_svg));

    let newOperations: FrontendOperation[];
    if (colorGroups.length > 1) {
      newOperations = colorGroups.map((group, index) => ({
        id: crypto.randomUUID(),
        name: `Engrave ${index + 1}`,
        target_depth_mm: defaultDepth,
        assigned_element_ids: group.elementIds,
        color: group.normalizedColor,
        fill_mode: null,
      }));
    } else {
      newOperations = [
        {
          id: crypto.randomUUID(),
          name: "Engrave 1",
          target_depth_mm: defaultDepth,
          assigned_element_ids: prepared.selectable_element_ids,
          color: colorForOperation(0),
          fill_mode: null,
        },
      ];
    }
    setOperations(newOperations);
    setActiveOperationId(newOperations[0].id);
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

  const handleSettingsNumberChange = (
    path: string,
    value: number | null,
    source: "basic" | "advanced",
  ) => {
    const nextOverrides =
      source === "advanced" && RECOMMENDED_ADVANCED_PATHS.has(path)
        ? { ...advancedOverrides, [path]: true }
        : advancedOverrides;
    if (nextOverrides !== advancedOverrides) {
      setAdvancedOverrides(nextOverrides);
    }

    setSettings((current) => {
      if (!current) {
        return current;
      }
      const next = setNumberAtPath(current, path, value);
      return applyRecommendedSettings(next, nextOverrides);
    });
  };

  const handleMaterialDimensionChange = (dimension: "width" | "height", value: number | null) => {
    setSettings((current) => {
      if (!current) {
        return current;
      }

      const field = dimension === "width" ? "material_width" : "material_height";
      const requested = Math.max(1, value ?? current.engraving[field]);
      let nextEngraving = {
        ...current.engraving,
        [field]: requested,
      };

      if (svgMetrics) {
        const svgWidthMm = getSvgWidthMm(svgMetrics, nextEngraving.svg_width_override);
        const svgHeightMm = getSvgHeightMm(svgMetrics, nextEngraving.svg_width_override);
        const minimum =
          dimension === "width" ? svgWidthMm + paddingMm * 2 : svgHeightMm + paddingMm * 2;
        nextEngraving = {
          ...nextEngraving,
          [field]: Math.max(requested, minimum),
        };
        nextEngraving = applyPlacementClamp(nextEngraving, svgMetrics);
      }

      return {
        ...current,
        engraving: nextEngraving,
      };
    });
  };

  const handlePlacementChange = (x: number, y: number) => {
    setSettings((current) => {
      if (!current) {
        return current;
      }

      const nextEngraving = svgMetrics
        ? applyPlacementClamp(
            {
              ...current.engraving,
              placement_x: x,
              placement_y: y,
            },
            svgMetrics,
          )
        : {
            ...current.engraving,
            placement_x: x,
            placement_y: y,
          };

      return {
        ...current,
        engraving: nextEngraving,
      };
    });
  };

  const handleSvgWidthOverrideChange = (value: number | null) => {
    setSettings((current) => {
      if (!current) {
        return current;
      }

      if (!svgMetrics) {
        return {
          ...current,
          engraving: {
            ...current.engraving,
            svg_width_override: value,
          },
        };
      }

      return {
        ...current,
        engraving: setSvgWidthOverrideWithinArtboard(current.engraving, value, svgMetrics),
      };
    });
  };

  const handlePaddingChange = (value: number | null) => {
    setPaddingMm(Math.max(0, value ?? 0));
  };

  const handleAlign = (action: AlignmentAction) => {
    if (!settings || !editorGeometry) {
      return;
    }

    const nextPlacement = getAlignedPlacement(
      action,
      editorGeometry,
      settings.engraving.material_width,
      settings.engraving.material_height,
      settings.engraving.placement_x,
      settings.engraving.placement_y,
      paddingMm,
    );

    if (!nextPlacement) {
      return;
    }

    handlePlacementChange(nextPlacement.x, nextPlacement.y);
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
      return applyRecommendedSettings(
        {
          ...current,
          engraving: {
            ...current.engraving,
            fill_mode: value,
          },
        },
        advancedOverrides,
      );
    });
  };

  const resetAdvancedRecommendations = () => {
    setAdvancedOverrides({});
    setSettings((current) => (current ? applyRecommendedSettings(current, {}) : current));
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

  const changeOperationFillMode = (operationId: string, value: FillMode | null) => {
    setOperations((current) =>
      current.map((operation) =>
        operation.id === operationId
          ? { ...operation, fill_mode: value }
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

  const maxDepth = parsedProgram?.bounds?.minZ ?? 0;
  const previewSnapshot = generated?.preview_snapshot;
  const previewMaterialWidth = previewSnapshot?.material_width ?? settings?.engraving.material_width ?? 100;
  const previewMaterialHeight = previewSnapshot?.material_height ?? settings?.engraving.material_height ?? 100;
  const previewMaterialThickness =
    previewSnapshot?.material_thickness ?? settings?.engraving.material_thickness ?? 18;
  const previewToolDiameter = previewSnapshot?.tool_diameter ?? settings?.engraving.tool_diameter ?? 6;
  const recommendedAdvanced = settings ? computeRecommendedAdvancedValues(settings) : {};

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
          <Panel defaultSize={20} minSize={14} maxSize={30}>
            <div className="h-full overflow-y-auto border-r border-border bg-card">
              {activeTab === "prepare" ? (
                <>
                  <SettingsPanel
                    settings={settings}
                    recommendedAdvanced={recommendedAdvanced}
                    advancedOverrides={advancedOverrides}
                    hasSvg={!!preparedSvg && !!svgMetrics}
                    paddingMm={paddingMm}
                    paddingValidationMessage={paddingValidationMessage}
                    onNumberChange={handleSettingsNumberChange}
                    onMaterialDimensionChange={handleMaterialDimensionChange}
                    onPlacementChange={handlePlacementChange}
                    onSvgWidthOverrideChange={handleSvgWidthOverrideChange}
                    onPaddingChange={handlePaddingChange}
                    onAlign={handleAlign}
                    onToolShapeChange={handleToolShapeChange}
                    onFillModeChange={handleFillModeChange}
                    onResetAdvancedRecommendations={resetAdvancedRecommendations}
                  />
                  <div className="border-t border-border" />
                  <OperationList
                    operations={operations}
                    activeOperationId={activeOperationId}
                    selectedCount={selectedIds.length}
                    onActivate={setActiveOperationId}
                    onAddOperation={addOperation}
                    onDeleteOperation={deleteOperation}
                    onRenameOperation={renameOperation}
                    onDepthChange={changeOperationDepth}
                    onOperationFillModeChange={changeOperationFillMode}
                    onAssignSelected={assignSelectionToOperation}
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
          <Panel defaultSize={60}>
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
              />
              <div className="min-h-0 flex-1">
                {activeTab === "prepare" ? (
                  <SvgCanvas
                    preparedSvg={preparedSvg}
                    operations={operations}
                    selectedIds={selectedIds}
                    activeOperationId={activeOperationId}
                    materialWidth={settings?.engraving.material_width ?? 300}
                    materialHeight={settings?.engraving.material_height ?? 300}
                    placementX={settings?.engraving.placement_x ?? 0}
                    placementY={settings?.engraving.placement_y ?? 0}
                    paddingMm={paddingMm}
                    paddingValidationMessage={paddingValidationMessage}
                    svgWidthOverride={settings?.engraving.svg_width_override ?? null}
                    onSelectIds={selectIds}
                    onDepthChange={changeOperationDepth}
                    onFillModeChange={changeOperationFillMode}
                    onAssignToOperation={assignSelectionToOperation}
                    onMaterialSizeChange={handleMaterialDimensionChange}
                    onPlacementChange={handlePlacementChange}
                    onPaddingChange={handlePaddingChange}
                    onAlign={handleAlign}
                    onSvgWidthOverrideChange={handleSvgWidthOverrideChange}
                  />
                ) : (
                  <NcViewer
                    gcodeResult={generated}
                    activeOperationId={activeOperationId}
                  />
                )}
              </div>
            </div>
          </Panel>
          {activeTab === "prepare" && (
            <>
              <PanelResizeHandle className="w-px bg-border hover:bg-primary/40 transition-colors" />
              <Panel defaultSize={20} minSize={14} maxSize={30}>
                <div className="h-full overflow-y-auto border-l border-border bg-card">
                  <LayerTree
                    tree={preparedSvg?.tree ?? null}
                    selectedIds={selectedIds}
                    operations={operations}
                    elementColors={elementColors}
                    onSelectIds={selectIds}
                  />
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
    </div>
  );
}

export default App;

const RECOMMENDED_ADVANCED_PATHS = new Set([
  "engraving.max_stepdown",
  "engraving.stepover",
  "engraving.cut_feedrate",
  "engraving.plunge_feedrate",
]);

function setNumberAtPath(settings: Settings, path: string, value: number | null) {
  const next = structuredClone(settings);
  const segments = path.split(".");
  let target: unknown = next;
  for (const segment of segments.slice(0, -1)) {
    target = (target as Record<string, unknown>)[segment];
  }
  (target as Record<string, number | null>)[segments.at(-1)!] = value;
  return next;
}

function computeRecommendedAdvancedValues(settings: Settings) {
  const toolDiameter = Math.max(settings.engraving.tool_diameter, 0.5);
  const stepover = Number(
    (settings.engraving.fill_mode === "Pocket"
      ? clamp(toolDiameter * 0.48, 0.2, toolDiameter * 0.8)
      : clamp(toolDiameter * 0.5, 0.2, toolDiameter)).toFixed(2),
  );
  const maxStepdown = Number(clamp(toolDiameter * 0.4, 0.3, 2.5).toFixed(2));
  const cutFeedrate = Number(clamp(180 + toolDiameter * 90, 180, 540).toFixed(0));
  const plungeFeedrate = Number(clamp(cutFeedrate * 0.4, 90, 220).toFixed(0));

  return {
    "engraving.max_stepdown": maxStepdown,
    "engraving.stepover": stepover,
    "engraving.cut_feedrate": cutFeedrate,
    "engraving.plunge_feedrate": plungeFeedrate,
  };
}

function applyPlacementClamp(
  engraving: Settings["engraving"],
  svgMetrics: SvgDocumentMetrics,
) {
  const clampedPlacement = clampPlacementToArtboard({
    artboardWidthMm: engraving.material_width,
    artboardHeightMm: engraving.material_height,
    placementX: engraving.placement_x,
    placementY: engraving.placement_y,
    svgWidthMm: getSvgWidthMm(svgMetrics, engraving.svg_width_override),
    svgHeightMm: getSvgHeightMm(svgMetrics, engraving.svg_width_override),
  });

  return {
    ...engraving,
    placement_x: clampedPlacement.x,
    placement_y: clampedPlacement.y,
  };
}

function setSvgWidthOverrideWithinArtboard(
  engraving: Settings["engraving"],
  value: number | null,
  svgMetrics: SvgDocumentMetrics,
) {
  const naturalWidthMm = svgMetrics.width;
  const requestedWidthMm = value && value > 0 ? value : naturalWidthMm;
  const maxWidthMm = getMaxSvgWidthFromPlacement(
    engraving.material_width,
    engraving.material_height,
    engraving.placement_x,
    engraving.placement_y,
    svgMetrics,
  );
  const clampedWidthMm = clamp(requestedWidthMm, 1, maxWidthMm);
  const svgWidthOverride =
    Math.abs(clampedWidthMm - naturalWidthMm) < 0.01 ? null : Number(clampedWidthMm.toFixed(2));

  return applyPlacementClamp(
    {
      ...engraving,
      svg_width_override: svgWidthOverride,
    },
    svgMetrics,
  );
}

function applyRecommendedSettings(
  settings: Settings,
  overrides: Record<string, boolean>,
) {
  const next = structuredClone(settings);
  const recommended = computeRecommendedAdvancedValues(next);

  for (const [path, value] of Object.entries(recommended)) {
    if (overrides[path]) {
      continue;
    }
    const segments = path.split(".");
    let target: unknown = next;
    for (const segment of segments.slice(0, -1)) {
      target = (target as Record<string, unknown>)[segment];
    }
    (target as Record<string, number | null>)[segments.at(-1)!] = value;
  }

  return next;
}
