import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { GenerateJobResponse } from "@/lib/types";

import { buildHeightField } from "./viewer/height-field";
import { parseGcodeProgram } from "./viewer/parse-gcode";

interface NcViewerProps {
  gcodeResult: GenerateJobResponse | null;
  materialWidth: number;
  materialHeight: number;
  materialThickness: number;
  toolDiameter: number;
  activeOperationId: string | null;
  visibleSegments: number;
}

export function NcViewer({
  gcodeResult,
  materialWidth,
  materialHeight,
  materialThickness,
  toolDiameter,
  activeOperationId,
  visibleSegments,
}: NcViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const parsedProgram = useMemo(() => {
    if (!gcodeResult) {
      return null;
    }
    return parseGcodeProgram(gcodeResult.gcode, gcodeResult.operation_ranges);
  }, [gcodeResult]);

  const heightField = useMemo(() => {
    if (!parsedProgram) {
      return null;
    }
    return buildHeightField(materialWidth, materialHeight, toolDiameter, parsedProgram.segments);
  }, [materialWidth, materialHeight, parsedProgram, toolDiameter]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.setClearColor(new THREE.Color("#f5f7fb"));
    container.replaceChildren(renderer.domElement);

    let viewportWidth = 0;
    let viewportHeight = 0;
    const syncViewport = () => {
      const nextWidth = Math.max(1, container.clientWidth);
      const nextHeight = Math.max(1, container.clientHeight);
      if (nextWidth === viewportWidth && nextHeight === viewportHeight) {
        return;
      }
      viewportWidth = nextWidth;
      viewportHeight = nextHeight;
      renderer.setSize(nextWidth, nextHeight, false);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f5f7fb");

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5_000);
    // Auto-zoom to fit the stock
    const diagonal = Math.sqrt(materialWidth ** 2 + materialHeight ** 2);
    const fovRad = (Math.PI * 40) / 360;
    const fitDistance = (diagonal / 2) / Math.tan(fovRad) * 1.1;
    camera.position.set(fitDistance * 0.6, -fitDistance * 0.6, fitDistance * 0.5);
    camera.up.set(0, 0, 1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, -materialThickness / 2);
    // Middle mouse button pans
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.DOLLY,
    };

    scene.add(new THREE.AmbientLight("#ffffff", 1.3));
    const directional = new THREE.DirectionalLight("#ffffff", 0.9);
    directional.position.set(materialWidth, -materialHeight, materialThickness * 3);
    scene.add(directional);

    const world = new THREE.Group();
    scene.add(world);

    const stockGeometry = new THREE.BoxGeometry(materialWidth, materialHeight, materialThickness);
    const stockMaterial = new THREE.MeshStandardMaterial({
      color: "#d6b48d",
      transparent: true,
      opacity: 0.3,
      roughness: 0.8,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const stock = new THREE.Mesh(stockGeometry, stockMaterial);
    stock.position.set(0, 0, -materialThickness / 2);
    world.add(stock);

    if (heightField) {
      const plane = new THREE.PlaneGeometry(
        heightField.width,
        heightField.height,
        heightField.cols - 1,
        heightField.rows - 1,
      );
      const positions = plane.attributes.position as THREE.BufferAttribute;
      for (let row = 0; row < heightField.rows; row += 1) {
        for (let col = 0; col < heightField.cols; col += 1) {
          const vertexIndex = row * heightField.cols + col;
          // PlaneGeometry row 0 = top (y=+h/2), height field row 0 = bottom (y=0)
          const hfRow = heightField.rows - 1 - row;
          positions.setZ(vertexIndex, heightField.values[hfRow * heightField.cols + col]);
        }
      }
      positions.needsUpdate = true;
      plane.computeVertexNormals();

      const surface = new THREE.Mesh(
        plane,
        new THREE.MeshStandardMaterial({
          color: "#f4ede3",
          roughness: 0.7,
          metalness: 0.05,
          side: THREE.DoubleSide,
        }),
      );
      world.add(surface);
    }

    if (parsedProgram && parsedProgram.segments.length > 0) {
      const operationColorMap = new Map(
        gcodeResult?.operation_ranges.map((range) => [range.operation_id, range.color ?? "#2563eb"]) ?? [],
      );
      const positions: number[] = [];
      const colors: number[] = [];
      const centerX = materialWidth / 2;
      const centerY = materialHeight / 2;
      const visible = Math.min(visibleSegments, parsedProgram.segments.length);

      for (const segment of parsedProgram.segments.slice(0, visible)) {
        const color = new THREE.Color(
          segment.command === "G0"
            ? "#94a3b8"
            : segment.operationId && operationColorMap.has(segment.operationId)
              ? operationColorMap.get(segment.operationId)!
              : "#2563eb",
        );
        if (activeOperationId && segment.command === "G1" && segment.operationId !== activeOperationId) {
          color.lerp(new THREE.Color("#cbd5e1"), 0.72);
        }

        positions.push(
          segment.start.x - centerX,
          segment.start.y - centerY,
          segment.start.z,
          segment.end.x - centerX,
          segment.end.y - centerY,
          segment.end.z,
        );
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }

      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      lineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      const lines = new THREE.LineSegments(
        lineGeometry,
        new THREE.LineBasicMaterial({ vertexColors: true }),
      );
      world.add(lines);
    }

    world.position.set(0, 0, 0);
    syncViewport();

    const observer = new ResizeObserver(() => {
      syncViewport();
    });
    observer.observe(container);

    let frameId = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(tick);
    };
    tick();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
      controls.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => material.dispose());
        } else {
          mesh.material?.dispose?.();
        }
      });
    };
  }, [
    activeOperationId,
    gcodeResult?.operation_ranges,
    heightField,
    materialHeight,
    materialThickness,
    materialWidth,
    parsedProgram,
    toolDiameter,
    visibleSegments,
  ]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
    >
      {!gcodeResult && (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-muted-foreground">Generate a job to preview the cut result.</p>
        </div>
      )}
    </div>
  );
}
