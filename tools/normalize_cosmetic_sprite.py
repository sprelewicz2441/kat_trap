#!/usr/bin/env python3
"""Normalize a cosmetic recolor sprite sheet to match the character's
default sprite sheet's own per-frame content size/position.

Why this exists: cosmetic recolor sheets (cat_v2_tutu_*.png,
mouse_v2_tutu_*.png) were originally extracted per-frame - tight alpha
bbox crop, independently resized to fill the native frame - with no
shared anchor/scale across frames or against the hand-authored default
sprite. That let a recolor's content fill noticeably more of the frame
than the default does (confirmed by direct alpha-channel measurement:
cat's default filled ~86% of its frame's content height where a recolor
filled 100%, touching/clipping the very top edge - ears cropped off).
In gameplay this rendered an equipped cosmetic visibly bigger than the
default look and clipped extremities at the frame edge (reported live as
"shoes above heads" during the walk-cycle animation). See kat_trap's
CLAUDE.md, Currency & economy system section, cosmetics bullet, for the
full audit writeup.

This script re-crops and re-anchors every frame of a variant sheet to
match the DEFAULT sheet's own alpha-channel bbox for that exact frame
index: same content height (uniform scale per frame, aspect preserved -
no stretch), same bottom edge, same horizontal center. The default sheet
is always treated as ground truth (it's the hand-authored, known-good
art) - never edit the default itself with this script.

Usage - run once per new cosmetic color, before wiring it into
kpground-api's seed_store.py:

    python3 tools/normalize_cosmetic_sprite.py \\
        assets/cat_v2.png assets/cat_v2_tutu_newcolor.png \\
        --frame-width 256 --frame-height 296 --frames 6 --cols 1

    python3 tools/normalize_cosmetic_sprite.py \\
        assets/mouse_v2.png assets/mouse_v2_tutu_newcolor.png \\
        --frame-width 327 --frame-height 327 --frames 12 --cols 3

    python3 tools/normalize_cosmetic_sprite.py \\
        assets/dog_v2.png assets/dog_v2_tutu_newcolor.png \\
        --frame-width 473 --frame-height 296 --frames 6 --cols 1

By default this overwrites the variant file in place - pass --out to
write elsewhere instead (useful for a before/after visual check first).
Always eyeball the result before shipping - this is deterministic pixel
processing, not a substitute for looking at it.
"""
import argparse
import sys

from PIL import Image
import numpy as np


def alpha_bbox(alpha_channel):
    """Tight bounding box (x0, y0, x1, y1 - half-open) of pixels with
    alpha > 10, or None if the frame is empty."""
    ys, xs = np.where(alpha_channel > 10)
    if len(ys) == 0:
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def get_frame(sheet_arr, frame_w, frame_h, index, cols):
    col = index % cols
    row = index // cols
    sx, sy = col * frame_w, row * frame_h
    return sheet_arr[sy:sy + frame_h, sx:sx + frame_w]


def normalize(default_path, variant_path, frame_w, frame_h, n_frames, cols, out_path):
    ref = np.array(Image.open(default_path).convert('RGBA'))
    var = np.array(Image.open(variant_path).convert('RGBA'))

    expected_shape = None
    for name, arr in [('default', ref), ('variant', var)]:
        h_needed = ((n_frames + cols - 1) // cols) * frame_h
        w_needed = min(cols, n_frames) * frame_w
        if arr.shape[0] < h_needed or arr.shape[1] < w_needed:
            raise ValueError(
                f'{name} sheet {arr.shape[1]}x{arr.shape[0]} is smaller than '
                f'{w_needed}x{h_needed} implied by frame_w={frame_w} frame_h={frame_h} '
                f'frames={n_frames} cols={cols}'
            )

    out = var.copy()
    report = []
    for i in range(n_frames):
        ref_frame = get_frame(ref, frame_w, frame_h, i, cols)
        var_frame = get_frame(var, frame_w, frame_h, i, cols)
        rbbox = alpha_bbox(ref_frame[:, :, 3])
        vbbox = alpha_bbox(var_frame[:, :, 3])
        col, row = i % cols, i // cols
        sx, sy = col * frame_w, row * frame_h

        if rbbox is None or vbbox is None:
            report.append(f'frame {i}: SKIPPED (empty frame in default or variant)')
            continue

        rx0, ry0, rx1, ry1 = rbbox
        vx0, vy0, vx1, vy1 = vbbox
        ref_h, var_h = ry1 - ry0, vy1 - vy0
        if var_h <= 0:
            report.append(f'frame {i}: SKIPPED (zero-height variant content)')
            continue

        scale = ref_h / var_h
        var_w = vx1 - vx0
        crop_im = Image.fromarray(var_frame[vy0:vy1, vx0:vx1])
        new_w = max(1, round(var_w * scale))
        new_h = max(1, round(var_h * scale))
        resized = crop_im.resize((new_w, new_h), Image.LANCZOS)

        ref_cx = (rx0 + rx1) / 2
        dst_x = round(ref_cx - new_w / 2)
        dst_y = ry1 - new_h

        canvas = Image.new('RGBA', (frame_w, frame_h), (0, 0, 0, 0))
        canvas.paste(resized, (dst_x, dst_y), resized)
        out[sy:sy + frame_h, sx:sx + frame_w] = np.array(canvas)
        report.append(f'frame {i}: scale={scale:.3f} (was {var_w}x{var_h}, now {new_w}x{new_h})')

    Image.fromarray(out).save(out_path)
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('default_sheet', help='Path to the character\'s default sprite sheet (ground truth, never modified)')
    p.add_argument('variant_sheet', help='Path to the cosmetic recolor sheet to normalize')
    p.add_argument('--frame-width', type=int, required=True)
    p.add_argument('--frame-height', type=int, required=True)
    p.add_argument('--frames', type=int, required=True, help='Total frame count in the sheet')
    p.add_argument('--cols', type=int, default=1, help='Frames per row (1 for cat/dog\'s single-column walk cycle, 3 for mouse\'s grid)')
    p.add_argument('--out', default=None, help='Output path (default: overwrite variant_sheet in place)')
    args = p.parse_args()

    out_path = args.out or args.variant_sheet
    report = normalize(
        args.default_sheet, args.variant_sheet,
        args.frame_width, args.frame_height, args.frames, args.cols,
        out_path,
    )
    for line in report:
        print(line)
    print(f'\nWrote {out_path}')
    print('Now look at it - open the sheet and compare it frame-by-frame against the default before shipping.')


if __name__ == '__main__':
    sys.exit(main())
