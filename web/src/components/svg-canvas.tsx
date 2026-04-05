import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Button } from "@heroui/react";
import { Group, Layer, Rect, Stage, Transformer } from "react-konva";
import { LocationArrowFill } from "@gravity-ui/icons";

import { SvgHitLayer } from "@/components/svg-hit-layer";
import { useSvgCanvasController } from "@/components/use-svg-canvas-controller";
import { buildCompositeElementId, withCompositeElementIds } from "@/lib/art-objects";
import { AppIcon, type AppIconComponent, Icons } from "@/lib/icons";
import { MATERIAL_PRESETS, type MaterialPresetId } from "@/lib/material-presets";
import type {
  ArtObject,
  DiveRootScope,
  EditorInteractionMode,
  EditorSelection,
  FrontendOperation,
  SvgTreeNode,
} from "@/lib/types";
import { clamp, cn } from "@/lib/utils";

type CanvasBox = { x: number; y: number; width: number; height: number };
type CanvasToolMode = "default" | "pan";
type MarqueeRect = { left: number; top: number; width: number; height: number };
type GroupBoundsOverlay = { id: string; left: number; top: number; width: number; height: number };

interface SvgCanvasProps {
  artObjects: ArtObject[];
  operations: FrontendOperation[];
  selection: EditorSelection;
  hoveredIds?: string[];
  activeOperationId: string | null;
  activeProfileKey: string | null;
  isDiveMode: boolean;
  activeDiveRoot: DiveRootScope | null;
  modifierDirectPick: boolean;
  showOperationOutlines: boolean;
  materialWidth?: number;
  materialHeight?: number;
  paddingMm: number;
  paddingValidationMessage: string | null;
  materialPreset: MaterialPresetId;
  interactionMode: EditorInteractionMode;
  onInteractionModeChange: (mode: EditorInteractionMode) => void;
  onClearSelection: () => void;
  onSelectIds: (artObjectId: string, ids: string[], additive: boolean) => void;
  onSelectArtObject: (artObjectId: string) => void;
  onSelectArtObjects: (artObjectIds: string[], additive: boolean) => void;
  onEnterSvgDiveMode: (artObjectId: string) => void;
  onDrillIntoElement: (artObjectId: string, elementId: string) => boolean;
  onExitSvgDiveMode: () => void;
  onImportClick?: () => void;
  onMaterialSizeChange?: (dimension: "width" | "height", value: number | null) => void;
  onArtObjectPlacementChange?: (artObjectId: string, x: number, y: number) => void;
  onArtObjectSizeChange?: (artObjectId: string, width: number | null, height: number | null) => void;
  onArtObjectsTransformChange?: (
    transforms: { artObjectId: string; x: number; y: number; width: number; height: number }[],
  ) => void;
  onShowOperationOutlinesChange?: (value: boolean) => void;
}

