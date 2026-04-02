import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import { AppIcon, Icons } from "@/lib/icons";
import type { GenerateJobResponse } from "@/lib/types";

import { buildAccessMap } from "./viewer/access-map";
import { buildHeightField } from "./viewer/height-field";
import {
  parseGcodeProgram,
  sampleProgramAtDistance,
  type ParsedSegment,
} from "./viewer/parse-gcode";
import {
  clipSegmentToDistance,
  splitSegmentAtDistance,
} from "./viewer/playback-segment";

interface NcViewerProps {
  gcodeResult: GenerateJobResponse | null;
  activeOperationId: string | null;
  currentDistance: number;
  showStock: boolean;
  liveCutSimulation: boolean;
  cameraMode: "orthographic" | "perspective";
}

interface LayerHandles {
  geometry: LineSegmentsGeometry;
  line: LineSegments2;
}

export function NcViewer({
  gcodeResult,
  activeOperationId,
  currentDistance,
  showStock,
  liveCutSimulation,
  cameraMode,
}: NcViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playbackDistanceRef = useRef(0);
  const materialWidth = gcodeResult?.preview_snapshot.material_width ?? 100;
  const materialHeight = gcodeResult?.preview_snapshot.material_height ?? 100;
  const materialThickness = gcodeResult?.preview_snapshot.material_thickness ?? 18;
  const toolDiameter = gcodeResult?.preview_snapshot.tool_diameter ?? 6;

  const parsedProgram = useMemo(() => {
    if (!gcodeResult) {
      return null;
    }
    return parseGcodeProgram(gcodeResult.gcode, gcodeResult.operation_ranges);
  }, [gcodeResult]);

  const maxDepth = parsedProgram?.bounds?.minZ ?? 0;
  const heightField = useMemo(() => {
    if (!parsedProgram) {
      return null;
    }
    return buildHeightField(materialWidth, materialHeight, toolDiameter, parsedProgram.segments);
  }, [materialWidth, materialHeight, parsedProgram, toolDiameter]);

  const accessMap = useMemo(() => {
    if (!parsedProgram || typeof document === "undefined") {
      return null;
    }
    return buildAccessMap(
      materialWidth,
      materialHeight,
      toolDiameter,
      parsedProgram.segments,
      maxDepth,
    );
  }, [materialWidth, materialHeight, maxDepth, parsedProgram, toolDiameter]);

  useEffect(() => {
    playbackDistanceRef.current = currentDistance;
  }, [currentDistance]);

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
    renderer.setClearColor(new THREE.Color("#18181d"));
    container.replaceChildren(renderer.domElement);

    let viewportWidth = 0;
    let viewportHeight = 0;
    const lineMaterials: LineMaterial[] = [];

    const diagonal = Math.sqrt(materialWidth ** 2 + materialHeight ** 2);
    const fovRad = (Math.PI * 24) / 360;
    const fitDistance = (diagonal / 2) / Math.tan(fovRad) * 1.15;
    const orthographicSize = Math.max(materialWidth, materialHeight) * 0.8;

    const camera =
      cameraMode === "orthographic"
        ? new THREE.OrthographicCamera(-orthographicSize, orthographicSize, orthographicSize, -orthographicSize, 0.1, 5_000)
        : new THREE.PerspectiveCamera(24, 1, 0.1, 5_000);

    const syncViewport = () => {
      const nextWidth = Math.max(1, container.clientWidth);
      const nextHeight = Math.max(1, container.clientHeight);
      if (nextWidth === viewportWidth && nextHeight === viewportHeight) {
        return;
      }
      viewportWidth = nextWidth;
      viewportHeight = nextHeight;
      renderer.setSize(nextWidth, nextHeight, false);

      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = nextWidth / nextHeight;
      } else {
        const aspect = nextWidth / nextHeight;
        camera.left = -orthographicSize * aspect;
        camera.right = orthographicSize * aspect;
        camera.top = orthographicSize;
        camera.bottom = -orthographicSize;
      }

      camera.updateProjectionMatrix();
      for (const material of lineMaterials) {
        material.resolution.set(nextWidth, nextHeight);
      }
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#18181d");

    camera.position.set(0, -diagonal * 0.04, fitDistance);
    camera.up.set(0, 1, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, -materialThickness / 2);
    camera.lookAt(controls.target);
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.DOLLY,
    };

    scene.add(new THREE.AmbientLight("#e4d8c8", 1.2));
    const directional = new THREE.DirectionalLight("#ffd2a8", 0.75);
    directional.position.set(materialWidth * 0.5, -materialHeight * 0.9, materialThickness * 5);
    scene.add(directional);
    const fill = new THREE.DirectionalLight("#93c5fd", 0.55);
    fill.position.set(-materialWidth * 0.7, materialHeight * 0.8, materialThickness * 4);
    scene.add(fill);

    const world = new THREE.Group();
    scene.add(world);

    const stockMaterial = new THREE.MeshStandardMaterial({
      color: "#c9c0b6",
      transparent: true,
      opacity: showStock ? 0.95 : 0,
      roughness: 0.95,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const stock = createStockShell(
      materialWidth,
      materialHeight,
      materialThickness,
      stockMaterial,
    );
    stock.visible = showStock;
    world.add(stock);

    let surface: THREE.Mesh | null = null;
    let surfaceOverlay: THREE.Mesh | null = null;
    let accessTexture: THREE.CanvasTexture | null = null;
    let surfaceGeometry: THREE.PlaneGeometry | null = null;
    let surfaceOverlayGeometry: THREE.PlaneGeometry | null = null;

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
          const hfRow = heightField.rows - 1 - row;
          positions.setZ(vertexIndex, heightField.values[hfRow * heightField.cols + col]);
        }
      }
      positions.needsUpdate = true;
      plane.computeVertexNormals();
      surfaceGeometry = plane;

      accessTexture = accessMap ? new THREE.CanvasTexture(accessMap) : null;
      if (accessTexture) {
        accessTexture.colorSpace = THREE.SRGBColorSpace;
        accessTexture.needsUpdate = true;
      }

      surface = new THREE.Mesh(
        plane,
        new THREE.MeshStandardMaterial({
          color: "#d9d0c4",
          roughness: 0.93,
          metalness: 0.02,
          side: THREE.FrontSide,
          transparent: true,
          opacity: showStock ? 0.98 : 0,
        }),
      );
      surface.visible = showStock;
      world.add(surface);

      if (accessTexture) {
        surfaceOverlayGeometry = plane.clone();
        surfaceOverlay = new THREE.Mesh(
          surfaceOverlayGeometry,
          new THREE.MeshBasicMaterial({
            map: accessTexture,
            transparent: true,
            opacity: showStock ? 1 : 0,
            side: THREE.FrontSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
            toneMapped: false,
          }),
        );
        surfaceOverlay.visible = showStock;
        surfaceOverlay.renderOrder = 3;
        world.add(surfaceOverlay);
      }
    }

    const cutPast = createLineLayer(3, 1, lineMaterials);
    const cutFuture = createLineLayer(2.3, 0.16, lineMaterials);
    const travelPast = createLineLayer(1.8, 0.7, lineMaterials);
    const travelFuture = createLineLayer(1.4, 0.12, lineMaterials);
    const verticalPast = createLineLayer(2.4, 0.9, lineMaterials);
    const verticalFuture = createLineLayer(1.8, 0.14, lineMaterials);

    world.add(
      cutPast.line,
      cutFuture.line,
      travelPast.line,
      travelFuture.line,
      verticalPast.line,
      verticalFuture.line,
    );

    const toolLength = Math.max(materialThickness + 8, 18);
    const tool = new THREE.Group();
    const cutter = new THREE.Mesh(
      new THREE.CylinderGeometry(toolDiameter * 0.5, toolDiameter * 0.5, toolLength, 24),
      new THREE.MeshStandardMaterial({
        color: "#7BFFAF",
        roughness: 0.32,
        metalness: 0.24,
      }),
    );
    const collet = new THREE.Mesh(
      new THREE.CylinderGeometry(toolDiameter * 0.33, toolDiameter * 0.33, toolLength * 0.6, 20),
      new THREE.MeshStandardMaterial({
        color: "#d1d5db",
        roughness: 0.4,
        metalness: 0.5,
      }),
    );
    cutter.rotation.x = Math.PI / 2;
    collet.rotation.x = Math.PI / 2;
    collet.position.z = toolLength * 0.76;
    tool.add(cutter, collet);
    world.add(tool);

    const centerX = materialWidth / 2;
    const centerY = materialHeight / 2;
    let lastAppliedDistance = -1;
    let lastAppliedSurfaceDistance = Number.NaN;

    const updateSurface = (distance: number) => {
      if (!parsedProgram || !heightField || !surfaceGeometry || !accessTexture) {
        return;
      }

      const useFullCarve = !liveCutSimulation || distance >= parsedProgram.totalDistance;
      if (!useFullCarve && Math.abs(distance - lastAppliedSurfaceDistance) < Math.max(toolDiameter * 0.2, 0.2)) {
        return;
      }

      const dynamicHeightField = useFullCarve
        ? heightField
        : buildHeightField(
            materialWidth,
            materialHeight,
            toolDiameter,
            parsedProgram.segments.flatMap((segment) => {
              const clipped = clipSegmentToDistance(segment, distance);
              return clipped ? [clipped] : [];
            }),
          );
      applyHeightFieldToPlaneGeometry(surfaceGeometry, dynamicHeightField);
      if (surfaceOverlayGeometry) {
        applyHeightFieldToPlaneGeometry(surfaceOverlayGeometry, dynamicHeightField);
      }

      accessTexture.image = useFullCarve
        ? accessMap ?? accessTexture.image
        : buildAccessMap(
            materialWidth,
            materialHeight,
            toolDiameter,
            parsedProgram.segments.flatMap((segment) => {
              const clipped = clipSegmentToDistance(segment, distance);
              return clipped ? [clipped] : [];
            }),
            maxDepth,
          );
      accessTexture.needsUpdate = true;
      lastAppliedSurfaceDistance = distance;
    };

    const updateLayerGeometries = (distance: number) => {
      if (!parsedProgram) {
        return;
      }

      const buckets = {
        cutPast: createLineBuffers(),
        cutFuture: createLineBuffers(),
        travelPast: createLineBuffers(),
        travelFuture: createLineBuffers(),
        verticalPast: createLineBuffers(),
        verticalFuture: createLineBuffers(),
      };

      for (const segment of parsedProgram.segments) {
        const { past, future } = splitSegmentAtDistance(segment, distance);
        if (past) {
          const color = colorForSegment(past, activeOperationId);
          pushSegment(selectBucketForMotion(past.motionKind, true, buckets), past, color, centerX, centerY);
        }
        if (future) {
          const color = colorForSegment(future, activeOperationId);
          pushSegment(selectBucketForMotion(future.motionKind, false, buckets), future, color, centerX, centerY);
        }
      }

      applyLineBuffers(cutPast.geometry, buckets.cutPast);
      applyLineBuffers(cutFuture.geometry, buckets.cutFuture);
      applyLineBuffers(travelPast.geometry, buckets.travelPast);
      applyLineBuffers(travelFuture.geometry, buckets.travelFuture);
      applyLineBuffers(verticalPast.geometry, buckets.verticalPast);
      applyLineBuffers(verticalFuture.geometry, buckets.verticalFuture);

      const sample = sampleProgramAtDistance(parsedProgram, distance);
      tool.position.set(
        sample.position.x - centerX,
        sample.position.y - centerY,
        sample.position.z + toolLength / 2,
      );
      updateSurface(distance);
    };

    syncViewport();
    updateLayerGeometries(playbackDistanceRef.current);

    const observer = new ResizeObserver(() => {
      syncViewport();
    });
    observer.observe(container);

    let frameId = 0;
    const tick = () => {
      controls.update();
      stockMaterial.opacity = showStock ? 0.95 : 0;
      stock.visible = showStock;
      if (surface) {
        const material = surface.material as THREE.MeshStandardMaterial;
        material.opacity = showStock ? 0.98 : 0;
        surface.visible = showStock;
      }
      if (surfaceOverlay) {
        const material = surfaceOverlay.material as THREE.MeshBasicMaterial;
        material.opacity = showStock ? 1 : 0;
        surfaceOverlay.visible = showStock;
      }
      const distance = playbackDistanceRef.current;
      if (distance !== lastAppliedDistance) {
        updateLayerGeometries(distance);
        lastAppliedDistance = distance;
      }
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(tick);
    };
    tick();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
      controls.dispose();
      renderer.dispose();
      accessTexture?.dispose();
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
    accessMap,
    cameraMode,
    heightField,
    liveCutSimulation,
    materialHeight,
    materialThickness,
    materialWidth,
    maxDepth,
    parsedProgram,
    showStock,
    toolDiameter,
  ]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden">
        {!gcodeResult ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Generate a job to preview the cut result.</p>
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute left-8 top-8 z-20 rounded-[1.4rem] bg-[rgba(20,20,24,0.78)] px-4 py-4 text-white shadow-[0_18px_40px_rgba(0,0,0,0.38)] backdrop-blur-xl">
        <div className="relative h-24 w-24">
          <div className="absolute left-1/2 top-1/2 h-12 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-white/85" />
          <div className="absolute left-1/2 top-1/2 h-0.5 w-12 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-white/85" />
          <div className="absolute left-1/2 top-1/2 h-0.5 w-12 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-white/85" />
          <AxisBubble className="left-1/2 top-0 -translate-x-1/2 bg-[#3F7DFF]" label="Z" />
          <AxisBubble className="left-0 top-1/2 -translate-y-1/2 bg-[#FF4E4E]" label="X" />
          <AxisBubble className="right-0 top-1/2 -translate-y-1/2 bg-[#37D86F]" label="Y" />
          <AxisBubble className="left-[18%] top-[14%] bg-[#37D86F]" />
          <AxisBubble className="right-[16%] top-[18%] bg-[#FF4E4E]" />
          <AxisBubble className="left-[48%] bottom-[8%] -translate-x-1/2 bg-[#3F7DFF]" />
        </div>
      </div>

      <div className="pointer-events-none absolute right-8 top-8 z-20 rounded-[1.15rem] bg-[rgba(20,20,24,0.82)] px-6 py-4 text-[1.05rem] text-white shadow-[0_18px_40px_rgba(0,0,0,0.38)] backdrop-blur-xl">
        <span className="inline-flex items-center gap-3">
          <span>{cameraMode === "orthographic" ? "100 %" : "Perspective"}</span>
          <AppIcon icon={Icons.chevronDown} className="h-4 w-4 text-white/55" />
        </span>
      </div>
    </div>
  );
}

