#!/usr/bin/env python3
"""Turn a raw generated hairstyle image into a game-ready transparent overlay
for Mane Attraction (see kat_trap's CLAUDE.md, "Mane Attraction" section, and
js/utils/hair.js).

A generated hairstyle usually arrives on a flat colored background (or with a
faint non-transparent one). This script:
  1. makes the background transparent by FLOOD-FILLING inward from the image
     border over pixels close to the border's own color - not a global chroma
     key, so same-colored pixels inside the hair itself are never punched out
     (a global key blurred/damaged edges on earlier cosmetic sprites, see
     CLAUDE.md lessons on lossless extraction);
  2. keeps only the largest connected piece (plus any piece at least
     --keep-frac of its size, e.g. a separate pigtail) and drops stray specks;
  3. feathers the alpha edge by ~1px so it doesn't read as cut-out;
  4. crops to the content's bounding box and resizes to --width px (the
     overlay's stored resolution, a few x the on-sprite size so it stays crisp
     under the game's downscale);
  5. optionally writes a --preview composite of the result on the real default
     cat frames, placed at the same head anchors the game uses, so coverage of
     the cat's built-in purple tuft and the placement can be judged by eye
     BEFORE wiring the style in.

Usage:
    python3 tools/prepare_hair_overlay.py raw/twin_buns.png \\
        --out assets/hair_cat_twin-buns.png --width 400 \\
        --preview /tmp/twin_buns_preview.png --display-width 200 --dx 0 --dy -14

It prints the HAIR_STYLES entry to paste into js/utils/hair.js (using
--display-width/--dx/--dy). Then still LOOK at the preview - the script fixes
the measurable defects (background, specks, edge), not whether the style reads
well on the head. Sheets for other characters will need their own anchors.
"""

import argparse
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

# Keep in sync with HAIR_ANCHORS.cat in js/utils/hair.js (native 256x296 frames
# of assets/cat_v2.png). Only used for --preview.
CAT_ANCHORS = [(125, 23), (125, 38), (125, 38), (125, 33), (125, 20), (125, 20)]
CAT_FRAME_W, CAT_FRAME_H = 256, 296


def remove_background(rgba, tol):
    """Flood-fill transparent from the border over pixels near the border's
    median color. Returns an RGBA array with the background's alpha zeroed."""
    arr = np.array(rgba).astype(np.int16)
    h, w = arr.shape[:2]
    border = np.concatenate([arr[0, :, :3], arr[-1, :, :3], arr[:, 0, :3], arr[:, -1, :3]])
    bg = np.median(border, axis=0)
    dist = np.abs(arr[:, :, :3] - bg).max(axis=2)
    candidate = dist <= tol
    # Already-transparent pixels count as background too.
    candidate |= arr[:, :, 3] < 8
    labels, _ = ndimage.label(candidate)
    edge_labels = set(np.unique(np.concatenate([labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])))
    edge_labels.discard(0)
    bg_mask = np.isin(labels, list(edge_labels))
    out = arr.astype(np.uint8)
    out[bg_mask, 3] = 0
    return out, bg, bg_mask.mean()


def keep_main_pieces(arr, keep_frac):
    alpha = arr[:, :, 3] > 8
    labels, n = ndimage.label(alpha)
    if n <= 1:
        return arr, n, n
    sizes = ndimage.sum(alpha, labels, range(1, n + 1))
    biggest = sizes.max()
    keep = [i + 1 for i, sz in enumerate(sizes) if sz >= biggest * keep_frac]
    mask = np.isin(labels, keep)
    out = arr.copy()
    out[~mask, 3] = 0
    return out, n, len(keep)


def feather_edge(arr):
    img = Image.fromarray(arr)
    original = np.array(img.getchannel('A'))
    blurred = np.array(img.getchannel('A').filter(ImageFilter.GaussianBlur(0.8)))
    # min(): soften the edge inward only. Blurring outward would grow a halo of
    # the old background's color into pixels that used to be fully transparent.
    img.putalpha(Image.fromarray(np.minimum(original, blurred)))
    return img


