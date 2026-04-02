import { useEffect, useMemo, useRef } from "react";

import type { FrontendOperation } from "@/lib/types";

interface SvgHitLayerProps {
  normalizedSvg: string;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  selectedIds: string[];
  previewSelectedIds?: string[];
  activeOperationId: string | null;
  operationForId: Map<string, FrontendOperation>;
  interactiveIds?: string[] | null;
  interactive?: boolean;
  onHostReady?: (host: HTMLDivElement | null) => void;
  onClick: (event: MouseEvent) => void;
  onDoubleClick?: (event: MouseEvent) => void;
  onMouseDown?: (event: MouseEvent) => void;
}

type PresentationState = {
  selectedIds: string[];
  previewSelectedIdSet: Set<string> | null;
  activeOperationId: string | null;
  operationForId: Map<string, FrontendOperation>;
  minDepthMm: number;
  maxDepthMm: number;
  interactive: boolean;
  interactiveIdSet: Set<string> | null;
};

function applyElementPresentation(element: SVGElement, state: PresentationState) {
  const id = element.getAttribute("data-s2g-id");
  if (!id) {
    return;
  }

  const {
    selectedIds,
    previewSelectedIdSet,
    activeOperationId,
    operationForId,
    minDepthMm,
    maxDepthMm,
    interactive,
    interactiveIdSet,
  } = state;
  const operation = operationForId.get(id);
  const isSelected = selectedIds.includes(id);
  const isPreviewSelected = previewSelectedIdSet?.has(id) ?? false;
  const isHovered = element.dataset.s2gHovered === "true";
  const isActive = activeOperationId ? operation?.id === activeOperationId : true;
  const isInteractive = interactive && (!interactiveIdSet || interactiveIdSet.has(id));
  const opDepth = operation?.target_depth_mm;
  const depthMm = typeof opDepth === "number" && Number.isFinite(opDepth) ? opDepth : minDepthMm;
  const depthRatio = getDepthRatio(depthMm, minDepthMm, maxDepthMm);
  const fillColor = mixHex("#5f3c24", "#190f09", depthRatio);
  const strokeColor = mixHex("#3d2718", "#0f0906", depthRatio);

  element.style.pointerEvents = isInteractive ? "auto" : "none";
  element.style.cursor = isInteractive ? "pointer" : "default";
  element.style.transition =
    "opacity 120ms ease, filter 120ms ease, stroke-width 120ms ease, stroke 120ms ease";
  element.style.opacity = isActive && (!interactiveIdSet || interactiveIdSet.has(id)) ? "1" : "0.22";

  const isBlueHighlighted = !isSelected && (isPreviewSelected || (isHovered && isInteractive));
  element.style.fill = fillColor;
  element.style.strokeLinecap = "round";
  element.style.strokeLinejoin = "round";
  if (isSelected) {
    element.style.stroke = "#2563eb";
    element.style.strokeWidth = "2.2";
    element.style.vectorEffect = "non-scaling-stroke";
  } else if (isBlueHighlighted) {
    element.style.stroke = "#2563eb";
    element.style.strokeWidth = "2";
    element.style.vectorEffect = "non-scaling-stroke";
  } else {
    element.style.stroke = strokeColor;
    element.style.strokeWidth = "1";
    element.style.vectorEffect = "non-scaling-stroke";
  }

  if (isBlueHighlighted || isSelected) {
    element.style.filter =
      "drop-shadow(0 1px 0 rgba(255,255,255,0.12)) drop-shadow(0 -1px 1px rgba(34,22,12,0.48)) drop-shadow(0 0 0.4rem rgba(37,99,235,0.28))";
  } else {
    element.style.filter =
      "drop-shadow(0 1px 0 rgba(255,255,255,0.14)) drop-shadow(0 -1.5px 1px rgba(31,20,11,0.52))";
  }
}

