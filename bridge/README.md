# @svg2gcode/bridge

Framework-agnostic module that bridges your UI to the svg2gcode WASM converter. SVG with settings goes in, GCode comes out.

## Quick Start

```typescript
import {
  ensureWasmReady,
  loadDefaultSettings,
  prepareSvgDocument,
  createArtObject,
  composeArtObjectsSvg,
  getDerivedOperationsForArtObjects,
  generateEngravingJob,
} from "@svg2gcode/bridge";

// 1. Initialize WASM (once at startup)
await ensureWasmReady("/path/to/svg2gcode_wasm_bg.wasm");

// 2. Load default settings
const settings = await loadDefaultSettings();

// 3. Prepare an SVG (parses + normalizes + builds element tree)
const prepared = await prepareSvgDocument(svgString);

// 4. Create an art object (positions it on the material)
const artObject = createArtObject({
  artObjectId: "art-1",
  name: "my-design.svg",
  preparedSvg: prepared,
  settings,
  defaultEngraveType: "pocket",
  existingArtObjects: [],
});

// 5. Derive operations from element assignments
const operations = getDerivedOperationsForArtObjects([artObject]);

// 6. Compose SVG and generate GCode
const composedSvg = composeArtObjectsSvg([artObject], settings);
const result = await generateEngravingJob({
  normalized_svg: composedSvg,
  settings,
  operations,
});

// result.gcode — the generated GCode string
// result.warnings — any generation warnings
// result.operation_ranges — line number ranges per operation
// result.preview_snapshot — material/tool dimensions for viewer
```

## API Reference

### WASM Lifecycle

| Function | Description |
|----------|-------------|
| `ensureWasmReady(wasmUrl?)` | Initialize the WASM module. Call once at startup. |
| `loadDefaultSettings()` | Get default `Settings` with engraving enabled. |
| `prepareSvgDocument(svg)` | Parse + normalize SVG, returns `PreparedSvgDocument`. |
| `generateEngravingJob(request, onProgress?)` | Convert SVG to GCode. Returns `GenerateJobResponse`. |

### Art Objects

| Function | Description |
|----------|-------------|
| `createArtObject(params)` | Create an `ArtObject` from a prepared SVG. Browser-only. |
| `composeArtObjectsSvg(artObjects, settings)` | Merge multiple art objects into one SVG for conversion. Browser-only. |
| `getDerivedOperationsForArtObjects(artObjects)` | Derive `FrontendOperation[]` from element assignments. |
| `getAutoPlacement(params)` | Calculate auto-placement position for a new art object. |
| `resizeArtObjectWithAspect(artObject, w, h, settings)` | Resize with aspect ratio lock. |
| `buildCompositeElementId(artObjectId, elementId)` | Create a composite ID (`artObjectId::elementId`). |
| `splitCompositeElementId(compositeId)` | Split composite ID back to parts. |
| `cloneTreeWithCompositeIds(tree, artObjectId)` | Clone SVG tree with composite IDs. |

### Settings

| Function | Description |
|----------|-------------|
| `setNumberAtPath(settings, path, value)` | Set a numeric value by dot-path (e.g. `"engraving.tool_diameter"`). |
| `computeRecommendedAdvancedValues(settings, engraveType)` | Get recommended stepdown/stepover/feedrates based on tool diameter. |
| `applyRecommendedSettings(settings, overrides, engraveType)` | Apply recommendations, respecting user overrides. |
| `MATERIAL_PRESETS` | Material data: `{ Oak, MDF, OSB }` with `defaultDepthMm` and `defaultPasses`. |

### Engraving

| Function | Description |
|----------|-------------|
| `engraveTypeToFillMode(engraveType)` | `"pocket"` → `"Pocket"`, `"outline"` → `"Contour"`. |
| `fillModeToEngraveType(fillMode)` | `"Pocket"` → `"pocket"`, `"Contour"` → `"outline"`. |
| `engraveTypeLabel(engraveType)` | Human-readable label. |
| `isSupportedEngraveType(engraveType)` | `outline` and `pocket` are supported; `raster`/`skeleton` are not yet. |

### Geometry

| Function | Description |
|----------|-------------|
| `parseSvgDocumentMetrics(svg)` | Extract viewBox/dimensions from SVG string. Browser-only. |
| `clampPlacementToArtboard(params)` | Clamp placement within material bounds. |
| `getSvgWidthMm(metrics, widthOverride?, heightOverride?)` | Resolved SVG width in mm. |
| `getSvgHeightMm(metrics, widthOverride?, heightOverride?)` | Resolved SVG height in mm. |

