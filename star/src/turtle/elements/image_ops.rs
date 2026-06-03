//! Image transformation and cropping utilities to normalize images before passing them to turtles.

use euclid::default::Transform2D;
use image::{DynamicImage, GenericImage, GenericImageView};
use lyon_geom::{Box2D, point, vector};
use svgtypes::AspectRatio;

use super::RasterImage;

/// Transforms (rotates, scales, resamples) the input image using the given transform and aspect ratio.
/// Returns the transformed image and its bounding box in final coordinate space.
///
/// # Note on Scaling
/// For memory reasons, the pixel dimensions of the returned `DynamicImage` likely won't map directly to the
/// physical dimensions of the returned `Box2D`.
///
/// - axis-aligned transforms defer scaling to `Turtle`-time, where a more efficient operation could be applied
/// - non-aligned transforms do require resizing, but this is clamped to avoid more than 4x memory usage
///
/// The `Turtle` must handle any stretching/scaling as appropriate.
pub fn transform_image(
    mut image: DynamicImage,
    image_to_user: Transform2D<f64>,
    user_to_final: &Transform2D<f64>,
    preserve_aspect_ratio: AspectRatio,
) -> (DynamicImage, Box2D<f64>) {
    // TODO: should this be more coarse?
    const EPSILON: f64 = f64::EPSILON;
    const MAX_NON_AFFINE_SCALE: f64 = 2.;

    let orig_w = image.width();
    let orig_h = image.height();

    let pixel_corners = [
        point(0., 0.),
        point(orig_w as f64, 0.),
        point(0., orig_h as f64),
        point(orig_w as f64, orig_h as f64),
    ];
    let user_corners = pixel_corners.map(|p| image_to_user.transform_point(p));
    let user_bounds = Box2D::from_points(user_corners);

    let transformed_corners = user_corners.map(|p| user_to_final.transform_point(p));
    let transformed_box = Box2D::from_points(transformed_corners);

    let (is_transform_axis_aligned, [transformed_x_axis, transformed_y_axis]) = {
        let tx = user_to_final.transform_vector(vector(1.0, 0.0));
        let ty = user_to_final.transform_vector(vector(0.0, 1.0));

        let aligned = (tx.y.abs() < EPSILON && ty.x.abs() < EPSILON)
            || (tx.x.abs() < EPSILON && ty.y.abs() < EPSILON);

        (aligned, [tx, ty])
    };

    let aspect_ratios_match = {
        let orig_aspect_ratio = orig_w as f64 / orig_h as f64;
        let final_aspect_ratio = user_bounds.width() / user_bounds.height();
        (orig_aspect_ratio - final_aspect_ratio).abs() < EPSILON
    };
    let is_simple_orthogonal_rotation = is_transform_axis_aligned
        && (preserve_aspect_ratio.align == svgtypes::Align::None || aspect_ratios_match);

    if is_simple_orthogonal_rotation {
        if transformed_x_axis.x.abs() < EPSILON && transformed_y_axis.y.abs() < EPSILON {
            if transformed_x_axis.y > 0.0 && transformed_y_axis.x < 0.0 {
                image = image.rotate90();
            } else if transformed_x_axis.y < 0.0 && transformed_y_axis.x > 0.0 {
                image = image.rotate270();
            }
        } else if transformed_x_axis.y.abs() < EPSILON
            && transformed_y_axis.x.abs() < EPSILON
            && transformed_x_axis.x < 0.0
            && transformed_y_axis.y < 0.0
        {
            image = image.rotate180();
        }
    } else {
        // During non-aligned rotation, the corners need to be transparent
        image = add_alpha_channel(image);

        let image_to_final = image_to_user.then(user_to_final);

        let scale_x = image_to_final.transform_vector(vector(1.0, 0.0)).length();
        let scale_y = image_to_final.transform_vector(vector(0.0, 1.0)).length();

        // Clamp the scale factors proportionally (preserve aspect ratio) to avoid an unnecessarily
        // large buffer.
        let max_scale = scale_x.max(scale_y);
        let (resample_scale_x, resample_scale_y) = if max_scale > MAX_NON_AFFINE_SCALE {
            (
                scale_x * (MAX_NON_AFFINE_SCALE / max_scale),
                scale_y * (MAX_NON_AFFINE_SCALE / max_scale),
            )
        } else {
            (scale_x, scale_y)
        };

        let new_w = (orig_w as f64 * resample_scale_x).ceil() as u32;
        let new_h = (orig_h as f64 * resample_scale_y).ceil() as u32;

        let mut new_img = DynamicImage::new(new_w, new_h, image.color());

        if let Some(inv) = image_to_final.inverse() {
            let min = transformed_box.min;
            let tb_w = transformed_box.width();
            let tb_h = transformed_box.height();
            for new_y in 0..new_h {
                for new_x in 0..new_w {
                    // Map new pixel to target space
                    let target_pt = min
                        + vector(
                            (new_x as f64 / new_w as f64) * tb_w,
                            (new_y as f64 / new_h as f64) * tb_h,
                        );

                    let orig_pt = inv.transform_point(target_pt);
                    if (0.0..orig_w as f64).contains(&orig_pt.x)
                        && (0.0..orig_h as f64).contains(&orig_pt.y)
                        && let Some(pixel) =
                            sample_lanczos3(&image, orig_pt.x, orig_pt.y, orig_w, orig_h)
                    {
                        new_img.put_pixel(new_x, new_y, pixel);
                    }
                }
            }
            image = new_img;
        }
    }

    (image, transformed_box)
}

