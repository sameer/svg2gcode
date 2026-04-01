import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import type { GenerateJobResponse } from "@/lib/types";
import { clamp } from "@/lib/utils";

import { PreviewTimeline } from "./preview-timeline";
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
}

interface LayerHandles {
  geometry: LineSegmentsGeometry;
  line: LineSegments2;
}

export function NcViewer({
  gcodeResult,
  activeOperationId,
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

  const [showStock, setShowStock] = useState(true);
  const [liveCutSimulation, setLiveCutSimulation] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentDistance, setCurrentDistance] = useState(0);

  useEffect(() => {
    const totalDistance = parsedProgram?.totalDistance ?? 0;
    playbackDistanceRef.current = totalDistance;
    const frameId = window.requestAnimationFrame(() => {
      setCurrentDistance(totalDistance);
      setIsPlaying(false);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [parsedProgram?.totalDistance]);

  useEffect(() => {
    playbackDistanceRef.current = currentDistance;
  }, [currentDistance]);

  useEffect(() => {
    if (!isPlaying || !parsedProgram) {
      return;
    }

    let frameId = 0;
    let lastFrame = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - lastFrame) / 1000;
      lastFrame = now;
      const baseDistancePerSecond = Math.max(parsedProgram.totalDistance / 18, 45);

      setCurrentDistance((distance) => {
        const next = Math.min(
          parsedProgram.totalDistance,
          distance + elapsed * baseDistancePerSecond * playbackRate,
        );
        if (next >= parsedProgram.totalDistance) {
          setIsPlaying(false);
          return parsedProgram.totalDistance;
        }
        return next;
      });

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [isPlaying, parsedProgram, playbackRate]);

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
    renderer.setClearColor(new THREE.Color("#edf0f6"));
    container.replaceChildren(renderer.domElement);

    let viewportWidth = 0;
    let viewportHeight = 0;
    const lineMaterials: LineMaterial[] = [];
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
      for (const material of lineMaterials) {
        material.resolution.set(nextWidth, nextHeight);
      }
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#edf0f6");

    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 5_000);
    const diagonal = Math.sqrt(materialWidth ** 2 + materialHeight ** 2);
    const fovRad = (Math.PI * 24) / 360;
    const fitDistance = (diagonal / 2) / Math.tan(fovRad) * 1.15;
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

    scene.add(new THREE.AmbientLight("#ffffff", 1.5));
    const directional = new THREE.DirectionalLight("#fff7ed", 1.05);
    directional.position.set(materialWidth * 0.5, -materialHeight * 0.9, materialThickness * 5);
    scene.add(directional);

    const world = new THREE.Group();
    scene.add(world);

    const stockMaterial = new THREE.MeshStandardMaterial({
      color: "#d8ba95",
      transparent: true,
      opacity: showStock ? 0.12 : 0,
      roughness: 0.9,
      metalness: 0.01,
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
          color: "#e9d8bf",
          roughness: 0.82,
          metalness: 0.03,
          side: THREE.FrontSide,
          transparent: true,
          opacity: showStock ? 0.94 : 0,
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
        color: "#f59e0b",
        roughness: 0.32,
        metalness: 0.15,
      }),
    );
    const collet = new THREE.Mesh(
      new THREE.CylinderGeometry(toolDiameter * 0.33, toolDiameter * 0.33, toolLength * 0.6, 20),
      new THREE.MeshStandardMaterial({
        color: "#475569",
        roughness: 0.4,
        metalness: 0.35,
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
      stockMaterial.opacity = showStock ? 0.12 : 0;
      stock.visible = showStock;
      if (surface) {
        const material = surface.material as THREE.MeshStandardMaterial;
        material.opacity = showStock ? 0.94 : 0;
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
    heightField,
    materialHeight,
    materialThickness,
    materialWidth,
    maxDepth,
    parsedProgram,
    showStock,
    liveCutSimulation,
    toolDiameter,
  ]);

  const handleTogglePlaying = () => {
    if (!parsedProgram) {
      return;
    }
    if (currentDistance >= parsedProgram.totalDistance) {
      const restartDistance = 0;
      playbackDistanceRef.current = restartDistance;
      setCurrentDistance(restartDistance);
    }
    setIsPlaying((value) => !value);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden"
      >
        {!gcodeResult && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Generate a job to preview the cut result.</p>
          </div>
        )}
      </div>
      <PreviewTimeline
        program={parsedProgram}
        currentDistance={currentDistance}
        isPlaying={isPlaying}
        playbackRate={playbackRate}
        showStock={showStock}
        liveCutSimulation={liveCutSimulation}
        activeOperationId={activeOperationId}
        onDistanceChange={(distance) => {
          const nextDistance = clamp(distance, 0, parsedProgram?.totalDistance ?? 0);
          playbackDistanceRef.current = nextDistance;
          setCurrentDistance(nextDistance);
          setIsPlaying(false);
        }}
        onTogglePlaying={handleTogglePlaying}
        onPlaybackRateChange={setPlaybackRate}
        onShowStockChange={setShowStock}
        onLiveCutSimulationChange={setLiveCutSimulation}
      />
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
  let color = new THREE.Color("#2563eb");

  if (segment.motionKind === "rapid") {
    color = new THREE.Color("#94a3b8");
  } else if (segment.motionKind === "plunge") {
    color = new THREE.Color("#f97316");
  } else if (segment.motionKind === "retract") {
    color = new THREE.Color("#38bdf8");
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
