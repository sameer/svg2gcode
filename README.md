# svg2gcode

Convert any SVG 1.1 path to gcode for a pen plotter, laser engraver, etc.

## TODO
- [x] Support all path variants
- [x] Support transforms
- [ ] Biarc interpolation (G2/G3 instead of many G1)
- [ ] Units

## Known bugs & whether fixed
- [ ] Smooth curves should not use the control point when the previous curve is not of the same type (quadratic -> smooth cubic, cubic -> smooth quadratic)
