#!/usr/bin/env python3
"""Author Mane Attraction hairstyles for the DOG and the MOUSE and turn them
into game-ready overlays (the cat's styles live in make_hair_art.py /
make_human_hair.py).

Same approach as make_human_hair.py: every piece is drawn in the sprite's own
NATIVE frame coordinates (x SCALE, with PAD of room on every side), so after
rendering each layer is cropped to its alpha bbox and its HAIR_STYLES
{width, dx, dy} falls out of where it sits relative to the head anchor - no
hand placement.

- Dog (dog_v2.png, 473x296 frames, side view facing LEFT; Dog.draw() mirrors
  it when walking right and the hair mirrors with it). One view, an optional
  `back` layer (drawn before the sprite, so it only shows around the head -
  the curly pouf uses it to sit BEHIND the ears).
- Mouse (mouse_v2.png, 327x327 frames, 4 facings x 3 walk frames). Not truly
  top-down: north is the back of the head, south is the face, east/west are
  side profiles. So a mouse style is THREE views (`back`, `front`, `side`);
  west reuses `side` mirrored (HAIR_ANCHORS.mouse carries view + flip).

Anchors (head-crown points) were measured by registering each walk frame's
head against the view's first frame (sum-of-squared-differences over a head
window), not eyeballed; they're duplicated in HAIR_ANCHORS (js/utils/hair.js).

Usage:
    python3 tools/make_critter_hair.py [slug ...] [--preview out.png]
Writes assets/hair_<character>_<slug>[ _<view>][_back].png, SVG sources to
tools/hair_src/, prints the HAIR_STYLES entries. Needs Google Chrome
(headless render, run outside the Bash sandbox).
"""

import argparse
import os
import subprocess
import sys

from PIL import Image

OUTLINE = '#2a1248'
SCALE = 2
PAD = 70
SW = 2.6  # outline width, native px
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

CHAR = {
    'dog': {'sheet': 'assets/dog_v2.png', 'fw': 473, 'fh': 296},
    'mouse': {'sheet': 'assets/mouse_v2.png', 'fw': 327, 'fh': 327},
}
# Per-frame crown anchors (frame-local native px). Keep in sync with hair.js.
DOG_ANCHORS = [(112, 72), (110, 70), (111, 74), (111, 58), (114, 56), (111, 49)]
MOUSE_ANCHORS = [
    (165, 28, 'back', False), (160, 30, 'back', False), (160, 34, 'back', False),
    (258, 140, 'side', False), (253, 140, 'side', False), (256, 141, 'side', False),
    (165, 178, 'front', False), (164, 183, 'front', False), (162, 183, 'front', False),
    (76, 128, 'side', True), (73, 131, 'side', True), (67, 137, 'side', True),
]
# The frame each view is authored on (its first walk frame).
MOUSE_VIEW_FRAME = {'back': 0, 'side': 3, 'front': 6}


def grad(gid, light, mid, dark, x1=0, y1=0, x2=0, y2=1):
    return (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">'
            f'<stop offset="0" stop-color="{light}"/><stop offset="0.5" stop-color="{mid}"/>'
            f'<stop offset="1" stop-color="{dark}"/></linearGradient>')


def doc(char, defs, body):
    fw, fh = CHAR[char]['fw'], CHAR[char]['fh']
    w, h = (fw + 2 * PAD) * SCALE, (fh + 2 * PAD) * SCALE
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">'
            f'<defs>{defs}</defs><g transform="scale({SCALE}) translate({PAD} {PAD})">{body}</g></svg>')


def outlined(shapes, fill):
    """Fat stroke pass for every shape, then the fill pass - one shared outline.
    `shapes` are path d strings or ('c', cx, cy, r) circles / ('e', cx, cy, rx, ry, rot)."""
    def el(s, attrs):
        if isinstance(s, str):
            return f'<path d="{s}" {attrs}/>'
        if s[0] == 'c':
            return f'<circle cx="{s[1]}" cy="{s[2]}" r="{s[3]}" {attrs}/>'
        _, cx, cy, rx, ry, rot = s
        return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" transform="rotate({rot} {cx} {cy})" {attrs}/>'
    st = ''.join(el(s, f'fill="{OUTLINE}" stroke="{OUTLINE}" stroke-width="{SW * 2}" stroke-linejoin="round"') for s in shapes)
    fl = ''.join(el(s, f'fill="{fill}"') for s in shapes)
    return st + fl