def crop_to_content(img, pad=2):
    bbox = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        sys.exit('Nothing left after background removal - raise --tol or check the input.')
    l, t, r, b = bbox
    return img.crop((max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad)))


def write_preview(overlay, path, display_width, dx, dy, cat_sheet):
    sheet = Image.open(cat_sheet).convert('RGBA')
    ratio = overlay.height / overlay.width
    ov = overlay.resize((int(display_width), max(1, int(display_width * ratio))), Image.LANCZOS)
    frames = [0, 1, 4]
    # Headroom above the sprite frame: tall styles legitimately extend past the
    # frame's top edge (the game canvas and the store portrait both have room),
    # so a flush-cropped preview would clip them and hide the real result.
    pad = 90
    out = Image.new('RGBA', (CAT_FRAME_W * len(frames), CAT_FRAME_H + pad), (120, 160, 170, 255))
    for k, i in enumerate(frames):
        frame = Image.new('RGBA', (CAT_FRAME_W, CAT_FRAME_H + pad), (0, 0, 0, 0))
        frame.alpha_composite(sheet.crop((0, i * CAT_FRAME_H, CAT_FRAME_W, (i + 1) * CAT_FRAME_H)), (0, pad))
        ax, ay = CAT_ANCHORS[i]
        frame.alpha_composite(ov, (int(round(ax + dx - ov.width / 2)), int(round(ay + dy)) + pad))
        out.alpha_composite(frame, (CAT_FRAME_W * k, 0))
    out.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('raw', help='raw generated image (flat background or transparent)')
    ap.add_argument('--out', required=True, help='output PNG, e.g. assets/hair_cat_twin-buns.png')
    ap.add_argument('--width', type=int, default=400, help='stored overlay width in px (default 400)')
    ap.add_argument('--tol', type=int, default=28, help='background color tolerance, 0-255 (default 28)')
    ap.add_argument('--keep-frac', type=float, default=0.02, help='keep pieces at least this fraction of the largest (default 0.02)')
    ap.add_argument('--preview', help='write a composite on the real cat frames to this path')
    ap.add_argument('--display-width', type=float, default=200, help='on-sprite width in native frame px (default 200)')
    ap.add_argument('--dx', type=float, default=0, help='horizontal offset from the head anchor (default 0)')
    ap.add_argument('--dy', type=float, default=-14, help='image top edge relative to the head anchor y (default -14)')
    ap.add_argument('--cat-sheet', default='assets/cat_v2.png')
    args = ap.parse_args()

    rgba = Image.open(args.raw).convert('RGBA')
    arr, bg, bg_frac = remove_background(rgba, args.tol)
    arr, pieces, kept = keep_main_pieces(arr, args.keep_frac)
    img = feather_edge(arr)
    img = crop_to_content(img)
    ratio = img.height / img.width
    img = img.resize((args.width, max(1, round(args.width * ratio))), Image.LANCZOS)
    img.save(args.out)

    print(f'background color ~{tuple(int(x) for x in bg)}, removed {bg_frac:.0%} of pixels')
    print(f'connected pieces: {pieces} found, {kept} kept')
    print(f'wrote {args.out}: {img.width}x{img.height}')
    if args.preview:
        write_preview(img, args.preview, args.display_width, args.dx, args.dy, args.cat_sheet)
        print(f'wrote preview {args.preview}')
    slug = args.out.rsplit('/', 1)[-1].replace('hair_cat_', '').rsplit('.', 1)[0]
    # Paste-ready src: always the ./assets/... path the game serves, even if --out
    # pointed somewhere else for a dry run.
    src = './assets/' + args.out.rsplit('/', 1)[-1]
    print('\nHAIR_STYLES entry (js/utils/hair.js):')
    print(f"  '{slug}': {{ images: {{ cat: {{ src: '{src}?v=1', width: {args.display_width:g}, dx: {args.dx:g}, dy: {args.dy:g} }} }} }},")


if __name__ == '__main__':
    main()
