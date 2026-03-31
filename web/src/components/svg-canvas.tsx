import { useEffect, useMemo, useRef } from "react";

import type { FrontendOperation, PreparedSvgDocument } from "@/lib/types";

interface SvgCanvasProps {
  preparedSvg: PreparedSvgDocument | null;
  operations: FrontendOperation[];
  selectedIds: string[];
  activeOperationId: string | null;
  onSelectIds: (ids: string[], additive: boolean) => void;
}

export function SvgCanvas({
  preparedSvg,
  operations,
  selectedIds,
  activeOperationId,
  onSelectIds,
}: SvgCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  const operationForId = useMemo(() => {
    const map = new Map<string, FrontendOperation>();
    for (const operation of operations) {
      for (const id of operation.assigned_element_ids) {
        map.set(id, operation);
      }
    }
    return map;
  }, [operations]);

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

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
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

  return (
    <div
      className="h-full w-full overflow-hidden bg-[linear-gradient(145deg,#ffffff_0%,#f6f8fc_48%,#eef2ff_100%)]"
      onClick={handleClick}
    >
      {!preparedSvg ? (
        <div className="flex h-full items-center justify-center">
          <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">
            Drop an SVG into the studio to start assigning operations and generating an NC program.
          </p>
        </div>
      ) : (
        <div ref={hostRef} className="h-full w-full p-4" />
      )}
    </div>
  );
}
