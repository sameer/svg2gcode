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
  interactive?: boolean;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export function SvgHitLayer({
  normalizedSvg,
  rect,
  selectedIds,
  activeOperationId,
  operationForId,
  interactive = true,
  onClick,
  onContextMenu,
}: SvgHitLayerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

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

    for (const element of rootSvg.querySelectorAll<SVGElement>("[data-s2g-id]")) {
      const id = element.getAttribute("data-s2g-id");
      if (!id) {
        continue;
      }

      const operation = operationForId.get(id);
      const isSelected = selectedIds.includes(id);
      const isActive = activeOperationId ? operation?.id === activeOperationId : true;
      element.style.pointerEvents = interactive ? "auto" : "none";
      element.style.cursor = interactive ? "pointer" : "default";
      element.style.transition = "opacity 120ms ease, filter 120ms ease, stroke-width 120ms ease";
      element.style.opacity = isActive ? "1" : "0.22";

      if (operation?.color) {
        element.style.filter = `drop-shadow(0 0 0.35rem ${operation.color}55)`;
      } else {
        element.style.removeProperty("filter");
      }

      if (isSelected) {
        element.style.stroke = "#0f172a";
        element.style.strokeWidth = "2.2";
        element.style.vectorEffect = "non-scaling-stroke";
      } else {
        element.style.removeProperty("stroke");
        element.style.removeProperty("stroke-width");
        element.style.removeProperty("vector-effect");
      }
    }
  }, [activeOperationId, interactive, normalizedSvg, operationForId, selectedIds]);

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
        className="pointer-events-none h-full w-full"
        onClick={onClick}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}