function AxisBubble({
  className,
  label,
}: {
  className: string;
  label?: string;
}) {
  return (
    <div className={`absolute inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white ${className}`}>
      {label}
    </div>
  );
}

function createLineLayer(
  linewidth: number,
  opacity: number,
  materials: LineMaterial[],
): LayerHandles {
  const geometry = new LineSegmentsGeometry();
  const material = new LineMaterial({
    linewidth,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    worldUnits: false,
  });
  materials.push(material);

  const line = new LineSegments2(geometry, material);
  line.frustumCulled = false;
  return { geometry, line };
}

function createStockShell(
  width: number,
  height: number,
  thickness: number,
  material: THREE.Material,
) {
  const shell = new THREE.Group();

  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  bottom.position.z = -thickness;
  shell.add(bottom);

  const front = new THREE.Mesh(new THREE.PlaneGeometry(width, thickness), material);
  front.rotation.x = Math.PI / 2;
  front.position.set(0, height / 2, -thickness / 2);
  shell.add(front);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(width, thickness), material);
  back.rotation.x = -Math.PI / 2;
  back.position.set(0, -height / 2, -thickness / 2);
  shell.add(back);

  const right = new THREE.Mesh(new THREE.PlaneGeometry(height, thickness), material);
  right.rotation.y = Math.PI / 2;
  right.position.set(width / 2, 0, -thickness / 2);
  shell.add(right);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(height, thickness), material);
  left.rotation.y = -Math.PI / 2;
  left.position.set(-width / 2, 0, -thickness / 2);
  shell.add(left);

  return shell;
}

