#!/usr/bin/env python3
"""Author the "human-style" Mane Attraction hairstyles (long hair, bob, ponytail,
braids) as TWO layers each and turn them straight into game-ready overlays.

Unlike tools/make_hair_art.py (one front layer that sits on top of the head),
these need hair that hangs BEHIND the head and body, so every style is a
`back` layer (drawn before the cat sprite) plus a `front` layer (bangs/cap,
drawn after it - also what covers the cat's built-in purple tuft).

Everything is drawn directly in the cat sprite's NATIVE frame coordinates
(cat_v2.png frame 0, 256x296; head-top anchor at (125, 23) - see HAIR_ANCHORS
in js/utils/hair.js), at SCALE x, with PAD px of headroom/side room. That
makes placement exact: after rendering, each layer is cropped to its own alpha
bbox and its HAIR_STYLES {width, dx, dy} is computed from where it sits
relative to the frame-0 anchor - no hand-tuned offsets.

Same visual language as the other styles: heavy #2a1248 outline (fat-stroke-
then-fill double draw, so overlapping pieces share one outer outline),
3-stop gradients, white gloss.

Usage:
    python3 tools/make_human_hair.py [slug ...] [--preview out.png]
Writes assets/hair_cat_<slug>.png and assets/hair_cat_<slug>_back.png, the SVG
sources to tools/hair_src/, and prints the HAIR_STYLES entries. Needs Google
Chrome (headless render, run outside the Bash sandbox).
"""

import argparse
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image

OUTLINE = '#2a1248'
SCALE = 3
PAD_X, PAD_TOP, PAD_BOTTOM = 40, 60, 0
FRAME_W, FRAME_H = 256, 296
ANCHOR = (125, 23)  # HAIR_ANCHORS.cat[0]
ANCHORS = [(125, 23), (125, 38), (125, 38), (125, 33), (125, 20), (125, 20)]
CX = 124  # mirror axis (the head's measured horizontal center)
CANVAS_W = (FRAME_W + 2 * PAD_X) * SCALE
CANVAS_H = (PAD_TOP + FRAME_H + PAD_BOTTOM) * SCALE
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
SW = 2.8  # outline width in native px


def grad(gid, light, mid, dark, x1=0, y1=0, x2=0, y2=1):
    return (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">'
            f'<stop offset="0" stop-color="{light}"/><stop offset="0.5" stop-color="{mid}"/>'
            f'<stop offset="1" stop-color="{dark}"/></linearGradient>')


def doc(defs, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS_W}" height="{CANVAS_H}">'
            f'<defs>{defs}</defs><g transform="scale({SCALE}) translate({PAD_X} {PAD_TOP})">{body}</g></svg>')


def mirror(body):
    return f'<g transform="translate({2 * CX} 0) scale(-1 1)">{body}</g>'


def outlined(paths, fill):
    """Fat stroke pass for every path, then the fill pass - one shared outline."""
    strokes = ''.join(f'<path d="{d}" fill="{OUTLINE}" stroke="{OUTLINE}" stroke-width="{SW * 2}" stroke-linejoin="round"/>' for d in paths)
    fills = ''.join(f'<path d="{d}" fill="{fill}"/>' for d in paths)
    return strokes + fills


def outlined_sym(d, fill):
    """Like outlined(), for a left-half path and its mirror image: both strokes
    first, then both fills, so there's no outline seam down the middle."""
    st = f'<path d="{d}" fill="{OUTLINE}" stroke="{OUTLINE}" stroke-width="{SW * 2}" stroke-linejoin="round"/>'
    fl = f'<path d="{d}" fill="{fill}"/>'
    return st + mirror(st) + fl + mirror(fl)


def strand(d, color, w=1.6, op=0.6):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" opacity="{op}"/>'


def gloss(cx, cy, rx, ry, rot=0, op=0.7):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#fff" opacity="{op}" transform="rotate({rot} {cx} {cy})"/>'


