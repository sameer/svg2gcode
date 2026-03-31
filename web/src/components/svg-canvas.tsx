import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import type { FillMode, FrontendOperation, PreparedSvgDocument } from "@/lib/types";

const DEPTH_PRESETS = [0.5, 1, 1.5, 2, 3, 5, 10];

interface SvgCanvasProps {
  preparedSvg: PreparedSvgDocument | null;
  operations: FrontendOperation[];
  selectedIds: string[];
  activeOperationId: string | null;
  materialWidth?: number;
  materialHeight?: number;
  placementX?: number;
  placementY?: number;
  onSelectIds: (ids: string[], additive: boolean) => void;
  onDepthChange?: (operationId: string, value: number) => void;
  onFillModeChange?: (operationId: string, value: FillMode | null) => void;
  onAssignToOperation?: (operationId: string) => void;
  onPlacementChange?: (x: number, y: number) => void;
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
  onSelectIds,
  onDepthChange,
  onFillModeChange,
  onAssignToOperation,
  onPlacementChange,
}: SvgCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stockOverlayRef = useRef<SVGSVGElement | null>(null);
  const [contextElementId, setContextElementId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; startPlacementX: number; startPlacementY: number } | null>(null);

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

  // Get the SVG viewBox dimensions for coordinate mapping
  const svgDimensions = useMemo(() => {
    if (!preparedSvg) return null;
    const parser = new DOMParser();
    const doc = parser.parseFromString(preparedSvg.normalized_svg, "image/svg+xml");
    const svgEl = doc.querySelector("svg");
    if (!svgEl) return null;

    const viewBox = svgEl.getAttribute("viewBox");
    if (viewBox) {
      const parts = viewBox.split(/[\s,]+/).map(Number);
      if (parts.length === 4) {
        return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
      }
    }
    const w = parseFloat(svgEl.getAttribute("width") ?? "100");
    const h = parseFloat(svgEl.getAttribute("height") ?? "100");
    return { x: 0, y: 0, width: w, height: h };
  }, [preparedSvg]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !preparedSvg) {
      return;
    }

    host.innerHTML = preparedSvg.normalized_svg;
    const rootSvg = host.querySelector("svg");
    if (!rootSvg) {
      return;
    }

    rootSvg.setAttribute("width", "100%");
    rootSvg.setAttribute("height", "100%");
    rootSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    rootSvg.classList.add("h-full", "w-full");

    for (const element of rootSvg.querySelectorAll<SVGElement>("[data-s2g-id]")) {
      const id = element.getAttribute("data-s2g-id");
      if (!id) {
        continue;
      }

      const operation = operationForId.get(id);
      const isSelected = selectedIds.includes(id);
      const isActive = activeOperationId ? operation?.id === activeOperationId : true;
      element.style.cursor = "pointer";
      element.style.transition = "opacity 120ms ease, filter 120ms ease, stroke-width 120ms ease";
      element.style.opacity = isActive ? "1" : "0.28";

      if (operation?.color) {
        element.style.filter = `drop-shadow(0 0 0.35rem ${operation.color}55)`;
      } else {
        element.style.removeProperty("filter");
      }

      if (isSelected) {
        element.style.stroke = "#0f172a";
        element.style.strokeWidth = "2.2";
        element.style.vectorEffect = "non-scaling-stroke";
      }
    }
  }, [activeOperationId, operationForId, preparedSvg, selectedIds]);

  // Stock overlay: position the overlay SVG to match the main SVG's layout
  useEffect(() => {
    if (!stockOverlayRef.current || !hostRef.current || !svgDimensions) return;
    const rootSvg = hostRef.current.querySelector("svg");
    if (!rootSvg) return;

    const overlay = stockOverlayRef.current;
    // Match the viewBox so our stock rect coordinates align with the SVG content
    overlay.setAttribute(
      "viewBox",
      `${svgDimensions.x} ${svgDimensions.y} ${svgDimensions.width} ${svgDimensions.height}`,
    );
  }, [svgDimensions]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) return;
    const target = event.target as HTMLElement;
    const selectable = target.closest("[data-s2g-id]");
    if (!(selectable instanceof SVGElement)) {
      return;
    }

    const id = selectable.getAttribute("data-s2g-id");
    if (!id) {
      return;
    }

    onSelectIds([id], event.metaKey || event.ctrlKey || event.shiftKey);
  };

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
    },
    [selectedIds, onSelectIds],
  );

  // Drag to reposition the stock rectangle (which moves placement offset)
  const handleStockMouseDown = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(true);
      dragStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        startPlacementX: placementX,
        startPlacementY: placementY,
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!dragStartRef.current || !stockOverlayRef.current || !svgDimensions) return;

        const overlay = stockOverlayRef.current;
        const rect = overlay.getBoundingClientRect();

        // Convert pixel delta to SVG coordinate delta
        const scaleX = svgDimensions.width / rect.width;
        const scaleY = svgDimensions.height / rect.height;
        const dx = (e.clientX - dragStartRef.current.x) * scaleX;
        const dy = (e.clientY - dragStartRef.current.y) * scaleY;

        // Stock moves = placement moves in opposite direction
        // Moving stock right means SVG content is offset left relative to stock
        onPlacementChange?.(
          Math.round((dragStartRef.current.startPlacementX - dx) * 100) / 100,
          Math.round((dragStartRef.current.startPlacementY - dy) * 100) / 100,
        );
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        dragStartRef.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [placementX, placementY, svgDimensions, onPlacementChange],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="relative h-full w-full overflow-hidden bg-[linear-gradient(145deg,#ffffff_0%,#f6f8fc_48%,#eef2ff_100%)]"
          onClick={handleClick}
          onContextMenu={handleContextMenu}
        >
          {!preparedSvg ? (
            <div className="flex h-full items-center justify-center">
              <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">
                Drop an SVG into the studio to start assigning operations and generating an NC program.
              </p>
            </div>
          ) : (
            <>
              <div ref={hostRef} className="h-full w-full p-4" />
              {svgDimensions && (
                <svg
                  ref={stockOverlayRef}
                  className="pointer-events-none absolute inset-0 h-full w-full p-4"
                  viewBox={`${svgDimensions.x} ${svgDimensions.y} ${svgDimensions.width} ${svgDimensions.height}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <rect
                    x={svgDimensions.x + placementX}
                    y={svgDimensions.y + placementY}
                    width={materialWidth}
                    height={materialHeight}
                    fill="none"
                    stroke="#0ea5e9"
                    strokeWidth={svgDimensions.width * 0.003}
                    strokeDasharray={`${svgDimensions.width * 0.008} ${svgDimensions.width * 0.005}`}
                    opacity={0.6}
                    className="pointer-events-auto cursor-move"
                    onMouseDown={handleStockMouseDown}
                  />
                  <text
                    x={svgDimensions.x + placementX + 2}
                    y={svgDimensions.y + placementY - svgDimensions.height * 0.008}
                    fontSize={svgDimensions.width * 0.018}
                    fill="#0ea5e9"
                    opacity={0.7}
                  >
                    Stock {materialWidth}×{materialHeight}mm
                  </text>
                </svg>
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
                    {contextOperation.target_depth_mm === depth && (
                      <span className="text-primary">&#10003;</span>
                    )}
                  </span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Fill mode</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-36">
              <ContextMenuItem
                onClick={() => onFillModeChange?.(contextOperation.id, null)}
              >
                <span className="flex w-full items-center justify-between">
                  <span>Default</span>
                  {!contextOperation.fill_mode && (
                    <span className="text-primary">&#10003;</span>
                  )}
                </span>
              </ContextMenuItem>
              {(["Pocket", "Contour"] as const).map((mode) => (
                <ContextMenuItem
                  key={mode}
                  onClick={() => onFillModeChange?.(contextOperation.id, mode)}
                >
                  <span className="flex w-full items-center justify-between">
                    <span>{mode}</span>
                    {contextOperation.fill_mode === mode && (
                      <span className="text-primary">&#10003;</span>
                    )}
                  </span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          {operations.length > 1 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>Assign to operation</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-44">
                  {operations.map((op) => (
                    <ContextMenuItem
                      key={op.id}
                      onClick={() => onAssignToOperation?.(op.id)}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: op.color ?? "#2563eb" }}
                        />
                        <span>{op.name}</span>
                        {contextOperation.id === op.id && (
                          <span className="ml-auto text-primary">&#10003;</span>
                        )}
                      </span>
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            </>
          )}
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