export function SvgHitLayer({
  normalizedSvg,
  rect,
  selectedIds,
  previewSelectedIds,
  activeOperationId,
  operationForId,
  interactiveIds,
  interactive = true,
  onHostReady,
  onClick,
  onDoubleClick,
  onMouseDown,
}: SvgHitLayerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Stable refs for callbacks — updated every render without re-subscribing listeners
  const onClickRef = useRef(onClick);
  const onDoubleClickRef = useRef(onDoubleClick);
  const onMouseDownRef = useRef(onMouseDown);

  const interactiveIdSet = useMemo(() => {
    if (!interactiveIds || interactiveIds.length === 0) {
      return null;
    }
    return new Set(interactiveIds);
  }, [interactiveIds]);

  const { minDepthMm, maxDepthMm } = useMemo(() => {
    const depths: number[] = [];
    for (const operation of operationForId.values()) {
      if (Number.isFinite(operation.target_depth_mm)) {
        depths.push(operation.target_depth_mm);
      }
    }
    if (depths.length === 0) {
      return { minDepthMm: 0, maxDepthMm: 1 };
    }
    return {
      minDepthMm: Math.min(...depths),
      maxDepthMm: Math.max(...depths),
    };
  }, [operationForId]);

  const previewSelectedIdSet = useMemo(
    () => (previewSelectedIds && previewSelectedIds.length > 0 ? new Set(previewSelectedIds) : null),
    [previewSelectedIds],
  );

  // Stable ref for presentation state — updated every render so hover handlers see latest values
  const presentationStateRef = useRef<PresentationState>({
    selectedIds,
    previewSelectedIdSet,
    activeOperationId,
    operationForId,
    minDepthMm: 0,
    maxDepthMm: 1,
    interactive,
    interactiveIdSet,
  });

  const normalizedRect = useMemo(
    () => ({
      left: Math.round(rect.left * 100) / 100,
      top: Math.round(rect.top * 100) / 100,
      width: Math.max(1, Math.round(rect.width * 100) / 100),
      height: Math.max(1, Math.round(rect.height * 100) / 100),
    }),
    [rect.height, rect.left, rect.top, rect.width],
  );

  useEffect(() => {
    const host = hostRef.current;
    onHostReady?.(host);
    return () => onHostReady?.(null);
  }, [onHostReady]);

  useEffect(() => {
    onClickRef.current = onClick;
    onDoubleClickRef.current = onDoubleClick;
    onMouseDownRef.current = onMouseDown;
    presentationStateRef.current = {
      selectedIds,
      previewSelectedIdSet,
      activeOperationId,
      operationForId,
      minDepthMm,
      maxDepthMm,
      interactive,
      interactiveIdSet,
    };
  }, [
    activeOperationId,
    interactive,
    interactiveIdSet,
    maxDepthMm,
    minDepthMm,
    onClick,
    onDoubleClick,
    onMouseDown,
    operationForId,
    previewSelectedIdSet,
    selectedIds,
  ]);

  // Effect 1: DOM injection — only re-runs when normalizedSvg changes.
  // This preserves DOM nodes across selection state changes so the browser's
  // dblclick detection (which tracks the element from the first click) still works.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    host.innerHTML = normalizedSvg;
    const rootSvg = host.querySelector("svg");
    if (!rootSvg) {
      return;
    }

    rootSvg.setAttribute("width", "100%");
    rootSvg.setAttribute("height", "100%");
    rootSvg.setAttribute("preserveAspectRatio", "none");
    rootSvg.classList.add("h-full", "w-full");
    rootSvg.style.display = "block";
    rootSvg.style.pointerEvents = "none";
    rootSvg.style.overflow = "visible";
    rootSvg.style.opacity = "0.76";
    rootSvg.style.filter = "saturate(0.86) contrast(0.95)";

    const handleClick = (event: MouseEvent) => {
      onClickRef.current(event);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      onDoubleClickRef.current?.(event);
    };

    const handleMouseDown = (event: MouseEvent) => {
      onMouseDownRef.current?.(event);
    };

    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const selectable = target.closest("[data-s2g-id]");
      if (!(selectable instanceof SVGElement)) {
        return;
      }
      selectable.dataset.s2gHovered = "true";
      applyElementPresentation(selectable, presentationStateRef.current);
    };

    const handleMouseOut = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const selectable = target.closest("[data-s2g-id]");
      if (!(selectable instanceof SVGElement)) {
        return;
      }
      selectable.dataset.s2gHovered = "false";
      applyElementPresentation(selectable, presentationStateRef.current);
    };

    rootSvg.addEventListener("click", handleClick);
    rootSvg.addEventListener("dblclick", handleDoubleClick);
    rootSvg.addEventListener("mousedown", handleMouseDown);
    rootSvg.addEventListener("mouseover", handleMouseOver);
    rootSvg.addEventListener("mouseout", handleMouseOut);

    return () => {
      rootSvg.removeEventListener("click", handleClick);
      rootSvg.removeEventListener("dblclick", handleDoubleClick);
      rootSvg.removeEventListener("mousedown", handleMouseDown);
      rootSvg.removeEventListener("mouseover", handleMouseOver);
      rootSvg.removeEventListener("mouseout", handleMouseOut);
    };
  }, [normalizedSvg]);

  // Effect 2: Presentation updates — runs when selection/operation state changes.
  // Queries existing DOM nodes and updates their styles without touching innerHTML.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const rootSvg = host.querySelector("svg");
    if (!rootSvg) {
      return;
    }
    const state: PresentationState = {
      selectedIds,
      previewSelectedIdSet,
      activeOperationId,
      operationForId,
      minDepthMm,
      maxDepthMm,
      interactive,
      interactiveIdSet,
    };
    for (const element of rootSvg.querySelectorAll<SVGElement>("[data-s2g-id]")) {
      applyElementPresentation(element, state);
    }
  }, [
    selectedIds,
    previewSelectedIdSet,
    activeOperationId,
    operationForId,
    minDepthMm,
    maxDepthMm,
    interactive,
    interactiveIdSet,
    normalizedSvg,
  ]);

  return (
    <div
      className="absolute overflow-visible"
      style={{
        left: normalizedRect.left,
        top: normalizedRect.top,
        width: normalizedRect.width,
        height: normalizedRect.height,
        pointerEvents: "none",
      }}
    >
      <div
        ref={hostRef}
        className="h-full w-full"
        style={{ pointerEvents: "none" }}
      />
    </div>
  );
}

function getDepthRatio(depthMm: number, minDepthMm: number, maxDepthMm: number) {
  const span = maxDepthMm - minDepthMm;
  if (span <= 0.0001) {
    return 0;
  }
  return Math.min(1, Math.max(0, (depthMm - minDepthMm) / span));
}

function mixHex(from: string, to: string, ratio: number) {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const t = Math.min(1, Math.max(0, ratio));
  const r = Math.round(start.r + (end.r - start.r) * t);
  const g = Math.round(start.g + (end.g - start.g) * t);
  const b = Math.round(start.b + (end.b - start.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}