# ------------------------------------------------------------ long waves
def princess():
    defs = grad('hb', '#ffe9a6', '#f5c451', '#c98a1c', 0, 0, 0, 260) + grad('hf', '#fff1bf', '#f7cd5e', '#d99a28', 0, 10, 0, 90)
    # Back: a dome over the head flowing into long wavy locks down both sides,
    # ending in rounded curls beside the tutu.
    left = ('M124,10 C92,6 40,14 22,52 C8,84 18,118 8,150 C0,178 16,196 6,220 '
            'C2,236 12,252 26,250 C34,262 50,256 50,244 C58,252 72,244 68,232 '
            'L84,200 L124,196 Z')
    waves = (strand('M20,70 C12,100 22,130 14,160 C8,185 20,205 14,228', '#b07612', 1.8)
             + strand('M34,64 C26,104 36,140 26,176 C22,200 36,220 30,240', '#fff4c8', 1.4, 0.7)
             + strand('M50,90 C44,130 52,170 44,206 C42,222 52,232 56,240', '#b07612', 1.6))
    back_half = waves
    back = (outlined_sym(left, 'url(#hb)')
            + back_half + mirror(back_half) + gloss(40, 40, 14, 5, -30))
    # Front: curtain bangs parted in the middle, swooping out over the ear bases.
    bang = ('M124,14 C104,10 76,20 64,42 C56,58 56,74 60,88 C66,80 74,72 82,66 '
            'C96,64 112,67 124,68 Z')
    front_half = (strand('M120,18 C98,24 78,44 68,78', '#c98a1c', 1.6)
                  + strand('M122,30 C106,36 92,46 82,62', '#fff4c8', 1.3, 0.75)
                  + gloss(92, 26, 12, 4, -22))
    front = outlined_sym(bang, 'url(#hf)') + front_half + mirror(front_half)
    return doc(defs, back), doc(defs, front)


# ------------------------------------------------------------ bob
def bob():
    defs = grad('hb', '#9a5a3a', '#6b3420', '#3d1a0e', 0, 0, 0, 180) + grad('hf', '#b06a44', '#7a3d24', '#4a2010', 0, 8, 0, 92)
    # Back: rounded chin-length bob, wider than the face so it frames the cheeks,
    # ends curling under.
    left = ('M124,10 C84,6 24,16 8,64 C0,96 2,130 6,152 C10,172 28,180 44,172 '
            'C52,168 56,160 54,150 L90,150 L124,150 Z')
    back_half = (strand('M16,70 C8,100 10,130 16,156', '#2a0f06', 1.6, 0.5)
                 + strand('M26,60 C18,96 20,130 28,162', '#c98a66', 1.3, 0.6))
    back = (outlined_sym(left, 'url(#hb)')
            + back_half + mirror(back_half) + gloss(34, 40, 12, 5, -35))
    # Front: full blunt bangs between the ears with a slightly uneven, strandy edge.
    bang = ('M124,12 C100,10 74,20 66,44 C62,58 62,72 64,84 '
            'C70,88 76,84 80,88 C86,92 92,86 98,90 C104,94 110,88 116,92 C120,94 122,92 124,92 Z')
    front_half = (strand('M80,34 C76,50 76,66 78,82', '#3d1a0e', 1.4, 0.55)
                  + strand('M100,26 C96,46 96,66 100,86', '#3d1a0e', 1.4, 0.55)
                  + strand('M90,24 C86,44 86,60 88,76', '#d79a72', 1.2, 0.7)
                  + gloss(96, 24, 14, 4, -15))
    front = outlined_sym(bang, 'url(#hf)') + front_half + mirror(front_half)
    return doc(defs, back), doc(defs, front)


