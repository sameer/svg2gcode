import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import {
  collectAssignmentsForArtObjects,
  composeArtObjectsSvg,
  createArtObject,
  getArtObjectElementIds,
  resizeArtObjectWithAspect,
} from "@/lib/art-objects";
import { fillModeToEngraveType, engraveTypeLabel, isSupportedEngraveType } from "@/editor/engraving";
import { applyRecommendedSettings } from "@/editor/recommendations";
import { useMachiningSettings } from "@/editor/use-machining-settings";
import { clampPlacementToArtboard, getAlignedPlacement, getCanvasGeometry, getPaddingValidationMessage } from "@/lib/editor-geometry";
import {
  buildArtObjectSelectionIndex,
  expandSelectableUnitIds,
  findDrilldownFocusScope,
  getEffectiveInteractionMode,
  getFocusScopeInfo,
  getSelectableUnitOwnerArtObjectId,
  isScopeNodeIdValid,
  isSelectableUnitIdValid,
  resolveSelectableUnitIdsForHits,
} from "@/lib/editor-selection";
import { groupAssignmentsForIds } from "@/lib/profile-groups";
import type {
  AlignmentAction,
  ArtObject,
  DesignSelectionSnapshot,
  DistributionAction,
  DiveRootScope,
  EditorSelection,
  EditorFocusScope,
  EditorInteractionMode,
  ElementAssignment,
  FillMode,
  FrontendOperation,
  GenerateJobResponse,
  InspectorContext,
  InspectorTab,
  Settings,
  TabId,
  EngraveType,
} from "@/lib/types";
import { type MaterialPresetId } from "@/lib/material-presets";
import { generateEngravingJob, loadDefaultSettings, prepareSvgDocument } from "@/lib/wasm";

