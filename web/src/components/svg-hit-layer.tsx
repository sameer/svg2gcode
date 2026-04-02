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
  activeProfileKey: string | null;
  operationForId: Map<string, FrontendOperation>;
  showOperationOutlines: boolean;
  svgSelected: boolean;
  editMode: boolean;
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
  activeProfileKey: string | null;
  operationForId: Map<string, FrontendOperation>;
  showOperationOutlines: boolean;
  svgSelected: boolean;
  editMode: boolean;
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
    activeProfileKey,
    operationForId,
    showOperationOutlines,
    svgSelected,
    editMode,
    interactive,
    interactiveIdSet,
  } = state;
  const operation = operationForId.get(id);
  const isSelected = selectedIds.includes(id);
  const isPreviewSelected = previewSelectedIdSet?.has(id) ?? false;
  const isHovered = element.dataset.s2gHovered === "true";
  const operationProfileKey = operation?.id.startsWith("profile-") ? operation.id.slice("profile-".length) : null;
  const isProfilePreviewed = !!activeProfileKey && activeProfileKey === operationProfileKey;
  const isActive = activeOperationId ? operation?.id === activeOperationId : true;
  const isInteractive = interactive && (!interactiveIdSet || interactiveIdSet.has(id));
  const operationColor = operation?.color ?? "#ef4444";
  const fallbackOutline = "#8ea0b8";
  const woodTone = showOperationOutlines
    ? {
        fill: "rgba(255, 255, 255, 0.035)",
        stroke: "rgba(142, 160, 184, 0.8)",
        highlightStroke: "rgba(226, 235, 248, 0.95)",
        glow: "rgba(103, 184, 255, 0.2)",
      }
    : {
        fill: "rgba(86, 53, 31, 0.16)",
        stroke: "rgba(90, 56, 33, 0.58)",
        highlightStroke: "rgba(98, 60, 34, 0.82)",
        glow: "rgba(62, 37, 18, 0.24)",
      };
  const mappedTone = {
    stroke: rgba(operationColor, showOperationOutlines ? 0.98 : 0.92),
    strongStroke: rgba(operationColor, 1),
    fill: rgba(operationColor, showOperationOutlines ? 0.055 : 0.1),
    strongFill: rgba(operationColor, showOperationOutlines ? 0.11 : 0.14),
    glow: rgba(operationColor, showOperationOutlines ? 0.3 : 0.24),
  };
  const outlineTone = {
    stroke: operation ? mappedTone.stroke : rgba(fallbackOutline, 0.78),
    strongStroke: operation ? mappedTone.strongStroke : rgba(fallbackOutline, 0.96),
    fill: operation ? mappedTone.fill : "rgba(190, 204, 224, 0.03)",
    strongFill: operation ? mappedTone.strongFill : "rgba(190, 204, 224, 0.08)",
    glow: operation ? mappedTone.glow : "rgba(103, 184, 255, 0.18)",
  };

  element.style.pointerEvents = isInteractive ? "auto" : "none";
  element.style.cursor = isInteractive ? "pointer" : "default";
  element.style.transition =
    "opacity 120ms ease, filter 120ms ease, stroke-width 120ms ease, stroke 120ms ease";
  element.style.opacity = showOperationOutlines
    ? (!interactiveIdSet || interactiveIdSet.has(id) ? "1" : "0.5")
    : isActive && (!interactiveIdSet || interactiveIdSet.has(id))
      ? "1"
      : "0.22";

  const isHighlighted = !isSelected && (isPreviewSelected || isProfilePreviewed || (editMode && isHovered && isInteractive));
  const baseTone = showOperationOutlines ? outlineTone : mappedTone;
  const showMappedStroke = showOperationOutlines || isSelected || isHighlighted || svgSelected;
  element.style.fill = showOperationOutlines ? baseTone.fill : woodTone.fill;
  element.style.strokeLinecap = "round";
  element.style.strokeLinejoin = "round";
  if (isSelected) {
    element.style.stroke = baseTone.strongStroke;
    element.style.strokeWidth = editMode ? (showOperationOutlines ? "2.3" : "2") : "1.8";
    element.style.fill = showOperationOutlines ? baseTone.strongFill : editMode ? mappedTone.strongFill : woodTone.fill;
    element.style.vectorEffect = "non-scaling-stroke";
  } else if (isHighlighted) {
    element.style.stroke = baseTone.stroke;
    element.style.strokeWidth = editMode ? (showOperationOutlines ? "2" : "1.7") : "1.45";
    element.style.fill = showOperationOutlines
      ? editMode || isProfilePreviewed
        ? baseTone.strongFill
        : baseTone.fill
      : editMode || isProfilePreviewed
        ? mappedTone.fill
        : woodTone.fill;
    element.style.vectorEffect = "non-scaling-stroke";
  } else if (svgSelected) {
    element.style.stroke = baseTone.stroke;
    element.style.strokeWidth = showOperationOutlines ? "1.5" : "1.15";
    element.style.fill = showOperationOutlines ? baseTone.fill : woodTone.fill;
    element.style.vectorEffect = "non-scaling-stroke";
  } else {
    element.style.stroke = showOperationOutlines ? baseTone.stroke : woodTone.stroke;
    element.style.strokeWidth = showOperationOutlines ? "1.45" : "0.7";
    element.style.fill = showOperationOutlines ? baseTone.fill : woodTone.fill;
    element.style.vectorEffect = "non-scaling-stroke";
  }

  if (showMappedStroke) {
    element.style.filter =
      `drop-shadow(0 1px 0 rgba(255,255,255,0.07)) drop-shadow(0 -1px 1px rgba(36,46,60,0.22)) drop-shadow(0 1.2px 1.6px rgba(22,30,44,0.16)) drop-shadow(0 0 0.32rem ${baseTone.glow})`;
  } else {
    element.style.filter =
      showOperationOutlines
        ? "drop-shadow(0 1px 0 rgba(255,255,255,0.04)) drop-shadow(0 -1.4px 1.1px rgba(28,38,51,0.18)) drop-shadow(0 1.6px 1.8px rgba(17,24,39,0.1))"
        : "drop-shadow(0 0.5px 0 rgba(255,255,255,0.04)) drop-shadow(0 -1.2px 0.9px rgba(40,24,13,0.24)) drop-shadow(0 1px 1.4px rgba(60,36,20,0.14))";
  }
}