def strand(d, color, w=1.4, op=0.6):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" opacity="{op}"/>'


def gloss(cx, cy, rx, ry, rot=0, op=0.7):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#fff" opacity="{op}" transform="rotate({rot} {cx} {cy})"/>'


def curl_shine(circles, op=0.55):
    """A little highlight arc on the upper-left of each curl."""
    return ''.join(gloss(cx - r * 0.35, cy - r * 0.4, r * 0.38, r * 0.18, -35, op) for _, cx, cy, r in circles)


def bow(cx, cy, s, fill_id, knot='#ff8fc8'):
    """Two-loop ribbon bow centered at (cx, cy), half-width ~ 20*s."""
    l = (f'M{cx},{cy} C{cx - 10 * s},{cy - 14 * s} {cx - 24 * s},{cy - 10 * s} {cx - 21 * s},{cy} '
         f'C{cx - 24 * s},{cy + 10 * s} {cx - 10 * s},{cy + 14 * s} {cx},{cy} Z')
    r = (f'M{cx},{cy} C{cx + 10 * s},{cy - 14 * s} {cx + 24 * s},{cy - 10 * s} {cx + 21 * s},{cy} '
         f'C{cx + 24 * s},{cy + 10 * s} {cx + 10 * s},{cy + 14 * s} {cx},{cy} Z')
    return (outlined([l, r], f'url(#{fill_id})')
            + outlined([('c', cx, cy, 5 * s)], knot)
            + gloss(cx - 12 * s, cy - 5 * s, 5 * s, 2 * s, -20) + gloss(cx + 10 * s, cy - 5 * s, 5 * s, 2 * s, 20))


# ======================================================================= DOG
# Frame-0 landmarks (dog faces left): far ear x75-105 y35-75, near ear x105-160
# (tip ~125,28), forehead slopes (65,95)->(100,72), eye ~(88,110), back of the
# head curves (160,80)->(190,140).

def curl_swirl(circles, color, op=0.55):
    """A little inner spiral per curl so a cluster reads as curls, not bubbles."""
    out = ''
    for _, cx, cy, r in circles:
        out += strand(f'M{cx + r * 0.5},{cy + r * 0.2} C{cx + r * 0.4},{cy + r * 0.7} {cx - r * 0.6},{cy + r * 0.6} {cx - r * 0.55},{cy} '
                      f'C{cx - r * 0.5},{cy - r * 0.45} {cx + r * 0.1},{cy - r * 0.5} {cx + r * 0.15},{cy - r * 0.05}', color, 1.3, op)
    return out


def dog_swoop():
    """Shaggy magenta side-swept fringe with pointed locks + a short back mane."""
    defs = grad('h', '#ff9ad5', '#e8389a', '#9c1462', 60, 55, 120, 150)
    hair = ('M192,140 C196,112 186,84 168,70 C150,56 126,56 106,60 C90,64 76,74 66,86 '
            'C58,96 52,106 48,118 L62,104 L66,116 L76,98 L84,100 L92,90 L102,96 L112,86 '
            'C130,82 148,86 160,96 L164,112 L172,102 L178,124 L184,116 L188,144 Z')
    body = (outlined([hair], 'url(#h)')
            + strand('M176,80 C152,64 120,62 96,72 C80,80 66,92 56,108', '#ffd0ec', 1.5, 0.75)
            + strand('M182,104 C168,86 140,74 112,76 C98,78 88,84 80,92', '#7a0c4a', 1.4, 0.55)
            + strand('M120,66 C106,70 92,78 82,90', '#7a0c4a', 1.2, 0.5)
            + strand('M186,132 C184,114 176,100 164,90', '#7a0c4a', 1.3, 0.5)
            + gloss(124, 66, 16, 4, -6) + gloss(176, 92, 4, 10, -30, 0.5))
    return {'front': doc('dog', defs, body)}