# ------------------------------------------------------------ ponytail
def ponytail():
    defs = (grad('hb', '#ff9a5c', '#e2561e', '#9c2c0a', 0, -40, 0, 170)
            + grad('hf', '#ffa66b', '#e8602a', '#a8320e', 0, 0, 0, 70)
            + grad('tie', '#d8b4ff', '#9b5cf0', '#5a24a8', 0, -6, 0, 14))
    # Back: the tail springs up from the crown, arcs over to the right and falls
    # down behind the right ear past the cheek, ending in a flicked point.
    tail = ('M118,8 C120,-22 168,-40 206,-18 C240,4 250,48 244,92 C240,124 248,150 236,176 '
            'C232,160 226,150 222,140 C226,112 222,80 208,54 C194,30 160,16 134,14 Z')
    back = (outlined([tail], 'url(#hb)')
            + strand('M132,4 C164,-18 206,-14 226,14 C240,40 236,80 234,120', '#ffc49a', 1.6, 0.7)
            + strand('M140,12 C170,0 202,10 216,40 C226,66 226,100 228,140', '#8a240a', 1.6, 0.55)
            + gloss(176, -20, 16, 5, 10))
    # Front: hair slicked back off the face to the tie, plus the scrunchie on top.
    cap = ('M124,10 C98,10 74,22 66,44 C62,56 64,66 70,72 C84,62 104,67 124,68 Z')
    front_half = (strand('M74,58 C86,34 104,20 122,14', '#a8320e', 1.4, 0.6)
                  + strand('M86,52 C96,34 110,24 122,20', '#ffc49a', 1.2, 0.7))
    tie = (f'<ellipse cx="124" cy="7" rx="17" ry="9" fill="{OUTLINE}" stroke="{OUTLINE}" stroke-width="{SW * 2}"/>'
           '<ellipse cx="124" cy="7" rx="17" ry="9" fill="url(#tie)"/>'
           + strand('M112,4 C118,10 130,10 136,4', '#efdcff', 1.4, 0.8)
           + gloss(118, 3, 5, 2, -10))
    front = (outlined_sym(cap, 'url(#hf)')
             + front_half + mirror(front_half) + gloss(96, 22, 12, 4, -22) + tie)
    return doc(defs, back), doc(defs, front)


# ------------------------------------------------------------ braids
def braids():
    defs = (grad('hb', '#6b4a8a', '#3e2560', '#1e0f33', 0, 0, 0, 220)
            + grad('hf', '#73509a', '#452a6b', '#24123d', 0, 8, 0, 80)
            + grad('bw', '#ffb3d9', '#ff5fa8', '#c41a6c', 0, 0, 0, 20))

    def braid_left():
        # A dome behind the head plus a plaited braid hanging down the left side.
        dome = 'M124,12 C84,8 30,18 16,60 C10,80 14,94 22,100 L124,100 Z'
        segs = []
        x, y = 18, 92
        for i in range(8):
            yy = y + i * 15
            segs.append(f'M{x - 10},{yy} C{x - 12},{yy + 9} {x - 4},{yy + 17} {x + 1},{yy + 18} '
                        f'C{x + 8},{yy + 17} {x + 12},{yy + 8} {x + 9},{yy} '
                        f'C{x + 4},{yy + 4} {x - 4},{yy + 4} {x - 10},{yy} Z')
        tuft = f'M{x - 7},{y + 120} C{x - 14},{y + 134} {x - 8},{y + 146} {x},{y + 142} C{x + 8},{y + 146} {x + 14},{y + 132} {x + 7},{y + 120} Z'
        shapes = outlined([dome] + segs + [tuft], 'url(#hb)')
        lines = ''.join(strand(f'M{x - 7},{y + i * 15 + 6} C{x - 2},{y + i * 15 + 11} {x + 3},{y + i * 15 + 12} {x + 7},{y + i * 15 + 7}', '#9a7cc0', 1.2, 0.7) for i in range(8))
        bow_y = y + 118
        bow = (f'<path d="M{x},{bow_y} C{x - 16},{bow_y - 12} {x - 22},{bow_y + 8} {x - 6},{bow_y + 6} Z '
               f'M{x},{bow_y} C{x + 16},{bow_y - 12} {x + 22},{bow_y + 8} {x + 6},{bow_y + 6} Z" '
               f'fill="url(#bw)" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linejoin="round"/>'
               f'<circle cx="{x}" cy="{bow_y + 1}" r="4" fill="#ff5fa8" stroke="{OUTLINE}" stroke-width="{SW * 0.8}"/>')
        return shapes + lines + bow

    back = braid_left() + mirror(braid_left()) + gloss(40, 38, 12, 4, -30)
    # Front: smooth center-parted cap with a visible part line.
    cap = 'M124,14 C100,10 74,20 64,44 C58,60 60,72 64,80 C78,66 100,67 124,68 Z'
    front_half = (strand('M70,66 C80,42 100,26 120,20', '#a487c8', 1.3, 0.7)
                  + strand('M80,64 C90,46 104,36 120,32', '#24123d', 1.3, 0.5))
    front = (outlined_sym(cap, 'url(#hf)')
             + front_half + mirror(front_half)
             + f'<path d="M124,15 L124,62" stroke="#1a0b2e" stroke-width="1.6" stroke-linecap="round"/>'
             + gloss(94, 26, 11, 4, -24))
    return doc(defs, back), doc(defs, front)


