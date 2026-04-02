import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { LayerTree } from "@/components/layer-tree";
import { MaterialInspector } from "@/components/material-inspector";
import { NcViewer } from "@/components/nc-viewer";
import { PreviewInspector } from "@/components/preview-inspector";
import { PreviewSidebar } from "@/components/preview-sidebar";
import { PreviewTimeline } from "@/components/preview-timeline";
import { StudioInspector } from "@/components/studio-inspector";
import { SvgCanvas } from "@/components/svg-canvas";
import { TopBar } from "@/components/top-bar";
import { parseGcodeProgram, sampleProgramAtDistance } from "@/components/viewer/parse-gcode";
import { colorForOperation } from "@/lib/colors";
import { buildElementColorMap } from "@/lib/color-detection";
import {
  clampPlacementToArtboard,
  getAlignedPlacement,
  getCanvasGeometry,
  getPaddingValidationMessage,
  parseSvgDocumentMetrics,
  type SvgDocumentMetrics,
} from "@/lib/editor-geometry";
import type {
  DesignSelectionSnapshot,
  DiveRootScope,
  ElementAssignment,
  FillMode,
  FrontendOperation,
  GenerateJobResponse,
  InspectorContext,
  InspectorTab,
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
  const [elementAssignments, setElementAssignments] = useState<Record<string, ElementAssignment>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generated, setGenerated] = useState<GenerateJobResponse | null>(null);
  const [generatedOperationsSnapshot, setGeneratedOperationsSnapshot] = useState<FrontendOperation[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("prepare");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("design");
  const [canvasSelectionTarget, setCanvasSelectionTarget] = useState<"material" | "svg" | null>(null);
  const [isDiveMode, setIsDiveMode] = useState(false);
  const [activeDiveRoot, setActiveDiveRoot] = useState<DiveRootScope | null>(null);
  const [lastDesignSelection, setLastDesignSelection] = useState<DesignSelectionSnapshot | null>(null);
  const [modifierDirectPick, setModifierDirectPick] = useState(false);
  const [elementColors, setElementColors] = useState<Map<string, string>>(new Map());
  const [paddingMm, setPaddingMm] = useState(0);
  const [svgSizeMm, setSvgSizeMm] = useState({ width: 100, height: 100, aspectLocked: true });
  const [projectName, setProjectName] = useState("3D Dog Character");
  const [previewActiveOperationId, setPreviewActiveOperationId] = useState<string | null>(null);
  const [previewCameraMode, setPreviewCameraMode] = useState<"orthographic" | "perspective">("orthographic");
  const [previewShowStock, setPreviewShowStock] = useState(true);
  const [previewLiveCutSimulation] = useState(true);
  const [previewPlaybackRate] = useState(1);
  const [previewCurrentDistance, setPreviewCurrentDistance] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        setModifierDirectPick(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) {
        setModifierDirectPick(false);
      }
    };
    const handleBlur = () => setModifierDirectPick(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const svgMetrics = useMemo(
    () => (preparedSvg ? parseSvgDocumentMetrics(preparedSvg.normalized_svg) : null),
    [preparedSvg],
  );
  const svgWidthMm = svgMetrics ? svgSizeMm.width : 0;
  const svgHeightMm = svgMetrics ? svgSizeMm.height : 0;

  const editorGeometry = useMemo(() => {
    if (!settings || !svgMetrics) {
      return null;
    }

    return getCanvasGeometry({
      artboardWidthMm: settings.engraving.material_width,
      artboardHeightMm: settings.engraving.material_height,
      placementX: settings.engraving.placement_x,
      placementY: settings.engraving.placement_y,
      paddingMm,
      svgWidthMm,
      svgHeightMm,
    });
  }, [paddingMm, settings, svgHeightMm, svgMetrics, svgWidthMm]);
  const paddingValidationMessage = useMemo(
    () => (editorGeometry ? getPaddingValidationMessage(editorGeometry, paddingMm) : null),
    [editorGeometry, paddingMm],
  );

  const allElementIds = useMemo(
    () => preparedSvg?.selectable_element_ids ?? [],
    [preparedSvg],
  );
  const svgDiveRoot = useMemo<DiveRootScope | null>(
    () =>
      preparedSvg
        ? {
            id: "svg-root",
            label: "SVG",
            elementIds: preparedSvg.selectable_element_ids,
          }
        : null,
    [preparedSvg],
  );
  const derivedOperations = useMemo(
    () => deriveOperationsFromAssignments(elementAssignments, allElementIds),
    [allElementIds, elementAssignments],
  );
  const inspectorContext = useMemo<InspectorContext>(() => {
    if (canvasSelectionTarget === "svg") {
      return {
        type: "svg",
        elementIds: allElementIds,
        profileGroups: groupAssignmentsForIds(elementAssignments, allElementIds),
      };
    }

    if (selectedIds.length === 0) {
      return { type: "none" };
    }

    const selectedAssignments = selectedIds
      .map((id) => elementAssignments[id])
      .filter((assignment): assignment is ElementAssignment => Boolean(assignment));
    const uniqueDepths = new Set(selectedAssignments.map((assignment) => assignment.targetDepthMm));
    const uniqueFills = new Set(selectedAssignments.map((assignment) => assignment.fillMode ?? "__default__"));

    return {
      type: "selection",
      elementIds: selectedIds,
      profileGroups: groupAssignmentsForIds(elementAssignments, selectedIds),
      mixedDepth: uniqueDepths.size > 1,
      mixedFillMode: uniqueFills.size > 1,
      targetDepthMm: uniqueDepths.size === 1 ? selectedAssignments[0]?.targetDepthMm ?? null : null,
      fillMode: uniqueFills.size === 1 ? selectedAssignments[0]?.fillMode ?? null : null,
    };
  }, [allElementIds, canvasSelectionTarget, elementAssignments, selectedIds]);

  const handleSvgImport = async (file: File) => {
    if (!file.type.includes("svg") && !file.name.toLowerCase().endsWith(".svg")) {
      setError("Please provide an SVG file.");
      return;
    }

    const text = await file.text();
    const prepared = await prepareSvgDocument(text);
    const importedMetrics = parseSvgDocumentMetrics(prepared.normalized_svg);
    setPreparedSvg(prepared);
    setProjectName(file.name.replace(/\.svg$/i, ""));
    setGenerated(null);
    setGeneratedOperationsSnapshot([]);
    setPreviewActiveOperationId(null);
    setPreviewCurrentDistance(0);
    setPreviewPlaying(false);
    setSelectedIds([]);
    setCanvasSelectionTarget(null);
    setIsDiveMode(false);
    setActiveDiveRoot(null);
    setLastDesignSelection(null);
    setInspectorTab("design");
    setActiveTab("prepare");
    setPaddingMm(10);
    setError(null);

    if (importedMetrics) {
      setSvgSizeMm({
        width: roundMm(importedMetrics.width),
        height: roundMm(importedMetrics.height),
        aspectLocked: true,
      });
    }

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
    const nextAssignments = Object.fromEntries(
      prepared.selectable_element_ids.map((elementId) => [
        elementId,
        {
          elementId,
          targetDepthMm: defaultDepth,
          fillMode: null,
        } satisfies ElementAssignment,
      ]),
    );
    setElementAssignments(nextAssignments);
    setElementColors(buildElementColorMap(prepared.normalized_svg));
  };

  const handleMakePath = async () => {
    if (!preparedSvg || !settings || derivedOperations.length === 0 || !svgMetrics) {
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const requestSettings = structuredClone(settings);
      requestSettings.engraving.svg_width_override = null;

      const result = await generateEngravingJob({
        normalized_svg: resizeSvgDocument(preparedSvg.normalized_svg, svgMetrics, svgWidthMm, svgHeightMm),
        settings: requestSettings,
        operations: derivedOperations,
      });
      setGenerated(result);
      setGeneratedOperationsSnapshot(derivedOperations);
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
        const minimum = dimension === "width" ? svgWidthMm + paddingMm * 2 : svgHeightMm + paddingMm * 2;
        nextEngraving = {
          ...nextEngraving,
          [field]: Math.max(requested, minimum),
        };
        nextEngraving = applyPlacementClamp(nextEngraving, svgWidthMm, svgHeightMm);
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

      return {
        ...current,
        engraving: applyPlacementClamp(
          {
            ...current.engraving,
            placement_x: x,
            placement_y: y,
          },
          svgWidthMm,
          svgHeightMm,
        ),
      };
    });
  };

  const handleSvgSizeChange = (width: number | null, height: number | null) => {
    if (!settings || !svgMetrics) {
      return;
    }

    const availableWidth = Math.max(1, settings.engraving.material_width - settings.engraving.placement_x);
    const availableHeight = Math.max(1, settings.engraving.material_height - settings.engraving.placement_y);
    const nextWidth = clamp(width ?? svgWidthMm, 1, availableWidth);
    const nextHeight = clamp(height ?? svgHeightMm, 1, availableHeight);

    setSvgSizeMm((current) => ({
      ...current,
      width: roundMm(nextWidth),
      height: roundMm(nextHeight),
    }));
  };

  const handleSvgDimensionChange = (dimension: "width" | "height", value: number | null) => {
    if (!settings || !svgMetrics) {
      return;
    }

    const aspectRatio = svgMetrics.aspectRatio;
    const availableWidth = Math.max(1, settings.engraving.material_width - settings.engraving.placement_x);
    const availableHeight = Math.max(1, settings.engraving.material_height - settings.engraving.placement_y);
    const requested = Math.max(1, value ?? (dimension === "width" ? svgWidthMm : svgHeightMm));

    if (svgSizeMm.aspectLocked) {
      const requestedWidth = dimension === "width" ? requested : requested * aspectRatio;
      const maxWidth = Math.min(availableWidth, availableHeight * aspectRatio);
      const nextWidth = clamp(requestedWidth, 1, Math.max(1, maxWidth));
      const nextHeight = nextWidth / aspectRatio;
      setSvgSizeMm((current) => ({
        ...current,
        width: roundMm(nextWidth),
        height: roundMm(nextHeight),
      }));
      return;
    }

    if (dimension === "width") {
      handleSvgSizeChange(requested, svgHeightMm);
    } else {
      handleSvgSizeChange(svgWidthMm, requested);
    }
  };

  const handleSvgAspectLockChange = (value: boolean) => {
    if (!svgMetrics || !settings) {
      return;
    }

    if (!value) {
      setSvgSizeMm((current) => ({ ...current, aspectLocked: false }));
      return;
    }

    const aspectRatio = svgMetrics.aspectRatio;
    const availableWidth = Math.max(1, settings.engraving.material_width - settings.engraving.placement_x);
    const availableHeight = Math.max(1, settings.engraving.material_height - settings.engraving.placement_y);
    const maxWidth = Math.min(availableWidth, availableHeight * aspectRatio);
    const nextWidth = clamp(svgWidthMm, 1, Math.max(1, maxWidth));
    const nextHeight = nextWidth / aspectRatio;
    setSvgSizeMm({
      width: roundMm(nextWidth),
      height: roundMm(nextHeight),
      aspectLocked: true,
    });
  };

  const handlePaddingChange = (value: number | null) => {
    setPaddingMm(Math.max(0, value ?? 0));
  };

  const handleAlign = (action: Parameters<typeof getAlignedPlacement>[0]) => {
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
    setInspectorTab("design");
    setCanvasSelectionTarget(null);
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

  const rememberCurrentDesignSelection = () => {
    if (canvasSelectionTarget === "material") {
      return;
    }

    setLastDesignSelection({
      selectionTarget: canvasSelectionTarget === "svg" ? "svg" : null,
      selectedIds,
      isDiveMode,
      activeDiveRoot,
    });
  };

  const restoreDesignSelection = () => {
    if (lastDesignSelection) {
      setCanvasSelectionTarget(lastDesignSelection.selectionTarget);
      setSelectedIds(lastDesignSelection.selectedIds);
      setIsDiveMode(lastDesignSelection.isDiveMode);
      setActiveDiveRoot(lastDesignSelection.activeDiveRoot);
      return;
    }

    if (preparedSvg) {
      setCanvasSelectionTarget("svg");
      setSelectedIds([]);
      setIsDiveMode(false);
      setActiveDiveRoot(null);
      return;
    }

    setCanvasSelectionTarget(null);
    setSelectedIds([]);
    setIsDiveMode(false);
    setActiveDiveRoot(null);
  };

  const selectMaterial = () => {
    rememberCurrentDesignSelection();
    setSelectedIds([]);
    setCanvasSelectionTarget("material");
    setIsDiveMode(false);
    setActiveDiveRoot(null);
    setInspectorTab("material");
  };

  const selectCanvasTarget = (target: "material" | "svg" | null) => {
    if (target === "material") {
      selectMaterial();
      return;
    }

    setSelectedIds([]);
    setCanvasSelectionTarget(target);
    setIsDiveMode(false);
    setActiveDiveRoot(null);
    setInspectorTab("design");
  };

  const activateDiveRoot = (scope: DiveRootScope | null) => {
    setInspectorTab("design");
    setCanvasSelectionTarget(null);
    setSelectedIds([]);
    setIsDiveMode(!!scope);
    setActiveDiveRoot(scope);
  };

  const enterSvgDiveMode = () => {
    if (!svgDiveRoot) {
      return;
    }
    activateDiveRoot(svgDiveRoot);
  };

  const exitSvgDiveMode = () => {
    activateDiveRoot(null);
  };

  const handleInspectorTabChange = (tab: InspectorTab) => {
    if (tab === inspectorTab) {
      return;
    }

    if (tab === "material") {
      selectMaterial();
      return;
    }

    setInspectorTab("design");
    restoreDesignSelection();
  };

  const updateAssignmentsForIds = (elementIds: string[], patch: Partial<Pick<ElementAssignment, "targetDepthMm" | "fillMode">>) => {
    if (elementIds.length === 0) {
      return;
    }

    const uniqueIds = Array.from(new Set(elementIds));
    setElementAssignments((current) => {
      const next = { ...current };
      for (const elementId of uniqueIds) {
        const existing = next[elementId];
        if (!existing) {
          continue;
        }
        next[elementId] = {
          ...existing,
          ...patch,
        };
      }
      return next;
    });
  };

  const changeBatchDepth = (elementIds: string[], value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }
    updateAssignmentsForIds(elementIds, { targetDepthMm: value });
  };

  const changeBatchFillMode = (elementIds: string[], value: FillMode | null) => {
    updateAssignmentsForIds(elementIds, { fillMode: value });
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

  const parsedProgram = useMemo(() => {
    if (!generated) {
      return null;
    }
    return parseGcodeProgram(generated.gcode, generated.operation_ranges);
  }, [generated]);

  useEffect(() => {
    const totalDistance = parsedProgram?.totalDistance ?? 0;
    setPreviewCurrentDistance(totalDistance);
    setPreviewPlaying(false);
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

  const recommendedAdvanced = settings ? computeRecommendedAdvancedValues(settings) : {};
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
  const projectSubtitle = "3D Design Project";

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#111113] text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(88,110,255,0.08),_transparent_24%),radial-gradient(circle_at_50%_50%,rgba(255,128,84,0.04),transparent_38%)]" />

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

      {error && activeTab === "prepare" ? (
        <div className="absolute left-1/2 top-6 z-40 -translate-x-1/2 rounded-[1rem] border border-red-400/20 bg-red-500/10 px-4 py-2 text-xs text-red-100">
          {error}
        </div>
      ) : null}

      <div className="relative z-10 min-h-0 flex-1 p-3">
        {activeTab === "prepare" ? (
          <PanelGroup direction="horizontal" className="h-full gap-4">
            <Panel defaultSize={20} minSize={16} maxSize={28}>
              <div className="h-full overflow-hidden rounded-[1.9rem] border border-white/6 bg-[#19191d] shadow-[0_30px_80px_rgba(0,0,0,0.4)]">
                <LayerTree
                  projectName={projectName}
                  projectSubtitle={projectSubtitle}
                  tree={preparedSvg?.tree ?? null}
                  selectedIds={selectedIds}
                  selectionTarget={canvasSelectionTarget}
                  isDiveMode={isDiveMode}
                  activeDiveRootId={activeDiveRoot?.id ?? null}
                  assignments={elementAssignments}
                  elementColors={elementColors}
                  onSelectIds={selectIds}
                  onSelectTarget={selectCanvasTarget}
                  onActivateDiveRoot={activateDiveRoot}
                />
              </div>
            </Panel>
            <PanelResizeHandle className="mx-1 w-1 rounded-full bg-white/[0.04] transition-colors hover:bg-primary/30" />
            <Panel defaultSize={56} minSize={36}>
              <div
                className="relative flex h-full flex-col overflow-hidden rounded-[2rem] border border-white/6 bg-[linear-gradient(180deg,rgba(16,16,18,0.95),rgba(13,13,16,0.98))] shadow-[0_30px_80px_rgba(0,0,0,0.45)]"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => void handleFileDrop(event)}
              >
                <TopBar
                  activeTab={activeTab}
                  hasGenerated={!!generated}
                  isBusy={isGenerating || !isReady}
                  onTabChange={setActiveTab}
                  onExport={() => void handleMakePath()}
                />
                <div className="min-h-0 flex-1">
                  <SvgCanvas
                    preparedSvg={preparedSvg}
                    operations={derivedOperations}
                    selectedIds={selectedIds}
                    activeOperationId={null}
                    selectionTarget={canvasSelectionTarget}
                    isDiveMode={isDiveMode}
                    activeDiveRoot={activeDiveRoot}
                    modifierDirectPick={modifierDirectPick}
                    materialWidth={settings?.engraving.material_width ?? 300}
                    materialHeight={settings?.engraving.material_height ?? 300}
                    placementX={settings?.engraving.placement_x ?? 0}
                    placementY={settings?.engraving.placement_y ?? 0}
                    paddingMm={paddingMm}
                    paddingValidationMessage={paddingValidationMessage}
                    svgWidthMm={svgWidthMm}
                    svgHeightMm={svgHeightMm}
                    svgAspectLocked={svgSizeMm.aspectLocked}
                    onSelectionTargetChange={selectCanvasTarget}
                    onSelectIds={selectIds}
                    onSelectMaterial={selectMaterial}
                    onEnterSvgDiveMode={enterSvgDiveMode}
                    onExitSvgDiveMode={exitSvgDiveMode}
                    onImportClick={() => fileInputRef.current?.click()}
                    onMaterialSizeChange={handleMaterialDimensionChange}
                    onPlacementChange={handlePlacementChange}
                    onSvgDimensionChange={handleSvgDimensionChange}
                    onSvgSizeChange={handleSvgSizeChange}
                  />
                </div>
              </div>
            </Panel>
            <PanelResizeHandle className="mx-1 w-1 rounded-full bg-white/[0.04] transition-colors hover:bg-primary/30" />
            <Panel defaultSize={26} minSize={18} maxSize={34}>
              <div className="h-full overflow-hidden rounded-[1.9rem] border border-white/6 bg-[#19191d] shadow-[0_30px_80px_rgba(0,0,0,0.4)]">
                <StudioInspector
                  activeTab={inspectorTab}
                  onTabChange={handleInspectorTabChange}
                  materialContent={
                    <MaterialInspector
                      settings={settings}
                      recommendedAdvanced={recommendedAdvanced}
                      advancedOverrides={advancedOverrides}
                      onMaterialSizeChange={handleMaterialDimensionChange}
                      onNumberChange={handleSettingsNumberChange}
                      onToolShapeChange={handleToolShapeChange}
                      onFillModeChange={handleFillModeChange}
                      onResetAdvancedRecommendations={resetAdvancedRecommendations}
                    />
                  }
                  context={inspectorContext}
                  settings={settings}
                  svgWidthMm={svgWidthMm}
                  svgHeightMm={svgHeightMm}
                  svgAspectLocked={svgSizeMm.aspectLocked}
                  placementX={settings?.engraving.placement_x ?? 0}
                  placementY={settings?.engraving.placement_y ?? 0}
                  paddingMm={paddingMm}
                  paddingValidationMessage={paddingValidationMessage}
                  onSvgDimensionChange={handleSvgDimensionChange}
                  onSvgAspectLockChange={handleSvgAspectLockChange}
                  onPlacementChange={handlePlacementChange}
                  onPaddingChange={handlePaddingChange}
                  onAlign={handleAlign}
                  onBatchDepthChange={changeBatchDepth}
                  onBatchFillModeChange={changeBatchFillMode}
                />
              </div>
            </Panel>
          </PanelGroup>
        ) : (
          <PanelGroup direction="horizontal" className="h-full gap-4">
            <Panel defaultSize={20} minSize={16} maxSize={28}>
              <div className="h-full overflow-hidden rounded-[1.9rem] border border-white/6 bg-[#19191d] shadow-[0_30px_80px_rgba(0,0,0,0.4)]">
                <PreviewSidebar
                  projectName={projectName}
                  projectSubtitle={projectSubtitle}
                  generated={generated}
                  program={parsedProgram}
                  operations={previewOperations}
                  error={error}
                  activeLineNumber={activePreviewLineNumber}
                  activeOperationId={previewActiveOperationId}
                  onLineSelect={focusPreviewLine}
                  onStepLine={stepPreviewLine}
                  onOperationSelect={setPreviewActiveOperationId}
                />
              </div>
            </Panel>
            <PanelResizeHandle className="mx-1 w-1 rounded-full bg-white/[0.04] transition-colors hover:bg-primary/30" />
            <Panel defaultSize={55} minSize={38}>
              <div className="relative flex h-full flex-col overflow-hidden rounded-[2rem] border border-white/6 bg-[linear-gradient(180deg,rgba(27,27,30,0.98),rgba(19,19,23,1))] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
                <TopBar
                  activeTab={activeTab}
                  hasGenerated={!!generated}
                  onTabChange={setActiveTab}
                  onExport={downloadNc}
                />
                <div className="min-h-0 flex-1">
                  <NcViewer
                    gcodeResult={generated}
                    activeOperationId={previewActiveOperationId}
                    currentDistance={previewCurrentDistance}
                    showStock={previewShowStock}
                    liveCutSimulation={previewLiveCutSimulation}
                    cameraMode={previewCameraMode}
                  />
                </div>
                <PreviewTimeline
                  program={parsedProgram}
                  currentDistance={previewCurrentDistance}
                  isPlaying={previewPlaying}
                  activeOperationId={previewActiveOperationId}
                  onDistanceChange={(distance) => {
                    setPreviewPlaying(false);
                    setPreviewCurrentDistance(distance);
                  }}
                  onTogglePlaying={togglePreviewPlaying}
                />
              </div>
            </Panel>
            <PanelResizeHandle className="mx-1 w-1 rounded-full bg-white/[0.04] transition-colors hover:bg-primary/30" />
            <Panel defaultSize={25} minSize={18} maxSize={32}>
              <div className="h-full overflow-hidden rounded-[1.9rem] border border-white/6 bg-[#19191d] shadow-[0_30px_80px_rgba(0,0,0,0.4)]">
                <PreviewInspector
                  generated={generated}
                  operations={previewOperations}
                  activeOperationId={previewActiveOperationId}
                  cameraMode={previewCameraMode}
                  showStock={previewShowStock}
                  onOperationSelect={setPreviewActiveOperationId}
                  onCameraModeChange={setPreviewCameraMode}
                  onShowStockChange={setPreviewShowStock}
                />
              </div>
            </Panel>
          </PanelGroup>
        )}
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
  svgWidthMm: number,
  svgHeightMm: number,
) {
  const clampedPlacement = clampPlacementToArtboard({
    artboardWidthMm: engraving.material_width,
    artboardHeightMm: engraving.material_height,
    placementX: engraving.placement_x,
    placementY: engraving.placement_y,
    svgWidthMm,
    svgHeightMm,
  });

  return {
    ...engraving,
    placement_x: clampedPlacement.x,
    placement_y: clampedPlacement.y,
  };
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

function groupAssignmentsForIds(
  assignments: Record<string, ElementAssignment>,
  elementIds: string[],
) {
  const groups = new Map<string, { targetDepthMm: number; fillMode: FillMode | null; elementIds: string[] }>();

  for (const elementId of elementIds) {
    const assignment = assignments[elementId];
    if (!assignment) {
      continue;
    }

    const key = `${assignment.targetDepthMm}::${assignment.fillMode ?? "default"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.elementIds.push(elementId);
    } else {
      groups.set(key, {
        targetDepthMm: assignment.targetDepthMm,
        fillMode: assignment.fillMode,
        elementIds: [elementId],
      });
    }
  }

  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      targetDepthMm: group.targetDepthMm,
      fillMode: group.fillMode,
      elementIds: group.elementIds,
    }))
    .sort((left, right) => {
      if (left.targetDepthMm !== right.targetDepthMm) {
        return left.targetDepthMm - right.targetDepthMm;
      }
      return (left.fillMode ?? "").localeCompare(right.fillMode ?? "");
    });
}

function deriveOperationsFromAssignments(
  assignments: Record<string, ElementAssignment>,
  elementIds: string[],
) {
  return groupAssignmentsForIds(assignments, elementIds).map((group, index) => ({
    id: `profile-${group.key}`,
    name: `${formatDepthLabel(group.targetDepthMm)}${group.fillMode ? ` · ${group.fillMode}` : ""}`,
    target_depth_mm: group.targetDepthMm,
    assigned_element_ids: group.elementIds,
    color: colorForOperation(index),
    fill_mode: group.fillMode,
  }));
}

function resizeSvgDocument(
  normalizedSvg: string,
  svgMetrics: SvgDocumentMetrics,
  widthMm: number,
  heightMm: number,
) {
  const parser = new DOMParser();
  const document = parser.parseFromString(normalizedSvg, "image/svg+xml");
  const svg = document.querySelector("svg");
  if (!svg) {
    return normalizedSvg;
  }

  svg.setAttribute("viewBox", `${svgMetrics.x} ${svgMetrics.y} ${svgMetrics.width} ${svgMetrics.height}`);
  svg.setAttribute("width", `${roundMm(widthMm)}mm`);
  svg.setAttribute("height", `${roundMm(heightMm)}mm`);

  return new XMLSerializer().serializeToString(document);
}

function roundMm(value: number) {
  return Math.round(value * 100) / 100;
}

function formatDepthLabel(value: number) {
  return `${roundMm(value)}mm`;
}