def dog_ponytail():
    """Golden cap with a soft scalloped hairline, swept back into a full
    high ponytail that splits into two locks, teal scrunchie."""
    defs = (grad('h', '#ffe9a6', '#f5c451', '#c98a1c', 0, 20, 0, 160)
            + grad('t', '#9ff3ea', '#2ec4b6', '#127a72', 0, 62, 0, 96))
    cap = ('M182,100 C180,80 168,64 150,60 C130,56 106,58 90,64 C80,68 72,78 70,90 '
           'C76,86 80,88 84,84 C90,82 94,86 100,80 C108,78 114,82 120,78 C136,76 158,82 174,100 Z')
    tail = ('M168,74 C168,44 192,20 224,20 C256,20 278,46 272,80 C268,102 278,120 268,142 '
            'C264,154 256,162 246,170 C250,154 248,142 240,130 C236,142 230,148 220,152 '
            'C230,134 236,114 238,98 C242,74 234,54 216,50 C200,48 188,60 186,82 Z')
    body = (outlined([tail], 'url(#h)')
            + strand('M182,62 C190,38 214,30 236,36 C256,44 262,70 256,96 C252,116 258,134 252,152', '#fff4c8', 1.6, 0.75)
            + strand('M176,70 C188,48 208,40 226,46 C246,56 248,84 244,108 C242,124 236,138 228,148', '#b07612', 1.5, 0.55)
            + strand('M200,30 C228,24 252,34 262,58', '#b07612', 1.3, 0.45)
            + gloss(216, 30, 14, 4, 8)
            + outlined([cap], 'url(#h)')
            + strand('M80,84 C104,72 140,70 170,90', '#b07612', 1.3, 0.55)
            + strand('M92,72 C112,64 140,64 162,74', '#fff4c8', 1.4, 0.75)
            + gloss(124, 66, 14, 3.5, -4)
            + outlined([('e', 177, 80, 11, 16, 20)], 'url(#t)')
            + strand('M170,68 C177,75 180,85 178,94', '#0e5a54', 1.4, 0.6)
            + strand('M176,66 C183,74 186,84 184,92', '#d6fffa', 1.1, 0.6)
            + gloss(172, 72, 3, 5, 20))
    return {'front': doc('dog', defs, body)}


def dog_pouf():
    """Big curly lavender pouf: the cloud sits BEHIND the ears (back layer),
    uneven curls frame the forehead/crown in front, plus two loose ringlets."""
    defs = grad('h', '#efe2ff', '#b48cf0', '#6f45b8', 0, 0, 0, 110)
    cloud = [('c', 80, 56, 18), ('c', 96, 36, 20), ('c', 120, 22, 22), ('c', 146, 22, 20),
             ('c', 168, 38, 21), ('c', 182, 62, 18), ('c', 112, 50, 24), ('c', 146, 52, 24),
             ('c', 66, 78, 14), ('c', 190, 86, 14)]
    back = outlined(cloud, 'url(#h)') + curl_shine(cloud) + curl_swirl(cloud, '#5a2f9e', 0.45)
    front_c = [('c', 70, 86, 10), ('c', 84, 74, 13), ('c', 102, 70, 11), ('c', 118, 66, 13),
               ('c', 136, 70, 11), ('c', 152, 68, 13), ('c', 168, 76, 11), ('c', 180, 90, 12),
               ('c', 188, 106, 9)]
    ringlets = ['M70,92 C64,98 70,104 66,110 C62,116 68,122 64,126 C70,124 74,118 72,112 C76,106 70,100 76,94 Z',
                'M184,100 C190,108 184,116 190,122 C194,128 188,134 192,140 C198,134 198,126 194,120 C198,112 194,106 192,98 Z']
    front = (outlined(ringlets + front_c, 'url(#h)') + curl_shine(front_c, 0.6)
             + curl_swirl(front_c, '#5a2f9e', 0.5))
    return {'back': doc('dog', defs, back), 'front': doc('dog', defs, front)}


# ===================================================================== MOUSE
# View landmarks: back (frame 0) crown ~(165,28), ears x100-150 / x180-235;
# side (frame 3, facing right) crown ~(258,140), back ear centered ~(238,125),
# eye ~(272,185); front (frame 6) crown ~(165,178), ears x100-160 / x190-230,
# eyes y~240.

