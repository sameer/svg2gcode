# svg2gcode

Convert any SVG 1.1 path to gcode for a pen plotter, laser engraver, etc.

## TODO
- [x] Support all path variants
- [x] Support group and path transforms
- [ ] Biarc interpolation (G2/G3 instead of many G1)
- [x] Px, pc, in to mm
- [x] Configurable DPI for px/pc to mm

## Known bugs & whether fixed
- [ ] Smooth curves should not use the control point when the previous curve is not of the same type (quadratic -> smooth cubic, cubic -> smooth quadratic)
- [x] Image coordinates mirrored in the y-axis because SVGs uses upper left corner as (0,0) while GCode uses lower left as (0,0)
- [x] Close path command connects back to (0.0, 0.0) instead of the last move
- [ ] Ellipse paths are dubious -- large_arc, sweep may need to be inverted