export function SvgHitLayer({
  normalizedSvg,
  rect,
  selectedIds,
  previewSelectedIds,
  activeOperationId,
  activeProfileKey,
  operationForId,
  showOperationOutlines,
  svgSelected,
  editMode,
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

  const previewSelectedIdSet = useMemo(
    () => (previewSelectedIds && previewSelectedIds.length > 0 ? new Set(previewSelectedIds) : null),
    [previewSelectedIds],
  );

  // Stable ref for presentation state — updated every render so hover handlers see latest values
  const presentationStateRef = useRef<PresentationState>({
    selectedIds,
    previewSelectedIdSet,
    activeOperationId,
    activeProfileKey,
    operationForId,
    showOperationOutlines,
    svgSelected,
    editMode,
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
      activeProfileKey,
      operationForId,
      showOperationOutlines,
      svgSelected,
      editMode,
      interactive,
      interactiveIdSet,
    };
  }, [
    activeOperationId,
    activeProfileKey,
    editMode,
    interactive,
    interactiveIdSet,
    onClick,
    onDoubleClick,
    onMouseDown,
    operationForId,
    previewSelectedIdSet,
    selectedIds,
    showOperationOutlines,
    svgSelected,
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
    rootSvg.style.opacity = editMode ? "0.96" : showOperationOutlines ? "0.98" : "0.82";
    rootSvg.style.filter = showOperationOutlines
      ? "saturate(1.08) contrast(1.03)"
      : editMode
        ? "saturate(1.02) contrast(1.04)"
        : "saturate(0.9) contrast(0.97)";

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

    host.addEventListener("click", handleClick);
    host.addEventListener("dblclick", handleDoubleClick);
    host.addEventListener("mousedown", handleMouseDown);
    host.addEventListener("mouseover", handleMouseOver);
    host.addEventListener("mouseout", handleMouseOut);

    return () => {
      host.removeEventListener("click", handleClick);
      host.removeEventListener("dblclick", handleDoubleClick);
      host.removeEventListener("mousedown", handleMouseDown);
      host.removeEventListener("mouseover", handleMouseOver);
      host.removeEventListener("mouseout", handleMouseOut);
    };
  }, [editMode, interactive, normalizedSvg, showOperationOutlines]);

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
    rootSvg.style.opacity = editMode ? "0.96" : showOperationOutlines ? "0.98" : "0.82";
    rootSvg.style.filter = showOperationOutlines
      ? "saturate(1.08) contrast(1.03)"
      : editMode
        ? "saturate(1.02) contrast(1.04)"
        : "saturate(0.9) contrast(0.97)";
    rootSvg.style.pointerEvents = "none";
    const state: PresentationState = {
      selectedIds,
      previewSelectedIdSet,
      activeOperationId,
      activeProfileKey,
      operationForId,
      showOperationOutlines,
      svgSelected,
      editMode,
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
    activeProfileKey,
    operationForId,
    showOperationOutlines,
    svgSelected,
    editMode,
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
        style={{ pointerEvents: interactive ? "auto" : "none" }}
      />
    </div>
  );
}

function rgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
