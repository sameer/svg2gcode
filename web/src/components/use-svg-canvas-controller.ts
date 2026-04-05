import { useCallback, useEffect, useRef, useState } from "react";

import { clamp } from "@/lib/utils";

const FIT_MARGIN_PX = 72;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 12;

interface UseSvgCanvasControllerOptions {
  hasContent: boolean;
  fitToken: string;
  materialWidth: number;
  materialHeight: number;
  panToolActive?: boolean;
  onClearSelection: () => void;
}

export function useSvgCanvasController({
  hasContent,
  fitToken,
  materialWidth,
  materialHeight,
  panToolActive = false,
  onClearSelection,
}: UseSvgCanvasControllerOptions) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panSessionRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number } | null>(null);
  const fitKeyRef = useRef<string>("");
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoverTarget, setHoverTarget] = useState<"material" | "art-object" | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);

  const toViewportRect = useCallback(
    (box: { x: number; y: number; width: number; height: number } | null) => {
      if (!box) {
        return null;
      }

      return {
        left: pan.x + box.x * zoom,
        top: pan.y + box.y * zoom,
        width: box.width * zoom,
        height: box.height * zoom,
      };
    },
    [pan.x, pan.y, zoom],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setViewportSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isTyping =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement;
      if (isTyping || event.code !== "Space" || event.repeat) {
        return;
      }

      event.preventDefault();
      setSpacePressed(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const fitView = useCallback(() => {
    if (!viewportSize.width || !viewportSize.height) {
      return;
    }

    const nextZoom = clamp(
      Math.min(
        (viewportSize.width - FIT_MARGIN_PX * 2) / Math.max(materialWidth, 1),
        (viewportSize.height - FIT_MARGIN_PX * 2) / Math.max(materialHeight, 1),
      ),
      MIN_ZOOM,
      MAX_ZOOM,
    );

    setZoom(nextZoom);
    setPan({
      x: (viewportSize.width - materialWidth * nextZoom) / 2,
      y: (viewportSize.height - materialHeight * nextZoom) / 2,
    });
  }, [materialHeight, materialWidth, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    if (!hasContent || !viewportSize.width || !viewportSize.height) {
      return;
    }

    const nextKey = `${fitToken}::${viewportSize.width}x${viewportSize.height}`;
    if (fitKeyRef.current === nextKey) {
      return;
    }

    fitKeyRef.current = nextKey;
    const frameId = window.requestAnimationFrame(() => {
      fitView();
      onClearSelection();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [fitToken, fitView, hasContent, onClearSelection, viewportSize.height, viewportSize.width]);

  const zoomAtPoint = useCallback(
    (nextZoom: number, anchorClientPoint?: { x: number; y: number }) => {
      if (!viewportRef.current) {
        return;
      }

      const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      const rect = viewportRef.current.getBoundingClientRect();
      const anchor = anchorClientPoint ?? {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      const localAnchor = {
        x: anchor.x - rect.left,
        y: anchor.y - rect.top,
      };
      const worldAnchor = {
        x: (localAnchor.x - pan.x) / zoom,
        y: (localAnchor.y - pan.y) / zoom,
      };

      setZoom(clampedZoom);
      setPan({
        x: localAnchor.x - worldAnchor.x * clampedZoom,
        y: localAnchor.y - worldAnchor.y * clampedZoom,
      });
    },
    [pan.x, pan.y, zoom],
  );

  const setAbsoluteZoom = useCallback(
    (nextZoom: number) => {
      zoomAtPoint(nextZoom);
    },
    [zoomAtPoint],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!hasContent) {
        return;
      }

      event.preventDefault();
      const multiplier = event.deltaY < 0 ? 1.12 : 0.9;
      zoomAtPoint(zoom * multiplier, { x: event.clientX, y: event.clientY });
    },
    [hasContent, zoom, zoomAtPoint],
  );

  const handleViewportMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!hasContent) {
        return;
      }

      const isPanGesture = event.button === 1 || (event.button === 0 && (spacePressed || panToolActive));
      if (!isPanGesture) {
        return;
      }

      event.preventDefault();
      setIsPanning(true);
      panSessionRef.current = {
        x: event.clientX,
        y: event.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!panSessionRef.current) {
          return;
        }

        setPan({
          x: panSessionRef.current.startPanX + (moveEvent.clientX - panSessionRef.current.x),
          y: panSessionRef.current.startPanY + (moveEvent.clientY - panSessionRef.current.y),
        });
      };

      const handleMouseUp = () => {
        setIsPanning(false);
        panSessionRef.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [hasContent, pan.x, pan.y, panToolActive, spacePressed],
  );

  return {
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
    setAbsoluteZoom,
    handleWheel,
    handleViewportMouseDown,
  };
}
