# Phase 1: SVG Layer Extraction & Metadata

## Overview

Phase 1 adds layer metadata extraction and color-to-F/S mapping support to svg2gcode. This enables:

1. **Layer Extraction**: Identify individual layers (SVG `<g>` elements) with their properties
2. **Color Mapping**: Map RGB colors and stroke widths to feed rate (F) and laser power (S) parameters
3. **Metadata Output**: Export layer information as JSON for external processing

## New Features

### 1. Layer Metadata Extraction

#### New CLI Flag: `--extract-layers`

Extract layer metadata from SVG instead of converting to G-code:

```bash
svg2gcode pattern.svg --extract-layers -o pattern_metadata.json
```

Output format:
```json
{
  "pattern_name": "shirt_v2",
  "layers": [
    {
      "name": "front_left",
      "stroke": "rgb(255,0,0)",
      "stroke_width": 2.0,
      "feed": null,
      "power": null,
      "warnings": null
    }
  ]
}
```

### 2. Color-to-F/S Mapping

#### New CLI Flag: `--color-mapping <FILE>`

Provide a JSON configuration file that maps colors/stroke-widths to feed rates and laser power:

```bash
svg2gcode pattern.svg --extract-layers --color-mapping mapping.json -o pattern_metadata.json
```

#### Color Mapping Configuration

File: `color_mapping.json`

```json
{
  "default_feed": 3000,
  "default_power": 80,
  "color_mappings": [
    {
      "rgb": "rgb(255,0,0)",
      "feed": 3000,
      "power": 80,
      "description": "cut_red"
    },
    {
      "rgb": "rgb(0,255,0)",
      "feed": 2000,
      "power": 60,
      "description": "engrave_green"
    },
    {
      "rgb": "rgb(0,0,255)",
      "feed": 1500,
      "power": 40,
      "description": "score_blue"
    }
  ],
  "stroke_width_mappings": [
    {
      "width_mm": 0.5,
      "feed": 4000,
      "power": 90,
      "description": "thin_cut"
    },
    {
      "width_mm": 1.0,
      "feed": 2500,
      "power": 70,
      "description": "normal_cut"
    }
  ]
}
```

### 3. SVG Layer Structure

Layers should be represented as `<g>` (group) elements with identifiers:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <!-- Layer: front_left (cut - red stroke) -->
  <g id="front_left" stroke="rgb(255,0,0)" stroke-width="2">
    <path d="M 10 10 L 30 10 L 30 40 L 10 40 Z"/>
  </g>

  <!-- Layer: back (engrave - green stroke) -->
  <g id="back" stroke="rgb(0,255,0)" stroke-width="1">
    <path d="M 50 10 L 70 10 L 70 40 L 50 40 Z"/>
  </g>
</svg>
```

Layer identification methods (in order of precedence):
1. `id` attribute: `<g id="piece_name">`
2. `data-name` attribute: `<g data-name="piece_name">`
3. `label` attribute: `<g label="piece_name">`

## Data Structures

### New Modules in `g_code/src/`

**`layer_metadata.rs`**: Contains all layer and metadata-related types:

```rust
pub struct ColorMapping {
    pub rgb: String,
    pub feed: Option<f64>,
    pub power: Option<f64>,
    pub description: Option<String>,
}

pub struct LayerMetadata {
    pub name: String,
    pub stroke: Option<String>,
    pub stroke_width: Option<f64>,
    pub feed: Option<f64>,
    pub power: Option<f64>,
    pub warnings: Option<Vec<String>>,
}

pub struct ConversionMetadata {
    pub pattern_name: String,
    pub layers: Vec<LayerMetadata>,
}

