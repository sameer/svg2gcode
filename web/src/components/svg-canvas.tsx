import { Minus, Plus, ScanSearch } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Layer, Line, Rect, Stage, Tag, Text, Transformer } from "react-konva";

import { SvgHitLayer } from "@/components/svg-hit-layer";
import { useSvgCanvasController } from "@/components/use-svg-canvas-controller";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { getCanvasGeometry } from "@/lib/editor-geometry";
import type {
  AlignmentAction,
  FillMode,
  FrontendOperation,
  PreparedSvgDocument,
} from "@/lib/types";
import { clamp, cn } from "@/lib/utils";

const DEPTH_PRESETS = [0.5, 1, 1.5, 2, 3, 5, 10];
const SELECTION_HUD_WIDTH = 260;
type CanvasBox = { x: number; y: number; width: number; height: number };

interface SvgCanvasProps {
  preparedSvg: PreparedSvgDocument | null;
  operations: FrontendOperation[];
  selectedIds: string[];
  activeOperationId: string | null;
  materialWidth?: number;
  materialHeight?: number;
  placementX?: number;
  placementY?: number;
  paddingMm: number;
  paddingValidationMessage: string | null;
  onSelectIds: (ids: string[], additive: boolean) => void;
  onDepthChange?: (operationId: string, value: number) => void;
  onFillModeChange?: (operationId: string, value: FillMode | null) => void;
  onAssignToOperation?: (operationId: string) => void;
  onMaterialSizeChange?: (dimension: "width" | "height", value: number | null) => void;
  onPlacementChange?: (x: number, y: number) => void;
  onPaddingChange?: (value: number | null) => void;
  onAlign?: (alignment: AlignmentAction) => void;
  svgWidthOverride?: number | null;
  onSvgWidthOverrideChange?: (value: number | null) => void;
}

