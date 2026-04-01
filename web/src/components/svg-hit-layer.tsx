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
  activeOperationId: string | null;
  operationForId: Map<string, FrontendOperation>;
  interactiveIds?: string[] | null;
  interactive?: boolean;
  onHostReady?: (host: HTMLDivElement | null) => void;
  onClick: (event: MouseEvent) => void;
  onDoubleClick?: (event: MouseEvent) => void;
}

export function SvgHitLayer({
  normalizedSvg,
  rect,
  selectedIds,
  activeOperationId,
  operationForId,
  interactiveIds,
  interactive = true,
  onHostReady,
  onClick,
  onDoubleClick,
}: SvgHitLayerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const interactiveIdSet = useMemo(
    () => (interactiveIds ? new Set(interactiveIds) : null),
    [interactiveIds],
  );

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

    const applyElementPresentation = (element: SVGElement) => {
      const id = element.getAttribute("data-s2g-id");
      if (!id) {
        return;
      }

      const operation = operationForId.get(id);
      const isSelected = selectedIds.includes(id);
      const isHovered = element.dataset.s2gHovered === "true";
      const isActive = activeOperationId ? operation?.id === activeOperationId : true;
      const isInteractive = interactive && (!interactiveIdSet || interactiveIdSet.has(id));

      element.style.pointerEvents = isInteractive ? "auto" : "none";
      element.style.cursor = isInteractive ? "pointer" : "default";
      element.style.transition =
        "opacity 120ms ease, filter 120ms ease, stroke-width 120ms ease, stroke 120ms ease";
      element.style.opacity = isActive && (!interactiveIdSet || interactiveIdSet.has(id)) ? "1" : "0.22";

      if (isSelected) {
        element.style.stroke = "#0f172a";
        element.style.strokeWidth = "2.2";
        element.style.vectorEffect = "non-scaling-stroke";
      } else if (isHovered && isInteractive) {
        element.style.stroke = "#2563eb";
        element.style.strokeWidth = "2";
        element.style.vectorEffect = "non-scaling-stroke";
      } else {
        element.style.removeProperty("stroke");
        element.style.removeProperty("stroke-width");
        element.style.removeProperty("vector-effect");
      }

      if (operation?.color) {
        element.style.filter = `drop-shadow(0 0 0.35rem ${operation.color}55)`;
      } else if (isHovered && isInteractive) {
        element.style.filter = "drop-shadow(0 0 0.4rem rgba(37,99,235,0.28))";
      } else {
        element.style.removeProperty("filter");
      }
    };

    for (const element of rootSvg.querySelectorAll<SVGElement>("[data-s2g-id]")) {
      applyElementPresentation(element);
    }

    const handleClick = (event: MouseEvent) => {
      onClick(event);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      onDoubleClick?.(event);
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
      applyElementPresentation(selectable);
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
      applyElementPresentation(selectable);
    };

    rootSvg.addEventListener("click", handleClick);
    rootSvg.addEventListener("dblclick", handleDoubleClick);
    rootSvg.addEventListener("mouseover", handleMouseOver);
    rootSvg.addEventListener("mouseout", handleMouseOut);

    return () => {
      rootSvg.removeEventListener("click", handleClick);
      rootSvg.removeEventListener("dblclick", handleDoubleClick);
      rootSvg.removeEventListener("mouseover", handleMouseOver);
      rootSvg.removeEventListener("mouseout", handleMouseOut);
    };
  }, [activeOperationId, interactive, interactiveIdSet, normalizedSvg, onClick, onDoubleClick, operationForId, selectedIds]);

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