pub struct ColorMappingConfig {
    pub default_feed: Option<f64>,
    pub default_power: Option<f64>,
    pub color_mappings: Vec<ColorMapping>,
    pub stroke_width_mappings: Vec<StrokeWidthMapping>,
}
```

### New Functions in `g_code/src/lib.rs`

**`extract_layer_metadata(doc: &Document) -> ConversionMetadata`**

Extracts layer information from an SVG document without converting to G-code.

## Implementation Details

### Layer Detection

The extraction process:

1. Parses the SVG document
2. Finds all `<g>` (group) elements at the root level
3. Extracts layer name from `id`, `data-name`, or `label` attributes
4. Reads `stroke` and `stroke-width` properties from attributes or inline styles
5. Returns structured metadata

### Stroke Parsing

Supports multiple stroke formats:
- Hex colors: `#ff0000`, `#f00`
- RGB colors: `rgb(255,0,0)`, `rgb(255, 0, 0)`
- Named colors: `red` (passed through as-is)
- Stroke-width values: `2`, `2.0`, `2mm`, `2px`, `2pt`

### Color/Stroke-Width Matching

- Color comparison is case-insensitive
- Stroke-width matching allows ±0.01mm tolerance for floating-point precision
- If no mapping found, `feed` and `power` remain `null`

## Workflow Example

### Step 1: Create SVG in Illustrator

Export SVG from Adobe Illustrator with:
- Layer names as group IDs (exported as `id` attributes)
- Cut operations in red (`rgb(255,0,0)`)
- Engrave operations in green (`rgb(0,255,0)`)
- Score operations in blue (`rgb(0,0,255)`)

### Step 2: Extract Metadata

```bash
svg2gcode shirt_pattern.svg \
  --extract-layers \
  --color-mapping /etc/svg-to-gcode/color-mapping.json \
  -o shirt_pattern_metadata.json
```

### Step 3: Use Metadata

The daemon uses this metadata to:
1. Generate piece IDs
2. Apply correct F/S parameters
3. Print labels via the label printer
4. Pass information to the Pi for processing

## Testing

### Test SVG

A sample test SVG is included: `test_layers.svg`

Extract layers from the test:
```bash
svg2gcode test_layers.svg --extract-layers -o test_output.json
```

Expected output:
```json
{
  "pattern_name": "pattern",
  "layers": [
    {
      "name": "front_left",
      "stroke": "rgb(255,0,0)",
      "stroke_width": 2.0,
      "feed": null,
      "power": null,
      "warnings": null
    },
    {
      "name": "front_right",
      "stroke": "rgb(255,0,0)",
      "stroke_width": 2.0,
      "feed": null,
      "power": null,
      "warnings": null
    },
    {
      "name": "back",
      "stroke": "rgb(0,255,0)",
      "stroke_width": 1.0,
      "feed": null,
      "power": null,
      "warnings": null
    }
  ]
}
```

With color mapping:
```bash
svg2gcode test_layers.svg \
  --extract-layers \
  --color-mapping sample_color_mapping.json \
  -o test_output.json
```

Expected: `feed` and `power` fields populated based on color matches.

## Limitations (Phase 1)

- Only extracts top-level `<g>` elements (no nested groups)
- Stroke properties are read, but color parsing is simple (no CSS variables, no inheritance chains beyond direct style)
- No automatic F/S extraction from SVG metadata beyond stroke color/width
- G-code comments with piece metadata not yet implemented (Phase 3)

## Integration with Other Phases

**Phase 2 (Daemon)**: Uses this metadata to route pieces to label printer and track conversions.

**Phase 3 (Label Printing)**: Uses layer metadata (name, generated ID) to create labels.

**Phase 4 (Systemd)**: Daemon watches for SVG files and triggers extraction automatically.

## Files Modified

- `g_code/src/lib.rs` - Added `extract_layer_metadata()` function and module declaration
- `g_code/src/layer_metadata.rs` - New file with all metadata structures
- `cli/src/main.rs` - Added `--extract-layers` and `--color-mapping` flags, handling logic
- `sample_color_mapping.json` - New example configuration
- `test_layers.svg` - New test SVG with sample layers
