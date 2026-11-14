#!/usr/bin/env python3
"""Author the Mane Attraction hairstyle art as SVG and render it to raw PNGs.

There's no image generator in the loop for these, so each style is drawn here
in the same visual language as the cat sprite and the twin-buns art: a heavy
dark-purple outline, saturated 3-stop gradients, and white gloss highlights.
Re-running this script regenerates everything, so a palette/shape tweak is a
one-line change instead of a new art round.

Outputs (all in --outdir, default tools/hair_src/):
  <slug>.svg   the source drawing (transparent background)
  <slug>.png   a raw 1:1 render with real alpha (needs Google Chrome; see render())

Then each PNG goes through tools/prepare_hair_overlay.py (--preview to check
coverage on the real cat frames) before being wired into js/utils/hair.js.

Shared outline trick: shapes are drawn twice - once as a fat dark stroke, once
as the fill on top - so overlapping pieces (curls, spikes, strands) get ONE
clean outer outline instead of a dark line through every overlap.
"""

import argparse
import math
import os
import subprocess
import sys

OUTLINE = '#2a1248'
W = 600  # every drawing is 600 wide; height varies per style


def grad(gid, light, mid, dark, x1=0, y1=0, x2=0, y2=1, space=False):
    units = ' gradientUnits="userSpaceOnUse"' if space else ''
    return (
        f'<linearGradient id="{gid}"{units} x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">'
        f'<stop offset="0" stop-color="{light}"/><stop offset="0.5" stop-color="{mid}"/>'
        f'<stop offset="1" stop-color="{dark}"/></linearGradient>'
    )


def svg(height, defs, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{height}" '
        f'viewBox="0 0 {W} {height}"><defs>{defs}</defs>{body}</svg>'
    )


def gloss(cx, cy, rx, ry, rot=0, op=0.75):
    return (
        f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#fff" opacity="{op}" '
        f'transform="rotate({rot} {cx} {cy})"/>'
    )


def mirror_x(d_body):
    return f'<g transform="translate({W} 0) scale(-1 1)">{d_body}</g>'


# ---------------------------------------------------------------- bow
def bow():
    h = 300
    defs = grad('g', '#ff9ccf', '#ff4fa3', '#c4166f') + grad('k', '#ff7fba', '#e02a86', '#8f0c52')

    loop = (
        # outer loop
        f'<path d="M292,150 C240,50 100,10 45,85 C0,150 35,255 135,272 C215,284 268,212 292,184 Z" '
        f'fill="url(#g)" stroke="{OUTLINE}" stroke-width="8" stroke-linejoin="round"/>'
        # inner fold shading
        f'<path d="M286,158 C236,98 150,78 98,112 C70,134 80,196 135,208 C190,216 252,196 286,174 Z" '
        f'fill="#d9267f" opacity="0.55"/>'
        # satin fold lines
        f'<path d="M284,160 C226,112 150,100 104,126" fill="none" stroke="#ffc2e0" stroke-width="5" '
        f'stroke-linecap="round" opacity="0.8"/>'
        f'<path d="M284,176 C230,200 170,214 128,200" fill="none" stroke="#a80f5e" stroke-width="5" '
        f'stroke-linecap="round" opacity="0.55"/>'
        + gloss(120, 62, 46, 15, -22)
        + gloss(66, 112, 9, 9, 0, 0.7)
    )
    knot = (
        f'<ellipse cx="300" cy="168" rx="40" ry="54" fill="url(#k)" stroke="{OUTLINE}" stroke-width="8"/>'
        f'<path d="M286,128 C282,160 282,178 288,206" fill="none" stroke="#ff9ccf" stroke-width="6" '
        f'stroke-linecap="round" opacity="0.8"/>' + gloss(292, 138, 9, 18, -10, 0.7)
    )
    return svg(h, defs, loop + mirror_x(loop) + knot)


