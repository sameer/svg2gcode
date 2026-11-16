//! SVG elements that are directly drawn.

use std::result::Result;

use roxmltree::Node;
use smallvec::{SmallVec, smallvec};
use svgtypes::{Error, PathParser, PathSegment, PointsParser};

use super::ViewportState;

const PATH_TAG_NAME: &str = "path";
const POLYLINE_TAG_NAME: &str = "polyline";
const POLYGON_TAG_NAME: &str = "polygon";
const RECT_TAG_NAME: &str = "rect";
const CIRCLE_TAG_NAME: &str = "circle";
const ELLIPSE_TAG_NAME: &str = "ellipse";
const LINE_TAG_NAME: &str = "line";

pub struct SimpleElement<'a, 'input> {
    kind: Kind,
    node: Node<'a, 'input>,
}

enum Kind {
    Path,
    Polygon { is_closed: bool },
    Rect,
    Ellipse,
    Line,
}

impl Kind {
    fn parse<'input>(node: Node<'_, 'input>) -> Result<Self, &'input str> {
        Ok(match node.tag_name().name() {
            PATH_TAG_NAME => Self::Path,
            tag @ (POLYLINE_TAG_NAME | POLYGON_TAG_NAME) => Self::Polygon {
                is_closed: tag == POLYGON_TAG_NAME,
            },
            RECT_TAG_NAME => Self::Rect,
            CIRCLE_TAG_NAME | ELLIPSE_TAG_NAME => Self::Ellipse,
            LINE_TAG_NAME => Self::Line,
            other => return Err(other),
        })
    }
}

impl<'a, 'input> SimpleElement<'a, 'input> {
    pub fn new(node: Node<'a, 'input>) -> Result<Self, &'input str> {
        Ok(Self {
            kind: Kind::parse(node)?,
            node,
        })
    }
    pub fn segments(&self, viewport: &ViewportState) -> Result<SmallVec<[PathSegment; 6]>, Error> {
        use PathSegment::{
            ClosePath, EllipticalArc, HorizontalLineTo, LineTo, MoveTo, VerticalLineTo,
        };

        match self.kind {
            Kind::Path => {
                let d = self.node.attribute("d").ok_or(Error::InvalidValue)?;
                PathParser::from(d).collect::<Result<_, _>>()
            }
            Kind::Polygon { is_closed } => {
                let points = self.node.attribute("points").ok_or(Error::InvalidValue)?;
                let mut pp = PointsParser::from(points);
                let start = pp
                    .next()
                    .map(|(x, y)| MoveTo { abs: true, x, y })
                    .into_iter();
                Ok(start
                    .chain(pp.map(|(x, y)| LineTo { abs: true, x, y }))
                    .chain(is_closed.then_some(ClosePath { abs: true }))
                    .collect())
            }
            Kind::Rect => {
                let [x, y] = ["x", "y"]
                    .map(|attr| viewport.length_attr_to_user_units(self.node, attr))
                    .map(Option::unwrap_or_default);

                let [Some(width), Some(height)] = ["width", "height"]
                    .map(|attr| viewport.length_attr_to_user_units(self.node, attr))
                    .map(|v| v.filter(|&v| v > 0.))
                else {
                    return Err(Error::InvalidValue);
                };
                let [rx, ry] = ["rx", "ry"]
                    .map(|attr| viewport.length_attr_to_user_units(self.node, attr))
                    .map(|v| v.filter(|&v| v > 0.));

                let (mut rx, mut ry) = match (rx, ry) {
                    (Some(rx), Some(ry)) => (rx, ry),
                    (Some(rx), None) => (rx, rx),
                    (None, Some(ry)) => (ry, ry),
                    (None, None) => (0., 0.),
                };
                rx = rx.min(width / 2.);
                ry = ry.min(height / 2.);
                let has_radius = rx > 0. && ry > 0.;
                if !has_radius {
                    rx = 0.;
                    ry = 0.;
                }
                Ok([
                    MoveTo {
                        abs: true,
                        x: x + rx,
                        y,
                    },
                    HorizontalLineTo {
                        abs: true,
                        x: x + width - rx,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: x + width,
                        y: y + ry,
                    },
                    VerticalLineTo {
                        abs: true,
                        y: y + height - ry,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: x + width - rx,
                        y: y + height,
                    },
                    HorizontalLineTo {
                        abs: true,
                        x: x + rx,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x,
                        y: y + height - ry,
                    },
                    VerticalLineTo {
                        abs: true,
                        y: y + ry,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: x + rx,
                        y,
                    },
                    ClosePath { abs: true },
                ]
                .into_iter()
                .filter(move |p| has_radius || !matches!(p, EllipticalArc { .. }))
                .collect())
            }
            Kind::Ellipse => {
                let [cx, cy, r, rx_attr, ry_attr] = ["cx", "cy", "r", "rx", "ry"]
                    .map(|attr| viewport.length_attr_to_user_units(self.node, attr));
                let [cx, cy, r] = [cx, cy, r].map(Option::unwrap_or_default);
                let rx = rx_attr.or(ry_attr).unwrap_or(r);
                let ry = ry_attr.or(rx_attr).unwrap_or(r);

                if rx <= 0. || ry <= 0. {
                    return Err(Error::InvalidValue);
                }

                Ok(smallvec![
                    MoveTo {
                        abs: true,
                        x: cx + rx,
                        y: cy,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: cx,
                        y: cy + ry,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: cx - rx,
                        y: cy,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: cx,
                        y: cy - ry,
                    },
                    EllipticalArc {
                        abs: true,
                        rx,
                        ry,
                        x_axis_rotation: 0.,
                        large_arc: false,
                        sweep: true,
                        x: cx + rx,
                        y: cy,
                    },
                    ClosePath { abs: true },
                ])
            }
            Kind::Line => {
                let [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"]
                    .map(|attr| viewport.length_attr_to_user_units(self.node, attr))
                    .map(Option::unwrap_or_default);
                Ok(smallvec![
                    MoveTo {
                        abs: true,
                        x: x1,
                        y: y1,
                    },
                    LineTo {
                        abs: true,
                        x: x2,
                        y: y2,
                    },
                ])
            }
        }
    }
}