function createLineBuffers() {
  return {
    positions: [] as number[],
    colors: [] as number[],
  };
}

function selectBucketForMotion(
  motionKind: ParsedSegment["motionKind"],
  played: boolean,
  buckets: Record<string, ReturnType<typeof createLineBuffers>>,
) {
  if (motionKind === "cut") {
    return played ? buckets.cutPast : buckets.cutFuture;
  }
  if (motionKind === "rapid") {
    return played ? buckets.travelPast : buckets.travelFuture;
  }
  return played ? buckets.verticalPast : buckets.verticalFuture;
}

function colorForSegment(segment: ParsedSegment, activeOperationId: string | null) {
  let color = new THREE.Color("#67B8FF");

  if (segment.motionKind === "rapid") {
    color = new THREE.Color("#94a3b8");
  } else if (segment.motionKind === "plunge") {
    color = new THREE.Color("#fb7185");
  } else if (segment.motionKind === "retract") {
    color = new THREE.Color("#67B8FF");
  } else if (segment.operationColor) {
    color = new THREE.Color(segment.operationColor);
  }

  if (
    activeOperationId &&
    segment.operationId &&
    segment.operationId !== activeOperationId &&
    segment.motionKind === "cut"
  ) {
    color.lerp(new THREE.Color("#cbd5e1"), 0.7);
  }

  return color;
}