# ---------------------------------------------------------------- pompadour
def pompadour():
    h = 360
    defs = (grad('d', '#5ee8e0', '#16b4c8', '#0a6590', 0, 30, 0, 320, True)
            + grad('l', '#b4fff6', '#3fdcd8', '#139bb8', 0, 40, 0, 250, True))
    dome = ('M52,300 C20,230 45,125 140,78 C235,30 365,22 455,64 C548,106 575,205 540,300 '
            'A62,40 0 0 1 416,300 A62,40 0 0 1 292,300 A62,40 0 0 1 168,300 A62,40 0 0 1 52,300 Z')
    # the signature lock: sweeps up from the left, over the top, and curls into a spiral
    lock = 'M70,262 C100,130 250,52 400,88 C505,114 520,215 445,228 C385,238 365,170 415,158'
    body = (
        f'<path d="{dome}" fill="url(#d)" stroke="{OUTLINE}" stroke-width="9" stroke-linejoin="round"/>'
        # strands in the dome
        f'<path d="M95,296 C85,220 120,150 190,110" fill="none" stroke="#0a6590" stroke-width="6" stroke-linecap="round" opacity="0.4"/>'
        f'<path d="M160,300 C150,240 175,190 225,160" fill="none" stroke="#0a6590" stroke-width="6" stroke-linecap="round" opacity="0.4"/>'
        f'<path d="M470,300 C500,250 500,190 470,150" fill="none" stroke="#0a6590" stroke-width="6" stroke-linecap="round" opacity="0.4"/>'
        # the lock, outlined as one fat stroke over the dome
        f'<path d="{lock}" fill="none" stroke="{OUTLINE}" stroke-width="82" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="{lock}" fill="none" stroke="url(#l)" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="M92,236 C128,138 250,78 388,104" fill="none" stroke="#e6fffc" stroke-width="9" stroke-linecap="round" opacity="0.85"/>'
        f'<path d="M110,250 C150,160 260,102 390,128" fill="none" stroke="#0e86a8" stroke-width="5" stroke-linecap="round" opacity="0.45"/>'
        f'<path d="M430,206 C470,206 478,170 440,158" fill="none" stroke="#0e86a8" stroke-width="5" stroke-linecap="round" opacity="0.5"/>'
        + gloss(150, 118, 40, 11, -35, 0.8)
    )
    return svg(h, defs, body)


# ---------------------------------------------------------------- mohawk
def mohawk():
    h = 400
    colors = [
        ('#ff8fb8', '#ff2d78', '#b0124f'),
        ('#ffb27a', '#ff6a1f', '#b53a05'),
        ('#fff08a', '#ffd21f', '#c28a00'),
        ('#a6f59a', '#33d65a', '#117a2f'),
        ('#8fe9ff', '#1fb4f0', '#0a5f99'),
        ('#c9a6ff', '#8b4df0', '#4a1e9c'),
        ('#ff9ee8', '#e53ad0', '#8a1480'),
    ]
    defs = grad('base', '#8b4df0', '#6a2fd0', '#3d1690')
    defs += ''.join(grad(f's{i}', *c) for i, c in enumerate(colors))
    # spike geometry: (center x, tip x, tip y) - a gentle left-to-right fan
    spikes = [(155, 130, 140), (210, 195, 80), (265, 260, 40), (320, 322, 26), (375, 384, 44), (430, 444, 86), (485, 500, 146)]
    out_layer, fill_layer = '', ''
    for i, (cx, tx, ty) in enumerate(spikes):
        d = (
            f'M{cx - 46},340 C{cx - 40},{(340 + ty) / 2 + 20} {tx - 10},{ty + 70} {tx},{ty} '
            f'C{tx + 12},{ty + 70} {cx + 40},{(340 + ty) / 2 + 20} {cx + 46},340 Q{cx},378 {cx - 46},340 Z'
        )
        out_layer += f'<path d="{d}" fill="{OUTLINE}" stroke="{OUTLINE}" stroke-width="16" stroke-linejoin="round"/>'
        fill_layer += (
            f'<path d="{d}" fill="url(#s{i})"/>'
            f'<path d="M{cx - 14},326 C{cx - 16},{(340 + ty) / 2 + 30} {tx - 8},{ty + 90} {tx - 2},{ty + 34}" '
            f'fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity="0.6"/>'
        )
    base = ''
    return svg(h, defs, out_layer + fill_layer + base)


