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
import {
  collectAssignmentsForArtObjects,
  composeArtObjectsSvg,
  createArtObject,
  getArtObjectElementIds,
  getDerivedOperationsForArtObjects,
  resizeArtObjectWithAspect,
} from "@/lib/art-objects";
import { clampPlacementToArtboard, getAlignedPlacement, getCanvasGeometry, getPaddingValidationMessage } from "@/lib/editor-geometry";
import { groupAssignmentsForIds } from "@/lib/profile-groups";
import type {
  AlignmentAction,
  ArtObject,
  DesignSelectionSnapshot,
  DiveRootScope,
  EditorSelection,
  ElementAssignment,
  FillMode,
  FrontendOperation,
  GenerateJobResponse,
  InspectorContext,
  InspectorTab,
  Settings,
  TabId,
} from "@/lib/types";
import { MATERIAL_PRESETS, type MaterialPresetId } from "@/lib/material-presets";
import { clamp } from "@/lib/utils";
import { generateEngravingJob, loadDefaultSettings, prepareSvgDocument } from "@/lib/wasm";

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [advancedOverrides, setAdvancedOverrides] = useState<Record<string, boolean>>({});
  const [artObjects, setArtObjects] = useState<ArtObject[]>([]);
  const [hoveredLayerIds, setHoveredLayerIds] = useState<string[]>([]);
  const [generated, setGenerated] = useState<GenerateJobResponse | null>(null);
  const [lastGeneratedInputSignature, setLastGeneratedInputSignature] = useState<string | null>(null);
  const [generatedOperationsSnapshot, setGeneratedOperationsSnapshot] = useState<FrontendOperation[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreviewBlockedNotice, setShowPreviewBlockedNotice] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("prepare");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("design");
  const [selection, setSelection] = useState<EditorSelection>({ type: "none" });
  const [isDiveMode, setIsDiveMode] = useState(false);
  const [activeDiveRoot, setActiveDiveRoot] = useState<DiveRootScope | null>(null);
  const [lastDesignSelection, setLastDesignSelection] = useState<DesignSelectionSnapshot | null>(null);
  const [modifierDirectPick, setModifierDirectPick] = useState(false);
  const [designActiveProfileKey, setDesignActiveProfileKey] = useState<string | null>(null);
  const [showOperationOutlines, setShowOperationOutlines] = useState(true);
  const [paddingMm, setPaddingMm] = useState(10);
  const [projectName, setProjectName] = useState("3D Dog Character");
  const [materialPreset, setMaterialPreset] = useState<MaterialPresetId>("Oak");
  const [previewActiveOperationId, setPreviewActiveOperationId] = useState<string | null>(null);
  const [previewCameraMode, setPreviewCameraMode] = useState<"orthographic" | "perspective">("orthographic");
  const [previewShowStock, setPreviewShowStock] = useState(true);
  const [previewLiveCutSimulation] = useState(true);
  const [previewPlaybackRate] = useState(1);
  const [previewCurrentDistance, setPreviewCurrentDistance] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewBlockedNoticeTimerRef = useRef<number | null>(null);
  const artObjectCounterRef = useRef(1);

  useEffect(() => {
    loadDefaultSettings()
      .then((defaults) => {
        setSettings(
          applyRecommendedSettings(
            {
              ...defaults,
              engraving: {
                ...defaults.engraving,
                target_depth: 5,
                placement_x: 0,
                placement_y: 0,
              },
            },
            {},
          ),
        );
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

  useEffect(() => {
    return () => {
      if (previewBlockedNoticeTimerRef.current !== null) {
        window.clearTimeout(previewBlockedNoticeTimerRef.current);
      }
    };
  }, []);

  const selectedArtObjectId =
    selection.type === "art-object" || selection.type === "elements"
      ? selection.artObjectId
      : activeDiveRoot?.artObjectId ?? null;
  const activeArtObject = selectedArtObjectId
    ? artObjects.find((artObject) => artObject.id === selectedArtObjectId) ?? null
    : null;
  const allElementIds = useMemo(
    () => artObjects.flatMap((artObject) => getArtObjectElementIds(artObject)),
    [artObjects],
  );
  const mergedAssignments = useMemo(() => collectAssignmentsForArtObjects(artObjects), [artObjects]);
  const allProfileGroups = useMemo(
    () => groupAssignmentsForIds(mergedAssignments, allElementIds),
    [allElementIds, mergedAssignments],
  );
  const derivedOperations = useMemo(
    () => getDerivedOperationsForArtObjects(artObjects),
    [artObjects],
  );
  const activeArtObjectElementIds = useMemo(
    () => (activeArtObject ? getArtObjectElementIds(activeArtObject) : []),
    [activeArtObject],
  );
  const activeArtObjectProfileGroups = useMemo(
    () => groupAssignmentsForIds(mergedAssignments, activeArtObjectElementIds),
    [activeArtObjectElementIds, mergedAssignments],
  );
  const paddingValidationMessage = useMemo(() => {
    if (!settings || !activeArtObject) {
      return null;
    }

    const geometry = getCanvasGeometry({
      artboardWidthMm: settings.engraving.material_width,
      artboardHeightMm: settings.engraving.material_height,
      placementX: activeArtObject.placementX,
      placementY: activeArtObject.placementY,
      paddingMm,
      svgWidthMm: activeArtObject.widthMm,
      svgHeightMm: activeArtObject.heightMm,
    });

    return getPaddingValidationMessage(geometry, paddingMm);
  }, [activeArtObject, paddingMm, settings]);

  const inspectorContext = useMemo<InspectorContext>(() => {
    if (selection.type === "elements") {
      const selectedAssignments = selection.elementIds
        .map((id) => mergedAssignments[id])
        .filter((assignment): assignment is ElementAssignment => Boolean(assignment));
      const uniqueDepths = new Set(selectedAssignments.map((assignment) => assignment.targetDepthMm));
      const uniqueFills = new Set(selectedAssignments.map((assignment) => assignment.fillMode ?? "__default__"));

      return {
        type: "selection",
        elementIds: selection.elementIds,
        profileGroups: groupAssignmentsForIds(mergedAssignments, selection.elementIds),
        mixedDepth: uniqueDepths.size > 1,
        mixedFillMode: uniqueFills.size > 1,
        targetDepthMm: uniqueDepths.size === 1 ? selectedAssignments[0]?.targetDepthMm ?? null : null,
        fillMode: uniqueFills.size === 1 ? selectedAssignments[0]?.fillMode ?? null : null,
      };
    }

    if (activeArtObject) {
      return {
        type: "art-object",
        artObjectId: activeArtObject.id,
        elementIds: activeArtObjectElementIds,
        profileGroups: activeArtObjectProfileGroups,
      };
    }

    return { type: "none" };
  }, [activeArtObject, activeArtObjectElementIds, activeArtObjectProfileGroups, mergedAssignments, selection]);

  const generationInput = useMemo(() => {
    if (!settings || artObjects.length === 0 || derivedOperations.length === 0) {
      return null;
    }

    const requestSettings = structuredClone(settings);
    requestSettings.engraving.svg_width_override = null;
    requestSettings.engraving.placement_x = 0;
    requestSettings.engraving.placement_y = 0;

    return {
      normalizedSvg: composeArtObjectsSvg(artObjects, requestSettings),
      settings: requestSettings,
      operations: derivedOperations,
    };
  }, [artObjects, derivedOperations, settings]);
  const generationInputSignature = useMemo(
    () => (generationInput ? JSON.stringify(generationInput) : null),
    [generationInput],
  );

  const handleSvgImport = async (inputFiles: FileList | File[]) => {
    const files = Array.from(inputFiles).filter(
      (file) => file.type.includes("svg") || file.name.toLowerCase().endsWith(".svg"),
    );
    if (files.length === 0) {
      setError("Please provide SVG files.");
      return;
    }

    try {
      const preparedEntries = [];
      for (const file of files) {
        const text = await file.text();
        const prepared = await prepareSvgDocument(text);
        preparedEntries.push({ file, prepared });
      }

      let nextSettings = settings;
      if (settings) {
        const requiredWidth = Math.max(
          settings.engraving.material_width,
          ...preparedEntries.map(({ prepared }) => {
            const metrics = artObjectMetrics(prepared.normalized_svg);
            return metrics ? metrics.width + 20 : settings.engraving.material_width;
          }),
        );
        const requiredHeight = Math.max(
          settings.engraving.material_height,
          ...preparedEntries.map(({ prepared }) => {
            const metrics = artObjectMetrics(prepared.normalized_svg);
            return metrics ? metrics.height + 20 : settings.engraving.material_height;
          }),
        );
        nextSettings = {
          ...settings,
          engraving: {
            ...settings.engraving,
            material_width: roundMm(requiredWidth),
            material_height: roundMm(requiredHeight),
          },
        };
        setSettings(nextSettings);
      }

      const nextArtObjects = [...artObjects];
      for (const { file, prepared } of preparedEntries) {
        const artObjectId = `art-${artObjectCounterRef.current++}`;
        nextArtObjects.push(
          createArtObject({
            artObjectId,
            name: file.name.replace(/\.svg$/i, ""),
            preparedSvg: prepared,
            settings: nextSettings,
            existingArtObjects: nextArtObjects,
          }),
        );
      }

      setArtObjects(nextArtObjects);
      setGenerated(null);
      setLastGeneratedInputSignature(null);
      setGeneratedOperationsSnapshot([]);
      setPreviewActiveOperationId(null);
      setPreviewCurrentDistance(0);
      setPreviewPlaying(false);
      setDesignActiveProfileKey(null);
      setShowOperationOutlines(true);
      setShowPreviewBlockedNotice(false);
      setError(null);
      setInspectorTab("design");
      setActiveTab("prepare");
      const newestArtObject = nextArtObjects.at(-1);
      setSelection(newestArtObject ? { type: "art-object", artObjectId: newestArtObject.id } : { type: "none" });
      setIsDiveMode(false);
      setActiveDiveRoot(null);

      if (artObjects.length === 0) {
        setProjectName(files[0].name.replace(/\.svg$/i, ""));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleMakePath = async () => {
    if (!generationInput || !generationInputSignature) {
      return;
    }

    setShowPreviewBlockedNotice(false);
    setIsGenerating(true);
    setError(null);

    try {
      const result = await generateEngravingJob({
        normalized_svg: generationInput.normalizedSvg,
        settings: generationInput.settings,
        operations: generationInput.operations,
      });
      setGenerated(result);
      setGeneratedOperationsSnapshot(generationInput.operations);
      setLastGeneratedInputSignature(generationInputSignature);
      setActiveTab("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length > 0) {
      await handleSvgImport(event.dataTransfer.files);
    }
  };

  const handleSettingsNumberChange = (path: string, value: number | null, source: "basic" | "advanced") => {
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

      const minimum = getMinimumMaterialDimension(artObjects, paddingMm, dimension);
      const field = dimension === "width" ? "material_width" : "material_height";
      const requested = Math.max(1, value ?? current.engraving[field]);
      const next = {
        ...current,
        engraving: {
          ...current.engraving,
          [field]: Math.max(requested, minimum),
        },
      };
      return next;
    });

    setArtObjects((current) =>
      current.map((artObject) => clampArtObjectToMaterial(artObject, dimension, value, settings)),
    );
  };

  const handlePlacementChange = (x: number, y: number) => {
    if (!activeArtObject || !settings) {
      return;
    }

    setArtObjects((current) =>
      current.map((artObject) => {
        if (artObject.id !== activeArtObject.id) {
          return artObject;
        }
        const clamped = clampPlacementToArtboard({
          artboardWidthMm: settings.engraving.material_width,
          artboardHeightMm: settings.engraving.material_height,
          placementX: x,
          placementY: y,
          svgWidthMm: artObject.widthMm,
          svgHeightMm: artObject.heightMm,
        });
        return {
          ...artObject,
          placementX: clamped.x,
          placementY: clamped.y,
        };
      }),
    );
  };

  const handleArtObjectPlacementChange = (artObjectId: string, x: number, y: number) => {
    if (!settings) {
      return;
    }
    setArtObjects((current) =>
      current.map((artObject) => {
        if (artObject.id !== artObjectId) {
          return artObject;
        }
        const clamped = clampPlacementToArtboard({
          artboardWidthMm: settings.engraving.material_width,
          artboardHeightMm: settings.engraving.material_height,
          placementX: x,
          placementY: y,
          svgWidthMm: artObject.widthMm,
          svgHeightMm: artObject.heightMm,
        });
        return {
          ...artObject,
          placementX: clamped.x,
          placementY: clamped.y,
        };
      }),
    );
  };

  const handleArtObjectDimensionChange = (
    artObjectId: string,
    dimension: "width" | "height",
    value: number | null,
  ) => {
    if (!settings) {
      return;
    }

    setArtObjects((current) =>
      current.map((artObject) => {
        if (artObject.id !== artObjectId) {
          return artObject;
        }

        const next = resizeArtObjectWithAspect(
          artObject,
          dimension === "width" ? value : null,
          dimension === "height" ? value : null,
          settings,
        );
        return {
          ...artObject,
          ...next,
        };
      }),
    );
  };

  const handleArtObjectSizeChange = (artObjectId: string, width: number | null, height: number | null) => {
    if (!settings) {
      return;
    }
    setArtObjects((current) =>
      current.map((artObject) =>
        artObject.id === artObjectId
          ? {
              ...artObject,
              ...resizeArtObjectWithAspect(artObject, width, height, settings),
            }
          : artObject,
      ),
    );
  };

  const handleSvgDimensionChange = (dimension: "width" | "height", value: number | null) => {
    if (!activeArtObject || !settings) {
      return;
    }

    setArtObjects((current) =>
      current.map((artObject) => {
        if (artObject.id !== activeArtObject.id) {
          return artObject;
        }

        const next = resizeArtObjectWithAspect(
          artObject,
          dimension === "width" ? value : null,
          dimension === "height" ? value : null,
          settings,
        );
        return {
          ...artObject,
          ...next,
        };
      }),
    );
  };

  const handleSvgAspectLockChange = (value: boolean) => {
    if (!activeArtObject) {
      return;
    }
    setArtObjects((current) =>
      current.map((artObject) =>
        artObject.id === activeArtObject.id
          ? {
              ...artObject,
              aspectLocked: value,
            }
          : artObject,
      ),
    );
  };

  const handlePaddingChange = (value: number | null) => {
    setPaddingMm(Math.max(0, value ?? 0));
  };

  const handleAlign = (action: AlignmentAction) => {
    if (!settings || !activeArtObject) {
      return;
    }

    const geometry = getCanvasGeometry({
      artboardWidthMm: settings.engraving.material_width,
      artboardHeightMm: settings.engraving.material_height,
      placementX: activeArtObject.placementX,
      placementY: activeArtObject.placementY,
      paddingMm,
      svgWidthMm: activeArtObject.widthMm,
      svgHeightMm: activeArtObject.heightMm,
    });
    const nextPlacement = getAlignedPlacement(
      action,
      geometry,
      settings.engraving.material_width,
      settings.engraving.material_height,
      activeArtObject.placementX,
      activeArtObject.placementY,
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

  const handleMaterialPresetChange = (value: MaterialPresetId) => {
    const preset = MATERIAL_PRESETS[value];
    const maxStepdown = Number((preset.defaultDepthMm / preset.defaultPasses).toFixed(2));
    const nextOverrides = {
      ...advancedOverrides,
      "engraving.max_stepdown": true,
    };

    setMaterialPreset(value);
    setAdvancedOverrides(nextOverrides);
    setSettings((current) => {
      if (!current) {
        return current;
      }
      return applyRecommendedSettings(
        {
          ...current,
          engraving: {
            ...current.engraving,
            target_depth: preset.defaultDepthMm,
            max_stepdown: maxStepdown,
          },
        },
        nextOverrides,
      );
    });
  };

  const resetAdvancedRecommendations = () => {
    setAdvancedOverrides({});
    setSettings((current) => (current ? applyRecommendedSettings(current, {}) : current));
  };

  const rememberCurrentDesignSelection = () => {
    if (selection.type === "material") {
      return;
    }

    setLastDesignSelection({
      selection,
      isDiveMode,
      activeDiveRoot,
    });
  };

  const restoreDesignSelection = () => {
    if (lastDesignSelection) {
      setSelection(lastDesignSelection.selection);
      setIsDiveMode(lastDesignSelection.isDiveMode);
      setActiveDiveRoot(lastDesignSelection.activeDiveRoot);
      return;
    }

    if (artObjects.length > 0) {
      setSelection({ type: "art-object", artObjectId: artObjects[0].id });
      setIsDiveMode(false);
      setActiveDiveRoot(null);
      return;
    }

    setSelection({ type: "none" });
    setIsDiveMode(false);
    setActiveDiveRoot(null);
  };

  const selectMaterial = () => {
    rememberCurrentDesignSelection();
    setSelection({ type: "material" });
    setDesignActiveProfileKey(null);
    setIsDiveMode(false);
    setActiveDiveRoot(null);
    setInspectorTab("material");
  };

  const selectArtObject = (artObjectId: string) => {
    setSelection({ type: "art-object", artObjectId });
    setDesignActiveProfileKey(null);
    setIsDiveMode(false);
    setActiveDiveRoot(null);
    setInspectorTab("design");
  };

  const selectIds = (artObjectId: string, ids: string[], additive: boolean) => {
    setInspectorTab("design");
    setDesignActiveProfileKey(null);
    setSelection((current) => {
      if (!additive || current.type !== "elements" || current.artObjectId !== artObjectId) {
        return {
          type: "elements",
          artObjectId,
          elementIds: ids,
        };
      }

      const next = new Set(current.elementIds);
      for (const id of ids) {
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      return {
        type: "elements",
        artObjectId,
        elementIds: Array.from(next),
      };
    });
  };

  const activateDiveRoot = (scope: DiveRootScope | null) => {
    setInspectorTab("design");
    if (scope) {
      setSelection({ type: "art-object", artObjectId: scope.artObjectId });
    }
    setDesignActiveProfileKey(null);
    setIsDiveMode(!!scope);
    setActiveDiveRoot(scope);
  };

  const enterSvgDiveMode = (artObjectId: string) => {
    const artObject = artObjects.find((candidate) => candidate.id === artObjectId);
    if (!artObject) {
      return;
    }
    activateDiveRoot({
      id: `${artObject.id}:root`,
      label: artObject.name,
      artObjectId: artObject.id,
      elementIds: getArtObjectElementIds(artObject),
    });
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

    setArtObjects((current) =>
      current.map((artObject) => {
        const nextAssignments = { ...artObject.elementAssignments };
        let changed = false;
        for (const elementId of elementIds) {
          const existing = nextAssignments[elementId];
          if (!existing) {
            continue;
          }
          nextAssignments[elementId] = {
            ...existing,
            ...patch,
          };
          changed = true;
        }

        return changed
          ? {
              ...artObject,
              elementAssignments: nextAssignments,
            }
          : artObject;
      }),
    );
  };

  const changeBatchDepth = (elementIds: string[], value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }
    updateAssignmentsForIds(elementIds, { targetDepthMm: value });
  };

  const changeBatchFillMode = (elementIds: string[], value: FillMode) => {
    updateAssignmentsForIds(elementIds, { fillMode: value });
  };

  const handleProfilePreview = (profileKey: string | null) => {
    setInspectorTab("design");
    setDesignActiveProfileKey(profileKey);
  };

  const handleProfileSelect = (elementIds: string[]) => {
    if (elementIds.length === 0) {
      return;
    }
    const artObjectId = splitCompositeOwner(elementIds[0]);
    setInspectorTab("design");
    setDesignActiveProfileKey(null);
    setSelection({
      type: "elements",
      artObjectId,
      elementIds,
    });
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

  const notifyPreviewRequiresProcessing = () => {
    setShowPreviewBlockedNotice(true);
    if (previewBlockedNoticeTimerRef.current !== null) {
      window.clearTimeout(previewBlockedNoticeTimerRef.current);
    }
    previewBlockedNoticeTimerRef.current = window.setTimeout(() => {
      setShowPreviewBlockedNotice(false);
      previewBlockedNoticeTimerRef.current = null;
    }, 2200);
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
  const hasGeneratedGcode = !!generated;
  const hasOutdatedGcode = hasGeneratedGcode && generationInputSignature !== lastGeneratedInputSignature;
  const isPreviewReady = hasGeneratedGcode && !hasOutdatedGcode;
  const canProcessGcode = !!generationInput;
  const processLabel = !hasGeneratedGcode ? "Make GCODE" : hasOutdatedGcode ? "Update GCODE" : "GCODE Ready";
  const processDisabled = isGenerating || !isReady || !canProcessGcode || isPreviewReady;
  const exportDisabled = !isPreviewReady || isGenerating;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) {
            void handleSvgImport(event.target.files);
          }
        }}
      />

      {error && activeTab === "prepare" ? (
        <div className="absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-md border border-danger/30 bg-danger/15 px-3 py-2 text-xs text-danger-foreground">
          {error}
        </div>
      ) : null}
      {showPreviewBlockedNotice ? (
        <div className="absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-md border border-warning/30 bg-warning/15 px-3 py-2 text-xs text-warning-foreground">
          Process first to preview GCODE
        </div>
      ) : null}

      <div className="relative z-10 min-h-0 flex-1 p-0">
        {activeTab === "prepare" ? (
          <PanelGroup direction="horizontal" className="h-full gap-0">
            <Panel defaultSize={20} minSize={16} maxSize={28}>
              <div className="h-full overflow-hidden bg-content1">
                <LayerTree
                  artObjects={artObjects}
                  projectName={projectName}
                  onProjectNameChange={setProjectName}
                  selection={selection}
                  activeDiveRootId={activeDiveRoot?.id ?? null}
                  onSelectMaterial={selectMaterial}
                  onSelectArtObject={selectArtObject}
                  onSelectIds={selectIds}
                  onActivateDiveRoot={activateDiveRoot}
                  onHoverIdsChange={setHoveredLayerIds}
                  onAddClick={() => fileInputRef.current?.click()}
                />
              </div>
            </Panel>
            <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/30" />
            <Panel defaultSize={56} minSize={36}>
              <div
                className="relative flex h-full flex-col overflow-hidden bg-content1"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => void handleFileDrop(event)}
              >
                <TopBar
                  activeTab={activeTab}
                  canPreview={isPreviewReady}
                  isBusy={isGenerating}
                  processLabel={processLabel}
                  processDisabled={processDisabled}
                  exportDisabled={exportDisabled}
                  onTabChange={setActiveTab}
                  onProcess={() => void handleMakePath()}
                  onExport={downloadNc}
                  onPreviewBlocked={notifyPreviewRequiresProcessing}
                />
                <div className="min-h-0 flex-1">
                  <SvgCanvas
                    artObjects={artObjects}
                    operations={derivedOperations}
                    selection={selection}
                    hoveredIds={hoveredLayerIds}
                    activeOperationId={null}
                    activeProfileKey={designActiveProfileKey}
                    isDiveMode={isDiveMode}
                    activeDiveRoot={activeDiveRoot}
                    modifierDirectPick={modifierDirectPick}
                    showOperationOutlines={showOperationOutlines}
                    materialWidth={settings?.engraving.material_width ?? 300}
                    materialHeight={settings?.engraving.material_height ?? 300}
                    paddingMm={paddingMm}
                    paddingValidationMessage={paddingValidationMessage}
                    materialPreset={materialPreset}
                    onSelectionChange={(nextSelection) => {
                      if (nextSelection.type === "material") {
                        selectMaterial();
                        return;
                      }
                      setSelection(nextSelection);
                      if (nextSelection.type !== "elements") {
                        setDesignActiveProfileKey(null);
                      }
                    }}
                    onSelectIds={selectIds}
                    onSelectMaterial={selectMaterial}
                    onEnterSvgDiveMode={enterSvgDiveMode}
                    onExitSvgDiveMode={exitSvgDiveMode}
                    onImportClick={() => fileInputRef.current?.click()}
                    onMaterialSizeChange={handleMaterialDimensionChange}
                    onArtObjectPlacementChange={handleArtObjectPlacementChange}
                    onArtObjectDimensionChange={handleArtObjectDimensionChange}
                    onArtObjectSizeChange={handleArtObjectSizeChange}
                    onShowOperationOutlinesChange={setShowOperationOutlines}
                  />
                </div>
              </div>
            </Panel>
            <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/30" />
            <Panel defaultSize={26} minSize={18} maxSize={34}>
              <div className="h-full overflow-hidden bg-content1">
                <StudioInspector
                  activeTab={inspectorTab}
                  onTabChange={handleInspectorTabChange}
                  materialContent={
                    <MaterialInspector
                      settings={settings}
                      materialPreset={materialPreset}
                      paddingMm={paddingMm}
                      recommendedAdvanced={recommendedAdvanced}
                      advancedOverrides={advancedOverrides}
                      onMaterialSizeChange={handleMaterialDimensionChange}
                      onPaddingChange={handlePaddingChange}
                      onNumberChange={handleSettingsNumberChange}
                      onToolShapeChange={handleToolShapeChange}
                      onMaterialPresetChange={handleMaterialPresetChange}
                      onResetAdvancedRecommendations={resetAdvancedRecommendations}
                    />
                  }
                  context={inspectorContext}
                  activeArtObject={activeArtObject}
                  allProfileGroups={allProfileGroups}
                  activeProfileKey={designActiveProfileKey}
                  settings={settings}
                  paddingValidationMessage={paddingValidationMessage}
                  onSvgDimensionChange={handleSvgDimensionChange}
                  onSvgAspectLockChange={handleSvgAspectLockChange}
                  onPlacementChange={handlePlacementChange}
                  onAlign={handleAlign}
                  onBatchDepthChange={changeBatchDepth}
                  onBatchFillModeChange={changeBatchFillMode}
                  onProfilePreview={handleProfilePreview}
                  onProfilePreviewClear={() => handleProfilePreview(null)}
                  onProfileSelect={handleProfileSelect}
                />
              </div>
            </Panel>
          </PanelGroup>
        ) : (
          <PanelGroup direction="horizontal" className="h-full gap-0">
            <Panel defaultSize={20} minSize={16} maxSize={28}>
              <div className="h-full overflow-hidden bg-content1">
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
            <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/30" />
            <Panel defaultSize={55} minSize={38}>
              <div className="relative flex h-full flex-col overflow-hidden bg-content1">
                <TopBar
                  activeTab={activeTab}
                  canPreview={isPreviewReady}
                  isBusy={isGenerating}
                  processLabel={processLabel}
                  processDisabled={processDisabled}
                  exportDisabled={exportDisabled}
                  onTabChange={setActiveTab}
                  onProcess={() => void handleMakePath()}
                  onExport={downloadNc}
                  onPreviewBlocked={notifyPreviewRequiresProcessing}
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
            <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/30" />
            <Panel defaultSize={25} minSize={18} maxSize={32}>
              <div className="h-full overflow-hidden bg-content1">
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

function applyRecommendedSettings(settings: Settings, overrides: Record<string, boolean>) {
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

function getMinimumMaterialDimension(
  artObjects: ArtObject[],
  paddingMm: number,
  dimension: "width" | "height",
) {
  if (artObjects.length === 0) {
    return 1;
  }

  if (dimension === "width") {
    return Math.max(...artObjects.map((artObject) => artObject.placementX + artObject.widthMm + paddingMm));
  }

  return Math.max(...artObjects.map((artObject) => artObject.placementY + artObject.heightMm + paddingMm));
}

function clampArtObjectToMaterial(
  artObject: ArtObject,
  dimension: "width" | "height",
  value: number | null,
  settings: Settings | null,
) {
  if (!settings) {
    return artObject;
  }

  const materialWidth = dimension === "width" ? Math.max(1, value ?? settings.engraving.material_width) : settings.engraving.material_width;
  const materialHeight = dimension === "height" ? Math.max(1, value ?? settings.engraving.material_height) : settings.engraving.material_height;
  const widthMm = Math.min(artObject.widthMm, materialWidth);
  const heightMm = Math.min(artObject.heightMm, materialHeight);
  const clampedPlacement = clampPlacementToArtboard({
    artboardWidthMm: materialWidth,
    artboardHeightMm: materialHeight,
    placementX: artObject.placementX,
    placementY: artObject.placementY,
    svgWidthMm: widthMm,
    svgHeightMm: heightMm,
  });

  return {
    ...artObject,
    widthMm,
    heightMm,
    placementX: clampedPlacement.x,
    placementY: clampedPlacement.y,
  };
}

function artObjectMetrics(normalizedSvg: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(normalizedSvg, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) {
    return null;
  }
  const viewBox = svg.getAttribute("viewBox")?.split(/[\s,]+/).map(Number) ?? [];
  if (viewBox.length === 4 && viewBox.every(Number.isFinite)) {
    return { width: viewBox[2], height: viewBox[3] };
  }
  const width = Number.parseFloat(svg.getAttribute("width") ?? "0");
  const height = Number.parseFloat(svg.getAttribute("height") ?? "0");
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return { width, height };
}

function splitCompositeOwner(compositeId: string) {
  const [owner] = compositeId.split("::");
  return owner;
}

function roundMm(value: number) {
  return Math.round(value * 100) / 100;
}
