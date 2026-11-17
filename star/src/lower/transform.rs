use euclid::{
    Angle,
    default::{Transform2D, Transform3D},
};
use lyon_geom::vector;
use roxmltree::Node;
use svgtypes::{
    Align, AspectRatio, LengthListParser, TransformListParser, TransformListToken, ViewBox,
};

use crate::lower::{elements::ViewportState, units::DimensionHint};

/// <https://www.w3.org/TR/SVG/coords.html#ComputingAViewportsTransform>
pub fn get_viewport_transform(
    view_box: ViewBox,
    preserve_aspect_ratio: Option<AspectRatio>,
    viewport_size: [f64; 2],
    viewport_pos: [Option<f64>; 2],
) -> Transform2D<f64> {
    let [element_width, element_height] = viewport_size;
    let [element_x, element_y] = viewport_pos.map(|pos| pos.unwrap_or(0.));

    let preserve_aspect_ratio = preserve_aspect_ratio.unwrap_or(AspectRatio {
        defer: false,
        align: Align::XMidYMid,
        slice: false,
    });

    let mut scale_x = element_width / view_box.w;
    let mut scale_y = element_height / view_box.h;
    if preserve_aspect_ratio.align != Align::None {
        if preserve_aspect_ratio.slice {
            scale_x = scale_x.max(scale_y);
        } else {
            scale_x = scale_x.min(scale_y);
        }
        scale_y = scale_x;
    }
    let mut translate_x = element_x - (view_box.x * scale_x);
    let mut translate_y = element_y - (view_box.y * scale_y);
    match preserve_aspect_ratio.align {
        Align::XMidYMax | Align::XMidYMid | Align::XMidYMin => {
            translate_x += (element_width - view_box.w * scale_x) / 2.;
        }
        Align::XMaxYMax | Align::XMaxYMid | Align::XMaxYMin => {
            translate_x += element_width - view_box.w * scale_x;
        }
        Align::None | Align::XMinYMin | Align::XMinYMid | Align::XMinYMax => {}
    }
    match preserve_aspect_ratio.align {
        Align::XMinYMid | Align::XMidYMid | Align::XMaxYMid => {
            translate_y += (element_height - view_box.h * scale_y) / 2.;
        }
        Align::XMinYMax | Align::XMidYMax | Align::XMaxYMax => {
            translate_y += element_height - view_box.h * scale_y;
        }
        Align::None | Align::XMinYMin | Align::XMidYMin | Align::XMaxYMin => {}
    }
    Transform2D::scale(scale_x, scale_y).then_translate(vector(translate_x, translate_y))
}

pub fn parse_transform_list(transform: &str) -> Transform2D<f64> {
    // https://stackoverflow.com/questions/18582935/the-applying-order-of-svg-transforms
    TransformListParser::from(transform)
        .map(|token| token.expect("could not parse a transform in a list of transforms"))
        .map(svg_transform_into_euclid_transform)
        .fold(Transform2D::identity(), |acc, t| t.then(&acc))
}

pub fn node_transform(node: Node, viewport: &ViewportState) -> Transform2D<f64> {
    let mut flattened_transform = node
        .attribute("transform")
        .map_or_else(Transform2D::identity, parse_transform_list);

    // https://www.w3.org/TR/css-transforms-1/#transform-origin-property
    if let Some(to_str) = node.attribute("transform-origin") {
        let mut parser = LengthListParser::from(to_str);
        let ox = parser.next().and_then(Result::ok).map_or(0., |l| {
            viewport.length_to_user_units(l, DimensionHint::Horizontal)
        });
        let oy = parser.next().and_then(Result::ok).map_or(0., |l| {
            viewport.length_to_user_units(l, DimensionHint::Vertical)
        });
        if ox != 0. || oy != 0. {
            // https://www.w3.org/TR/css-transforms-1/#transformation-matrix-computation
            // Steps 2 & 4
            flattened_transform = Transform2D::translation(-ox, -oy)
                .then(&flattened_transform)
                .then(&Transform2D::translation(ox, oy));
        }
    }

    flattened_transform
}

pub fn svg_transform_into_euclid_transform(svg_transform: TransformListToken) -> Transform2D<f64> {
    use TransformListToken::{Matrix, Rotate, Scale, SkewX, SkewY, Translate};
    match svg_transform {
        Matrix { a, b, c, d, e, f } => Transform2D::new(a, b, c, d, e, f),
        Translate { tx, ty } => Transform2D::translation(tx, ty),
        Scale { sx, sy } => Transform2D::scale(sx, sy),
        Rotate { angle } => Transform2D::rotation(Angle::degrees(angle)),
        // https://drafts.csswg.org/css-transforms/#SkewXDefined
        SkewX { angle } => Transform3D::skew(Angle::degrees(angle), Angle::zero()).to_2d(),
        // https://drafts.csswg.org/css-transforms/#SkewYDefined
        SkewY { angle } => Transform3D::skew(Angle::zero(), Angle::degrees(angle)).to_2d(),
    }
}