/// Crops the image bounds to the specified viewport bounds, returning None if the cropped area is empty.
pub fn crop_image_to_bounds(
    mut image: DynamicImage,
    img_bbox: Box2D<f64>,
    bounds: Box2D<f64>,
) -> Option<RasterImage> {
    let cropped_bbox = img_bbox.intersection(&bounds)?;
    if cropped_bbox.is_empty() || img_bbox.is_empty() {
        return None;
    }

    let src_w = image.width();
    let src_h = image.height();
    if src_w == 0 || src_h == 0 {
        return None;
    }

    let orig_w = img_bbox.width();
    let orig_h = img_bbox.height();
    let w_crop = cropped_bbox.width();
    let h_crop = cropped_bbox.height();

    let crop_offset = cropped_bbox.min - img_bbox.min;

    let mut pixel_x = (crop_offset.x / orig_w * src_w as f64).round() as u32;
    let mut pixel_y = (crop_offset.y / orig_h * src_h as f64).round() as u32;

    pixel_x = pixel_x.min(src_w - 1);
    pixel_y = pixel_y.min(src_h - 1);

    let pixel_w = ((w_crop / orig_w) * src_w as f64).round() as u32;
    let pixel_h = ((h_crop / orig_h) * src_h as f64).round() as u32;

    let pixel_w = pixel_w.clamp(1, src_w - pixel_x);
    let pixel_h = pixel_h.clamp(1, src_h - pixel_y);

    image = image.crop_imm(pixel_x, pixel_y, pixel_w, pixel_h);

    Some(RasterImage {
        dimensions: cropped_bbox,
        image,
    })
}

fn add_alpha_channel(image: DynamicImage) -> DynamicImage {
    if image.color().has_alpha() {
        image
    } else {
        match image {
            DynamicImage::ImageLuma8(_) => DynamicImage::ImageLumaA8(image.to_luma_alpha8()),
            DynamicImage::ImageLuma16(_) => DynamicImage::ImageLumaA16(image.to_luma_alpha16()),
            DynamicImage::ImageRgb8(_) => DynamicImage::ImageRgba8(image.to_rgba8()),
            DynamicImage::ImageRgb16(_) => DynamicImage::ImageRgba16(image.to_rgba16()),
            DynamicImage::ImageRgb32F(_) => DynamicImage::ImageRgba32F(image.to_rgba32f()),
            other => DynamicImage::ImageRgba8(other.to_rgba8()),
        }
    }
}

/// <https://en.wikipedia.org/wiki/Lanczos_resampling#Lanczos_kernel>
fn lanczos3_weight(x: f64) -> f64 {
    const A: f64 = 3.;

    let x = x.abs();
    if x < f64::EPSILON {
        1.0
    } else if x < A {
        // sinc(x)*sinc(x/a)
        let pi_x = std::f64::consts::PI * x;
        (pi_x.sin() * (pi_x / A).sin()) / (pi_x * pi_x / A)
    } else {
        // Does not contribute
        0.0
    }
}

/// TODO: Bad attempt at lanczos3 resample for non-aligned transforms that should probably be revisited...
fn sample_lanczos3(
    image: &image::DynamicImage,
    x0: f64,
    y0: f64,
    orig_w: u32,
    orig_h: u32,
) -> Option<image::Rgba<u8>> {
    let x_floor = x0.floor() as i64;
    let y_floor = y0.floor() as i64;

    // Pre-compute horizontal (x) and vertical (y) weights in 1D arrays
    let mut wx_arr = [0.0; 6];
    for (dx, wx) in wx_arr.iter_mut().enumerate() {
        let px = x_floor - 2 + dx as i64;
        *wx = lanczos3_weight(x0 - px as f64);
    }

    let mut wy_arr = [0.0; 6];
    for (dy, wy) in wy_arr.iter_mut().enumerate() {
        let py = y_floor - 2 + dy as i64;
        *wy = lanczos3_weight(y0 - py as f64);
    }

    let mut r_sum = 0.0;
    let mut g_sum = 0.0;
    let mut b_sum = 0.0;
    let mut a_sum = 0.0;
    let mut w_sum = 0.0;

    for (dy_idx, &wy) in wy_arr.iter().enumerate() {
        if wy.abs() < f64::EPSILON {
            continue;
        }
        let py = y_floor - 2 + dy_idx as i64;
        let clamped_py = py.clamp(0, orig_h as i64 - 1) as u32;

        for (dx_idx, &wx) in wx_arr.iter().enumerate() {
            let w = wx * wy;
            if w.abs() < f64::EPSILON {
                continue;
            }
            let px = x_floor - 2 + dx_idx as i64;
            let clamped_px = px.clamp(0, orig_w as i64 - 1) as u32;

            let pixel = image.get_pixel(clamped_px, clamped_py);
            r_sum += pixel.0[0] as f64 * w;
            g_sum += pixel.0[1] as f64 * w;
            b_sum += pixel.0[2] as f64 * w;
            a_sum += pixel.0[3] as f64 * w;
            w_sum += w;
        }
    }

    if w_sum > 0.0 {
        let r = (r_sum / w_sum).clamp(0.0, 255.0).round() as u8;
        let g = (g_sum / w_sum).clamp(0.0, 255.0).round() as u8;
        let b = (b_sum / w_sum).clamp(0.0, 255.0).round() as u8;
        let a = (a_sum / w_sum).clamp(0.0, 255.0).round() as u8;

        Some(image::Rgba([r, g, b, a]))
    } else {
        None
    }
}
