#!/bin/sh

# SVG to G-code Converter Watcher
# Monitors a directory for SVG files and automatically converts them to G-code
#
# Usage: ./svg2gcode-watcher.sh [watch_dir] [poll_interval]
#
# Environment variables:
#   FEEDRATE: Machine feed rate (mm/min) - default 1000
#   TOLERANCE: Curve interpolation tolerance (mm) - default 0.5
#   DPI: Dots per Inch for scaling - default 96
#   LOG_LEVEL: Logging verbosity - default INFO

# Configuration from environment or defaults
WATCH_DIR="${1:-.}"
POLL_INTERVAL="${2:-2}"
FEEDRATE="${FEEDRATE:-1000}"
TOLERANCE="${TOLERANCE:-0.5}"
DPI="${DPI:-96}"
LOG_LEVEL="${LOG_LEVEL:-INFO}"

# Ensure watch directory exists
mkdir -p "$WATCH_DIR"

echo "[$(date +'%Y-%m-%d %H:%M:%S')] SVG to G-code Watcher started"
echo "[$(date +'%Y-%m-%d %H:%M:%S')] Watch directory: $WATCH_DIR"
echo "[$(date +'%Y-%m-%d %H:%M:%S')] Poll interval: ${POLL_INTERVAL}s"
echo "[$(date +'%Y-%m-%d %H:%M:%S')] Settings: feedrate=${FEEDRATE}, tolerance=${TOLERANCE}, dpi=${DPI}"

# Track processed files using a marker file
marker_file="/tmp/svg2gcode_processed.txt"
touch "$marker_file"

while true; do
    # Find all SVG files in watch directory (exclude ._ files)
    find "$WATCH_DIR" -maxdepth 1 -type f \( -name "*.svg" -o -name "*.SVG" \) ! -name "._*" | sort | while read -r svg_file; do
        # Skip if file doesn't exist
        [ -f "$svg_file" ] || continue

        # Skip if already in marker file
        if grep -q "^${svg_file}$" "$marker_file" 2>/dev/null; then
            continue
        fi

        # Skip macOS temp files
        case "$svg_file" in
            *"._"*) continue ;;
        esac

        filename=$(basename "$svg_file")
        gcode_file="${svg_file%.*}.gcode"
        gcode_filename=$(basename "$gcode_file")

        echo "[$(date +'%Y-%m-%d %H:%M:%S')] Converting: $filename"

        # Call svg2gcode-cli with configured parameters
        if svg2gcode-cli "$svg_file" \
            --feedrate "$FEEDRATE" \
            --tolerance "$TOLERANCE" \
            --dpi "$DPI" \
            -o "$gcode_file"; then

            echo "[$(date +'%Y-%m-%d %H:%M:%S')] ✓ Generated: $gcode_filename"
            # Mark file as processed
            echo "$svg_file" >> "$marker_file"
        else
            echo "[$(date +'%Y-%m-%d %H:%M:%S')] ✗ Failed to convert: $filename" >&2
        fi
    done

    # Sleep before next poll
    sleep "$POLL_INTERVAL"
done