### Profile Groups

| Function | Description |
|----------|-------------|
| `groupAssignmentsForIds(assignments, elementIds)` | Group element assignments by depth + engrave type. |
| `deriveOperationsFromProfileGroups(groups)` | Convert profile groups to `FrontendOperation[]`. |

## Progress Reporting

`generateEngravingJob` accepts an optional progress callback:

```typescript
const result = await generateEngravingJob(request, (progress) => {
  // progress.phase: "processing" | "optimizing" | "formatting"
  // progress.current: 0-based operation index (for "processing")
  // progress.total: total operation count (for "processing")

  if (progress.phase === "processing" && progress.total > 0) {
    const percent = Math.round((progress.current / progress.total) * 90);
    setProgressBar(percent);
  } else if (progress.phase === "optimizing") {
    setProgressBar(92);
  } else if (progress.phase === "formatting") {
    setProgressBar(97);
  }
});
setProgressBar(100);
```

Phases:
- **processing** — Per-operation SVG geometry collection (the expensive part). `current` and `total` are populated.
- **optimizing** — TSP path ordering by depth. Indeterminate (`current=0, total=0`).
- **formatting** — GCode string generation. Indeterminate.

## Konva UI Integration Guide

### Data Flow

```
┌─────────────────────────────────────────────┐
│  Konva Canvas (your UI)                     │
│  - Renders art objects as positioned SVGs   │
│  - Handles drag/resize/selection            │
│  - Manages element assignments per object   │
└─────────────┬───────────────────────────────┘
              │ ArtObject[] + Settings
              ▼
┌─────────────────────────────────────────────┐
│  @svg2gcode/bridge                          │
│  1. composeArtObjectsSvg(artObjects, settings)
│  2. getDerivedOperationsForArtObjects(artObjects)
│  3. generateEngravingJob({ svg, settings, ops })
└─────────────┬───────────────────────────────┘
              │ GenerateJobResponse
              ▼
┌─────────────────────────────────────────────┐
│  NC Viewer (your UI)                        │
│  - parseGcodeProgram(gcode, operationRanges)│
│  - Renders toolpaths with THREE.js / etc.   │
└─────────────────────────────────────────────┘
```

### Step 1: Load and prepare SVGs

When the user imports an SVG file:

```typescript
const prepared = await prepareSvgDocument(rawSvgString);

const artObject = createArtObject({
  artObjectId: crypto.randomUUID(),
  name: file.name,
  preparedSvg: prepared,
  settings,
  defaultEngraveType: "pocket",
  existingArtObjects: existingArtObjects,
  elementColors: myColorDetection(prepared.normalized_svg), // optional
});
```

The `prepared.tree` contains the SVG element hierarchy with selectable IDs. Use it to build your layer tree UI.

### Step 2: Display on Konva canvas

Each `ArtObject` has:
- `placementX`, `placementY` — position on material (bottom-left origin, mm)
- `widthMm`, `heightMm` — display dimensions
- `svgMetrics` — original SVG dimensions and aspect ratio
- `preparedSvg.normalized_svg` — the SVG to render (with `data-s2g-id` attributes on elements)

Position your Konva nodes using these values. The coordinate system origin is bottom-left (Y increases upward), matching CNC convention.

### Step 3: Element selection and assignment

Elements are identified by composite IDs: `artObjectId::elementId`.

```typescript
// When user selects elements, update their assignments:
artObject.elementAssignments[compositeId] = {
  elementId: compositeId,
  targetDepthMm: 1.5,
  engraveType: "pocket",
  fillMode: "Pocket",
};
```

Use `groupAssignmentsForIds()` to group selected elements by their assignment profile (depth + engrave type).

### Step 4: Generate GCode

```typescript
const composedSvg = composeArtObjectsSvg(artObjects, settings);
const operations = getDerivedOperationsForArtObjects(artObjects);

const result = await generateEngravingJob(
  { normalized_svg: composedSvg, settings, operations },
  (progress) => updateProgressBar(progress),
);
```

### Step 5: Adjusting settings

```typescript
import { setNumberAtPath, applyRecommendedSettings } from "@svg2gcode/bridge";

// Change tool diameter
settings = setNumberAtPath(settings, "engraving.tool_diameter", 3.175);

// Auto-compute stepdown, stepover, feedrates based on tool
settings = applyRecommendedSettings(settings, userOverrides, "pocket");
```

## GCode Viewer Integration Guide

The viewer utilities parse GCode into structured data for rendering. They are framework-agnostic — use them with THREE.js, Canvas 2D, WebGL, or any renderer.