export function SvgCanvas({
  preparedSvg,
  operations,
  selectedIds,
  activeOperationId,
  materialWidth = 300,
  materialHeight = 300,
  placementX = 0,
  placementY = 0,
  paddingMm,
  paddingValidationMessage,
  onSelectIds,
  onDepthChange,
  onFillModeChange,
  onAssignToOperation,
  onMaterialSizeChange,
  onPlacementChange,
  onPaddingChange,
  onAlign,
  svgWidthOverride = null,
  onSvgWidthOverrideChange,
}: SvgCanvasProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const artboardRef = useRef<Konva.Rect | null>(null);
  const svgRectRef = useRef<Konva.Rect | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const [contextElementId, setContextElementId] = useState<string | null>(null);
  const [liveArtboardBox, setLiveArtboardBox] = useState<CanvasBox | null>(null);
  const [liveSvgBox, setLiveSvgBox] = useState<CanvasBox | null>(null);

  const operationForId = useMemo(() => {
    const map = new Map<string, FrontendOperation>();
    for (const operation of operations) {
      for (const id of operation.assigned_element_ids) {
        map.set(id, operation);
      }
    }
    return map;
  }, [operations]);

  const contextOperation = contextElementId ? operationForId.get(contextElementId) ?? null : null;
  const {
    viewportRef,
    viewportSize,
    zoom,
    pan,
    selectionTarget,
    hoverTarget,
    isPanning,
    spacePressed,
    svgMetrics,
    geometry,
    paddingMessage,
    toViewportRect,
    setSelectionTarget,
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
    svgWidthOverride,
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

    if (!liveArtboardBox) {
      return geometry;
    }

    return getCanvasGeometry({
      artboardWidthMm: effectiveArtboardBox.width,
      artboardHeightMm: effectiveArtboardBox.height,
      placementX,
      placementY,
      svgWidthOverride,
      paddingMm,
      svgMetrics,
    });
  }, [
    effectiveArtboardBox.height,
    effectiveArtboardBox.width,
    geometry,
    liveArtboardBox,
    paddingMm,
    placementX,
    placementY,
    svgMetrics,
    svgWidthOverride,
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
    liveSvgBox && derivedSvgBox && !boxesEqual(liveSvgBox, derivedSvgBox)
      ? liveSvgBox
      : derivedSvgBox;
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
  const artboardViewportRect = useMemo(
    () => toViewportRect(effectiveArtboardBox),
    [effectiveArtboardBox, toViewportRect],
  );
  const effectiveOverlayRect = useMemo(
    () => toViewportRect(effectiveSvgBox),
    [effectiveSvgBox, toViewportRect],
  );

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    if (selectionTarget === "artboard" && artboardRef.current) {
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
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const selectable = target.closest("[data-s2g-id]");
      if (!(selectable instanceof SVGElement)) {
        return;
      }

      const id = selectable.getAttribute("data-s2g-id");
      if (!id) {
        return;
      }

      event.stopPropagation();
      onSelectIds([id], event.metaKey || event.ctrlKey || event.shiftKey);
      setSelectionTarget(null);
    },
    [onSelectIds, setSelectionTarget],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const selectable = target.closest("[data-s2g-id]");
      if (!(selectable instanceof SVGElement)) {
        setContextElementId(null);
        return;
      }

      const id = selectable.getAttribute("data-s2g-id");
      if (!id) {
        setContextElementId(null);
        return;
      }

      setContextElementId(id);
      if (!selectedIds.includes(id)) {
        onSelectIds([id], false);
      }
      setSelectionTarget(null);
    },
    [onSelectIds, selectedIds, setSelectionTarget],
  );

  const handleStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (spacePressed) {
        return;
      }

      const stage = event.target.getStage();
      if (!stage || event.target !== stage) {
        return;
      }

      setSelectionTarget(null);
      onSelectIds([], false);
    },
    [onSelectIds, setSelectionTarget, spacePressed],
  );

  const handleArtboardSelect = useCallback(() => {
    setSelectionTarget("artboard");
  }, [setSelectionTarget]);

  const handleSvgSelect = useCallback(() => {
    setSelectionTarget("svg");
  }, [setSelectionTarget]);

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
        roundMm(
          effectiveArtboardBox.height - (nextY - effectiveArtboardBox.y) - nextBox.height,
        ),
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

  const handleTransform = useCallback(() => {
    if (selectionTarget === "artboard" && artboardRef.current) {
      setLiveArtboardBox(normalizeRectNode(artboardRef.current));
      return;
    }

    if (selectionTarget === "svg" && svgRectRef.current) {
      setLiveSvgBox(normalizeRectNode(svgRectRef.current));
    }
  }, [selectionTarget]);

  const handleTransformEnd = useCallback(() => {
    const transformer = transformerRef.current;
    const node = transformer?.nodes()[0];
    if (!node) {
      return;
    }

    const stageScale = zoom;

    if (selectionTarget === "artboard" && artboardRef.current) {
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
        x: current.x + nextBox.x * stageScale,
        y: current.y + nextBox.y * stageScale,
      }));
      onMaterialSizeChange?.("width", roundMm(nextBox.width));
      onMaterialSizeChange?.("height", roundMm(nextBox.height));
      return;
    }

    if (selectionTarget === "svg" && svgRectRef.current && effectiveSvgBox && svgMetrics) {
      const nextBox = liveSvgBox ?? normalizeRectNode(svgRectRef.current);
      syncRectNode(svgRectRef.current, nextBox);
      setLiveSvgBox(nextBox);

      const uniformWidth = roundMm(nextBox.width);
      onPlacementChange?.(
        roundMm(nextBox.x - effectiveArtboardBox.x),
        roundMm(
          effectiveArtboardBox.height - (nextBox.y - effectiveArtboardBox.y) - nextBox.height,
        ),
      );
      onSvgWidthOverrideChange?.(uniformWidth);
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
    onSvgWidthOverrideChange,
    selectionTarget,
    setPan,
    svgMetrics,
    zoom,
  ]);

  const transformerBoundBox = useCallback(
    (oldBox: { x: number; y: number; width: number; height: number; rotation: number }, newBox: { x: number; y: number; width: number; height: number; rotation: number }) => {
      if (!effectiveGeometry) {
        return oldBox;
      }

      // boundBoxFunc receives pixel-space coordinates; convert to mm-space
      const toMm = (px: number) => px / zoom;
      const toPx = (mm: number) => mm * zoom;
      const toMmPos = (pxPos: number) => (pxPos - pan.x) / zoom;
      const toPxPos = (mmPos: number) => mmPos * zoom + pan.x;
      const toMmPosY = (pxPos: number) => (pxPos - pan.y) / zoom;
      const toPxPosY = (mmPos: number) => mmPos * zoom + pan.y;

      if (selectionTarget === "artboard") {
        return {
          ...newBox,
          width: Math.max(newBox.width, toPx(effectiveGeometry.minArtboardWidthMm)),
          height: Math.max(newBox.height, toPx(effectiveGeometry.minArtboardHeightMm)),
          rotation: newBox.rotation ?? 0,
        };
      }

      if (selectionTarget === "svg" && svgMetrics) {
        const aspectRatio = svgMetrics.aspectRatio;
        const oldWidthMm = Math.max(1, toMm(oldBox.width));
        const oldHeightMm = Math.max(1, toMm(oldBox.height));
        const newWidthMm = Math.max(1, toMm(Math.abs(newBox.width)));
        const newHeightMm = Math.max(1, toMm(Math.abs(newBox.height)));
        const widthRatio = newWidthMm / oldWidthMm;
        const heightRatio = newHeightMm / oldHeightMm;
        const dominantRatio =
          Math.abs(widthRatio - 1) >= Math.abs(heightRatio - 1) ? widthRatio : heightRatio;
        const nextWidthMm = clamp(oldWidthMm * dominantRatio, 1, effectiveArtboardBox.width);
        const nextHeightMm = clamp(nextWidthMm / aspectRatio, 1, effectiveArtboardBox.height);
        const anchoredLeft = Math.abs(newBox.x - oldBox.x) > 0.5;
        const anchoredTop = Math.abs(newBox.y - oldBox.y) > 0.5;
        const oldXMm = toMmPos(oldBox.x);
        const oldYMm = toMmPosY(oldBox.y);
        const maxXMm = effectiveArtboardBox.x + effectiveArtboardBox.width - nextWidthMm;
        const maxYMm = effectiveArtboardBox.y + effectiveArtboardBox.height - nextHeightMm;
        const nextXMm = clamp(
          anchoredLeft
            ? oldXMm + oldWidthMm - nextWidthMm
            : oldXMm,
          effectiveArtboardBox.x,
          Math.max(effectiveArtboardBox.x, maxXMm),
        );
        const nextYMm = clamp(
          anchoredTop
            ? oldYMm + oldHeightMm - nextHeightMm
            : oldYMm,
          effectiveArtboardBox.y,
          Math.max(effectiveArtboardBox.y, maxYMm),
        );

        return {
          x: toPxPos(nextXMm),
          y: toPxPosY(nextYMm),
          width: toPx(nextWidthMm),
          height: toPx(nextHeightMm),
          rotation: 0,
        };
      }

      return oldBox;
    },
    [effectiveArtboardBox.height, effectiveArtboardBox.width, effectiveArtboardBox.x, effectiveArtboardBox.y, effectiveGeometry, pan.x, pan.y, selectionTarget, svgMetrics, zoom],
  );

  const selectionHud = useMemo(() => {
    if (!effectiveGeometry || !effectiveOverlayRect || !artboardViewportRect) {
      return null;
    }

    if (selectionTarget === "artboard") {
      return {
        left: clamp(artboardViewportRect.left + 12, 12, Math.max(12, viewportSize.width - 232)),
        top: Math.max(12, artboardViewportRect.top - 90),
        width: effectiveArtboardBox.width,
        height: effectiveArtboardBox.height,
      };
    }

    if (selectionTarget === "svg") {
      return {
        left: clamp(
          effectiveOverlayRect.left,
          12,
          Math.max(12, viewportSize.width - SELECTION_HUD_WIDTH - 12),
        ),
        top: Math.max(12, effectiveOverlayRect.top - 94),
        width: effectiveSvgBox?.width ?? effectiveGeometry.svgWidthMm,
        height: effectiveSvgBox?.height ?? effectiveGeometry.svgHeightMm,
      };
    }

    return null;
  }, [
    artboardViewportRect,
    effectiveArtboardBox.height,
    effectiveArtboardBox.width,
    effectiveGeometry,
    effectiveOverlayRect,
    effectiveSvgBox?.height,
    effectiveSvgBox?.width,
    selectionTarget,
    viewportSize.width,
  ]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={viewportRef}
          className={cn(
            "relative h-full w-full overflow-hidden bg-[#c8ced8]",
            isPanning ? "cursor-grabbing" : spacePressed ? "cursor-grab" : "cursor-default",
          )}
          onContextMenu={handleContextMenu}
          onMouseDown={handleViewportMouseDown}
          onWheel={handleWheel}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.82),_rgba(208,214,224,0.96)_42%,_rgba(154,165,182,0.98)_100%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] bg-[size:32px_32px] opacity-45" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_0%,_transparent_58%,_rgba(15,23,42,0.12)_100%)]" />

          {!preparedSvg || !effectiveGeometry || !svgMetrics || !viewportSize.width || !viewportSize.height ? (
            <div className="relative flex h-full items-center justify-center">
              <p className="max-w-sm border border-white/60 bg-white/70 px-6 py-5 text-center text-sm text-slate-600 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
                Drop an SVG into the studio to start assigning operations, sizing the artboard, and generating an NC program.
              </p>
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
                    fill="#ffffff"
                    shadowColor="rgba(15, 23, 42, 0.2)"
                    shadowBlur={32 / zoom}
                    shadowOffset={{ x: 0, y: 18 / zoom }}
                    stroke={selectionTarget === "artboard" ? "#0ea5e9" : "rgba(148,163,184,0.7)"}
                    strokeWidth={selectionTarget === "artboard" ? 1.4 / zoom : 1 / zoom}
                    onMouseDown={handleArtboardSelect}
                    onMouseEnter={() => setHoverTarget("artboard")}
                    onMouseLeave={() => setHoverTarget((current) => (current === "artboard" ? null : current))}
                  />
                  {(selectionTarget === "artboard" || hoverTarget === "artboard") && (
                    <ObjectChrome
                      x={effectiveArtboardBox.x}
                      y={effectiveArtboardBox.y}
                      width={effectiveArtboardBox.width}
                      height={effectiveArtboardBox.height}
                      zoom={zoom}
                      tone="artboard"
                      label="Artboard"
                      helper={selectionTarget === "artboard" ? undefined : "Click to edit"}
                      subtle={selectionTarget !== "artboard"}
                    />
                  )}
                  {paddingMm > 0 && (
                    <Rect
                      x={effectiveArtboardBox.x + paddingMm}
                      y={effectiveArtboardBox.y + paddingMm}
                      width={Math.max(0, effectiveArtboardBox.width - paddingMm * 2)}
                      height={Math.max(0, effectiveArtboardBox.height - paddingMm * 2)}
                      stroke={paddingMessage ? "rgba(217,119,6,0.95)" : "rgba(14,165,233,0.42)"}
                      strokeWidth={1 / zoom}
                      dash={[10 / zoom, 8 / zoom]}
                      listening={false}
                    />
                  )}
                  <Rect
                    ref={svgRectRef}
                    x={effectiveSvgBox?.x ?? effectiveArtboardBox.x + effectiveGeometry.svgLeftMm}
                    y={effectiveSvgBox?.y ?? effectiveArtboardBox.y + effectiveGeometry.svgTopMm}
                    width={effectiveSvgBox?.width ?? effectiveGeometry.svgWidthMm}
                    height={effectiveSvgBox?.height ?? effectiveGeometry.svgHeightMm}
                    fill="rgba(16, 185, 129, 0.001)"
                    draggable={selectionTarget === "svg"}
                    onMouseDown={handleSvgSelect}
                    onMouseEnter={() => setHoverTarget("svg")}
                    onMouseLeave={() => setHoverTarget((current) => (current === "svg" ? null : current))}
                    onDragStart={handleSvgDragStart}
                    onDragMove={handleSvgDragMove}
                    onDragEnd={handleSvgDragEnd}
                    dragBoundFunc={(pos) => {
                      if (!effectiveGeometry) return pos;
                      const localX = (pos.x - pan.x) / zoom;
                      const localY = (pos.y - pan.y) / zoom;
                      const clampedX = clamp(
                        localX,
                        effectiveArtboardBox.x,
                        effectiveArtboardBox.x + effectiveGeometry.maxPlacementX
                      );
                      const clampedY = clamp(
                        localY,
                        effectiveArtboardBox.y,
                        effectiveArtboardBox.y + effectiveGeometry.maxPlacementY
                      );
                      return {
                        x: pan.x + clampedX * zoom,
                        y: pan.y + clampedY * zoom,
                      };
                    }}
                  />
                  {(selectionTarget === "svg" || hoverTarget === "svg") && (
                    <ObjectChrome
                      x={effectiveSvgBox?.x ?? effectiveArtboardBox.x + effectiveGeometry.svgLeftMm}
                      y={effectiveSvgBox?.y ?? effectiveArtboardBox.y + effectiveGeometry.svgTopMm}
                      width={effectiveSvgBox?.width ?? effectiveGeometry.svgWidthMm}
                      height={effectiveSvgBox?.height ?? effectiveGeometry.svgHeightMm}
                      zoom={zoom}
                      tone="svg"
                      label="SVG"
                      helper={selectionTarget === "svg" ? "Drag empty area" : "Click to edit"}
                      subtle={selectionTarget !== "svg"}
                    />
                  )}
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
                    anchorFill={selectionTarget === "artboard" ? "#0ea5e9" : "#10b981"}
                    anchorStroke="#ffffff"
                    anchorStrokeWidth={1 / zoom}
                    anchorCornerRadius={0}
                    anchorSize={10 / zoom}
                    borderStroke={selectionTarget === "artboard" ? "#0ea5e9" : "#10b981"}
                    borderStrokeWidth={1.25 / zoom}
                    borderDash={[10 / zoom, 6 / zoom]}
                    boundBoxFunc={transformerBoundBox}
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
                  activeOperationId={activeOperationId}
                  operationForId={operationForId}
                  interactive={selectionTarget !== "svg"}
                  onClick={handlePartClick}
                  onContextMenu={handleContextMenu}
                />
              ) : null}

              <div className="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full border border-white/70 bg-slate-950/80 px-2 py-2 text-white shadow-[0_16px_40px_rgba(15,23,42,0.24)] backdrop-blur">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-none text-white hover:bg-white/10 hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    zoomAtPoint(zoom / 1.15);
                  }}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="min-w-16 text-center text-xs font-medium">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-none text-white hover:bg-white/10 hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    zoomAtPoint(zoom * 1.15);
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 rounded-none px-3 text-white hover:bg-white/10 hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    fitView();
                  }}
                >
                  <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
                  Fit
                </Button>
              </div>

              {selectionHud && selectionTarget && (
                <div
                  className="absolute z-20 border border-white/80 bg-white/95 p-3 shadow-[0_24px_70px_rgba(15,23,42,0.18)] backdrop-blur"
                  style={{
                    left: selectionHud.left,
                    top: selectionHud.top,
                    width: selectionTarget === "svg" ? SELECTION_HUD_WIDTH : 220,
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    {selectionTarget === "artboard" ? "Artboard" : "SVG"}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <DimensionField
                      label="Width"
                      value={selectionHud.width}
                      onChange={(value) => {
                        if (selectionTarget === "artboard") {
                          onMaterialSizeChange?.("width", value);
                        } else {
                          onSvgWidthOverrideChange?.(value);
                        }
                      }}
                    />
                    <DimensionField
                      label="Height"
                      value={selectionHud.height}
                      onChange={(value) => {
                        if (!svgMetrics) {
                          return;
                        }

                        if (selectionTarget === "artboard") {
                          onMaterialSizeChange?.("height", value);
                        } else if (value !== null) {
                          onSvgWidthOverrideChange?.(roundMm(value * svgMetrics.aspectRatio));
                        }
                      }}
                    />
                  </div>

                  {selectionTarget === "svg" && (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <DimensionField
                          label="Padding"
                          value={paddingMm}
                          onChange={onPaddingChange}
                        />
                        <div className="grid gap-1.5">
                          <span className="text-[11px] font-medium text-slate-600">Align</span>
                          <div className="grid grid-cols-3 gap-1.5">
                            {ALIGNMENT_BUTTONS.map(({ action, label }) => (
                              <button
                                key={action}
                                className="border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-600 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={!!paddingMessage}
                                onClick={() => onAlign?.(action)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      {paddingMessage ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
                          {paddingMessage}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </ContextMenuTrigger>
      {contextElementId && contextOperation && (
        <ContextMenuContent className="w-52">
          <ContextMenuLabel className="text-[10px] text-muted-foreground">
            {contextOperation.name} — {contextOperation.target_depth_mm}mm
          </ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>Set depth</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-36">
              {DEPTH_PRESETS.map((depth) => (
                <ContextMenuItem
                  key={depth}
                  onClick={() => onDepthChange?.(contextOperation.id, depth)}
                >
                  <span className="flex w-full items-center justify-between">
                    <span>{depth} mm</span>
                    {contextOperation.target_depth_mm === depth ? (
                      <span className="text-primary">&#10003;</span>
                    ) : null}
                  </span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Fill mode</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-36">
              <ContextMenuItem onClick={() => onFillModeChange?.(contextOperation.id, null)}>
                <span className="flex w-full items-center justify-between">
                  <span>Default</span>
                  {!contextOperation.fill_mode ? <span className="text-primary">&#10003;</span> : null}
                </span>
              </ContextMenuItem>
              {(["Pocket", "Contour"] as const).map((mode) => (
                <ContextMenuItem
                  key={mode}
                  onClick={() => onFillModeChange?.(contextOperation.id, mode)}
                >
                  <span className="flex w-full items-center justify-between">
                    <span>{mode}</span>
                    {contextOperation.fill_mode === mode ? (
                      <span className="text-primary">&#10003;</span>
                    ) : null}
                  </span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          {operations.length > 1 ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>Assign to operation</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-44">
                  {operations.map((op) => (
                    <ContextMenuItem key={op.id} onClick={() => onAssignToOperation?.(op.id)}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: op.color ?? "#2563eb" }}
                        />
                        <span>{op.name}</span>
                        {contextOperation.id === op.id ? (
                          <span className="ml-auto text-primary">&#10003;</span>
                        ) : null}
                      </span>
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            </>
          ) : null}
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

function ObjectChrome({
  x,
  y,
  width,
  height,
  zoom,
  tone,
  label,
  helper,
  subtle = false,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
  tone: "artboard" | "svg";
  label: string;
  helper?: string;
  subtle?: boolean;
}) {
  const color =
    tone === "artboard"
      ? subtle
        ? "rgba(56,189,248,0.55)"
        : "rgba(14,165,233,0.98)"
      : subtle
        ? "rgba(52,211,153,0.6)"
        : "rgba(16,185,129,0.98)";
  const labelFill = tone === "artboard" ? "rgba(224,242,254,0.96)" : "rgba(209,250,229,0.96)";
  const labelText = tone === "artboard" ? "#0369a1" : "#047857";

  return (
    <Group listening={false}>
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        stroke={color}
        strokeWidth={1.1 / zoom}
      />
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
      <Group x={x} y={y - 28 / zoom}>
        <Tag
          fill={labelFill}
          stroke={color}
          strokeWidth={1 / zoom}
          pointerDirection="none"
          width={helper ? 118 / zoom : 70 / zoom}
          height={22 / zoom}
        />
        <Text
          x={8 / zoom}
          y={4.5 / zoom}
          fontSize={10 / zoom}
          fontStyle="bold"
          letterSpacing={1.8 / zoom}
          text={label.toUpperCase()}
          fill={labelText}
        />
        {helper ? (
          <Text
            x={52 / zoom}
            y={4.8 / zoom}
            fontSize={10 / zoom}
            text={helper}
            fill="rgba(71,85,105,0.9)"
          />
        ) : null}
      </Group>
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
        [
          x + width,
          y + height,
          x + width - span,
          y + height,
          x + width,
          y + height,
          x + width,
          y + height - span,
        ],
      ] as const).map((points, index) => (
        <Line
          key={index}
          points={[...points]}
          stroke={color}
          strokeWidth={strokeWidth}
        />
      ))}
    </>
  );
}

function DimensionField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange?: (value: number | null) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <div className="relative">
        <Input
          type="number"
          step="0.01"
          className="h-8 border-slate-200 pr-12 text-xs"
          value={value.toFixed(2)}
          onChange={(event) =>
            onChange?.(
              event.target.value === "" ? null : Number.parseFloat(event.target.value),
            )
          }
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
          mm
        </span>
      </div>
    </div>
  );
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

const ALIGNMENT_BUTTONS: Array<{ action: AlignmentAction; label: string }> = [
  { action: "left", label: "L" },
  { action: "center-x", label: "CX" },
  { action: "right", label: "R" },
  { action: "top", label: "T" },
  { action: "center-y", label: "CY" },
  { action: "bottom", label: "B" },
];