def mouse_bun():
    """Cotton-candy pink bun with a purple bow, visible from every side."""
    defs = (grad('h', '#ffd1ec', '#ff7ac4', '#c2307e', 0, -20, 0, 40)
            + grad('hs', '#ffd1ec', '#ff7ac4', '#c2307e', 0, 90, 0, 150)
            + grad('hf', '#ffd1ec', '#ff7ac4', '#c2307e', 0, 135, 0, 185)
            + grad('b', '#e2c4ff', '#9b5cf0', '#5a24a8', 0, -14, 0, 14)
            + grad('bs', '#e2c4ff', '#9b5cf0', '#5a24a8', 0, 124, 0, 152)
            + grad('bf', '#e2c4ff', '#9b5cf0', '#5a24a8', 0, 162, 0, 190))

    def bun(cx, cy, r, gid):
        return (outlined([('c', cx, cy, r)], f'url(#{gid})')
                + strand(f'M{cx - r * 0.6},{cy + r * 0.2} C{cx - r * 0.5},{cy - r * 0.7} {cx + r * 0.6},{cy - r * 0.6} {cx + r * 0.5},{cy + r * 0.1} '
                         f'C{cx + r * 0.4},{cy + r * 0.5} {cx - r * 0.2},{cy + r * 0.5} {cx - r * 0.1},{cy}', '#9c1f62', 1.6, 0.55)
                + gloss(cx - r * 0.4, cy - r * 0.45, r * 0.35, r * 0.15, -35))
    back = bun(165, 6, 22, 'h') + bow(165, 30, 1.0, 'b')
    side = bun(256, 116, 22, 'hs') + bow(254, 138, 0.85, 'bs')
    front = bun(165, 154, 22, 'hf') + bow(165, 176, 1.0, 'bf')
    return {'back': doc('mouse', defs, back), 'side': doc('mouse', defs, side), 'front': doc('mouse', defs, front)}


def mouse_curls():
    """Golden curly fringe."""
    defs = (grad('h', '#fff1b8', '#f5c84c', '#c58a12', 0, 0, 0, 60)
            + grad('hs', '#fff1b8', '#f5c84c', '#c58a12', 0, 115, 0, 165)
            + grad('hf', '#fff1b8', '#f5c84c', '#c58a12', 0, 155, 0, 205))
    back_c = [('c', 140, 34, 13), ('c', 190, 34, 13), ('c', 152, 18, 14), ('c', 178, 18, 14),
              ('c', 165, 10, 14), ('c', 165, 34, 15), ('c', 150, 48, 12), ('c', 180, 48, 12)]
    side_c = [('c', 240, 134, 12), ('c', 252, 124, 13), ('c', 266, 126, 13), ('c', 278, 136, 12),
              ('c', 286, 150, 11), ('c', 258, 140, 12), ('c', 272, 146, 11)]
    front_c = [('c', 134, 186, 12), ('c', 196, 186, 12), ('c', 146, 172, 13), ('c', 184, 172, 13),
               ('c', 165, 166, 14), ('c', 150, 192, 12), ('c', 180, 192, 12), ('c', 165, 186, 13)]
    return {'back': doc('mouse', defs, outlined(back_c, 'url(#h)') + curl_shine(back_c)),
            'side': doc('mouse', defs, outlined(side_c, 'url(#hs)') + curl_shine(side_c)),
            'front': doc('mouse', defs, outlined(front_c, 'url(#hf)') + curl_shine(front_c))}


