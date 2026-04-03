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

// Illustrator-like color constants
const SELECTION_BLUE = "#2D8CFF";
const HOVER_BLUE = "#5BA3FF";
const SUBTLE_SHADOW = "drop-shadow(0 0.5px 0 rgba(255,255,255,0.04)) drop-shadow(0 -0.8px 0.6px rgba(20,20,30,0.18)) drop-shadow(0 0.8px 1px rgba(15,15,25,0.12))";

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
  const isHighlighted = !isSelected && (isPreviewSelected || isProfilePreviewed || (editMode && isHovered && isInteractive));

  // Pointer events & cursor
  element.style.pointerEvents = isInteractive ? "auto" : "none";
  element.style.cursor = isInteractive ? "pointer" : "default";
  element.style.transition = "opacity 120ms ease, filter 120ms ease, stroke-width 120ms ease, stroke 120ms ease";
  element.style.strokeLinecap = "round";
  element.style.strokeLinejoin = "round";
  element.style.vectorEffect = "non-scaling-stroke";

  // Opacity — dim inactive/non-interactive elements
  const isInScope = !interactiveIdSet || interactiveIdSet.has(id);
  element.style.opacity = isActive && isInScope ? "1" : "0.18";

  // Priority-based styling: selected > highlighted > svgSelected > normal
  if (isSelected) {
    element.style.stroke = SELECTION_BLUE;
    element.style.strokeWidth = editMode ? "2.2" : "1.8";
    element.style.fill = "rgba(45, 140, 255, 0.08)";
    element.style.filter = `${SUBTLE_SHADOW} drop-shadow(0 0 0.3rem rgba(45, 140, 255, 0.3))`;
  } else if (isHighlighted) {
    element.style.stroke = HOVER_BLUE;
    element.style.strokeWidth = editMode ? "1.8" : "1.5";
    element.style.fill = "rgba(45, 140, 255, 0.04)";
    element.style.filter = `${SUBTLE_SHADOW} drop-shadow(0 0 0.2rem rgba(45, 140, 255, 0.2))`;
  } else if (svgSelected) {
    // Art object is selected — show operation colors at medium intensity
    element.style.stroke = showOperationOutlines
      ? rgba(operationColor, 0.65)
      : "rgba(90, 56, 33, 0.50)";
    element.style.strokeWidth = showOperationOutlines ? "1.3" : "1.0";
    element.style.fill = showOperationOutlines
      ? rgba(operationColor, 0.04)
      : "rgba(86, 53, 31, 0.10)";
    element.style.filter = SUBTLE_SHADOW;
  } else if (showOperationOutlines) {
    // Normal with outlines on — muted operation colors for depth differentiation
    element.style.stroke = rgba(operationColor, 0.40);
    element.style.strokeWidth = "1.0";
    element.style.fill = rgba(operationColor, 0.02);
    element.style.filter = SUBTLE_SHADOW;
  } else {
    // Normal with outlines off — subtle wood tone
    element.style.stroke = "rgba(90, 56, 33, 0.40)";
    element.style.strokeWidth = "0.7";
    element.style.fill = "rgba(86, 53, 31, 0.10)";
    element.style.filter = "drop-shadow(0 0.5px 0 rgba(255,255,255,0.04)) drop-shadow(0 -1px 0.7px rgba(40,24,13,0.20)) drop-shadow(0 0.8px 1px rgba(60,36,20,0.12))";
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
        className="hit-layer-host h-full w-full"
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