# ---------------------------------------------------------------- curly puff
def puff():
    h = 380
    defs = grad('g', '#ffd27a', '#ff9a2e', '#c4520c', 0, 20, 0, 360, True)
    # a cloud of overlapping circles, back row first
    circles = [
        (300, 170, 120), (170, 220, 92), (430, 220, 92), (110, 290, 62), (490, 290, 62),
        (225, 120, 70), (375, 120, 70), (300, 80, 68), (210, 270, 70), (390, 270, 70),
    ]
    outline = ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{OUTLINE}" stroke="{OUTLINE}" stroke-width="16"/>' for x, y, r in circles)
    fills = ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#g)"/>' for x, y, r in circles)

    def curl(cx, cy, r):
        # a little spiral curl inside a bump
        pts = []
        for i in range(0, 52):
            t = i / 51
            a = t * 3.2 * math.pi
            rr = r * (1 - 0.82 * t)
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        d = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts)
        return f'<path d="{d}" fill="none" stroke="#a8430a" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.65"/>'

    detail = ''.join(curl(x, y, r * 0.5) for x, y, r in [(300, 170, 120), (170, 220, 92), (430, 220, 92), (225, 120, 70), (375, 120, 70), (300, 80, 68)])
    glints = gloss(250, 70, 30, 12, -25) + gloss(140, 190, 22, 9, -35, 0.65) + gloss(345, 110, 16, 8, -20, 0.6)
    return svg(h, defs, outline + fills + detail + glints)


# ---------------------------------------------------------------- top knot
def topknot():
    h = 380
    defs = (grad('g', '#d99a6c', '#9a552e', '#52260f', 0, 40, 0, 300, True)
            + grad('r', '#ff9aa8', '#f0305a', '#a30f33'))

    def spiral(cx, cy, r0, r1, turns, start=0.0):
        pts = []
        n = 90
        for i in range(n + 1):
            t = i / n
            a = start + t * turns * 2 * math.pi
            rr = r0 + (r1 - r0) * t
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a) * 0.9))
        return 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts)

    swirl = spiral(300, 168, 118, 14, 2.4, -0.6)
    bun = (
        f'<ellipse cx="300" cy="170" rx="136" ry="124" fill="url(#g)" stroke="{OUTLINE}" stroke-width="9"/>'
        # strand bands spiralling into the middle (cinnamon-roll wrap)
        + f'<path d="{swirl}" fill="none" stroke="#3b180a" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>'
        + f'<path d="{spiral(300, 168, 104, 10, 2.4, -0.6)}" fill="none" stroke="#f2b88a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>'
        + gloss(222, 92, 36, 12, -32, 0.7)
        # a couple of flyaway strands at the top
        + f'<path d="M290,52 C280,22 310,6 330,24" fill="none" stroke="{OUTLINE}" stroke-width="13" stroke-linecap="round"/>'
        + f'<path d="M290,52 C280,22 310,6 330,24" fill="none" stroke="#9a552e" stroke-width="6" stroke-linecap="round"/>'
        # small hair tie capping the neck of the knot
        + f'<path d="M226,262 C268,280 332,280 374,262 L368,296 C332,312 268,312 232,296 Z" fill="url(#r)" stroke="{OUTLINE}" stroke-width="9" stroke-linejoin="round"/>'
        + f'<path d="M246,278 C278,290 322,290 354,278" fill="none" stroke="#ffd0d6" stroke-width="5" stroke-linecap="round" opacity="0.8"/>'
    )
    return svg(h, defs, bun)


STYLES = {'bow': bow, 'pompadour': pompadour, 'mohawk': mohawk, 'puff': puff, 'topknot': topknot}

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def render(svg_path, png_path, height):
    """Render an SVG to a transparent PNG at 1:1 via headless Chrome."""
    html_path = svg_path[:-4] + '.render.html'
    with open(html_path, 'w') as f:
        f.write(f'<html><body style="margin:0;background:transparent"><img src="{os.path.basename(svg_path)}" style="display:block"></body></html>')
    subprocess.run(
        [CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
         '--default-background-color=00000000', f'--window-size={W},{height}', f'--screenshot={png_path}',
         'file://' + os.path.abspath(html_path)],
        check=True, capture_output=True,
    )
    os.remove(html_path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--outdir', default='tools/hair_src')
    ap.add_argument('styles', nargs='*', help=f'subset of {list(STYLES)} (default: all)')
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)
    for slug in args.styles or STYLES:
        text = STYLES[slug]()
        height = int(text.split('height="')[1].split('"')[0])
        sp, pp = os.path.join(args.outdir, f'{slug}.svg'), os.path.join(args.outdir, f'{slug}.png')
        with open(sp, 'w') as f:
            f.write(text)
        render(sp, pp, height)
        print('wrote', pp)


if __name__ == '__main__':
    sys.exit(main())