def mouse_mohawk():
    """Teal-to-blue punk mohawk: a fan of spikes end-on (front/back), a row
    of spikes along the head in profile."""
    defs = (grad('h', '#b6fff2', '#26c6b0', '#1a4fd0', 0, -26, 0, 36)
            + grad('hs', '#b6fff2', '#26c6b0', '#1a4fd0', 0, 88, 0, 150)
            + grad('hf', '#b6fff2', '#26c6b0', '#1a4fd0', 0, 124, 0, 186))

    def fan(cx, base_y):
        d = (f'M{cx - 15},{base_y} L{cx - 20},{base_y - 30} L{cx - 9},{base_y - 16} L{cx - 7},{base_y - 46} '
             f'L{cx},{base_y - 22} L{cx + 7},{base_y - 46} L{cx + 9},{base_y - 16} L{cx + 20},{base_y - 30} '
             f'L{cx + 15},{base_y} C{cx + 8},{base_y + 6} {cx - 8},{base_y + 6} {cx - 15},{base_y} Z')
        return (outlined([d], 'url(#h)' if base_y < 60 else 'url(#hf)')
                + strand(f'M{cx - 4},{base_y - 4} L{cx - 6},{base_y - 36}', '#e8fffb', 1.4, 0.75)
                + strand(f'M{cx + 10},{base_y - 4} L{cx + 15},{base_y - 22}', '#0e2f88', 1.2, 0.5))
    side = ('M232,138 L222,106 L240,124 L242,92 L256,118 L264,92 L270,122 L284,102 L282,130 '
            'L298,122 L290,146 C276,140 252,134 232,138 Z')
    side_body = (outlined([side], 'url(#hs)')
                 + strand('M244,128 L243,102', '#e8fffb', 1.4, 0.75)
                 + strand('M262,126 L263,102', '#e8fffb', 1.4, 0.75)
                 + strand('M278,132 L282,112', '#0e2f88', 1.2, 0.5))
    return {'back': doc('mouse', defs, fan(165, 32)),
            'side': doc('mouse', defs, side_body),
            'front': doc('mouse', defs, fan(165, 182))}


STYLES = {
    'dog-swoop': ('dog', dog_swoop),
    'dog-ponytail': ('dog', dog_ponytail),
    'dog-pouf': ('dog', dog_pouf),
    'mouse-bun': ('mouse', mouse_bun),
    'mouse-curls': ('mouse', mouse_curls),
    'mouse-mohawk': ('mouse', mouse_mohawk),
}


def render(svg_text, png_path):
    html = png_path + '.html'
    import re
    w, h = (int(v) for v in re.search(r'width="(\d+)" height="(\d+)"', svg_text).groups())
    with open(html, 'w') as f:
        f.write(f'<html><body style="margin:0;background:transparent">{svg_text}</body></html>')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    '--default-background-color=00000000', f'--window-size={w},{h}',
                    f'--screenshot={png_path}', 'file://' + os.path.abspath(html)], check=True, capture_output=True)
    os.remove(html)
    return Image.open(png_path).convert('RGBA')


def to_overlay(img, out_path, anchor):
    bbox = img.getchannel('A').point(lambda v: 255 if v > 4 else 0).getbbox()
    l, t, r, _ = bbox
    img.crop(bbox).save(out_path)
    nl, nt, nr = l / SCALE - PAD, t / SCALE - PAD, r / SCALE - PAD
    return {'width': round(nr - nl, 1), 'dx': round((nl + nr) / 2 - anchor[0], 1), 'dy': round(nt - anchor[1], 1)}


def fmt(src, g):
    return f"src: '{src}?v=1', width: {g['width']:g}, dx: {g['dx']:g}, dy: {g['dy']:g}"


