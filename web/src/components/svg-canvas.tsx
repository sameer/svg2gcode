import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Button } from "@heroui/react";
import { Group, Layer, Line, Rect, Stage, Transformer } from "react-konva";
import { LocationArrowFill } from "@gravity-ui/icons";

import { SvgHitLayer } from "@/components/svg-hit-layer";
import { useSvgCanvasController } from "@/components/use-svg-canvas-controller";
import { getCanvasGeometry } from "@/lib/editor-geometry";
import { AppIcon, type AppIconComponent, Icons } from "@/lib/icons";
import { MATERIAL_PRESETS, type MaterialPresetId } from "@/lib/material-presets";
import type {
  CanvasSelectionTarget,
  DiveRootScope,
  FrontendOperation,
  PreparedSvgDocument,
} from "@/lib/types";
import { clamp, cn } from "@/lib/utils";

type CanvasBox = { x: number; y: number; width: number; height: number };
type ResizeOverlayState = {
  anchor: string;
  target: Exclude<CanvasSelectionTarget, null>;
};
type MarqueeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
type InteractionMode = "default" | "direct-pick" | "pan";

interface SvgCanvasProps {
  preparedSvg: PreparedSvgDocument | null;
  operations: FrontendOperation[];
  selectedIds: string[];
  hoveredIds?: string[];
  activeOperationId: string | null;
  selectionTarget: CanvasSelectionTarget;
  isDiveMode: boolean;
  activeDiveRoot: DiveRootScope | null;
  modifierDirectPick: boolean;
  materialWidth?: number;
  materialHeight?: number;
  placementX?: number;
  placementY?: number;
  paddingMm: number;
  paddingValidationMessage: string | null;
  svgWidthMm: number;
  svgHeightMm: number;
  svgAspectLocked: boolean;
  materialPreset: MaterialPresetId;
  onSelectionTargetChange: (value: CanvasSelectionTarget) => void;
  onSelectIds: (ids: string[], additive: boolean) => void;
  onSelectMaterial: () => void;
  onEnterSvgDiveMode: () => void;
  onExitSvgDiveMode: () => void;
  onImportClick?: () => void;
  onMaterialSizeChange?: (dimension: "width" | "height", value: number | null) => void;
  onPlacementChange?: (x: number, y: number) => void;
  onSvgDimensionChange?: (dimension: "width" | "height", value: number | null) => void;
  onSvgSizeChange?: (width: number | null, height: number | null) => void;
}

