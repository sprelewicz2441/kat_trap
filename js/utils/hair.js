// Hair overlay for the "Mane Attraction" salon (prototype). Hair is drawn as a
// separate layer on top of a character's already-drawn sprite frame rather than
// baked into full alternate sprite sheets (see outfits.js's getSpriteSrc() for
// the full-sheet approach cosmetics use) - hair x tutu would otherwise multiply
// into one sheet per combination.
//
// Everything here is in the sprite sheet's NATIVE frame coordinates (cat_v2.png
// is 256x296 per frame), so the caller just applies whatever transform it already
// uses to draw the sprite itself (translate to center, directional lean, then the
// non-uniform native->display scale) and the hair follows the head exactly.

// Per-frame head anchor in native frame pixels: `x` is the head's horizontal
// center, `y` the top of the head (tuft top) in that frame. The walk cycle bobs
// the head ~18px, so a single fixed anchor would make hair float/sink as it
// walks. Measured from cat_v2.png's alpha channel (topmost opaque row in the
// center columns), not eyeballed - re-measure if the sheet's art changes.
export const HAIR_ANCHORS = {
  cat: [
    { x: 125, y: 23 },
    { x: 125, y: 38 },
    { x: 125, y: 38 },
    { x: 125, y: 33 },
    { x: 125, y: 20 },
    { x: 125, y: 20 },
  ],
};

// Placeholder procedural styles, each a list of primitives in coordinates
// relative to the head anchor (x right, y down from the top of the head), so a
// style is independent of frame bob. Real styles will be transparent PNGs drawn
// the same way - these exist to prove the anchor/transform plumbing before any
// art is generated. `fill` accepts any canvas color.
//
// The default cat has a built-in purple tuft on top of its head, so a style
// has to be big enough to cover it (about 100px wide, 50px tall at the top).
export const HAIR_STYLES = {
  bow: [
    { type: 'poly', pts: [[0, 22], [-62, -8], [-62, 54]], fill: '#ff4f9a' },
    { type: 'poly', pts: [[0, 22], [62, -8], [62, 54]], fill: '#ff4f9a' },
    { type: 'ellipse', x: 0, y: 22, rx: 18, ry: 28, fill: '#d81b78' },
  ],
  pompadour: [
    { type: 'ellipse', x: 0, y: 36, rx: 66, ry: 40, fill: '#7b3fe4' },
    { type: 'ellipse', x: -28, y: 22, rx: 30, ry: 24, fill: '#9a63f0' },
  ],
};

function drawPrimitive(ctx, p) {
  ctx.fillStyle = p.fill;
  ctx.beginPath();
  if (p.type === 'ellipse') {
    ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
  } else if (p.type === 'poly') {
    p.pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
  }
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 10, 60, 0.7)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

// Draws `style` for `character`'s `frame`. Expects ctx already translated so the
// origin is the TOP-LEFT of the sprite's destination rect and scaled by
// (displayWidth / frameWidth, displayHeight / frameHeight) - i.e. native frame
// coordinates, exactly what the sprite's own drawImage source rect uses. No-ops
// for an unknown character/style/frame so a bad equip value can never break the
// sprite draw underneath.
export function drawHair(ctx, character, style, frame) {
  const anchor = HAIR_ANCHORS[character]?.[frame];
  const primitives = HAIR_STYLES[style];
  if (!anchor || !primitives) return;
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  primitives.forEach((p) => drawPrimitive(ctx, p));
  ctx.restore();
}