```typescript
import {
  parseGcodeProgram,
  sampleProgramAtDistance,
  buildHeightField,
} from "@svg2gcode/bridge/viewer";
```

### Parsing

```typescript
const program = parseGcodeProgram(result.gcode, result.operation_ranges);

// program.segments     — ParsedSegment[] with start/end XYZ, motion type, operation info
// program.bounds       — axis-aligned bounding box of all motion
// program.totalDistance — total toolpath distance (for playback timeline)
// program.events       — plunge/retract events (for timeline markers)
// program.operationSpans — distance ranges per operation (for color-coded timeline)
```

### Segment structure

Each `ParsedSegment` contains:
- `start`, `end` — `{ x, y, z }` positions
- `motionKind` — `"rapid"` | `"plunge"` | `"cut"` | `"retract"`
- `command` — `"G0"` or `"G1"`
- `operationId`, `operationName`, `operationColor` — from operation ranges
- `cumulativeDistanceStart`, `cumulativeDistanceEnd` — for timeline mapping
- `feedrate` — current feedrate

### Playback

For timeline scrubbing, sample the program at a distance:

```typescript
const sample = sampleProgramAtDistance(program, currentDistance);
// sample.position  — interpolated XYZ at this distance
// sample.motionKind — what the tool is doing
// sample.operationId — which operation is active
// sample.segmentIndex — for splitting past/future segments
```

### Segment splitting (past/future rendering)

```typescript
import { splitSegmentAtDistance, clipSegmentToDistance } from "@svg2gcode/bridge/viewer";

// Split a segment into past (already cut) and future (remaining) parts:
const { past, future } = splitSegmentAtDistance(segment, currentDistance);

// Or just clip to get the "already cut" portion:
const clipped = clipSegmentToDistance(segment, currentDistance);
```

### Height field (3D stock visualization)

Build a height map showing the material surface after cutting:

```typescript
const heightField = buildHeightField(
  result.preview_snapshot.material_width,
  result.preview_snapshot.material_height,
  result.preview_snapshot.tool_diameter,
  program.segments.filter(s => s.cumulativeDistanceEnd <= currentDistance),
);

// heightField.values — Float32Array grid of Z depths (0 = surface, negative = cut)
// heightField.cols, heightField.rows — grid dimensions
// heightField.width, heightField.height — physical dimensions in mm
```

Use this to deform a plane mesh in THREE.js or render a depth texture.

### Color-coding by operation

Each segment carries `operationColor` from the operation ranges. Use `program.operationSpans` to map distance ranges to colors for your timeline UI.

## Settings Reference

### `settings.engraving`

| Field | Type | Description |
|-------|------|-------------|
| `material_width` | mm | Material board width |
| `material_height` | mm | Material board height |
| `material_thickness` | mm | Material thickness (for depth validation) |
| `tool_diameter` | mm | Cutting tool diameter |
| `tool_shape` | `"Flat"` \| `"Ball"` \| `"V"` | Tool geometry (only Flat supported currently) |
| `target_depth` | mm | Default cut depth |
| `max_stepdown` | mm | Maximum depth per pass |
| `cut_feedrate` | mm/min | Cutting feed rate |
| `plunge_feedrate` | mm/min | Vertical plunge speed |
| `stepover` | mm | Distance between parallel passes |
| `fill_mode` | `"Pocket"` \| `"Contour"` | Default fill strategy |
| `placement_x` | mm | SVG placement X (set to 0 when using art objects) |
| `placement_y` | mm | SVG placement Y (set to 0 when using art objects) |
| `machine_width` | mm | Machine envelope width |
| `machine_height` | mm | Machine envelope height |

### `settings.machine`

| Field | Type | Description |
|-------|------|-------------|
| `travel_z` | mm \| null | Safe Z height for rapid moves |
| `cut_z` | mm \| null | Cutting Z (null = use operation depth) |
| `begin_sequence` | string \| null | GCode prepended at start |
| `end_sequence` | string \| null | GCode appended at end |
| `tool_on_sequence` | string \| null | GCode when tool engages |
| `tool_off_sequence` | string \| null | GCode when tool disengages |

### `settings.postprocess`

| Field | Type | Description |
|-------|------|-------------|
| `checksums` | boolean | Add checksums to GCode lines |
| `line_numbers` | boolean | Add line numbers |

## Browser-Only APIs

These functions use `DOMParser` / `XMLSerializer` and only work in browser environments:

- `parseSvgDocumentMetrics(svg)`
- `createArtObject(params)`
- `composeArtObjectsSvg(artObjects, settings)`
- `withCompositeElementIds(svg, artObjectId)`