export function SvgCanvas({
  artObjects,
  operations,
  selection,
  hoveredIds = [],
  activeOperationId,
  activeProfileKey,
  isDiveMode,
  activeDiveRoot,
  modifierDirectPick,
  showOperationOutlines,
  materialWidth = 300,
  materialHeight = 300,
  paddingMm,
  paddingValidationMessage,
  materialPreset,
  interactionMode,
  onInteractionModeChange,
  onClearSelection,
  onSelectIds,
  onSelectArtObject,
  onSelectArtObjects,
  onEnterSvgDiveMode,
  onDrillIntoElement,
  onExitSvgDiveMode,
  onImportClick,
  onMaterialSizeChange,
  onArtObjectPlacementChange,
  onArtObjectSizeChange,
  onArtObjectsTransformChange,
  onShowOperationOutlinesChange,
}: SvgCanvasProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const artboardRef = useRef<Konva.Rect | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const artObjectRectRefs = useRef<Record<string, Konva.Rect | null>>({});
  const hitLayerHostRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [liveMaterialBox, setLiveMaterialBox] = useState<CanvasBox | null>(null);
  const [liveArtObjectBoxes, setLiveArtObjectBoxes] = useState<Record<string, CanvasBox>>({});
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [marqueeHoverIds, setMarqueeHoverIds] = useState<string[]>([]);
  const [canvasToolMode, setCanvasToolMode] = useState<CanvasToolMode>("default");
  const [groupBoundsOverlays, setGroupBoundsOverlays] = useState<GroupBoundsOverlay[]>([]);
  const [isZoomEditing, setIsZoomEditing] = useState(false);
  const [zoomDraft, setZoomDraft] = useState("");
  const zoomInputRef = useRef<HTMLInputElement | null>(null);
  const marqueeRectRef = useRef<MarqueeRect | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const didMarqueeDragRef = useRef(false);
  const justFinishedMarqueeRef = useRef(false);
  const suppressHitLayerClickRef = useRef(false);
  const dragStartPositionsRef = useRef<Record<string, CanvasBox>>({});
  const materialTexture = MATERIAL_PRESETS[materialPreset].texture;
  const textureImage = useImageAsset(materialTexture);

  const fitToken = useMemo(
    () => artObjects.map((artObject) => `${artObject.id}:${artObject.widthMm}:${artObject.heightMm}:${artObject.placementX}:${artObject.placementY}`).join("|"),
    [artObjects],
  );
  const {
    viewportRef,
    viewportSize,
    zoom,
    pan,
    hoverTarget,
    isPanning,
    spacePressed,
    toViewportRect,
    setHoverTarget,
    setPan,
    fitView,
    zoomAtPoint,
    setAbsoluteZoom,
    handleWheel,
    handleViewportMouseDown,
  } = useSvgCanvasController({
    hasContent: artObjects.length > 0,
    fitToken,
    materialWidth,
    materialHeight,
    panToolActive: canvasToolMode === "pan",
    onClearSelection,
  });

  const operationForId = useMemo(() => {
    const map = new Map<string, FrontendOperation>();
    for (const operation of operations) {
      for (const id of operation.assigned_element_ids) {
        map.set(id, operation);
      }
    }
    return map;
  }, [operations]);

  const selectedArtObjectId =
    selection.type === "art-object" || selection.type === "elements" ? selection.artObjectId : null;
  const selectedArtObjectIds = useMemo(() => {
    if (selection.type === "art-object") {
      return [selection.artObjectId];
    }
    if (selection.type === "art-objects") {
      return selection.artObjectIds;
    }
    if (selection.type === "elements") {
      return [selection.artObjectId];
    }
    return [];
  }, [selection]);
  const selectedArtObject = selectedArtObjectId
    ? artObjects.find((artObject) => artObject.id === selectedArtObjectId) ?? null
    : null;
  const selectedDraggableArtObjectIds = useMemo(() => {
    if (selection.type === "art-object") {
      return [selection.artObjectId];
    }
    if (selection.type === "art-objects") {
      return selection.artObjectIds;
    }
    return [];
  }, [selection]);
  const directPickEnabled = modifierDirectPick || interactionMode === "direct";
  const panToolActive = canvasToolMode === "pan";

  useEffect(() => {
    if (!isZoomEditing) {
      return;
    }

    const input = zoomInputRef.current;
    if (!input) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isZoomEditing]);

  const materialBox = liveMaterialBox ?? { x: 0, y: 0, width: materialWidth, height: materialHeight };
  const artObjectBoxes = useMemo(
    () =>
      Object.fromEntries(
        artObjects.map((artObject) => {
          const liveBox =
            liveArtObjectBoxes[artObject.id] ?? null;
          const box =
            liveBox ?? {
              x: artObject.placementX,
              y: materialHeight - artObject.placementY - artObject.heightMm,
              width: artObject.widthMm,
              height: artObject.heightMm,
            };
          return [artObject.id, box];
        }),
      ),
    [artObjects, liveArtObjectBoxes, materialHeight],
  );

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    if (selection.type === "material" && artboardRef.current) {
      transformer.nodes([artboardRef.current]);
    } else if (selection.type === "art-objects") {
      const nodes = selection.artObjectIds
        .map((artObjectId) => artObjectRectRefs.current[artObjectId])
        .filter((node): node is Konva.Rect => Boolean(node));
      transformer.nodes(nodes);
    } else if (selectedArtObjectId) {
      const node = artObjectRectRefs.current[selectedArtObjectId];
      transformer.nodes(node ? [node] : []);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [selectedArtObjectId, selection]);

  useEffect(() => {
    if (!isDiveMode) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onExitSvgDiveMode();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDiveMode, onExitSvgDiveMode]);

  useEffect(() => {
    if (!showOperationOutlines) {
      const frameId = window.requestAnimationFrame(() => {
        setGroupBoundsOverlays([]);
      });
      return () => window.cancelAnimationFrame(frameId);
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setGroupBoundsOverlays(
        collectGroupBoundsOverlays({
          artObjects,
          hosts: hitLayerHostRefs.current,
          viewport,
        }),
      );
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [
    artObjects,
    isDiveMode,
    liveArtObjectBoxes,
    liveMaterialBox,
    pan.x,
    pan.y,
    selection,
    showOperationOutlines,
    viewportRef,
    viewportSize.height,
    viewportSize.width,
    zoom,
  ]);

  const beginViewportMarquee = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const bounds = viewport.getBoundingClientRect();
      const origin = {
        x: clientX - bounds.left,
        y: clientY - bounds.top,
      };

      marqueeStartRef.current = origin;
      didMarqueeDragRef.current = false;
      justFinishedMarqueeRef.current = false;
      marqueeRectRef.current = {
        left: origin.x,
        top: origin.y,
        width: 0,
        height: 0,
      };
      setMarqueeRect(marqueeRectRef.current);
    },
    [viewportRef],
  );

  const handleArtObjectSelect = useCallback(
    (artObjectId: string) => {
      if (panToolActive) {
        return;
      }
      onSelectArtObject(artObjectId);
    },
    [onSelectArtObject, panToolActive],
  );

  const handlePartClick = useCallback(
    (artObjectId: string) => (event: MouseEvent) => {
      if (panToolActive) {
        return;
      }
      if (suppressHitLayerClickRef.current) {
        suppressHitLayerClickRef.current = false;
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const selectable = target.closest("[data-s2g-id]");
      if (!(selectable instanceof SVGElement)) {
        return;
      }
      const id = selectable.getAttribute("data-s2g-id");
      if (!id) {
        return;
      }

      event.stopPropagation();

      if (!isDiveMode && !directPickEnabled && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
        onSelectArtObject(artObjectId);
        return;
      }

      onSelectIds(artObjectId, [id], event.metaKey || event.ctrlKey || event.shiftKey);
    },
    [directPickEnabled, isDiveMode, onSelectArtObject, onSelectIds, panToolActive],
  );

  const handlePartDoubleClick = useCallback(
    (artObjectId: string) => (event: MouseEvent) => {
      if (directPickEnabled || panToolActive) {
        return;
      }
      event.stopPropagation();

      const target = event.target;
      const selectable = target instanceof Element ? target.closest("[data-s2g-id]") : null;
      const hitElementId = selectable?.getAttribute("data-s2g-id") ?? null;

      if (hitElementId && onDrillIntoElement(artObjectId, hitElementId)) {
        return;
      }

      if (!isDiveMode) {
        onEnterSvgDiveMode(artObjectId);
        return;
      }

      if (selectedArtObjectId !== artObjectId) {
        onEnterSvgDiveMode(artObjectId);
      }
    },
    [directPickEnabled, isDiveMode, onDrillIntoElement, onEnterSvgDiveMode, panToolActive, selectedArtObjectId],
  );

  const startMarquee = useCallback(
    (artObjectId: string, origin: { x: number; y: number }, additive: boolean, minDragPx = 0) => {
      let currentRect = { left: origin.x, top: origin.y, width: 0, height: 0 };
      setMarqueeRect(currentRect);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const viewport = viewportRef.current;
        if (!viewport) {
          return;
        }
        const bounds = viewport.getBoundingClientRect();
        currentRect = normalizeMarquee(origin, {
          x: moveEvent.clientX - bounds.left,
          y: moveEvent.clientY - bounds.top,
        });
        setMarqueeRect(currentRect);
        setMarqueeHoverIds(
          collectIntersectingSvgIds(hitLayerHostRefs.current[artObjectId], viewport, currentRect),
        );
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        const didDrag = currentRect.width >= minDragPx || currentRect.height >= minDragPx;
        const intersectingIds = didDrag
          ? collectIntersectingSvgIds(hitLayerHostRefs.current[artObjectId], viewportRef.current, currentRect)
          : [];
        setMarqueeRect(null);
        setMarqueeHoverIds([]);

        if (intersectingIds.length > 0) {
          onSelectIds(artObjectId, intersectingIds, additive);
        } else if (!additive && didDrag) {
          onClearSelection();
        }
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [onClearSelection, onSelectIds, viewportRef],
  );

  const handleStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (spacePressed || panToolActive || isDiveMode || event.evt.button !== 0) {
        return;
      }
      const stage = event.target.getStage();
      const targetName = typeof event.target.name === "function" ? event.target.name() : "";
      if (!stage || (event.target !== stage && targetName !== "artboard-base")) {
        return;
      }
      beginViewportMarquee(event.evt.clientX, event.evt.clientY);
    },
    [beginViewportMarquee, isDiveMode, panToolActive, spacePressed],
  );

  const handleStageMouseMove = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (!marqueeStartRef.current || spacePressed || panToolActive) {
        return;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
      const bounds = viewport.getBoundingClientRect();
      const next = normalizeMarquee(marqueeStartRef.current, {
        x: event.evt.clientX - bounds.left,
        y: event.evt.clientY - bounds.top,
      });
      marqueeRectRef.current = next;
      setMarqueeRect(next);
      didMarqueeDragRef.current = next.width >= 3 || next.height >= 3;
    },
    [panToolActive, spacePressed, viewportRef],
  );

  const handleStageMouseUp = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (!marqueeStartRef.current) {
        return;
      }

      const currentRect = marqueeRectRef.current;
      const additive = event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey;
      marqueeStartRef.current = null;

      if (!didMarqueeDragRef.current || !currentRect) {
        marqueeRectRef.current = null;
        setMarqueeRect(null);
        return;
      }

      const intersectingIds = artObjects
        .filter((artObject) => {
          const box = artObjectBoxes[artObject.id];
          const viewportRect = box ? toViewportRect(box) : null;
          if (!viewportRect) {
            return false;
          }
          return (
            viewportRect.left + viewportRect.width >= currentRect.left &&
            viewportRect.left <= currentRect.left + currentRect.width &&
            viewportRect.top + viewportRect.height >= currentRect.top &&
            viewportRect.top <= currentRect.top + currentRect.height
          );
        })
        .map((artObject) => artObject.id);

      marqueeRectRef.current = null;
      setMarqueeRect(null);
      didMarqueeDragRef.current = false;

      if (intersectingIds.length > 0) {
        onSelectArtObjects(intersectingIds, additive);
      } else if (!additive) {
        onClearSelection();
      }
      justFinishedMarqueeRef.current = true;
    },
    [artObjectBoxes, artObjects, onClearSelection, onSelectArtObjects, toViewportRect],
  );

  const handleStageClick = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (spacePressed || panToolActive) {
        return;
      }
      if (justFinishedMarqueeRef.current) {
        justFinishedMarqueeRef.current = false;
        return;
      }
      const stage = event.target.getStage();
      if (!stage || event.target !== stage) {
        return;
      }
      onClearSelection();
    },
    [onClearSelection, panToolActive, spacePressed],
  );

  const handleArtObjectDragStart = useCallback(
    (artObjectId: string) => {
      const ids = selectedDraggableArtObjectIds.includes(artObjectId)
        ? selectedDraggableArtObjectIds
        : [artObjectId];
      const nextPositions: Record<string, CanvasBox> = {};
      ids.forEach((id) => {
        const node = artObjectRectRefs.current[id];
        if (!node) {
          return;
        }
        nextPositions[id] = normalizeRectNode(node);
      });
      dragStartPositionsRef.current = nextPositions;
      setLiveArtObjectBoxes(nextPositions);
    },
    [selectedDraggableArtObjectIds],
  );

  const handleArtObjectDragMove = useCallback(
    (artObjectId: string) => {
      const node = artObjectRectRefs.current[artObjectId];
      if (!node) {
        return;
      }

      const start = dragStartPositionsRef.current[artObjectId];
      if (!start) {
        return;
      }

      const ids = Object.keys(dragStartPositionsRef.current);
      const desiredDx = node.x() - start.x;
      const desiredDy = node.y() - start.y;

      const clampedDelta = ids.reduce(
        (result, id) => {
          const box = dragStartPositionsRef.current[id];
          if (!box) {
            return result;
          }
          return {
            dx: clamp(
              result.dx,
              -box.x,
              materialWidth - box.width - box.x,
            ),
            dy: clamp(
              result.dy,
              -box.y,
              materialHeight - box.height - box.y,
            ),
          };
        },
        { dx: desiredDx, dy: desiredDy },
      );

      const nextBoxes: Record<string, CanvasBox> = {};
      ids.forEach((id) => {
        const startBox = dragStartPositionsRef.current[id];
        const rectNode = artObjectRectRefs.current[id];
        if (!startBox || !rectNode) {
          return;
        }
        const nextBox = {
          ...startBox,
          x: startBox.x + clampedDelta.dx,
          y: startBox.y + clampedDelta.dy,
        };
        syncRectNode(rectNode, nextBox);
        nextBoxes[id] = nextBox;
      });
      setLiveArtObjectBoxes(nextBoxes);
    },
    [materialHeight, materialWidth],
  );

  const handleArtObjectDragEnd = useCallback(
    (artObjectId: string) => {
      const node = artObjectRectRefs.current[artObjectId];
      if (!node) {
        return;
      }

      const draggedIds = Object.keys(dragStartPositionsRef.current);
      const nextBoxes = draggedIds.length > 0 ? draggedIds : [artObjectId];
      nextBoxes.forEach((id) => {
        const rectNode = artObjectRectRefs.current[id];
        if (!rectNode) {
          return;
        }
        const box = normalizeRectNode(rectNode);
        onArtObjectPlacementChange?.(id, roundMm(box.x), roundMm(materialHeight - box.y - box.height));
      });
      dragStartPositionsRef.current = {};
      setLiveArtObjectBoxes({});
    },
    [materialHeight, onArtObjectPlacementChange],
  );

  const handleHitLayerMouseDown = useCallback(
    (artObjectId: string) => (event: MouseEvent) => {
      if (spacePressed || panToolActive || event.button !== 0) {
        return;
      }

      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const bounds = viewport.getBoundingClientRect();
      const origin = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      const additive = event.metaKey || event.ctrlKey || event.shiftKey;
      const canDragSelectedArtObject =
        !isDiveMode &&
        !directPickEnabled &&
        !additive &&
        selectedDraggableArtObjectIds.includes(artObjectId);

      if (canDragSelectedArtObject) {
        let dragging = false;

        const handleMouseMove = (moveEvent: MouseEvent) => {
          const nextViewport = viewportRef.current;
          if (!nextViewport) {
            return;
          }

          const nextBounds = nextViewport.getBoundingClientRect();
          const current = {
            x: moveEvent.clientX - nextBounds.left,
            y: moveEvent.clientY - nextBounds.top,
          };
          const dxPx = current.x - origin.x;
          const dyPx = current.y - origin.y;

          if (!dragging) {
            if (Math.abs(dxPx) < 3 && Math.abs(dyPx) < 3) {
              return;
            }
            dragging = true;
            suppressHitLayerClickRef.current = true;
            handleArtObjectDragStart(artObjectId);
          }

          moveEvent.preventDefault();

          const desiredDx = dxPx / zoom;
          const desiredDy = dyPx / zoom;
          const ids = Object.keys(dragStartPositionsRef.current);
          const clampedDelta = ids.reduce(
            (result, id) => {
              const box = dragStartPositionsRef.current[id];
              if (!box) {
                return result;
              }
              return {
                dx: clamp(result.dx, -box.x, materialWidth - box.width - box.x),
                dy: clamp(result.dy, -box.y, materialHeight - box.height - box.y),
              };
            },
            { dx: desiredDx, dy: desiredDy },
          );

          const nextBoxes: Record<string, CanvasBox> = {};
          ids.forEach((id) => {
            const startBox = dragStartPositionsRef.current[id];
            const rectNode = artObjectRectRefs.current[id];
            if (!startBox || !rectNode) {
              return;
            }
            const nextBox = {
              ...startBox,
              x: startBox.x + clampedDelta.dx,
              y: startBox.y + clampedDelta.dy,
            };
            syncRectNode(rectNode, nextBox);
            nextBoxes[id] = nextBox;
          });
          setLiveArtObjectBoxes(nextBoxes);
        };

        const handleMouseUp = () => {
          window.removeEventListener("mousemove", handleMouseMove);
          window.removeEventListener("mouseup", handleMouseUp);
          if (!dragging) {
            return;
          }
          handleArtObjectDragEnd(artObjectId);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return;
      }

      if (!isDiveMode && !directPickEnabled) {
        return;
      }

      const target = event.target;
      if (
        selection.type === "elements" &&
        selection.artObjectId === artObjectId &&
        target instanceof Element
      ) {
        const selectable = target.closest("[data-s2g-id]");
        const id = selectable?.getAttribute("data-s2g-id");
        if (id && selection.elementIds.includes(id)) {
          return;
        }
      }

      event.preventDefault();
      startMarquee(artObjectId, origin, additive, 3);
    },
    [
      directPickEnabled,
      handleArtObjectDragEnd,
      handleArtObjectDragStart,
      isDiveMode,
      materialHeight,
      materialWidth,
      panToolActive,
      selection,
      selectedDraggableArtObjectIds,
      spacePressed,
      startMarquee,
      viewportRef,
      zoom,
    ],
  );

  const handleTransformEnd = useCallback(() => {
    const transformer = transformerRef.current;
    const nodes = transformer?.nodes() ?? [];
    if (nodes.length === 0) {
      return;
    }

    if (selection.type === "material" && artboardRef.current) {
      const normalized = normalizeRectNode(artboardRef.current);
      syncRectNode(artboardRef.current, { x: 0, y: 0, width: normalized.width, height: normalized.height });
      setLiveMaterialBox({ x: 0, y: 0, width: normalized.width, height: normalized.height });
      setPan((current) => ({
        x: current.x + normalized.x * zoom,
        y: current.y + normalized.y * zoom,
      }));
      onMaterialSizeChange?.("width", roundMm(normalized.width));
      onMaterialSizeChange?.("height", roundMm(normalized.height));
      return;
    }

    if (selection.type === "art-objects") {
      const transforms = selection.artObjectIds
        .map((artObjectId) => {
          const rectNode = artObjectRectRefs.current[artObjectId];
          if (!rectNode) {
            return null;
          }
          const normalized = normalizeRectNode(rectNode);
          return {
            artObjectId,
            x: roundMm(normalized.x),
            y: roundMm(materialHeight - normalized.y - normalized.height),
            width: roundMm(normalized.width),
            height: roundMm(normalized.height),
          };
        })
        .filter((value): value is { artObjectId: string; x: number; y: number; width: number; height: number } => Boolean(value));
      setLiveArtObjectBoxes({});
      onArtObjectsTransformChange?.(transforms);
      return;
    }

    if (!selectedArtObjectId) {
      return;
    }

    const rectNode = artObjectRectRefs.current[selectedArtObjectId];
    if (!rectNode) {
      return;
    }

    const normalized = normalizeRectNode(rectNode);
    setLiveArtObjectBoxes({});
    onArtObjectPlacementChange?.(
      selectedArtObjectId,
      roundMm(normalized.x),
      roundMm(materialHeight - normalized.y - normalized.height),
    );
    onArtObjectSizeChange?.(selectedArtObjectId, roundMm(normalized.width), roundMm(normalized.height));
  }, [
    materialHeight,
    onArtObjectsTransformChange,
    onArtObjectPlacementChange,
    onArtObjectSizeChange,
    onMaterialSizeChange,
    selectedArtObjectId,
    selection,
    setPan,
    zoom,
  ]);

  const beginZoomEdit = useCallback(() => {
    setZoomDraft(String(Math.round(zoom * 100)));
    setIsZoomEditing(true);
  }, [zoom]);

  const cancelZoomEdit = useCallback(() => {
    setIsZoomEditing(false);
    setZoomDraft("");
  }, []);

  const applyZoomDraft = useCallback(() => {
    const normalized = zoomDraft.replace(",", ".").trim();
    if (!normalized) {
      cancelZoomEdit();
      return;
    }

    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      cancelZoomEdit();
      return;
    }

    setAbsoluteZoom(parsed / 100);
    setIsZoomEditing(false);
    setZoomDraft("");
  }, [cancelZoomEdit, setAbsoluteZoom, zoomDraft]);

  const transformerBoundBox = useCallback(
    (
      oldBox: { x: number; y: number; width: number; height: number; rotation: number },
      newBox: { x: number; y: number; width: number; height: number; rotation: number },
    ) => {
      // boundBoxFunc receives/returns absolute screen pixel coordinates.
      // Convert to mm for constraint math, then convert the result back to pixels.
      const toMm = (px: number) => px / zoom;
      const toPx = (mm: number) => mm * zoom;
      const toMmX = (px: number) => (px - pan.x) / zoom;
      const toMmY = (px: number) => (px - pan.y) / zoom;
      const toPxX = (mm: number) => mm * zoom + pan.x;
      const toPxY = (mm: number) => mm * zoom + pan.y;

      if (selection.type === "material" || selection.type === "art-objects") {
        return {
          ...newBox,
          width: Math.max(newBox.width, toPx(paddingMm * 2 + 1)),
          height: Math.max(newBox.height, toPx(paddingMm * 2 + 1)),
          rotation: 0,
        };
      }

      if (!selectedArtObject) {
        return oldBox;
      }

      const oldWidthMm = Math.max(1, toMm(Math.abs(oldBox.width)));
      const oldHeightMm = Math.max(1, toMm(Math.abs(oldBox.height)));
      const widthMm = Math.max(1, toMm(Math.abs(newBox.width)));
      const heightMm = Math.max(1, toMm(Math.abs(newBox.height)));
      const anchoredLeft = Math.abs(newBox.x - oldBox.x) > 0.5;
      const anchoredTop = Math.abs(newBox.y - oldBox.y) > 0.5;
      const oldXMm = toMmX(oldBox.x);
      const oldYMm = toMmY(oldBox.y);

      if (selectedArtObject.aspectLocked) {
        const dominant = Math.max(widthMm / oldWidthMm, heightMm / oldHeightMm);
        const nextWidth = clamp(
          oldWidthMm * dominant,
          1,
          Math.min(materialWidth, materialHeight * selectedArtObject.svgMetrics.aspectRatio),
        );
        const nextHeight = nextWidth / selectedArtObject.svgMetrics.aspectRatio;
        const maxXMm = materialWidth - nextWidth;
        const maxYMm = materialHeight - nextHeight;
        const nextXMm = clamp(
          anchoredLeft ? oldXMm + oldWidthMm - nextWidth : oldXMm,
          0,
          Math.max(0, maxXMm),
        );
        const nextYMm = clamp(
          anchoredTop ? oldYMm + oldHeightMm - nextHeight : oldYMm,
          0,
          Math.max(0, maxYMm),
        );
        return {
          x: toPxX(nextXMm),
          y: toPxY(nextYMm),
          width: toPx(nextWidth),
          height: toPx(nextHeight),
          rotation: 0,
        };
      }

      const nextWidthMm = clamp(widthMm, 1, materialWidth);
      const nextHeightMm = clamp(heightMm, 1, materialHeight);
      const maxXMm = materialWidth - nextWidthMm;
      const maxYMm = materialHeight - nextHeightMm;
      const nextXMm = clamp(
        anchoredLeft ? oldXMm + oldWidthMm - nextWidthMm : oldXMm,
        0,
        Math.max(0, maxXMm),
      );
      const nextYMm = clamp(
        anchoredTop ? oldYMm + oldHeightMm - nextHeightMm : oldYMm,
        0,
        Math.max(0, maxYMm),
      );

      return {
        x: toPxX(nextXMm),
        y: toPxY(nextYMm),
        width: toPx(nextWidthMm),
        height: toPx(nextHeightMm),
        rotation: 0,
      };
    },
    [materialHeight, materialWidth, paddingMm, pan, selectedArtObject, selection.type, zoom],
  );

  return (
    <div
      ref={viewportRef}
      className={cn(
        "relative h-full w-full overflow-hidden bg-background",
        isPanning ? "cursor-grabbing" : spacePressed || panToolActive ? "cursor-grab" : "cursor-default",
      )}
      onMouseDown={handleViewportMouseDown}
      onWheel={handleWheel}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:32px_32px]" />

      {artObjects.length === 0 || !viewportSize.width || !viewportSize.height ? (
        <div className="relative flex h-full items-center justify-center px-6">
          <div className="max-w-sm rounded-[1.35rem] border border-white/10 bg-[#0b1020]/88 px-6 py-5 text-center shadow-[0_24px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <p className="text-sm leading-relaxed text-slate-200">
              Drag and drop SVGs onto the canvas, or use the button below to add them.
            </p>
            <Button className="mt-4 h-10 w-full justify-center text-white" size="sm" variant="secondary" onPress={onImportClick}>
              <AppIcon icon={Icons.fileUpload} className="h-4 w-4" />
              Add files (SVG)
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Stage
            ref={stageRef}
            className="absolute inset-0"
            width={viewportSize.width}
            height={viewportSize.height}
            x={pan.x}
            y={pan.y}
            scaleX={zoom}
            scaleY={zoom}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onClick={handleStageClick}
          >
            <Layer>
              <Rect
                ref={artboardRef}
                name="artboard-base"
                x={materialBox.x}
                y={materialBox.y}
                width={materialBox.width}
                height={materialBox.height}
                fill={isDiveMode ? "rgba(40, 28, 18, 0.65)" : "#6a4b33"}
                cornerRadius={2 / zoom}
                stroke={selection.type === "material" ? "#73bbff" : "rgba(132, 94, 62, 0.55)"}
                strokeWidth={selection.type === "material" ? 1.4 / zoom : 1 / zoom}
                listening
                onClick={() => {
                  if (justFinishedMarqueeRef.current) {
                    justFinishedMarqueeRef.current = false;
                    return;
                  }
                  onClearSelection();
                }}
                onMouseEnter={() => setHoverTarget("material")}
                onMouseLeave={() => setHoverTarget((current) => (current === "material" ? null : current))}
              />
              {textureImage ? (
                <Rect
                  x={materialBox.x}
                  y={materialBox.y}
                  width={materialBox.width}
                  height={materialBox.height}
                  fillPatternImage={textureImage}
                  fillPatternRepeat="repeat"
                  fillPatternScale={{ x: 0.11, y: 0.11 }}
                  opacity={isDiveMode ? 0.35 : 0.55}
                  listening={false}
                />
              ) : null}
              {paddingMm > 0 && selection.type === "material" ? (
                <Rect
                  x={paddingMm}
                  y={paddingMm}
                  width={Math.max(0, materialBox.width - paddingMm * 2)}
                  height={Math.max(0, materialBox.height - paddingMm * 2)}
                  stroke={paddingValidationMessage ? "rgba(245,158,11,0.92)" : "rgba(115,187,255,0.45)"}
                  strokeWidth={1 / zoom}
                  dash={[2 / zoom, 4 / zoom]}
                  listening={false}
                />
              ) : null}

              {artObjects.map((artObject) => {
                // Use committed artObject coordinates (not liveArtObjectBox) for the
                // Konva Rect's x/y props.  If we used liveArtObjectBox here, every
                // setLiveArtObjectBox call during drag would trigger a React-Konva
                // reconciliation that writes node.x()/node.y(), overwriting Konva's
                // internal drag offset and causing the drag to drop after a few px.
                const rectX = artObject.placementX;
                const rectY = materialHeight - artObject.placementY - artObject.heightMm;
                const rectW = artObject.widthMm;
                const rectH = artObject.heightMm;
                const selected = selectedArtObjectIds.includes(artObject.id);
                return (
                  <Group key={artObject.id}>
                    <Rect
                      ref={(node) => {
                        artObjectRectRefs.current[artObject.id] = node;
                      }}
                      x={rectX}
                      y={rectY}
                      width={rectW}
                      height={rectH}
                      fill="transparent"
                      stroke={selected || hoverTarget === "art-object" ? "rgba(115,187,255,0.95)" : "rgba(115,187,255,0.32)"}
                      strokeWidth={selected ? 1.35 / zoom : 1 / zoom}
                      dash={selected ? [6 / zoom, 4 / zoom] : [4 / zoom, 4 / zoom]}
                      draggable={selectedDraggableArtObjectIds.includes(artObject.id) && !isDiveMode && !directPickEnabled}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        const additive = event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey;
                        if (additive) {
                          onSelectArtObjects([artObject.id], true);
                          return;
                        }
                        handleArtObjectSelect(artObject.id);
                      }}
                      onDblClick={() => {
                        if (isDiveMode && selected) {
                          onExitSvgDiveMode();
                          return;
                        }
                        onEnterSvgDiveMode(artObject.id);
                      }}
                      onMouseEnter={() => {
                        if (!directPickEnabled) {
                          setHoverTarget("art-object");
                        }
                      }}
                      onMouseLeave={() => {
                        if (!directPickEnabled) {
                          setHoverTarget((current) => (current === "art-object" ? null : current));
                        }
                      }}
                      onDragStart={() => handleArtObjectDragStart(artObject.id)}
                      onDragMove={() => handleArtObjectDragMove(artObject.id)}
                      onDragEnd={() => handleArtObjectDragEnd(artObject.id)}
                    />
                  </Group>
                );
              })}

              <Transformer
                ref={transformerRef}
                rotateEnabled={false}
                flipEnabled={false}
                ignoreStroke
                enabledAnchors={[
                  "top-left",
                  "top-center",
                  "top-right",
                  "middle-left",
                  "middle-right",
                  "bottom-left",
                  "bottom-center",
                  "bottom-right",
                ]}
                anchorFill="#73bbff"
                anchorStroke="#ffffff"
                anchorStrokeWidth={1 / zoom}
                anchorCornerRadius={0}
                anchorSize={10 / zoom}
                borderStroke="#73bbff"
                borderStrokeWidth={1.25 / zoom}
                borderDash={[10 / zoom, 6 / zoom]}
                shouldOverdrawWholeArea
                boundBoxFunc={transformerBoundBox}
                onTransform={() => {
                  if (selection.type === "material" && artboardRef.current) {
                    setLiveMaterialBox(normalizeRectNode(artboardRef.current));
                    return;
                  }
                  if (selection.type === "art-object" && selectedArtObjectId) {
                    const node = artObjectRectRefs.current[selectedArtObjectId];
                    if (node) {
                      setLiveArtObjectBoxes({
                        [selectedArtObjectId]: normalizeRectNode(node),
                      });
                    }
                    return;
                  }
                  if (selection.type === "art-objects") {
                    const nextBoxes: Record<string, CanvasBox> = {};
                    selection.artObjectIds.forEach((artObjectId) => {
                      const node = artObjectRectRefs.current[artObjectId];
                      if (node) {
                        nextBoxes[artObjectId] = normalizeRectNode(node);
                      }
                    });
                    setLiveArtObjectBoxes(nextBoxes);
                  }
                }}
                onTransformEnd={handleTransformEnd}
              />
            </Layer>
          </Stage>

          {/* Focus mode darkening overlay — sits between non-focused and focused layers */}
          {isDiveMode ? (
            <div
              className="pointer-events-none absolute inset-0 z-[5] bg-black/50 transition-opacity duration-200"
            />
          ) : null}

          {artObjects.map((artObject) => {
            const box = artObjectBoxes[artObject.id];
            const rect = toViewportRect(box);
            if (!rect) {
              return null;
            }
            const artObjectElementIds = artObject.preparedSvg.selectable_element_ids.map(
              (elementId) => `${artObject.id}::${elementId}`,
            );
            const isFocused = isDiveMode && selectedArtObjectId === artObject.id;
            const isDimmed = isDiveMode && !isFocused;
            const interactiveIds =
              directPickEnabled
                ? artObjectElementIds
                : activeDiveRoot?.artObjectId === artObject.id
                ? activeDiveRoot.elementIds
                : isDiveMode && selectedArtObjectId === artObject.id
                  ? artObjectElementIds
                  : artObjectElementIds;
            const hitLayerInteractive = !panToolActive;

            return (
              <div
                key={`hit-wrapper-${artObject.id}`}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: isFocused ? 10 : 1,
                  opacity: isDimmed ? 0.15 : 1,
                  transition: "opacity 200ms ease",
                  pointerEvents: "none",
                }}
              >
                <SvgHitLayer
                  normalizedSvg={withCompositeElementIds(artObject.preparedSvg.normalized_svg, artObject.id)}
                  rect={rect}
                  selectedIds={selection.type === "elements" && selection.artObjectId === artObject.id ? selection.elementIds : []}
                  previewSelectedIds={[...hoveredIds, ...marqueeHoverIds]}
                  activeOperationId={activeOperationId}
                  activeProfileKey={activeProfileKey}
                  operationForId={operationForId}
                  showOperationOutlines={showOperationOutlines}
                  svgSelected={selectedArtObjectIds.includes(artObject.id)}
                  editMode={isFocused || directPickEnabled}
                  interactive={hitLayerInteractive}
                  interactiveIds={interactiveIds}
                  onHostReady={(host) => {
                    hitLayerHostRefs.current[artObject.id] = host;
                  }}
                  onClick={handlePartClick(artObject.id)}
                  onDoubleClick={handlePartDoubleClick(artObject.id)}
                  onMouseDown={handleHitLayerMouseDown(artObject.id)}
                />
              </div>
            );
          })}

          <div className="pointer-events-none absolute inset-x-0 bottom-7 z-20 flex justify-center px-6">
            <div className="pointer-events-auto flex items-center gap-2 rounded-[1.75rem] border border-white/10 bg-[rgba(19,19,23,0.9)] px-4 py-3 text-white shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className={interactionMode === "direct" ? "bg-white/[0.14] text-white" : "text-white/75"}
                onPress={() => onInteractionModeChange(interactionMode === "direct" ? "group" : "direct")}
              >
                <LocationArrowFill className="h-5 w-5" />
              </Button>
              <ToolbarButton
                icon={Icons.hand}
                active={canvasToolMode === "pan"}
                onClick={() => setCanvasToolMode((current) => (current === "pan" ? "default" : "pan"))}
              />
              <ToolbarButton
                icon={showOperationOutlines ? Icons.eye : Icons.eyeOff}
                active={showOperationOutlines}
                onClick={() => onShowOperationOutlinesChange?.(!showOperationOutlines)}
              />
              <div className="ml-2 flex items-center gap-3 rounded-[1.2rem] bg-white/[0.05] px-4 py-3">
                <button
                  className="text-white/72"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isZoomEditing) {
                      cancelZoomEdit();
                    }
                    zoomAtPoint(zoom / 1.15);
                  }}
                >
                  <AppIcon icon={Icons.minus} className="h-4 w-4" />
                </button>
                {isZoomEditing ? (
                  <div className="flex min-w-14 items-center justify-center text-[1.05rem] text-white">
                    <input
                      ref={zoomInputRef}
                      inputMode="decimal"
                      aria-label="Zoom percentage"
                      className="w-12 border-none bg-transparent text-center text-white outline-none"
                      value={zoomDraft}
                      onChange={(event) => setZoomDraft(event.target.value)}
                      onBlur={applyZoomDraft}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          event.preventDefault();
                          applyZoomDraft();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelZoomEdit();
                        }
                      }}
                    />
                    <span className="pl-1 text-white/72">%</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="min-w-14 text-center text-[1.05rem] text-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      beginZoomEdit();
                    }}
                  >
                    {Math.round(zoom * 100)} %
                  </button>
                )}
                <button
                  className="text-white/72"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isZoomEditing) {
                      cancelZoomEdit();
                    }
                    zoomAtPoint(zoom * 1.15);
                  }}
                >
                  <AppIcon icon={Icons.plus} className="h-4 w-4" />
                </button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="min-w-12 px-3 font-medium uppercase tracking-[0.08em] text-white/80"
                onPress={() => {
                  if (isZoomEditing) {
                    cancelZoomEdit();
                  }
                  fitView();
                }}
              >
                Fit
              </Button>
            </div>
          </div>
          {showOperationOutlines
            ? groupBoundsOverlays.map((overlay) => (
                <div
                  key={overlay.id}
                  className="pointer-events-none absolute z-10 rounded-[2px] border border-sky-400/75"
                  style={{
                    left: overlay.left,
                    top: overlay.top,
                    width: overlay.width,
                    height: overlay.height,
                    boxShadow: "0 0 0 1px rgba(56, 189, 248, 0.08)",
                  }}
                />
              ))
            : null}
          {marqueeRect ? (
            <div
              className="pointer-events-none absolute z-20 border border-sky-500 bg-sky-400/15"
              style={{
                left: marqueeRect.left,
                top: marqueeRect.top,
                width: marqueeRect.width,
                height: marqueeRect.height,
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function collectGroupBoundsOverlays({
  artObjects,
  hosts,
  viewport,
}: {
  artObjects: ArtObject[];
  hosts: Record<string, HTMLDivElement | null>;
  viewport: HTMLDivElement;
}) {
  const viewportBounds = viewport.getBoundingClientRect();
  const overlays: GroupBoundsOverlay[] = [];

  for (const artObject of artObjects) {
    const host = hosts[artObject.id];
    if (!host) {
      continue;
    }

    for (const groupNode of getInspectableGroupNodes(artObject.preparedSvg.tree)) {
      const bounds = collectNodeBounds(host, viewportBounds, artObject.id, groupNode.selectable_descendant_ids);
      if (!bounds) {
        continue;
      }

      overlays.push({
        id: `${artObject.id}:${groupNode.id ?? groupNode.label}`,
        ...bounds,
      });
    }
  }

  return overlays;
}

function getInspectableGroupNodes(tree: SvgTreeNode) {
  const nodes: SvgTreeNode[] = [];

  for (const child of tree.children) {
    collectInspectableGroupNodes(child, nodes);
  }

  return nodes;
}

function collectInspectableGroupNodes(node: SvgTreeNode, result: SvgTreeNode[]) {
  if (node.tag_name === "g" && node.selectable_descendant_ids.length > 0) {
    result.push(node);
  }

  for (const child of node.children) {
    collectInspectableGroupNodes(child, result);
  }
}

function collectNodeBounds(
  host: HTMLDivElement,
  viewportBounds: DOMRect,
  artObjectId: string,
  elementIds: string[],
) {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const elementId of elementIds) {
    const compositeId = buildCompositeElementId(artObjectId, elementId);
    const element = host.querySelector<SVGGraphicsElement>(`[data-s2g-id="${escapeAttributeValue(compositeId)}"]`);
    if (!element) {
      continue;
    }

    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      continue;
    }

    left = Math.min(left, bounds.left);
    top = Math.min(top, bounds.top);
    right = Math.max(right, bounds.right);
    bottom = Math.max(bottom, bounds.bottom);
  }

  if (!Number.isFinite(left) || !Number.isFinite(top) || right <= left || bottom <= top) {
    return null;
  }

  return {
    left: left - viewportBounds.left,
    top: top - viewportBounds.top,
    width: right - left,
    height: bottom - top,
  };
}

function escapeAttributeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function ToolbarButton({
  icon,
  disabled = false,
  active = false,
  onClick,
}: {
  icon: AppIconComponent;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      isIconOnly
      size="sm"
      variant="ghost"
      className={cn(active ? "bg-white/[0.14] text-white" : "text-white/75")}
      isDisabled={disabled}
      onPress={onClick}
    >
      <AppIcon icon={icon} className="h-5 w-5" />
    </Button>
  );
}

function normalizeRectNode(node: Konva.Rect): CanvasBox {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  const box = {
    x: node.x(),
    y: node.y(),
    width: Math.max(1, node.width() * Math.abs(scaleX)),
    height: Math.max(1, node.height() * Math.abs(scaleY)),
  };
  syncRectNode(node, box);
  return box;
}

function syncRectNode(node: Konva.Rect, box: CanvasBox) {
  node.position({ x: box.x, y: box.y });
  node.size({ width: box.width, height: box.height });
  node.scale({ x: 1, y: 1 });
}

function roundMm(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeMarquee(origin: { x: number; y: number }, point: { x: number; y: number }): MarqueeRect {
  const left = Math.min(origin.x, point.x);
  const top = Math.min(origin.y, point.y);
  return {
    left,
    top,
    width: Math.abs(point.x - origin.x),
    height: Math.abs(point.y - origin.y),
  };
}

function collectIntersectingSvgIds(
  host: HTMLDivElement | null | undefined,
  viewport: HTMLDivElement | null | undefined,
  rect: MarqueeRect,
) {
  if (!host || !viewport) {
    return [];
  }

  const viewportBounds = viewport.getBoundingClientRect();
  const selectionRect = {
    left: viewportBounds.left + rect.left,
    top: viewportBounds.top + rect.top,
    right: viewportBounds.left + rect.left + rect.width,
    bottom: viewportBounds.top + rect.top + rect.height,
  };

  const ids: string[] = [];
  for (const element of host.querySelectorAll<SVGGraphicsElement>("[data-s2g-id]")) {
    const id = element.getAttribute("data-s2g-id");
    if (!id) {
      continue;
    }
    const bounds = element.getBoundingClientRect();
    const intersects =
      bounds.right >= selectionRect.left &&
      bounds.left <= selectionRect.right &&
      bounds.bottom >= selectionRect.top &&
      bounds.top <= selectionRect.bottom;
    if (intersects) {
      ids.push(id);
    }
  }

  return ids;
}

function useImageAsset(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const nextImage = new window.Image();
    nextImage.src = src;
    nextImage.onload = () => setImage(nextImage);
    return () => {
      setImage(null);
    };
  }, [src]);

  return image;
}
