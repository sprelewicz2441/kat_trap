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

// Which sprite frame the store/character-select portrait crop shows (see
// outfits.js's PORTRAITS - cat's crop is frame 0), so a composited portrait
// anchors hair with that same frame's entry above.
export const HAIR_PORTRAIT_FRAME = {
  cat: 0,
};

// A style is one of two shapes, both keyed by the equipped item's slug:
//   - a procedural placeholder: an array of primitives (below), same for every
//     character; or
//   - real art: { images: { [character]: { src, width, dx, dy } } } - a
//     transparent PNG per character (made with tools/prepare_hair_overlay.py).
//     `width` is the on-sprite width in NATIVE frame px, `dx` shifts the
//     image's horizontal center from the head anchor's x, `dy` is the image's
//     TOP edge relative to the anchor's y (negative = above the head top). The
//     image's height follows its own aspect ratio.
// Real art goes in this registry as it's generated (see tools/prepare_hair_overlay.py).
//
// Placeholder procedural styles, each a list of primitives in coordinates
// relative to the head anchor (x right, y down from the top of the head), so a
// style is independent of frame bob. Real styles will be transparent PNGs drawn
// the same way - these exist to prove the anchor/transform plumbing before any
// art is generated. `fill` accepts any canvas color.
//
// The default cat has a built-in purple tuft on top of its head, so a style
// has to be big enough to cover it (about 100px wide, 50px tall at the top).
export const HAIR_STYLES = {
  // Real art. Two round buns on an arched band; the cat's own purple tuft still
  // peeks up between them (the buns are far apart) - left in on purpose, it reads
  // as baby hair. Placed from the tool's preview on the real cat frames.
  'twin-buns': { images: { cat: { src: './assets/hair_cat_twin-buns.png?v=1', width: 210, dx: 0, dy: -2 } } },
  // Real art for the rest, all drawn by tools/make_hair_art.py (SVG -> PNG) and
  // placed from tools/prepare_hair_overlay.py's preview on the real cat frames.
  // Tall styles (mohawk, puff, top knot) rise well above the sprite frame on
  // purpose - the game canvas and the 240px store portrait both have headroom.
  bow: { images: { cat: { src: './assets/hair_cat_bow.png?v=1', width: 130, dx: 0, dy: -10 } } },
  pompadour: { images: { cat: { src: './assets/hair_cat_pompadour.png?v=1', width: 150, dx: 0, dy: -20 } } },
  mohawk: { images: { cat: { src: './assets/hair_cat_mohawk.png?v=1', width: 130, dx: 0, dy: -52 } } },
  puff: { images: { cat: { src: './assets/hair_cat_puff.png?v=1', width: 160, dx: 0, dy: -42 } } },
  topknot: { images: { cat: { src: './assets/hair_cat_topknot.png?v=1', width: 112, dx: 0, dy: -70 } } },
  // Human-style hair (tools/make_human_hair.py): a front layer (bangs/cap,
  // covers the tuft) plus a `back` layer that hangs behind the head and body.
  // Geometry is computed by the tool from where it was drawn on frame 0.
  princess: { images: { cat: { src: './assets/hair_cat_princess.png?v=1', width: 139.3, dx: -1, dy: -12.7, back: { src: './assets/hair_cat_princess_back.png?v=1', width: 244, dx: -1, dy: -17 } } } },
  bob: { images: { cat: { src: './assets/hair_cat_bob.png?v=1', width: 128.7, dx: -1, dy: -14.3, back: { src: './assets/hair_cat_bob_back.png?v=1', width: 248.7, dx: -1, dy: -16.7 } } } },
  ponytail: { images: { cat: { src: './assets/hair_cat_ponytail.png?v=1', width: 126, dx: -1, dy: -28, back: { src: './assets/hair_cat_ponytail_back.png?v=1', width: 133.7, dx: 56.8, dy: -53.7 } } } },
  braids: { images: { cat: { src: './assets/hair_cat_braids.png?v=1', width: 133.3, dx: -1, dy: -12.7, back: { src: './assets/hair_cat_braids_back.png?v=1', width: 246, dx: -1, dy: -14.7 } } } },
};

// One Image per src, loaded once. Page-lifetime cache - hair art is small and
// there are only a handful of styles.
const hairImageCache = {};
function getHairImage(src) {
  if (!hairImageCache[src]) {
    const img = new Image();
    img.src = src;
    hairImageCache[src] = img;
  }
  return hairImageCache[src];
}

// Draws a real-art style. Returns without drawing if the image hasn't loaded
// yet; `onReady` (optional) is called once when it does so a caller that only
// draws once (the store pedestal) can redraw - gameplay redraws every frame and
// just picks it up on the next one.
function drawImageStyle(ctx, def, onReady) {
  const img = getHairImage(def.src);
  if (!img.complete || img.naturalWidth === 0) {
    if (onReady) img.addEventListener('load', onReady, { once: true });
    return;
  }
  const height = def.width * (img.naturalHeight / img.naturalWidth);
  // The overlays are stored ~4-5x bigger than they end up on screen. One
  // drawImage() straight from 400px down to ~90px with the browser's default
  // ('low') smoothing skips most source pixels and comes out jagged/smeared -
  // it read as "low res" art even though the PNGs are crisp. Pick a
  // pre-halved copy close to the real on-screen size instead (mipmap).
  const t = ctx.getTransform();
  const onScreenW = def.width * Math.hypot(t.a, t.b);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(pickMipLevel(img, onScreenW), def.dx - def.width / 2, def.dy, def.width, height);
}

// Halve repeatedly (each step a high-quality 2:1 downscale, which smooths
// properly) and cache the chain per image. Returns the smallest level that's
// still at least `targetW` wide, so the final drawImage() only ever shrinks by
// less than 2x.
const mipCache = new WeakMap();
function pickMipLevel(img, targetW) {
  let levels = mipCache.get(img);
  if (!levels) {
    levels = [img];
    let src = img;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    while (w / 2 >= 24) {
      w = Math.round(w / 2);
      h = Math.max(1, Math.round(h / 2));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cctx = c.getContext('2d');
      cctx.imageSmoothingEnabled = true;
      cctx.imageSmoothingQuality = 'high';
      cctx.drawImage(src, 0, 0, w, h);
      levels.push(c);
      src = c;
    }
    mipCache.set(img, levels);
  }
  let pick = levels[0];
  for (const level of levels) {
    if (level.width >= targetW) pick = level;
    else break;
  }
  return pick;
}

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
// sprite draw underneath. `onReady`: see drawImageStyle().
//
// `layer`: 'front' (default) is drawn AFTER the sprite; 'back' is drawn BEFORE
// it, for hair that hangs behind the head/body (long hair, braids, ponytail -
// an image entry's optional `back: { src, width, dx, dy }`, same geometry
// rules). Callers that support it draw back, sprite, front; a style with no
// back layer makes the 'back' call a no-op.
export function drawHair(ctx, character, style, frame, onReady, layer = 'front') {
  const anchor = HAIR_ANCHORS[character]?.[frame];
  const def = HAIR_STYLES[style];
  if (!anchor || !def) return;
  const isBack = layer === 'back';
  let image = null;
  if (!Array.isArray(def)) {
    image = def.images?.[character];
    if (image && isBack) image = image.back;
    if (!image) return;
  } else if (isBack) {
    return;
  }
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  if (image) drawImageStyle(ctx, image, onReady);
  else def.forEach((p) => drawPrimitive(ctx, p));
  ctx.restore();
}
