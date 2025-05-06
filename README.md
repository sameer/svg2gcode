# svg2gcode

[![Build, test, and publish coverage for svg2gcode](https://github.com/sameer/svg2gcode/actions/workflows/lib.yml/badge.svg)](https://github.com/sameer/svg2gcode/actions/workflows/lib.yml)

[![Build svg2gcode-cli](https://github.com/sameer/svg2gcode/actions/workflows/cli.yml/badge.svg)](https://github.com/sameer/svg2gcode/actions/workflows/cli.yml)

[![Build svg2gcode-web](https://github.com/sameer/svg2gcode/actions/workflows/web.yml/badge.svg)](https://github.com/sameer/svg2gcode/actions/workflows/web.yml)
[![Deploy svg2gcode-web](https://github.com/sameer/svg2gcode/actions/workflows/web-deploy.yml/badge.svg)](https://github.com/sameer/svg2gcode/actions/workflows/web-deploy.yml)

[![codecov](https://codecov.io/gh/sameer/svg2gcode/branch/master/graph/badge.svg)](https://codecov.io/gh/sameer/svg2gcode)

Convert vector graphics to g-code for pen plotters, laser engravers, and other CNC machines

## Usage

### Web interface

Check it out at https://sameer.github.io/svg2gcode. Just select an SVG and click generate!

![SVG selected on web interface](https://user-images.githubusercontent.com/11097096/129305765-f78da85d-cf4f-4286-a97c-7124a716b5fa.png)

### Command line interface (CLI)

#### Install

```sh
cargo install svg2gcode-cli
```

#### Usage
```
Arguments:
  [FILE]
          A file path to an SVG, else reads from stdin

Options:
      --tolerance <TOLERANCE>
          Curve interpolation tolerance (mm)

      --feedrate <FEEDRATE>
          Machine feed rate (mm/min)

      --dpi <DPI>
          Dots per Inch (DPI) Used for scaling visual units (pixels, points, picas, etc.)

      --on <TOOL_ON_SEQUENCE>
          G-Code for turning on the tool

      --off <TOOL_OFF_SEQUENCE>
          G-Code for turning off the tool

      --begin <BEGIN_SEQUENCE>
          G-Code for initializing the machine at the beginning of the program

      --end <END_SEQUENCE>
          G-Code for stopping/idling the machine at the end of the program

  -o, --out <OUT>
          Output file path (overwrites old files), else writes to stdout

      --settings <SETTINGS>
          Provide settings from a JSON file. Overrides command-line arguments

      --export <EXPORT>
          Export current settings to a JSON file instead of converting.
          
          Use `-` to export to standard out.

      --origin <ORIGIN>
          Coordinates for the bottom left corner of the machine

      --dimensions <DIMENSIONS>
          Override the width and height of the SVG (i.e. 210mm,297mm)
          
          Useful when the SVG does not specify these (see https://github.com/sameer/svg2gcode/pull/16)
          
          Passing "210mm," or ",297mm" calculates the missing dimension to conform to the viewBox aspect ratio.

      --circular-interpolation <CIRCULAR_INTERPOLATION>
          Whether to use circular arcs when generating g-code
          
          Please check if your machine supports G2/G3 commands before enabling this.
          
          [possible values: true, false]

      --line-numbers <LINE_NUMBERS>
          Include line numbers at the beginning of each line
          
          Useful for debugging/streaming g-code
          
          [possible values: true, false]

      --checksums <CHECKSUMS>
          Include checksums at the end of each line
          
          Useful for streaming g-code
          
          [possible values: true, false]

      --newline-before-comment <NEWLINE_BEFORE_COMMENT>
          Add a newline character before each comment
          
          Workaround for parsers that don't accept comments on the same line
          
          [possible values: true, false]

  -h, --help
          Print help (see a summary with '-h')

  -V, --version
          Print version
```

#### Example

```sh
svg2gcode-cli examples/Vanderbilt_Commodores_logo.svg --off 'M4' --on 'M5' -o out.gcode
```


To convert curves to G02/G03 Gcode commands, use flag `--circular-interpolation true`.

![Vanderbilt Commodores Logo](examples/Vanderbilt_Commodores_logo.svg)

#### Output, rendered at [https://ncviewer.com](https://ncviewer.com)

```sh
cat out.gcode
```

![Vanderbilt Commodores Logo Gcode](examples/Vanderbilt_Commodores_logo_gcode.png)

### Library

The core functionality of this tool is available as the [svg2gcode crate](https://crates.io/crates/svg2gcode).

## Blog Posts

These go into greater detail on the tool's origins, implementation details, and planned features.

- https://purisa.me/blog/pen-plotter/
- https://purisa.me/blog/svg2gcode-progress/

## FAQ / Interesting details

- Use a 3D printer for plotting: (thanks [@jeevank](https://github.com/jeevank) for sharing this) https://medium.com/@urish/how-to-turn-your-3d-printer-into-a-plotter-in-one-hour-d6fe14559f1a

- Convert a PDF to GCode: follow [this guide using Inkscape to convert a PDF to an SVG](https://en.wikipedia.org/wiki/Wikipedia:Graphics_Lab/Resources/PDF_conversion_to_SVG#Conversion_with_Inkscape), then use it with svg2gcode

- Are shapes, fill patterns supported? No, but you can convert them to paths in Inkscape with `Object to Path`. See [#15](https://github.com/sameer/svg2gcode/issues/15) for more discussion.
- Are stroke patterns supported? No, but you can convert them into paths in Inkscape with `Stroke to Path`.

## Reference Documents

- [W3 SVG2 Specification](https://www.w3.org/TR/SVG/Overview.html)
- [CSS absolute lengths](https://www.w3.org/TR/css-values/#absolute-lengths)
- [CSS font-relative lengths](https://www.w3.org/TR/css-values/#font-relative-lengths)
- [CSS compatible units](https://www.w3.org/TR/css-values/#compat)
- [RepRap G-code](https://reprap.org/wiki/G-code)
- [G-Code and M-Code Reference List for Milling](https://www.cnccookbook.com/g-code-m-code-reference-list-cnc-mills/)