function pushSegment(
  target: ReturnType<typeof createLineBuffers>,
  segment: ParsedSegment,
  color: THREE.Color,
  centerX: number,
  centerY: number,
) {
  target.positions.push(
    segment.start.x - centerX,
    segment.start.y - centerY,
    segment.start.z,
    segment.end.x - centerX,
    segment.end.y - centerY,
    segment.end.z,
  );
  target.colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
}

function applyLineBuffers(
  geometry: LineSegmentsGeometry,
  buffers: ReturnType<typeof createLineBuffers>,
) {
  if (buffers.positions.length === 0) {
    geometry.setPositions(new Float32Array(0));
    geometry.setColors(new Float32Array(0));
    return;
  }

  geometry.setPositions(buffers.positions);
  geometry.setColors(buffers.colors);
}

function applyHeightFieldToPlaneGeometry(
  geometry: THREE.PlaneGeometry,
  heightField: ReturnType<typeof buildHeightField>,
) {
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  for (let row = 0; row < heightField.rows; row += 1) {
    for (let col = 0; col < heightField.cols; col += 1) {
      const vertexIndex = row * heightField.cols + col;
      const hfRow = heightField.rows - 1 - row;
      positions.setZ(vertexIndex, heightField.values[hfRow * heightField.cols + col]);
    }
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
}
