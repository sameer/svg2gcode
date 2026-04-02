import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Button } from "@heroui/react";
import { Group, Layer, Rect, Stage, Transformer } from "react-konva";
import { LocationArrowFill } from "@gravity-ui/icons";

import { SvgHitLayer } from "@/components/svg-hit-layer";
import { useSvgCanvasController } from "@/components/use-svg-canvas-controller";
import { withCompositeElementIds } from "@/lib/art-objects";
import { AppIcon, type AppIconComponent, Icons } from "@/lib/icons";
import { MATERIAL_PRESETS, type MaterialPresetId } from "@/lib/material-presets";
import type {
  ArtObject,
  DiveRootScope,
  EditorSelection,
  FrontendOperation,
} from "@/lib/types";
import { clamp, cn } from "@/lib/utils";

type CanvasBox = { x: number; y: number; width: number; height: number };
type InteractionMode = "default" | "direct-pick" | "pan";
type MarqueeRect = { left: number; top: number; width: number; height: number };

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
  onSelectionChange: (value: EditorSelection) => void;
  onSelectIds: (artObjectId: string, ids: string[], additive: boolean) => void;
  onSelectMaterial: () => void;
  onEnterSvgDiveMode: (artObjectId: string) => void;
  onExitSvgDiveMode: () => void;
  onImportClick?: () => void;
  onMaterialSizeChange?: (dimension: "width" | "height", value: number | null) => void;
  onArtObjectPlacementChange?: (artObjectId: string, x: number, y: number) => void;
  onArtObjectSizeChange?: (artObjectId: string, width: number | null, height: number | null) => void;
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
  onSelectionChange,
  onSelectIds,
  onSelectMaterial,
  onEnterSvgDiveMode,
  onExitSvgDiveMode,
  onImportClick,
  onMaterialSizeChange,
  onArtObjectPlacementChange,
  onArtObjectSizeChange,
  onShowOperationOutlinesChange,
}: SvgCanvasProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const artboardRef = useRef<Konva.Rect | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const artObjectRectRefs = useRef<Record<string, Konva.Rect | null>>({});
  const hitLayerHostRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [liveMaterialBox, setLiveMaterialBox] = useState<CanvasBox | null>(null);
  const [liveArtObjectBox, setLiveArtObjectBox] = useState<{ artObjectId: string; box: CanvasBox } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [marqueeHoverIds, setMarqueeHoverIds] = useState<string[]>([]);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("default");
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
    handleWheel,
    handleViewportMouseDown,
  } = useSvgCanvasController({
    hasContent: artObjects.length > 0,
    fitToken,
    materialWidth,
    materialHeight,
    panToolActive: interactionMode === "pan",
    onSelectionChange,
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
  const selectedArtObject = selectedArtObjectId
    ? artObjects.find((artObject) => artObject.id === selectedArtObjectId) ?? null
    : null;
  const directPickEnabled = modifierDirectPick || interactionMode === "direct-pick";
  const panToolActive = interactionMode === "pan";

  const materialBox = liveMaterialBox ?? { x: 0, y: 0, width: materialWidth, height: materialHeight };
  const artObjectBoxes = useMemo(
    () =>
      Object.fromEntries(
        artObjects.map((artObject) => {
          const liveBox =
            liveArtObjectBox && liveArtObjectBox.artObjectId === artObject.id ? liveArtObjectBox.box : null;
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
    [artObjects, liveArtObjectBox, materialHeight],
  );

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    if (selection.type === "material" && artboardRef.current) {
      transformer.nodes([artboardRef.current]);
    } else if (selectedArtObjectId) {
      const node = artObjectRectRefs.current[selectedArtObjectId];
      transformer.nodes(node ? [node] : []);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [selectedArtObjectId, selection.type]);

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

  const handleStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (spacePressed || panToolActive) {
        return;
      }
      const stage = event.target.getStage();
      if (!stage || event.target !== stage) {
        return;
      }
      onSelectionChange({ type: "none" });
    },
    [onSelectionChange, panToolActive, spacePressed],
  );

  const handleMaterialSelect = useCallback(() => {
    if (panToolActive) {
      return;
    }
    onSelectMaterial();
  }, [onSelectMaterial, panToolActive]);

  const handleArtObjectSelect = useCallback(
    (artObjectId: string) => {
      if (panToolActive) {
        return;
      }
      onSelectionChange({ type: "art-object", artObjectId });
    },
    [onSelectionChange, panToolActive],
  );

  const handlePartClick = useCallback(
    (artObjectId: string) => (event: MouseEvent) => {
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
      if (isDiveMode || directPickEnabled || event.metaKey || event.ctrlKey || event.shiftKey) {
        onSelectIds(artObjectId, [id], event.metaKey || event.ctrlKey || event.shiftKey);
        return;
      }

      onSelectionChange({ type: "art-object", artObjectId });
    },
    [directPickEnabled, isDiveMode, onSelectIds, onSelectionChange, panToolActive],
  );

  const handlePartDoubleClick = useCallback(
    (artObjectId: string) => (event: MouseEvent) => {
      if (directPickEnabled || panToolActive) {
        return;
      }
      event.stopPropagation();
      if (isDiveMode && selectedArtObjectId === artObjectId) {
        onExitSvgDiveMode();
      } else {
        onEnterSvgDiveMode(artObjectId);
      }
    },
    [directPickEnabled, isDiveMode, onEnterSvgDiveMode, onExitSvgDiveMode, panToolActive, selectedArtObjectId],
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
          onSelectionChange({ type: "elements", artObjectId, elementIds: [] });
        }
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [onSelectIds, onSelectionChange, viewportRef],
  );

  const handleHitLayerMouseDown = useCallback(
    (artObjectId: string) => (event: MouseEvent) => {
      if (spacePressed || panToolActive) {
        return;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      startMarquee(
        artObjectId,
        {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        },
        event.shiftKey || event.metaKey || event.ctrlKey,
        5,
      );
    },
    [panToolActive, spacePressed, startMarquee, viewportRef],
  );

  const handleArtObjectDragStart = useCallback(
    (artObjectId: string) => {
      const node = artObjectRectRefs.current[artObjectId];
      const box = artObjectBoxes[artObjectId];
      if (!node || !box) {
        return;
      }

      syncRectNode(node, box);
      setLiveArtObjectBox({ artObjectId, box });
    },
    [artObjectBoxes],
  );

  const handleArtObjectDragMove = useCallback(
    (artObjectId: string) => {
      const node = artObjectRectRefs.current[artObjectId];
      if (!node) {
        return;
      }

      const box = normalizeRectNode(node);
      const nextX = clamp(box.x, 0, Math.max(0, materialWidth - box.width));
      const nextY = clamp(box.y, 0, Math.max(0, materialHeight - box.height));
      const nextBox = {
        x: nextX,
        y: nextY,
        width: box.width,
        height: box.height,
      };

      syncRectNode(node, nextBox);
      setLiveArtObjectBox({ artObjectId, box: nextBox });
      onArtObjectPlacementChange?.(
        artObjectId,
        roundMm(nextX),
        roundMm(materialHeight - nextY - nextBox.height),
      );
    },
    [materialHeight, materialWidth, onArtObjectPlacementChange],
  );

  const handleArtObjectDragEnd = useCallback(
    (artObjectId: string) => {
      const node = artObjectRectRefs.current[artObjectId];
      if (!node) {
        return;
      }

      const box = normalizeRectNode(node);
      const nextX = clamp(box.x, 0, Math.max(0, materialWidth - box.width));
      const nextY = clamp(box.y, 0, Math.max(0, materialHeight - box.height));
      syncRectNode(node, {
        x: nextX,
        y: nextY,
        width: box.width,
        height: box.height,
      });
      setLiveArtObjectBox(null);
      onArtObjectPlacementChange?.(artObjectId, roundMm(nextX), roundMm(materialHeight - nextY - box.height));
    },
    [materialHeight, materialWidth, onArtObjectPlacementChange],
  );

  const handleTransformEnd = useCallback(() => {
    const transformer = transformerRef.current;
    const node = transformer?.nodes()[0];
    if (!node) {
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

    if (!selectedArtObjectId) {
      return;
    }

    const rectNode = artObjectRectRefs.current[selectedArtObjectId];
    if (!rectNode) {
      return;
    }

    const normalized = normalizeRectNode(rectNode);
    setLiveArtObjectBox(null);
    onArtObjectPlacementChange?.(
      selectedArtObjectId,
      roundMm(normalized.x),
      roundMm(materialHeight - normalized.y - normalized.height),
    );
    onArtObjectSizeChange?.(selectedArtObjectId, roundMm(normalized.width), roundMm(normalized.height));
  }, [
    materialHeight,
    onArtObjectPlacementChange,
    onArtObjectSizeChange,
    onMaterialSizeChange,
    selectedArtObjectId,
    selection.type,
    setPan,
    zoom,
  ]);

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

      if (selection.type === "material") {
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
          >
            <Layer>
              <Rect
                ref={artboardRef}
                x={materialBox.x}
                y={materialBox.y}
                width={materialBox.width}
                height={materialBox.height}
                fill={isDiveMode ? "rgba(106, 75, 51, 0.48)" : "#6a4b33"}
                cornerRadius={2 / zoom}
                stroke={selection.type === "material" ? "#73bbff" : "rgba(132, 94, 62, 0.55)"}
                strokeWidth={selection.type === "material" ? 1.4 / zoom : 1 / zoom}
                listening={!isDiveMode}
                onMouseDown={handleMaterialSelect}
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
                const box = artObjectBoxes[artObject.id];
                const selected = selectedArtObjectId === artObject.id;
                return (
                  <Group key={artObject.id}>
                    <Rect
                      ref={(node) => {
                        artObjectRectRefs.current[artObject.id] = node;
                      }}
                      x={box.x}
                      y={box.y}
                      width={box.width}
                      height={box.height}
                      fill="transparent"
                      stroke={selected || hoverTarget === "art-object" ? "rgba(115,187,255,0.95)" : "rgba(115,187,255,0.32)"}
                      strokeWidth={selected ? 1.35 / zoom : 1 / zoom}
                      dash={selected ? [6 / zoom, 4 / zoom] : [4 / zoom, 4 / zoom]}
                      draggable={selected && !isDiveMode}
                      onMouseDown={() => handleArtObjectSelect(artObject.id)}
                      onDblClick={() => (isDiveMode && selected ? onExitSvgDiveMode() : onEnterSvgDiveMode(artObject.id))}
                      onMouseEnter={() => setHoverTarget("art-object")}
                      onMouseLeave={() => setHoverTarget((current) => (current === "art-object" ? null : current))}
                      onDragStart={() => handleArtObjectDragStart(artObject.id)}
                      onDragMove={() => handleArtObjectDragMove(artObject.id)}
                      onDragEnd={() => handleArtObjectDragEnd(artObject.id)}
                      dragBoundFunc={(pos) => {
                        const localX = (pos.x - pan.x) / zoom;
                        const localY = (pos.y - pan.y) / zoom;
                        return {
                          x: clamp(localX, 0, Math.max(0, materialWidth - box.width)) * zoom + pan.x,
                          y: clamp(localY, 0, Math.max(0, materialHeight - box.height)) * zoom + pan.y,
                        };
                      }}
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
                boundBoxFunc={transformerBoundBox}
                onTransform={() => {
                  if (selection.type === "material" && artboardRef.current) {
                    setLiveMaterialBox(normalizeRectNode(artboardRef.current));
                    return;
                  }
                  if (selectedArtObjectId) {
                    const node = artObjectRectRefs.current[selectedArtObjectId];
                    if (node) {
                      setLiveArtObjectBox({ artObjectId: selectedArtObjectId, box: normalizeRectNode(node) });
                    }
                  }
                }}
                onTransformEnd={handleTransformEnd}
              />
            </Layer>
          </Stage>

          {artObjects.map((artObject) => {
            const box = artObjectBoxes[artObject.id];
            const rect = toViewportRect(box);
            if (!rect) {
              return null;
            }
            const interactiveIds =
              activeDiveRoot?.artObjectId === artObject.id
                ? activeDiveRoot.elementIds
                : isDiveMode && selectedArtObjectId === artObject.id
                  ? artObject.preparedSvg.selectable_element_ids.map((elementId) => `${artObject.id}::${elementId}`)
                  : directPickEnabled && selectedArtObjectId === artObject.id
                    ? artObject.preparedSvg.selectable_element_ids.map((elementId) => `${artObject.id}::${elementId}`)
                    : [];
            const hitLayerInteractive =
              (isDiveMode && selectedArtObjectId === artObject.id) ||
              (directPickEnabled && selectedArtObjectId === artObject.id);

            return (
              <SvgHitLayer
                key={`hit-${artObject.id}`}
                normalizedSvg={withCompositeElementIds(artObject.preparedSvg.normalized_svg, artObject.id)}
                rect={rect}
                selectedIds={selection.type === "elements" && selection.artObjectId === artObject.id ? selection.elementIds : []}
                previewSelectedIds={[...hoveredIds, ...marqueeHoverIds]}
                activeOperationId={activeOperationId}
                activeProfileKey={activeProfileKey}
                operationForId={operationForId}
                showOperationOutlines={showOperationOutlines}
                svgSelected={selectedArtObjectId === artObject.id}
                editMode={isDiveMode && selectedArtObjectId === artObject.id}
                interactive={hitLayerInteractive}
                interactiveIds={interactiveIds}
                onHostReady={(host) => {
                  hitLayerHostRefs.current[artObject.id] = host;
                }}
                onClick={handlePartClick(artObject.id)}
                onDoubleClick={handlePartDoubleClick(artObject.id)}
                onMouseDown={isDiveMode || directPickEnabled ? handleHitLayerMouseDown(artObject.id) : undefined}
              />
            );
          })}

          <div className="pointer-events-none absolute inset-x-0 bottom-7 z-20 flex justify-center px-6">
            <div className="pointer-events-auto flex items-center gap-2 rounded-[1.75rem] border border-white/10 bg-[rgba(19,19,23,0.9)] px-4 py-3 text-white shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className={interactionMode === "direct-pick" ? "bg-white/[0.14] text-white" : "text-white/75"}
                onPress={() => setInteractionMode((current) => (current === "direct-pick" ? "default" : "direct-pick"))}
              >
                <LocationArrowFill className="h-5 w-5" />
              </Button>
              <ToolbarButton
                icon={Icons.hand}
                active={interactionMode === "pan"}
                onClick={() => setInteractionMode((current) => (current === "pan" ? "default" : "pan"))}
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
              <Button size="sm" variant="ghost" className="min-w-12 px-3 font-medium uppercase tracking-[0.08em] text-white/80" onPress={fitView}>
                Fit
              </Button>
            </div>
          </div>
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