STYLES = {'princess': princess, 'bob': bob, 'ponytail': ponytail, 'braids': braids}


def render(svg_text, png_path):
    html = png_path + '.html'
    with open(html, 'w') as f:
        f.write(f'<html><body style="margin:0;background:transparent">{svg_text}</body></html>')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    '--default-background-color=00000000', f'--window-size={CANVAS_W},{CANVAS_H}',
                    f'--screenshot={png_path}', 'file://' + os.path.abspath(html)], check=True, capture_output=True)
    os.remove(html)
    return Image.open(png_path).convert('RGBA')


def to_overlay(img, out_path):
    """Crop to content; return the HAIR_STYLES geometry relative to the frame-0 anchor."""
    bbox = img.getchannel('A').point(lambda v: 255 if v > 4 else 0).getbbox()
    l, t, r, b = bbox
    img.crop(bbox).save(out_path)
    nl, nt, nr = l / SCALE - PAD_X, t / SCALE - PAD_TOP, r / SCALE - PAD_X
    return {'width': round(nr - nl, 1), 'dx': round((nl + nr) / 2 - ANCHOR[0], 1), 'dy': round(nt - ANCHOR[1], 1)}


def preview(layers, path, sheet='assets/cat_v2.png'):
    """Back + cat + front on frames 0/1/4, at the per-frame anchors the game uses."""
    cat = Image.open(sheet).convert('RGBA')
    frames = [0, 1, 4]
    cell_w, cell_h = (FRAME_W + 2 * PAD_X), (PAD_TOP + FRAME_H)
    out = Image.new('RGBA', (cell_w * len(frames) * len(layers), cell_h), (120, 160, 170, 255))
    for s, (back, front) in enumerate(layers):
        b = back.resize((cell_w, cell_h), Image.LANCZOS)
        f = front.resize((cell_w, cell_h), Image.LANCZOS)
        for k, i in enumerate(frames):
            cell = Image.new('RGBA', (cell_w, cell_h), (0, 0, 0, 0))
            ox, oy = ANCHORS[i][0] - ANCHOR[0], ANCHORS[i][1] - ANCHOR[1]
            cell.paste(b, (ox, oy), b)
            cell.alpha_composite(cat.crop((0, i * FRAME_H, FRAME_W, (i + 1) * FRAME_H)), (PAD_X, PAD_TOP))
            tmp = Image.new('RGBA', (cell_w, cell_h), (0, 0, 0, 0))
            tmp.paste(f, (ox, oy), f)
            cell.alpha_composite(tmp)
            out.alpha_composite(cell, ((s * len(frames) + k) * cell_w, 0))
    out.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('styles', nargs='*')
    ap.add_argument('--preview')
    ap.add_argument('--srcdir', default='tools/hair_src')
    args = ap.parse_args()
    os.makedirs(args.srcdir, exist_ok=True)
    layers, entries = [], []
    for slug in args.styles or STYLES:
        back_svg, front_svg = STYLES[slug]()
        imgs = []
        for name, text in (('back', back_svg), ('front', front_svg)):
            with open(os.path.join(args.srcdir, f'{slug}_{name}.svg'), 'w') as f:
                f.write(text)
            imgs.append(render(text, os.path.join(args.srcdir, f'{slug}_{name}.png')))
        layers.append(imgs)
        fg = to_overlay(imgs[1], f'assets/hair_cat_{slug}.png')
        bg = to_overlay(imgs[0], f'assets/hair_cat_{slug}_back.png')
        entries.append(
            f"  {slug}: {{ images: {{ cat: {{ src: './assets/hair_cat_{slug}.png?v=1', width: {fg['width']:g}, dx: {fg['dx']:g}, dy: {fg['dy']:g}, "
            f"back: {{ src: './assets/hair_cat_{slug}_back.png?v=1', width: {bg['width']:g}, dx: {bg['dx']:g}, dy: {bg['dy']:g} }} }} }} }},")
    if args.preview:
        preview(layers, args.preview)
        print('wrote preview', args.preview)
    print('\n'.join(entries))


if __name__ == '__main__':
    sys.exit(main())