export function SvgCanvas({
  preparedSvg,
  operations,
  selectedIds,
  hoveredIds = [],
  activeOperationId,
  selectionTarget,
  isDiveMode,
  activeDiveRoot,
  modifierDirectPick,
  materialWidth = 300,
  materialHeight = 300,
  placementX = 0,
  placementY = 0,
  paddingMm,
  paddingValidationMessage,
  svgWidthMm,
  svgHeightMm,
  svgAspectLocked,
  materialPreset,
  onSelectionTargetChange,
  onSelectIds,
  onSelectMaterial,
  onEnterSvgDiveMode,
  onExitSvgDiveMode,
  onImportClick,
  onMaterialSizeChange,
  onPlacementChange,
  onSvgDimensionChange,
  onSvgSizeChange,
}: SvgCanvasProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const artboardRef = useRef<Konva.Rect | null>(null);
  const svgRectRef = useRef<Konva.Rect | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const hitLayerHostRef = useRef<HTMLDivElement | null>(null);
  const [liveArtboardBox, setLiveArtboardBox] = useState<CanvasBox | null>(null);
  const [liveSvgBox, setLiveSvgBox] = useState<CanvasBox | null>(null);
  const [resizeOverlay, setResizeOverlay] = useState<ResizeOverlayState | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [marqueeHoverIds, setMarqueeHoverIds] = useState<string[]>([]);
  const [actionHintTarget, setActionHintTarget] = useState<Exclude<CanvasSelectionTarget, null> | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("default");
  const materialTexture = MATERIAL_PRESETS[materialPreset].texture;
  const textureImage = useImageAsset(materialTexture);

  const operationForId = useMemo(() => {
    const map = new Map<string, FrontendOperation>();
    for (const operation of operations) {
      for (const id of operation.assigned_element_ids) {
        map.set(id, operation);
      }
    }
    return map;
  }, [operations]);

  const {
    viewportRef,
    viewportSize,
    zoom,
    pan,
    hoverTarget,
    isPanning,
    spacePressed,
    svgMetrics,
    geometry,
    paddingMessage,
    toViewportRect,
    setHoverTarget,
    setPan,
    fitView,
    zoomAtPoint,
    handleWheel,
    handleViewportMouseDown,
  } = useSvgCanvasController({
    preparedSvg,
    materialWidth,
    materialHeight,
    placementX,
    placementY,
    paddingMm,
    paddingValidationMessage,
    svgWidthMm,
    svgHeightMm,
    panToolActive: interactionMode === "pan",
    onSelectionTargetChange,
  });

  const committedArtboardBox = useMemo(
    () => ({ x: 0, y: 0, width: materialWidth, height: materialHeight }),
    [materialHeight, materialWidth],
  );
  const effectiveArtboardBox =
    liveArtboardBox && !boxesEqual(liveArtboardBox, committedArtboardBox)
      ? liveArtboardBox
      : committedArtboardBox;
  const artboardGeometry = useMemo(() => {
    if (!svgMetrics) {
      return geometry;
    }

    return getCanvasGeometry({
      artboardWidthMm: effectiveArtboardBox.width,
      artboardHeightMm: effectiveArtboardBox.height,
      placementX,
      placementY,
      paddingMm,
      svgWidthMm,
      svgHeightMm,
    });
  }, [
    effectiveArtboardBox.height,
    effectiveArtboardBox.width,
    geometry,
    paddingMm,
    placementX,
    placementY,
    svgHeightMm,
    svgMetrics,
    svgWidthMm,
  ]);
  const derivedSvgBox = useMemo(() => {
    if (!artboardGeometry) {
      return null;
    }

    return {
      x: effectiveArtboardBox.x + artboardGeometry.svgLeftMm,
      y: effectiveArtboardBox.y + artboardGeometry.svgTopMm,
      width: artboardGeometry.svgWidthMm,
      height: artboardGeometry.svgHeightMm,
    };
  }, [artboardGeometry, effectiveArtboardBox.x, effectiveArtboardBox.y]);
  const effectiveSvgBox =
    liveSvgBox && derivedSvgBox && !boxesEqual(liveSvgBox, derivedSvgBox) ? liveSvgBox : derivedSvgBox;
  const effectiveGeometry = useMemo(() => {
    if (!artboardGeometry || !effectiveSvgBox) {
      return artboardGeometry;
    }

    const minArtboardWidthMm = effectiveSvgBox.width + paddingMm * 2;
    const minArtboardHeightMm = effectiveSvgBox.height + paddingMm * 2;
    const horizontalPaddingFits = minArtboardWidthMm <= effectiveArtboardBox.width;
    const verticalPaddingFits = minArtboardHeightMm <= effectiveArtboardBox.height;

    return {
      ...artboardGeometry,
      svgWidthMm: effectiveSvgBox.width,
      svgHeightMm: effectiveSvgBox.height,
      svgLeftMm: effectiveSvgBox.x - effectiveArtboardBox.x,
      svgTopMm: effectiveSvgBox.y - effectiveArtboardBox.y,
      maxPlacementX: Math.max(0, effectiveArtboardBox.width - effectiveSvgBox.width),
      maxPlacementY: Math.max(0, effectiveArtboardBox.height - effectiveSvgBox.height),
      minArtboardWidthMm,
      minArtboardHeightMm,
      horizontalPaddingFits,
      verticalPaddingFits,
      paddingFits: horizontalPaddingFits && verticalPaddingFits,
    };
  }, [
    artboardGeometry,
    effectiveArtboardBox.height,
    effectiveArtboardBox.width,
    effectiveArtboardBox.x,
    effectiveArtboardBox.y,
    effectiveSvgBox,
    paddingMm,
  ]);
  const effectiveOverlayRect = useMemo(() => toViewportRect(effectiveSvgBox), [effectiveSvgBox, toViewportRect]);
  const materialOverlayRect = useMemo(
    () => toViewportRect(effectiveArtboardBox),
    [effectiveArtboardBox, toViewportRect],
  );
  const interactiveIds = useMemo(
    () => activeDiveRoot?.elementIds ?? preparedSvg?.selectable_element_ids ?? [],
    [activeDiveRoot, preparedSvg],
  );
  const directPickEnabled = modifierDirectPick || interactionMode === "direct-pick";
  const panToolActive = interactionMode === "pan";
  const shapePickingEnabled = true;
  const previewHighlightedIds = useMemo(
    () => Array.from(new Set([...marqueeHoverIds, ...hoveredIds])),
    [hoveredIds, marqueeHoverIds],
  );

  const showActionHint = useCallback((target: Exclude<CanvasSelectionTarget, null>) => {
    setActionHintTarget(target);
  }, []);

  useEffect(() => {
    if (!actionHintTarget) {
      return;
    }
    const timeout = window.setTimeout(() => setActionHintTarget(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [actionHintTarget]);

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
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    if (selectionTarget === "material" && artboardRef.current) {
      syncRectNode(artboardRef.current, effectiveArtboardBox);
      transformer.nodes([artboardRef.current]);
    } else if (selectionTarget === "svg" && svgRectRef.current && effectiveSvgBox) {
      syncRectNode(svgRectRef.current, effectiveSvgBox);
      transformer.nodes([svgRectRef.current]);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [effectiveArtboardBox, effectiveSvgBox, selectionTarget]);

  const handlePartClick = useCallback(
    (event: MouseEvent) => {
      if (panToolActive) {
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
      if (isDiveMode || directPickEnabled || event.metaKey || event.ctrlKey) {
        // Don't call onSelectionTargetChange in dive mode — selectCanvasTarget resets isDiveMode
        if (!isDiveMode) {
          onSelectionTargetChange(null);
        }
        onSelectIds([id], event.metaKey || event.ctrlKey || event.shiftKey);
        return;
      }

      onSelectIds([], false);
      onSelectionTargetChange("svg");
    },
    [directPickEnabled, isDiveMode, onSelectIds, onSelectionTargetChange, panToolActive],
  );

  const handlePartDoubleClick = useCallback(
    (event: MouseEvent) => {
      if (directPickEnabled || panToolActive) {
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
      event.stopPropagation();
      if (isDiveMode) {
        onExitSvgDiveMode();
      } else {
        onEnterSvgDiveMode();
      }
    },
    [directPickEnabled, isDiveMode, onEnterSvgDiveMode, onExitSvgDiveMode, panToolActive],
  );

  // startMarquee: subscribes window mousemove/mouseup and draws the selection rectangle.
  // minDragPx: if set > 0, the selection is only committed if the user dragged at least
  // that many pixels — use this when called from a hit-layer mousedown so that a plain
  // click still lets the click handler select the element.
  const startMarquee = useCallback(
    (origin: { x: number; y: number }, additive: boolean, minDragPx = 0) => {
      let currentRect = { left: origin.x, top: origin.y, width: 0, height: 0 };
      setMarqueeRect(currentRect);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const viewport = viewportRef.current;
        if (!viewport) {
          return;
        }
        const bounds = viewport.getBoundingClientRect();
        const nextPoint = {
          x: moveEvent.clientX - bounds.left,
          y: moveEvent.clientY - bounds.top,
        };
        currentRect = normalizeMarquee(origin, nextPoint);
        setMarqueeRect(currentRect);
        // Live-preview: highlight elements inside the current marquee rect in blue
        const hoverIds = collectIntersectingSvgIds(
          hitLayerHostRef.current,
          viewportRef.current,
          currentRect,
          interactiveIds,
        );
        setMarqueeHoverIds(hoverIds);
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        setMarqueeHoverIds([]);
        const didDrag = currentRect.width >= minDragPx || currentRect.height >= minDragPx;
        if (!didDrag) {
          setMarqueeRect(null);
          return;
        }
        const ids = collectIntersectingSvgIds(
          hitLayerHostRef.current,
          viewportRef.current,
          currentRect,
          interactiveIds,
        );
        setMarqueeRect(null);
        if (ids.length > 0) {
          // onSelectIds already clears canvasSelectionTarget; skip onSelectionTargetChange
          // which would also reset isDiveMode via selectCanvasTarget
          onSelectIds(ids, additive);
        } else if (!additive) {
          onSelectIds([], false);
        }
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [interactiveIds, onSelectIds, viewportRef],
  );

  const handleStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (spacePressed || panToolActive) {
        return;
      }

      const stage = event.target.getStage();
      if (!stage || event.target !== stage) {
        return;
      }

      const pointer = stage.getPointerPosition();
      if (
        (isDiveMode || directPickEnabled) &&
        pointer &&
        effectiveOverlayRect &&
        isPointInsideRect(pointer, effectiveOverlayRect)
      ) {
        startMarquee(pointer, event.evt.shiftKey);
        return;
      }

      setResizeOverlay(null);
      onSelectionTargetChange(null);
      onSelectIds([], false);
    },
    [
      directPickEnabled,
      effectiveOverlayRect,
      isDiveMode,
      onSelectIds,
      onSelectionTargetChange,
      panToolActive,
      spacePressed,
      startMarquee,
    ],
  );

  // Handles mousedown on SVG elements in the hit layer while in dive mode.
  // Starts marquee selection with a drag threshold so that plain clicks still
  // route through the click handler to select the individual element.
  const handleHitLayerMouseDown = useCallback(
    (event: MouseEvent) => {
      if (spacePressed || panToolActive) {
        return;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      const origin = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      startMarquee(origin, event.shiftKey, 5);
    },
    [panToolActive, spacePressed, startMarquee, viewportRef],
  );

  const handleArtboardSelect = useCallback(() => {
    if (panToolActive) {
      return;
    }
    onSelectMaterial();
    showActionHint("material");
  }, [onSelectMaterial, panToolActive, showActionHint]);

  const handleSvgSelect = useCallback(() => {
    if (isDiveMode || directPickEnabled || panToolActive) {
      return;
    }
    onSelectionTargetChange("svg");
    showActionHint("svg");
  }, [directPickEnabled, isDiveMode, onSelectionTargetChange, panToolActive, showActionHint]);

  const handleSvgDragMove = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      if (!effectiveGeometry || !effectiveSvgBox) {
        return;
      }

      const target = event.target;
      const nextX = target.x();
      const nextY = target.y();
      const nextBox = {
        x: nextX,
        y: nextY,
        width: effectiveSvgBox.width,
        height: effectiveSvgBox.height,
      };
      setLiveSvgBox(nextBox);
      onPlacementChange?.(
        roundMm(nextX - effectiveArtboardBox.x),
        roundMm(effectiveArtboardBox.height - (nextY - effectiveArtboardBox.y) - nextBox.height),
      );
    },
    [effectiveArtboardBox.height, effectiveArtboardBox.x, effectiveArtboardBox.y, effectiveGeometry, effectiveSvgBox, onPlacementChange],
  );

  const handleSvgDragStart = useCallback(() => {
    if (!svgRectRef.current || !effectiveSvgBox) {
      return;
    }

    syncRectNode(svgRectRef.current, effectiveSvgBox);
    setLiveSvgBox(effectiveSvgBox);
  }, [effectiveSvgBox]);

  const handleSvgDragEnd = useCallback(() => {
    setLiveSvgBox(null);
  }, []);

  const handleTransformStart = useCallback(() => {
    const anchor = transformerRef.current?.getActiveAnchor();
    if (!anchor || !selectionTarget) {
      return;
    }
    setResizeOverlay({ anchor, target: selectionTarget });
  }, [selectionTarget]);

  const handleTransform = useCallback(() => {
    const anchor = transformerRef.current?.getActiveAnchor();
    if (anchor && selectionTarget) {
      setResizeOverlay({ anchor, target: selectionTarget });
    }

    if (selectionTarget === "material" && artboardRef.current) {
      setLiveArtboardBox(normalizeRectNode(artboardRef.current));
      return;
    }

    if (selectionTarget === "svg" && svgRectRef.current) {
      setLiveSvgBox(normalizeRectNode(svgRectRef.current));
    }
  }, [selectionTarget]);

  const handleTransformEnd = useCallback(() => {
    if (selectionTarget === "material" && artboardRef.current) {
      const nextBox = liveArtboardBox ?? normalizeRectNode(artboardRef.current);
      syncRectNode(artboardRef.current, {
        x: 0,
        y: 0,
        width: nextBox.width,
        height: nextBox.height,
      });
      setLiveArtboardBox({
        x: 0,
        y: 0,
        width: nextBox.width,
        height: nextBox.height,
      });
      setPan((current) => ({
        x: current.x + nextBox.x * zoom,
        y: current.y + nextBox.y * zoom,
      }));
      onMaterialSizeChange?.("width", roundMm(nextBox.width));
      onMaterialSizeChange?.("height", roundMm(nextBox.height));
      return;
    }

    if (selectionTarget === "svg" && svgRectRef.current && effectiveSvgBox) {
      const nextBox = liveSvgBox ?? normalizeRectNode(svgRectRef.current);
      syncRectNode(svgRectRef.current, nextBox);
      setLiveSvgBox(nextBox);
      onPlacementChange?.(
        roundMm(nextBox.x - effectiveArtboardBox.x),
        roundMm(effectiveArtboardBox.height - (nextBox.y - effectiveArtboardBox.y) - nextBox.height),
      );
      onSvgSizeChange?.(roundMm(nextBox.width), roundMm(nextBox.height));
    }
  }, [
    effectiveArtboardBox.height,
    effectiveArtboardBox.x,
    effectiveArtboardBox.y,
    effectiveSvgBox,
    liveArtboardBox,
    liveSvgBox,
    onMaterialSizeChange,
    onPlacementChange,
    onSvgSizeChange,
    selectionTarget,
    setPan,
    zoom,
  ]);

  const transformerBoundBox = useCallback(
    (
      oldBox: { x: number; y: number; width: number; height: number; rotation: number },
      newBox: { x: number; y: number; width: number; height: number; rotation: number },
    ) => {
      if (!effectiveGeometry) {
        return oldBox;
      }

      const toMm = (px: number) => px / zoom;
      const toPx = (mm: number) => mm * zoom;
      const toMmPosX = (pxPos: number) => (pxPos - pan.x) / zoom;
      const toPxPosX = (mmPos: number) => mmPos * zoom + pan.x;
      const toMmPosY = (pxPos: number) => (pxPos - pan.y) / zoom;
      const toPxPosY = (mmPos: number) => mmPos * zoom + pan.y;

      if (selectionTarget === "material") {
        return {
          ...newBox,
          width: Math.max(newBox.width, toPx(effectiveGeometry.minArtboardWidthMm)),
          height: Math.max(newBox.height, toPx(effectiveGeometry.minArtboardHeightMm)),
          rotation: 0,
        };
      }

      if (selectionTarget === "svg") {
        const oldWidthMm = Math.max(1, toMm(Math.abs(oldBox.width)));
        const oldHeightMm = Math.max(1, toMm(Math.abs(oldBox.height)));
        const anchoredLeft = Math.abs(newBox.x - oldBox.x) > 0.5;
        const anchoredTop = Math.abs(newBox.y - oldBox.y) > 0.5;
        const oldXMm = toMmPosX(oldBox.x);
        const oldYMm = toMmPosY(oldBox.y);

        if (svgAspectLocked && svgMetrics) {
          const newWidthMm = Math.max(1, toMm(Math.abs(newBox.width)));
          const newHeightMm = Math.max(1, toMm(Math.abs(newBox.height)));
          const widthRatio = newWidthMm / oldWidthMm;
          const heightRatio = newHeightMm / oldHeightMm;
          const dominantRatio =
            Math.abs(widthRatio - 1) >= Math.abs(heightRatio - 1) ? widthRatio : heightRatio;
          const nextWidthMm = clamp(
            oldWidthMm * dominantRatio,
            1,
            Math.min(
              effectiveArtboardBox.width,
              effectiveArtboardBox.height * svgMetrics.aspectRatio,
            ),
          );
          const nextHeightMm = clamp(nextWidthMm / svgMetrics.aspectRatio, 1, effectiveArtboardBox.height);
          const maxXMm = effectiveArtboardBox.x + effectiveArtboardBox.width - nextWidthMm;
          const maxYMm = effectiveArtboardBox.y + effectiveArtboardBox.height - nextHeightMm;
          const nextXMm = clamp(
            anchoredLeft ? oldXMm + oldWidthMm - nextWidthMm : oldXMm,
            effectiveArtboardBox.x,
            Math.max(effectiveArtboardBox.x, maxXMm),
          );
          const nextYMm = clamp(
            anchoredTop ? oldYMm + oldHeightMm - nextHeightMm : oldYMm,
            effectiveArtboardBox.y,
            Math.max(effectiveArtboardBox.y, maxYMm),
          );

          return {
            x: toPxPosX(nextXMm),
            y: toPxPosY(nextYMm),
            width: toPx(nextWidthMm),
            height: toPx(nextHeightMm),
            rotation: 0,
          };
        }

        const unclampedWidthMm = Math.max(1, toMm(Math.abs(newBox.width)));
        const unclampedHeightMm = Math.max(1, toMm(Math.abs(newBox.height)));
        const nextWidthMm = clamp(unclampedWidthMm, 1, effectiveArtboardBox.width);
        const nextHeightMm = clamp(unclampedHeightMm, 1, effectiveArtboardBox.height);
        const maxXMm = effectiveArtboardBox.x + effectiveArtboardBox.width - nextWidthMm;
        const maxYMm = effectiveArtboardBox.y + effectiveArtboardBox.height - nextHeightMm;
        const nextXMm = clamp(
          anchoredLeft ? oldXMm + oldWidthMm - nextWidthMm : oldXMm,
          effectiveArtboardBox.x,
          Math.max(effectiveArtboardBox.x, maxXMm),
        );
        const nextYMm = clamp(
          anchoredTop ? oldYMm + oldHeightMm - nextHeightMm : oldYMm,
          effectiveArtboardBox.y,
          Math.max(effectiveArtboardBox.y, maxYMm),
        );

        return {
          x: toPxPosX(nextXMm),
          y: toPxPosY(nextYMm),
          width: toPx(nextWidthMm),
          height: toPx(nextHeightMm),
          rotation: 0,
        };
      }

      return oldBox;
    },
    [effectiveArtboardBox.height, effectiveArtboardBox.width, effectiveArtboardBox.x, effectiveArtboardBox.y, effectiveGeometry, pan.x, pan.y, selectionTarget, svgAspectLocked, svgMetrics, zoom],
  );

  const resizeOverlayRect = useMemo(() => {
    if (!resizeOverlay || resizeOverlay.target !== selectionTarget) {
      return null;
    }

    const box =
      selectionTarget === "material"
        ? liveArtboardBox ?? effectiveArtboardBox
        : liveSvgBox ?? effectiveSvgBox;
    if (!box) {
      return null;
    }

    const rect = toViewportRect(box);
    if (!rect) {
      return null;
    }

    const anchor = resizeOverlay.anchor;
    const showWidth = anchor.includes("left") || anchor.includes("right") || anchor.includes("top") || anchor.includes("bottom");
    const showHeight = anchor.includes("top") || anchor.includes("bottom");
    const isHorizontalSide = anchor === "middle-left" || anchor === "middle-right";
    const isVerticalSide = anchor === "top-center" || anchor === "bottom-center";

    if (isHorizontalSide) {
      return {
        left: anchor === "middle-left" ? rect.left - 90 : rect.left + rect.width + 12,
        top: rect.top + rect.height / 2 - 22,
        width: 78,
        fields: ["width"] as Array<"width" | "height">,
        values: { width: box.width, height: box.height },
      };
    }

    if (isVerticalSide) {
      return {
        left: rect.left + rect.width / 2 - 44,
        top: anchor === "top-center" ? rect.top - 50 : rect.top + rect.height + 12,
        width: 88,
        fields: ["height"] as Array<"width" | "height">,
        values: { width: box.width, height: box.height },
      };
    }

    return {
      left: anchor.includes("left") ? rect.left - 96 : rect.left + rect.width + 12,
      top: anchor.includes("top") ? rect.top - 58 : rect.top + rect.height + 12,
      width: 108,
      fields: [
        ...(showWidth ? (["width"] as const) : []),
        ...(showHeight ? (["height"] as const) : []),
      ],
      values: { width: box.width, height: box.height },
    };
  }, [effectiveArtboardBox, effectiveSvgBox, liveArtboardBox, liveSvgBox, resizeOverlay, selectionTarget, toViewportRect]);
  const resizeOverlayCenter = useMemo(() => {
    if (!resizeOverlay || resizeOverlay.target !== selectionTarget) {
      return null;
    }

    const box =
      selectionTarget === "material"
        ? liveArtboardBox ?? effectiveArtboardBox
        : liveSvgBox ?? effectiveSvgBox;
    if (!box) {
      return null;
    }

    const rect = toViewportRect(box);
    if (!rect) {
      return null;
    }

    return {
      left: clamp(rect.left + rect.width / 2, 56, Math.max(56, viewportSize.width - 56)),
      top: clamp(rect.top + rect.height / 2, 20, Math.max(20, viewportSize.height - 20)),
    };
  }, [
    effectiveArtboardBox,
    effectiveSvgBox,
    liveArtboardBox,
    liveSvgBox,
    resizeOverlay,
    selectionTarget,
    toViewportRect,
    viewportSize.height,
    viewportSize.width,
  ]);

  const topRulerTicks = useMemo(
    () => buildRulerTicks(viewportSize.width, pan.x, zoom, "x", materialHeight),
    [materialHeight, pan.x, viewportSize.width, zoom],
  );
  const leftRulerTicks = useMemo(
    () => buildRulerTicks(viewportSize.height, pan.y, zoom, "y", materialHeight),
    [materialHeight, pan.y, viewportSize.height, zoom],
  );

  const artboardSelectionStroke = "#73bbff";
  const svgSelectionStroke = "#73bbff";
  const artboardFill = isDiveMode ? "rgba(106, 75, 51, 0.48)" : "#6a4b33";

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

      {!preparedSvg || !effectiveGeometry || !svgMetrics || !viewportSize.width || !viewportSize.height ? (
        <div className="relative flex h-full items-center justify-center px-6">
          <div className="max-w-sm rounded-[1.35rem] border border-white/10 bg-[#0b1020]/88 px-6 py-5 text-center shadow-[0_24px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <p className="text-sm leading-relaxed text-slate-200">
              Drag and drop an SVG onto the canvas, or use the button below to add one.
            </p>
            <Button
              className="mt-4 h-10 w-full justify-center text-white"
              size="sm"
              variant="secondary"
              onPress={onImportClick}
            >
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
          >
            <Layer>
              <Rect
                ref={artboardRef}
                x={effectiveArtboardBox.x}
                y={effectiveArtboardBox.y}
                width={effectiveArtboardBox.width}
                height={effectiveArtboardBox.height}
                fill={artboardFill}
                cornerRadius={2 / zoom}
                shadowColor="rgba(29, 18, 10, 0.62)"
                shadowBlur={32 / zoom}
                shadowOffset={{ x: 0, y: 18 / zoom }}
                stroke={selectionTarget === "material" ? artboardSelectionStroke : "rgba(132, 94, 62, 0.55)"}
                strokeWidth={selectionTarget === "material" ? 1.4 / zoom : 1 / zoom}
                listening={!isDiveMode}
                onMouseDown={handleArtboardSelect}
                onMouseEnter={() => setHoverTarget("material")}
                onMouseLeave={() => setHoverTarget((current) => (current === "material" ? null : current))}
              />
              {textureImage ? (
                <Rect
                  x={effectiveArtboardBox.x}
                  y={effectiveArtboardBox.y}
                  width={effectiveArtboardBox.width}
                  height={effectiveArtboardBox.height}
                  fillPatternImage={textureImage}
                  fillPatternRepeat="repeat"
                  fillPatternScale={{ x: 0.11, y: 0.11 }}
                  opacity={isDiveMode ? 0.35 : 0.55}
                  listening={false}
                />
              ) : null}
              {(selectionTarget === "material" || hoverTarget === "material") ? (
                <ObjectChrome
                  x={effectiveArtboardBox.x}
                  y={effectiveArtboardBox.y}
                  width={effectiveArtboardBox.width}
                  height={effectiveArtboardBox.height}
                  zoom={zoom}
                  tone="artboard"
                  subtle={selectionTarget !== "material"}
                />
              ) : null}
              {paddingMm > 0 && selectionTarget === "material" ? (
                <Rect
                  x={effectiveArtboardBox.x + paddingMm}
                  y={effectiveArtboardBox.y + paddingMm}
                  width={Math.max(0, effectiveArtboardBox.width - paddingMm * 2)}
                  height={Math.max(0, effectiveArtboardBox.height - paddingMm * 2)}
                  stroke={paddingMessage ? "rgba(245,158,11,0.92)" : "rgba(115,187,255,0.45)"}
                  strokeWidth={1 / zoom}
                  dash={[2 / zoom, 4 / zoom]}
                  listening={false}
                />
              ) : null}
              <Rect
                ref={svgRectRef}
                x={effectiveSvgBox?.x ?? effectiveArtboardBox.x + effectiveGeometry.svgLeftMm}
                y={effectiveSvgBox?.y ?? effectiveArtboardBox.y + effectiveGeometry.svgTopMm}
                width={effectiveSvgBox?.width ?? effectiveGeometry.svgWidthMm}
                height={effectiveSvgBox?.height ?? effectiveGeometry.svgHeightMm}
                fill="transparent"
                stroke={
                  selectionTarget === "svg" || hoverTarget === "svg"
                    ? "rgba(115,187,255,0.95)"
                    : "rgba(115,187,255,0)"
                }
                strokeWidth={selectionTarget === "svg" ? 1.35 / zoom : 1 / zoom}
                dash={selectionTarget === "svg" ? [6 / zoom, 4 / zoom] : undefined}
                listening={!isDiveMode}
                draggable={selectionTarget === "svg" && !isDiveMode}
                onMouseDown={handleSvgSelect}
                onDblClick={isDiveMode ? onExitSvgDiveMode : onEnterSvgDiveMode}
                onMouseEnter={() => setHoverTarget("svg")}
                onMouseLeave={() => setHoverTarget((current) => (current === "svg" ? null : current))}
                onDragStart={handleSvgDragStart}
                onDragMove={handleSvgDragMove}
                onDragEnd={handleSvgDragEnd}
                dragBoundFunc={(pos) => {
                  if (!effectiveGeometry) {
                    return pos;
                  }
                  const localX = (pos.x - pan.x) / zoom;
                  const localY = (pos.y - pan.y) / zoom;
                  const clampedX = clamp(localX, effectiveArtboardBox.x, effectiveArtboardBox.x + effectiveGeometry.maxPlacementX);
                  const clampedY = clamp(localY, effectiveArtboardBox.y, effectiveArtboardBox.y + effectiveGeometry.maxPlacementY);
                  return {
                    x: pan.x + clampedX * zoom,
                    y: pan.y + clampedY * zoom,
                  };
                }}
              />
              {(selectionTarget === "svg" || hoverTarget === "svg" || isDiveMode) ? (
                <ObjectChrome
                  x={effectiveSvgBox?.x ?? effectiveArtboardBox.x + effectiveGeometry.svgLeftMm}
                  y={effectiveSvgBox?.y ?? effectiveArtboardBox.y + effectiveGeometry.svgTopMm}
                  width={effectiveSvgBox?.width ?? effectiveGeometry.svgWidthMm}
                  height={effectiveSvgBox?.height ?? effectiveGeometry.svgHeightMm}
                  zoom={zoom}
                  tone="svg"
                  subtle={selectionTarget !== "svg" && !isDiveMode}
                />
              ) : null}
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
                anchorFill={selectionTarget === "material" ? artboardSelectionStroke : svgSelectionStroke}
                anchorStroke="#ffffff"
                anchorStrokeWidth={1 / zoom}
                anchorCornerRadius={0}
                anchorSize={10 / zoom}
                borderStroke={selectionTarget === "material" ? artboardSelectionStroke : svgSelectionStroke}
                borderStrokeWidth={1.25 / zoom}
                borderDash={[10 / zoom, 6 / zoom]}
                boundBoxFunc={transformerBoundBox}
                onTransformStart={handleTransformStart}
                onTransform={handleTransform}
                onTransformEnd={handleTransformEnd}
              />
            </Layer>
          </Stage>

          {effectiveOverlayRect ? (
            <SvgHitLayer
              normalizedSvg={preparedSvg.normalized_svg}
              rect={effectiveOverlayRect}
              selectedIds={selectedIds}
              previewSelectedIds={previewHighlightedIds}
              activeOperationId={activeOperationId}
              operationForId={operationForId}
              interactive={shapePickingEnabled}
              interactiveIds={isDiveMode || directPickEnabled ? interactiveIds : []}
              onHostReady={(host) => {
                hitLayerHostRef.current = host;
              }}
              onClick={handlePartClick}
              onDoubleClick={handlePartDoubleClick}
              onMouseDown={isDiveMode || directPickEnabled ? handleHitLayerMouseDown : undefined}
            />
          ) : null}

          <CanvasRulers
            topTicks={topRulerTicks}
            leftTicks={leftRulerTicks}
            width={viewportSize.width}
            height={viewportSize.height}
          />

          <div className="pointer-events-none absolute inset-x-0 bottom-7 z-20 flex justify-center px-6">
            <div className="pointer-events-auto flex items-center gap-2 rounded-[1.75rem] border border-white/10 bg-[rgba(19,19,23,0.9)] px-4 py-3 text-white shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className={interactionMode === "direct-pick" ? "bg-white/[0.14] text-white" : "text-white/75"}
                onPress={() => {
                  setInteractionMode((current) => (current === "direct-pick" ? "default" : "direct-pick"));
                }}
              >
                <LocationArrowFill className="h-5 w-5" />
              </Button>
              <ToolbarButton
                icon={Icons.hand}
                active={interactionMode === "pan"}
                onClick={() => {
                  setInteractionMode((current) => (current === "pan" ? "default" : "pan"));
                }}
              />
              <div className="ml-2 flex items-center gap-3 rounded-[1.2rem] bg-white/[0.05] px-4 py-3">
                <button
                  className="text-white/72"
                  onClick={(event) => {
                    event.stopPropagation();
                    zoomAtPoint(zoom / 1.15);
                  }}
                >
                  <AppIcon icon={Icons.minus} className="h-4 w-4" />
                </button>
                <span className="min-w-14 text-center text-[1.05rem]">{Math.round(zoom * 100)} %</span>
                <button
                  className="text-white/72"
                  onClick={(event) => {
                    event.stopPropagation();
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
                onPress={fitView}
              >
                Fit
              </Button>
            </div>
          </div>

          {resizeOverlayRect && resizeOverlayCenter ? (
            <div
              className="absolute z-20 flex items-center gap-1"
              style={{
                left: resizeOverlayCenter.left,
                top: resizeOverlayCenter.top,
                transform: "translate(-50%, -50%)",
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {resizeOverlayRect.fields.map((field) => (
                <InlineDimensionTag
                  key={field}
                  label={field === "width" ? "W" : "H"}
                  value={resizeOverlayRect.values[field]}
                  onChange={(value) => {
                    if (selectionTarget === "material") {
                      onMaterialSizeChange?.(field, value);
                    } else {
                      onSvgDimensionChange?.(field, value);
                    }
                  }}
                />
              ))}
            </div>
          ) : null}

          {actionHintTarget === "svg" && !isDiveMode && effectiveOverlayRect ? (
            <div
              className="pointer-events-none absolute z-20 rounded-[8px] border border-[#2f95ff66] bg-[#0b1730]/95 px-2 py-1 text-xs text-[#b9dcff]"
              style={{
                left: effectiveOverlayRect.left + 6,
                top: Math.max(8, effectiveOverlayRect.top - 30),
              }}
            >
              Double-click to edit part
            </div>
          ) : null}

          {actionHintTarget === "material" && materialOverlayRect ? (
            <div
              className="pointer-events-none absolute z-20 rounded-[8px] border border-[#2f95ff66] bg-[#0b1730]/95 px-2 py-1 text-xs text-[#b9dcff]"
              style={{
                left: materialOverlayRect.left + 6,
                top: Math.max(8, materialOverlayRect.top - 30),
              }}
            >
              Drag edges to resize material
            </div>
          ) : null}

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

function CanvasRulers({
  topTicks,
  leftTicks,
  width,
  height,
}: {
  topTicks: RulerTick[];
  leftTicks: RulerTick[];
  width: number;
  height: number;
}) {
  return (
    <>
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-6 w-6 border-b border-r border-[#2f2f38] bg-[#111116]/95" />
      <div className="pointer-events-none absolute left-6 right-0 top-0 z-10 h-6 border-b border-[#2f2f38] bg-[#111116]/95 text-[10px] text-[#9ea0ad]">
        {topTicks.map((tick) => (
          <div key={`x-${tick.value}-${tick.position}`} className="absolute top-0 h-full" style={{ left: tick.position }}>
            <div className={`w-px bg-[#6f7180] ${tick.major ? "h-6" : "h-3"}`} />
            {tick.major ? <span className="absolute left-1 top-1">{tick.label}</span> : null}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 top-6 z-10 w-6 border-r border-[#2f2f38] bg-[#111116]/95 text-[10px] text-[#9ea0ad]">
        {leftTicks.map((tick) => (
          <div key={`y-${tick.value}-${tick.position}`} className="absolute left-0 w-full" style={{ top: tick.position }}>
            <div className={`h-px bg-[#6f7180] ${tick.major ? "w-6" : "w-3"}`} />
            {tick.major ? (
              <span
                className="absolute left-[3px] top-[2px] origin-top-left -rotate-90 whitespace-nowrap"
                style={{ transformOrigin: "top left" }}
              >
                {tick.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 rounded-none border border-transparent" style={{ width, height }} />
    </>
  );
}

function ObjectChrome({
  x,
  y,
  width,
  height,
  zoom,
  tone,
  subtle = false,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
  tone: "artboard" | "svg";
  subtle?: boolean;
}) {
  const color =
    tone === "artboard"
      ? subtle
        ? "rgba(173,130,88,0.7)"
        : "rgba(221,169,113,0.98)"
      : subtle
        ? "rgba(115,187,255,0.64)"
        : "rgba(115,187,255,0.96)";

  return (
    <Group listening={false}>
      <Rect x={x} y={y} width={width} height={height} stroke={color} strokeWidth={1.1 / zoom} />
      <Rect
        x={x + 4 / zoom}
        y={y + 4 / zoom}
        width={Math.max(0, width - 8 / zoom)}
        height={Math.max(0, height - 8 / zoom)}
        stroke={color}
        strokeWidth={0.9 / zoom}
        dash={[8 / zoom, 6 / zoom]}
        opacity={0.45}
      />
      <CornerBrackets x={x} y={y} width={width} height={height} zoom={zoom} color={color} />
    </Group>
  );
}

function CornerBrackets({
  x,
  y,
  width,
  height,
  zoom,
  color,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
  color: string;
}) {
  const span = 18 / zoom;
  const strokeWidth = 2 / zoom;
  return (
    <>
      {([
        [x, y, x + span, y, x, y, x, y + span],
        [x + width, y, x + width - span, y, x + width, y, x + width, y + span],
        [x, y + height, x + span, y + height, x, y + height, x, y + height - span],
        [x + width, y + height, x + width - span, y + height, x + width, y + height, x + width, y + height - span],
      ] as const).map((points, index) => (
        <Line key={index} points={[...points]} stroke={color} strokeWidth={strokeWidth} />
      ))}
    </>
  );
}

function InlineDimensionTag({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange?: (value: number | null) => void;
}) {
  const [editValue, setEditValue] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const displayValue = editValue ?? formatTagValue(value);
  const inputValue = editValue ?? String(value);

  return (
    <button
      className="inline-flex h-5 items-center gap-1 rounded-[4px] bg-[#2f95ff] px-1.5 text-[10px] font-medium text-white"
      onClick={(event) => {
        event.stopPropagation();
        setIsEditing(true);
        setEditValue(String(value));
      }}
    >
      <span className="opacity-85">{label}</span>
      {isEditing ? (
        <input
          type="text"
          inputMode="decimal"
          className="w-11 border-0 bg-transparent p-0 text-[10px] text-white outline-none"
          value={inputValue}
          autoFocus
          onFocus={(event) => {
            requestAnimationFrame(() => event.currentTarget.select());
          }}
          onChange={(event) => setEditValue(event.target.value)}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            if (raw === "") {
              onChange?.(null);
            } else {
              const parsed = Number.parseFloat(raw);
              if (Number.isFinite(parsed)) {
                onChange?.(parsed);
              }
            }
            setEditValue(null);
            setIsEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setEditValue(null);
              setIsEditing(false);
              event.currentTarget.blur();
            }
          }}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <span>{displayValue}</span>
      )}
    </button>
  );
}

function formatTagValue(value: number) {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function roundMm(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeRectNode(rect: Konva.Rect): CanvasBox {
  const box = {
    x: rect.x(),
    y: rect.y(),
    width: Math.max(1, rect.width() * Math.abs(rect.scaleX())),
    height: Math.max(1, rect.height() * Math.abs(rect.scaleY())),
  };
  syncRectNode(rect, box);
  return box;
}

function syncRectNode(rect: Konva.Rect, box: CanvasBox) {
  rect.scale({ x: 1, y: 1 });
  rect.position({ x: box.x, y: box.y });
  rect.size({ width: box.width, height: box.height });
}

function boxesEqual(a: CanvasBox, b: CanvasBox, epsilon = 0.02) {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.width - b.width) <= epsilon &&
    Math.abs(a.height - b.height) <= epsilon
  );
}

interface RulerTick {
  value: number;
  position: number;
  label: string;
  major: boolean;
}

function buildRulerTicks(
  lengthPx: number,
  panPx: number,
  zoom: number,
  axis: "x" | "y",
  materialHeight: number,
) {
  if (!lengthPx || !zoom) {
    return [];
  }

  const step = pickRulerStep(zoom);
  const majorEvery = 5;
  const worldMin = (0 - panPx) / zoom;
  const worldMax = (lengthPx - panPx) / zoom;
  const start = Math.floor(worldMin / step) * step;
  const ticks: RulerTick[] = [];

  for (let value = start, index = 0; value <= worldMax + step; value += step, index += 1) {
    const position = panPx + value * zoom;
    if (position < -step * zoom || position > lengthPx + step * zoom) {
      continue;
    }
    const major = Math.round(value / step) % majorEvery === 0;
    const labelValue = axis === "x" ? value : materialHeight - value;
    ticks.push({
      value,
      position,
      major,
      label: `${roundMm(labelValue)}`,
    });
  }

  return ticks;
}

function pickRulerStep(zoom: number) {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  for (const step of steps) {
    if (step * zoom >= 28) {
      return step;
    }
  }
  return steps.at(-1)!;
}

function normalizeMarquee(
  origin: { x: number; y: number },
  nextPoint: { x: number; y: number },
): MarqueeRect {
  return {
    left: Math.min(origin.x, nextPoint.x),
    top: Math.min(origin.y, nextPoint.y),
    width: Math.abs(nextPoint.x - origin.x),
    height: Math.abs(nextPoint.y - origin.y),
  };
}

function isPointInsideRect(point: { x: number; y: number }, rect: { left: number; top: number; width: number; height: number }) {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}

function useImageAsset(source: string | null) {
  const [loaded, setLoaded] = useState<{ source: string; image: HTMLImageElement } | null>(null);

  useEffect(() => {
    if (!source) {
      return;
    }

    let active = true;
    const nextImage = new window.Image();
    nextImage.crossOrigin = "anonymous";
    nextImage.onload = () => {
      if (active) {
        setLoaded({ source, image: nextImage });
      }
    };
    nextImage.onerror = () => {
      // Ignore failures and keep previous loaded image fallback.
    };
    nextImage.src = source;

    return () => {
      active = false;
    };
  }, [source]);

  if (!source) {
    return null;
  }
  return loaded?.source === source ? loaded.image : null;
}

function collectIntersectingSvgIds(
  host: HTMLDivElement | null,
  viewport: HTMLDivElement | null,
  marquee: MarqueeRect,
  allowedIds: string[],
) {
  if (!host || marquee.width < 2 || marquee.height < 2) {
    return [];
  }

  const allowed = new Set(allowedIds);
  const viewportBounds = viewport?.getBoundingClientRect() ?? null;
  if (!viewportBounds) {
    return [];
  }

  const selectionRect = {
    left: viewportBounds.left + marquee.left,
    top: viewportBounds.top + marquee.top,
    right: viewportBounds.left + marquee.left + marquee.width,
    bottom: viewportBounds.top + marquee.top + marquee.height,
  };

  const matches: string[] = [];
  for (const element of host.querySelectorAll<SVGGraphicsElement>("[data-s2g-id]")) {
    const id = element.getAttribute("data-s2g-id");
    if (!id || (allowed.size > 0 && !allowed.has(id))) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (
      rect.right >= selectionRect.left &&
      rect.left <= selectionRect.right &&
      rect.bottom >= selectionRect.top &&
      rect.top <= selectionRect.bottom
    ) {
      matches.push(id);
    }
  }

  return matches;
}