def frame(sheet, char, i):
    fw, fh = CHAR[char]['fw'], CHAR[char]['fh']
    if char == 'dog':
        return sheet.crop((0, i * fh, fw, (i + 1) * fh))
    return sheet.crop(((i % 3) * fw, (i // 3) * fh, (i % 3 + 1) * fw, (i // 3 + 1) * fh))


def place(layer_img, char, base_anchor, anchor, flip):
    """Shift a full-canvas layer authored at base_anchor onto a frame whose
    anchor is `anchor` (mirroring around it if flip). Returns a frame-sized
    (plus PAD) RGBA image at native scale."""
    fw, fh = CHAR[char]['fw'], CHAR[char]['fh']
    lay = layer_img.resize((fw + 2 * PAD, fh + 2 * PAD), Image.LANCZOS)
    out = Image.new('RGBA', lay.size, (0, 0, 0, 0))
    if flip:
        lay = lay.transpose(Image.FLIP_LEFT_RIGHT)
        # after the flip, base anchor x sits at (fw + 2PAD - 1) - (bx + PAD)
        bx = (fw + 2 * PAD - 1) - (base_anchor[0] + PAD) - PAD
    else:
        bx = base_anchor[0]
    out.paste(lay, (anchor[0] - bx, anchor[1] - base_anchor[1]), lay)
    return out


def preview(results, path):
    cells = []
    for slug, char, views in results:
        sheet = Image.open(CHAR[char]['sheet']).convert('RGBA')
        fw, fh = CHAR[char]['fw'], CHAR[char]['fh']
        if char == 'dog':
            frames = [(i, DOG_ANCHORS[i], 'side', False) for i in range(6)]
            base = {'side': DOG_ANCHORS[0]}
            vmap = {'side': views}
        else:
            frames = [(i, a[:2], a[2], a[3]) for i, a in enumerate(MOUSE_ANCHORS)]
            base = {v: MOUSE_ANCHORS[f][:2] for v, f in MOUSE_VIEW_FRAME.items()}
            vmap = views
        row = []
        for i, anchor, view, flip in frames:
            layers = vmap[view]
            cell = Image.new('RGBA', (fw + 2 * PAD, fh + 2 * PAD), (120, 160, 170, 255))
            if 'back' in layers:
                cell.alpha_composite(place(layers['back'], char, base[view], anchor, flip))
            cell.alpha_composite(frame(sheet, char, i), (PAD, PAD))
            cell.alpha_composite(place(layers['front'], char, base[view], anchor, flip))
            row.append(cell)
        cells.append(row)
    cw = max(c.width for r in cells for c in r)
    ch = max(c.height for r in cells for c in r)
    ncol = max(len(r) for r in cells)
    out = Image.new('RGBA', (cw * min(ncol, 6), ch * sum((len(r) + 5) // 6 for r in cells)), (90, 120, 130, 255))
    y = 0
    for r in cells:
        for k, c in enumerate(r):
            out.alpha_composite(c, ((k % 6) * cw, y + (k // 6) * ch))
        y += ((len(r) + 5) // 6) * ch
    out.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('styles', nargs='*')
    ap.add_argument('--preview')
    ap.add_argument('--srcdir', default='tools/hair_src')
    args = ap.parse_args()
    os.makedirs(args.srcdir, exist_ok=True)
    results, entries = [], []
    for slug in args.styles or STYLES:
        char, fn = STYLES[slug]
        svgs = fn()
        if char == 'dog':
            imgs = {}
            for layer, text in svgs.items():
                with open(os.path.join(args.srcdir, f'{slug}_{layer}.svg'), 'w') as f:
                    f.write(text)
                imgs[layer] = render(text, os.path.join(args.srcdir, f'{slug}_{layer}.png'))
            results.append((slug, char, imgs))
            fg = to_overlay(imgs['front'], f'assets/hair_{slug}.png', DOG_ANCHORS[0])
            entry = f"  '{slug}': {{ images: {{ dog: {{ {fmt(f'./assets/hair_{slug}.png', fg)}"
            if 'back' in imgs:
                bg = to_overlay(imgs['back'], f'assets/hair_{slug}_back.png', DOG_ANCHORS[0])
                entry += f", back: {{ {fmt(f'./assets/hair_{slug}_back.png', bg)} }}"
            entries.append(entry + ' } } },')
        else:
            views, parts = {}, []
            for view, text in svgs.items():
                with open(os.path.join(args.srcdir, f'{slug}_{view}.svg'), 'w') as f:
                    f.write(text)
                img = render(text, os.path.join(args.srcdir, f'{slug}_{view}.png'))
                views[view] = {'front': img}
                g = to_overlay(img, f'assets/hair_{slug}_{view}.png', MOUSE_ANCHORS[MOUSE_VIEW_FRAME[view]][:2])
                parts.append(f"{view}: {{ {fmt(f'./assets/hair_{slug}_{view}.png', g)} }}")
            results.append((slug, char, views))
            entries.append(f"  '{slug}': {{ images: {{ mouse: {{ views: {{ {', '.join(parts)} }} }} }} }},")
    if args.preview:
        preview(results, args.preview)
        print('wrote preview', args.preview)
    print('\n'.join(entries))


if __name__ == '__main__':
    sys.exit(main())