export function useStudioController() {
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
  const [surfaceMode, setSurfaceMode] = useState<"design" | "material">("design");
  const [selectedArtObjectIds, setSelectedArtObjectIds] = useState<string[]>([]);
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [focusScope, setFocusScope] = useState<EditorFocusScope | null>(null);
  const [interactionMode, setInteractionMode] = useState<EditorInteractionMode>("group");
  const [lastDesignSelection, setLastDesignSelection] = useState<DesignSelectionSnapshot | null>(null);
  const [modifierDirectPick, setModifierDirectPick] = useState(false);
  const [designActiveProfileKey, setDesignActiveProfileKey] = useState<string | null>(null);
  const [showOperationOutlines, setShowOperationOutlines] = useState(true);
  const [paddingMm, setPaddingMm] = useState(10);
  const [projectName, setProjectName] = useState("3D Dog Character");
  const [materialPreset, setMaterialPreset] = useState<MaterialPresetId>("Oak");
  const [defaultEngraveType, setDefaultEngraveType] = useState<EngraveType>("pocket");
  const [operationOverrides, setOperationOverrides] = useState<Record<string, { allowThickenRouting: boolean }>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewBlockedNoticeTimerRef = useRef<number | null>(null);
  const artObjectCounterRef = useRef(1);

  useEffect(() => {
    loadDefaultSettings()
      .then((defaults) => {
        const initialEngraveType = fillModeToEngraveType(defaults.engraving.fill_mode);
        setDefaultEngraveType(initialEngraveType);
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
            initialEngraveType,
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

  const machining = useMachiningSettings({
    settings,
    setSettings,
    artObjects,
    setArtObjects,
    paddingMm,
    setPaddingMm,
    materialPreset,
    setMaterialPreset,
    defaultEngraveType,
    setDefaultEngraveType,
    advancedOverrides,
    setAdvancedOverrides,
  });

  const selectionIndexes = useMemo(
    () =>
      Object.fromEntries(
        artObjects.map((artObject) => [artObject.id, buildArtObjectSelectionIndex(artObject)]),
      ),
    [artObjects],
  );
  const effectiveInteractionMode = getEffectiveInteractionMode(interactionMode, modifierDirectPick);
  const visibleFocusScope = surfaceMode === "design" ? focusScope : null;
  const activeDiveRoot = useMemo<DiveRootScope | null>(() => {
    if (!visibleFocusScope) {
      return null;
    }

    const index = selectionIndexes[visibleFocusScope.artObjectId];
    return index ? getFocusScopeInfo(index, visibleFocusScope.scopeNodeId) : null;
  }, [selectionIndexes, visibleFocusScope]);
  const isDiveMode = !!activeDiveRoot;
  const selectedElementIdsByArtObject = useMemo(() => {
    const next: Record<string, string[]> = {};
    const grouped = new Map<string, string[]>();

    selectedUnitIds.forEach((unitId) => {
      const artObjectId = getSelectableUnitOwnerArtObjectId(unitId);
      if (!artObjectId) {
        return;
      }

      const current = grouped.get(artObjectId) ?? [];
      current.push(unitId);
      grouped.set(artObjectId, current);
    });

    grouped.forEach((unitIds, artObjectId) => {
      const index = selectionIndexes[artObjectId];
      if (!index) {
        return;
      }
      next[artObjectId] = expandSelectableUnitIds(index, unitIds);
    });

    return next;
  }, [selectedUnitIds, selectionIndexes]);
  const selection = useMemo<EditorSelection>(() => {
    if (surfaceMode === "material") {
      return { type: "material" };
    }

    if (selectedUnitIds.length > 0) {
      const artObjectId =
        getSelectableUnitOwnerArtObjectId(selectedUnitIds[0]) ??
        selectedArtObjectIds[0] ??
        focusScope?.artObjectId;

      if (artObjectId) {
        return {
          type: "elements",
          artObjectId,
          elementIds: selectedElementIdsByArtObject[artObjectId] ?? [],
        };
      }
    }

    if (selectedArtObjectIds.length === 1) {
      return { type: "art-object", artObjectId: selectedArtObjectIds[0] };
    }
    if (selectedArtObjectIds.length > 1) {
      return { type: "art-objects", artObjectIds: selectedArtObjectIds };
    }

    return { type: "none" };
  }, [focusScope?.artObjectId, selectedArtObjectIds, selectedElementIdsByArtObject, selectedUnitIds, surfaceMode]);
  const selectedArtObjectId =
    selection.type === "art-object" || selection.type === "elements"
      ? selection.artObjectId
      : activeDiveRoot?.artObjectId ?? null;
  const activeArtObject = selectedArtObjectId
    ? artObjects.find((artObject) => artObject.id === selectedArtObjectId) ?? null
    : null;
  const selectedArtObjects = useMemo(
    () => artObjects.filter((artObject) => selectedArtObjectIds.includes(artObject.id)),
    [artObjects, selectedArtObjectIds],
  );
  const allElementIds = useMemo(
    () => artObjects.flatMap((artObject) => getArtObjectElementIds(artObject)),
    [artObjects],
  );
  const mergedAssignments = useMemo(() => collectAssignmentsForArtObjects(artObjects), [artObjects]);
  const allProfileGroups = useMemo(
    () => groupAssignmentsForIds(mergedAssignments, allElementIds),
    [allElementIds, mergedAssignments],
  );
  const derivedOperations = useMemo(() => {
    return allProfileGroups.map((group) => ({
      id: `profile-${group.key}`,
      name: `${roundMm(group.targetDepthMm)}mm${group.engraveType ? ` · ${engraveTypeLabel(group.engraveType)}` : ""}`,
      target_depth_mm: group.targetDepthMm,
      assigned_element_ids: group.elementIds,
      color: group.color,
      engrave_type: group.engraveType,
      fill_mode: group.fillMode,
      allow_thicken_routing: operationOverrides[group.key]?.allowThickenRouting ?? false,
    }));
  }, [allProfileGroups, operationOverrides]);
  const activeArtObjectElementIds = useMemo(
    () => (activeArtObject ? getArtObjectElementIds(activeArtObject) : []),
    [activeArtObject],
  );
  const activeArtObjectProfileGroups = useMemo(
    () => groupAssignmentsForIds(mergedAssignments, activeArtObjectElementIds),
    [activeArtObjectElementIds, mergedAssignments],
  );
  useEffect(() => {
    const validArtObjectIds = new Set(artObjects.map((artObject) => artObject.id));

    setSelectedArtObjectIds((current) =>
      current.filter((artObjectId) => validArtObjectIds.has(artObjectId)),
    );
    setSelectedUnitIds((current) =>
      current.filter((unitId) => {
        const artObjectId = getSelectableUnitOwnerArtObjectId(unitId);
        if (!artObjectId || !validArtObjectIds.has(artObjectId)) {
          return false;
        }

        const index = selectionIndexes[artObjectId];
        return index ? isSelectableUnitIdValid(index, unitId) : false;
      }),
    );
    setFocusScope((current) => {
      if (!current || !validArtObjectIds.has(current.artObjectId)) {
        return null;
      }

      const index = selectionIndexes[current.artObjectId];
      return index && isScopeNodeIdValid(index, current.scopeNodeId) ? current : null;
    });
  }, [artObjects, selectionIndexes]);

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

    if (selection.type === "art-objects") {
      const elementIds = artObjects
        .filter((artObject) => selection.artObjectIds.includes(artObject.id))
        .flatMap((artObject) => getArtObjectElementIds(artObject));
      const selectedAssignments = elementIds
        .map((id) => mergedAssignments[id])
        .filter((assignment): assignment is ElementAssignment => Boolean(assignment));
      const uniqueDepths = new Set(selectedAssignments.map((assignment) => assignment.targetDepthMm));
      const uniqueFills = new Set(selectedAssignments.map((assignment) => assignment.fillMode ?? "__default__"));

      return {
        type: "selection",
        elementIds,
        profileGroups: groupAssignmentsForIds(mergedAssignments, elementIds),
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
  }, [activeArtObject, activeArtObjectElementIds, activeArtObjectProfileGroups, artObjects, mergedAssignments, selection]);

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
            defaultEngraveType,
            existingArtObjects: nextArtObjects,
          }),
        );
      }

      setArtObjects(nextArtObjects);
      setGenerated(null);
      setLastGeneratedInputSignature(null);
      setGeneratedOperationsSnapshot([]);
      setDesignActiveProfileKey(null);
      setShowOperationOutlines(true);
      setShowPreviewBlockedNotice(false);
      setError(null);
      setInspectorTab("design");
      setActiveTab("prepare");
      const newestArtObject = nextArtObjects.at(-1);
      setSurfaceMode("design");
      setSelectedArtObjectIds(newestArtObject ? [newestArtObject.id] : []);
      setSelectedUnitIds([]);
      setFocusScope(null);

      if (artObjects.length === 0) {
        setProjectName(files[0].name.replace(/\.svg$/i, ""));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleFileDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length > 0) {
      await handleSvgImport(event.dataTransfer.files);
    }
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

  const handleArtObjectsTransformChange = (
    transforms: { artObjectId: string; x: number; y: number; width: number; height: number }[],
  ) => {
    if (!settings || transforms.length === 0) {
      return;
    }

    const byId = new Map(transforms.map((transform) => [transform.artObjectId, transform]));
    setArtObjects((current) =>
      current.map((artObject) => {
        const next = byId.get(artObject.id);
        if (!next) {
          return artObject;
        }
        return {
          ...artObject,
          placementX: next.x,
          placementY: next.y,
          widthMm: next.width,
          heightMm: next.height,
        };
      }),
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

  const handleAlign = (action: AlignmentAction) => {
    if (!settings || selectedArtObjects.length === 0) {
      return;
    }

    if (selectedArtObjects.length === 1) {
      const [artObject] = selectedArtObjects;
      const geometry = getCanvasGeometry({
        artboardWidthMm: settings.engraving.material_width,
        artboardHeightMm: settings.engraving.material_height,
        placementX: artObject.placementX,
        placementY: artObject.placementY,
        paddingMm,
        svgWidthMm: artObject.widthMm,
        svgHeightMm: artObject.heightMm,
      });
      const nextPlacement = getAlignedPlacement(
        action,
        geometry,
        settings.engraving.material_width,
        settings.engraving.material_height,
        artObject.placementX,
        artObject.placementY,
        paddingMm,
      );

      if (nextPlacement) {
        handlePlacementChange(nextPlacement.x, nextPlacement.y);
      }
      return;
    }

    const bounds = getSelectionBounds(selectedArtObjects);
    setArtObjects((current) =>
      current.map((artObject) => {
        if (!selectedArtObjectIds.includes(artObject.id)) {
          return artObject;
        }

        const next = getAlignedArtObjectPlacement(action, artObject, bounds);
        return {
          ...artObject,
          placementX: next.x,
          placementY: next.y,
        };
      }),
    );
  };

  const handleDistribute = (action: DistributionAction) => {
    if (selectedArtObjects.length < 2) {
      return;
    }

    const ordered = [...selectedArtObjects].sort((a, b) =>
      action === "horizontal"
        ? a.placementX + a.widthMm / 2 - (b.placementX + b.widthMm / 2)
        : a.placementY + a.heightMm / 2 - (b.placementY + b.heightMm / 2),
    );
    if (ordered.length <= 2) {
      return;
    }

    const firstCenter =
      action === "horizontal"
        ? ordered[0].placementX + ordered[0].widthMm / 2
        : ordered[0].placementY + ordered[0].heightMm / 2;
    const lastCenter =
      action === "horizontal"
        ? ordered.at(-1)!.placementX + ordered.at(-1)!.widthMm / 2
        : ordered.at(-1)!.placementY + ordered.at(-1)!.heightMm / 2;
    const step = (lastCenter - firstCenter) / (ordered.length - 1);
    const planned = new Map<string, { x: number; y: number }>();

    ordered.forEach((artObject, index) => {
      if (index === 0 || index === ordered.length - 1) {
        planned.set(artObject.id, { x: artObject.placementX, y: artObject.placementY });
        return;
      }

      const center = firstCenter + step * index;
      planned.set(artObject.id, {
        x: action === "horizontal" ? center - artObject.widthMm / 2 : artObject.placementX,
        y: action === "vertical" ? center - artObject.heightMm / 2 : artObject.placementY,
      });
    });

    setArtObjects((current) =>
      current.map((artObject) => {
        const next = planned.get(artObject.id);
        return next
          ? {
              ...artObject,
              placementX: next.x,
              placementY: next.y,
            }
          : artObject;
      }),
    );
  };

  const beginDesignSelectionChange = () => {
    setSurfaceMode("design");
    setInspectorTab("design");
    setDesignActiveProfileKey(null);
  };

  const rememberCurrentDesignSelection = () => {
    if (surfaceMode !== "design") {
      return;
    }

    setLastDesignSelection({
      surfaceMode: "design",
      selectedArtObjectIds,
      selectedUnitIds,
      focusScope,
      interactionMode,
    });
  };

  const getEffectiveFocusScopeNodeIdForArtObject = (artObjectId: string) => {
    if (effectiveInteractionMode === "direct") {
      return null;
    }

    return focusScope?.artObjectId === artObjectId ? focusScope.scopeNodeId : null;
  };

  const clearSelection = () => {
    beginDesignSelectionChange();
    setSelectedArtObjectIds([]);
    setSelectedUnitIds([]);
    setFocusScope(null);
  };

  const selectMaterial = () => {
    rememberCurrentDesignSelection();
    setSurfaceMode("material");
    setDesignActiveProfileKey(null);
    setInspectorTab("material");
    setSelectedArtObjectIds([]);
    setSelectedUnitIds([]);
    setFocusScope(null);
  };

  const selectArtObject = (artObjectId: string) => {
    beginDesignSelectionChange();
    setSelectedArtObjectIds([artObjectId]);
    setSelectedUnitIds([]);
    setFocusScope(null);
  };

  const selectArtObjects = (artObjectIds: string[], additive: boolean) => {
    const uniqueIds = Array.from(new Set(artObjectIds));
    beginDesignSelectionChange();
    setSelectedUnitIds([]);
    setFocusScope(null);

    if (!additive) {
      setSelectedArtObjectIds(uniqueIds);
      return;
    }

    const next = new Set(selectedArtObjectIds);
    const designArtObjectId =
      focusScope?.artObjectId ??
      (selectedUnitIds.length > 0 ? getSelectableUnitOwnerArtObjectId(selectedUnitIds[0]) : null);

    if (next.size === 0 && designArtObjectId) {
      next.add(designArtObjectId);
    }

    uniqueIds.forEach((artObjectId) => {
      if (next.has(artObjectId)) {
        next.delete(artObjectId);
      } else {
        next.add(artObjectId);
      }
    });

    setSelectedArtObjectIds(Array.from(next));
  };

  const selectIds = (artObjectId: string, ids: string[], additive: boolean) => {
    const index = selectionIndexes[artObjectId];
    if (!index) {
      return;
    }

    const resolvedUnitIds = resolveSelectableUnitIdsForHits(
      index,
      getEffectiveFocusScopeNodeIdForArtObject(artObjectId),
      effectiveInteractionMode,
      ids,
    );

    beginDesignSelectionChange();
    setSelectedArtObjectIds([artObjectId]);
    setFocusScope((current) => (current?.artObjectId === artObjectId ? current : null));

    if (!additive || getSelectableUnitOwnerArtObjectId(selectedUnitIds[0] ?? "") !== artObjectId) {
      setSelectedUnitIds(resolvedUnitIds);
      return;
    }

    const next = new Set(selectedUnitIds);
    resolvedUnitIds.forEach((unitId) => {
      if (next.has(unitId)) {
        next.delete(unitId);
      } else {
        next.add(unitId);
      }
    });
    setSelectedUnitIds(Array.from(next));
  };

  const activateFocusScope = (nextFocusScope: EditorFocusScope | null) => {
    beginDesignSelectionChange();
    setSelectedUnitIds([]);
    setFocusScope(nextFocusScope);
    setSelectedArtObjectIds(nextFocusScope ? [nextFocusScope.artObjectId] : []);
  };

  const enterSvgDiveMode = (artObjectId: string) => {
    if (!selectionIndexes[artObjectId]) {
      return;
    }

    activateFocusScope({
      artObjectId,
      scopeNodeId: null,
    });
  };

  const drillIntoElement = (artObjectId: string, elementId: string) => {
    const index = selectionIndexes[artObjectId];
    if (!index) {
      return false;
    }

    const nextFocusScope = findDrilldownFocusScope(
      index,
      focusScope?.artObjectId === artObjectId ? focusScope.scopeNodeId : null,
      elementId,
    );
    if (nextFocusScope) {
      activateFocusScope(nextFocusScope);
      return true;
    }

    return false;
  };

  const focusTreeScope = (artObjectId: string, scopeNodeId: string) => {
    const index = selectionIndexes[artObjectId];
    if (!index || !isScopeNodeIdValid(index, scopeNodeId)) {
      return;
    }

    activateFocusScope({
      artObjectId,
      scopeNodeId,
    });
  };

  const exitSvgDiveMode = () => {
    if (!focusScope) {
      return;
    }

    beginDesignSelectionChange();
    setSelectedArtObjectIds([focusScope.artObjectId]);
    setSelectedUnitIds([]);
    setFocusScope(null);
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
    if (lastDesignSelection) {
      setSurfaceMode(lastDesignSelection.surfaceMode);
      setSelectedArtObjectIds(lastDesignSelection.selectedArtObjectIds);
      setSelectedUnitIds(lastDesignSelection.selectedUnitIds);
      setFocusScope(lastDesignSelection.focusScope);
      setInteractionMode(lastDesignSelection.interactionMode);
      return;
    }

    setSurfaceMode("design");
  };

  const updateAssignmentsForIds = (
    elementIds: string[],
    patch: Partial<Pick<ElementAssignment, "targetDepthMm" | "fillMode" | "engraveType">>,
  ) => {
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
    if (Number.isFinite(value)) {
      updateAssignmentsForIds(elementIds, { targetDepthMm: value });
    }
  };

  const changeBatchFillMode = (elementIds: string[], value: FillMode) => {
    updateAssignmentsForIds(elementIds, {
      fillMode: value,
      engraveType: fillModeToEngraveType(value),
    });
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
    const scopedElementIds = elementIds.filter((elementId) => splitCompositeOwner(elementId) === artObjectId);

    beginDesignSelectionChange();
    setSelectedArtObjectIds([artObjectId]);
    setSelectedUnitIds(scopedElementIds);
    setFocusScope(null);
  };

  const handleThickenRoutingChange = useCallback((groupKey: string, value: boolean) => {
    setOperationOverrides((prev) => ({
      ...prev,
      [groupKey]: { ...prev[groupKey], allowThickenRouting: value },
    }));
  }, []);

  const handleMakePath = async () => {
    if (!generationInput || !generationInputSignature) {
      return;
    }

    const unsupportedTypes = collectUnsupportedEngraveTypes(artObjects);
    if (unsupportedTypes.length > 0) {
      setError(`Unsupported engrave types for GCODE generation: ${unsupportedTypes.join(", ")}.`);
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

  const hasGeneratedGcode = !!generated;
  const hasOutdatedGcode = hasGeneratedGcode && generationInputSignature !== lastGeneratedInputSignature;
  const isPreviewReady = hasGeneratedGcode && !hasOutdatedGcode;
  const canProcessGcode = !!generationInput;
  const processLabel = !hasGeneratedGcode ? "Make GCODE" : hasOutdatedGcode ? "Update GCODE" : "GCODE Ready";
  const processDisabled = isGenerating || !isReady || !canProcessGcode || isPreviewReady;
  const exportDisabled = !isPreviewReady || isGenerating;

  return {
    fileInputRef,
    settings,
    artObjects,
    hoveredLayerIds,
    setHoveredLayerIds,
    generated,
    generatedOperationsSnapshot,
    error,
    showPreviewBlockedNotice,
    activeTab,
    setActiveTab,
    inspectorTab,
    selection,
    clearSelection,
    isDiveMode,
    activeDiveRoot,
    focusScope,
    interactionMode,
    setInteractionMode,
    effectiveInteractionMode,
    selectedUnitIds,
    modifierDirectPick,
    designActiveProfileKey,
    showOperationOutlines,
    setShowOperationOutlines,
    projectName,
    setProjectName,
    materialPreset,
    defaultEngraveType,
    activeArtObject,
    selectedArtObjects,
    derivedOperations,
    allProfileGroups,
    inspectorContext,
    paddingValidationMessage,
    machining,
    handleSvgImport,
    handleFileDrop,
    handlePlacementChange,
    handleArtObjectPlacementChange,
    handleArtObjectSizeChange,
    handleArtObjectsTransformChange,
    handleSvgDimensionChange,
    handleSvgAspectLockChange,
    handleAlign,
    handleDistribute,
    selectMaterial,
    selectArtObject,
    selectArtObjects,
    selectIds,
    focusTreeScope,
    enterSvgDiveMode,
    drillIntoElement,
    exitSvgDiveMode,
    handleInspectorTabChange,
    changeBatchDepth,
    changeBatchFillMode,
    handleProfilePreview,
    handleProfileSelect,
    operationOverrides,
    handleThickenRoutingChange,
    handleMakePath,
    downloadNc,
    notifyPreviewRequiresProcessing,
    isGenerating,
    isPreviewReady,
    processLabel,
    processDisabled,
    exportDisabled,
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

function getSelectionBounds(artObjects: ArtObject[]) {
  const left = Math.min(...artObjects.map((artObject) => artObject.placementX));
  const right = Math.max(...artObjects.map((artObject) => artObject.placementX + artObject.widthMm));
  const bottom = Math.min(...artObjects.map((artObject) => artObject.placementY));
  const top = Math.max(...artObjects.map((artObject) => artObject.placementY + artObject.heightMm));
  return {
    left,
    right,
    bottom,
    top,
    centerX: (left + right) / 2,
    centerY: (bottom + top) / 2,
  };
}

function getAlignedArtObjectPlacement(
  action: AlignmentAction,
  artObject: ArtObject,
  bounds: ReturnType<typeof getSelectionBounds>,
) {
  if (action === "left") {
    return { x: bounds.left, y: artObject.placementY };
  }
  if (action === "right") {
    return { x: bounds.right - artObject.widthMm, y: artObject.placementY };
  }
  if (action === "center-x") {
    return { x: bounds.centerX - artObject.widthMm / 2, y: artObject.placementY };
  }
  if (action === "bottom") {
    return { x: artObject.placementX, y: bounds.bottom };
  }
  if (action === "top") {
    return { x: artObject.placementX, y: bounds.top - artObject.heightMm };
  }
  return { x: artObject.placementX, y: bounds.centerY - artObject.heightMm / 2 };
}

function collectUnsupportedEngraveTypes(artObjects: ArtObject[]) {
  const unsupported = new Set<string>();
  for (const artObject of artObjects) {
    for (const assignment of Object.values(artObject.elementAssignments)) {
      if (assignment.engraveType && !isSupportedEngraveType(assignment.engraveType)) {
        unsupported.add(engraveTypeLabel(assignment.engraveType));
      }
    }
  }
  return Array.from(unsupported);
}

function roundMm(value: number) {
  return Math.round(value * 100) / 100;
}
