// Builds a rounded-rect path without filling/stroking it, so callers can set
// fillStyle/strokeStyle/shadow independently. Shared by GameScreen's
// game-over modal/button, CharacterSelectScreen's character cards, and
// Cutscene's modal/button — extracted here once a third caller needed the
// exact same path-builder, rather than drifting into three near-identical
// copies.
export function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

// Shared ear geometry so drawCatEarCard (outer silhouette) and
// drawCatEarInner (the two-tone inner-ear accent) can never drift apart —
// both need the exact same ear position/size to line up.
function earGeometry(width, height) {
  return {
    inset: width * 0.16,
    width: width * 0.22,
    height: height * 0.2,
  };
}

// A rounded rect (same corner treatment as drawRoundedRect above) with two
// ears poking up from the top edge, inset from the corners — reads as a
// cat's head silhouette without needing an actual face outline. Used by
// CharacterSelectScreen's character cards as a callback to the game's own
// name ("Kat Trap") rather than to a specific mechanic — an earlier
// version shaped these cards like Escape.js's mouse-hole cutout instead,
// which read as off-brand for a cat-titled game (confirmed live: "mouse
// hole seems out of place on a game called KatTrap"). Each ear's tip is a
// quadraticCurveTo (control point pulled up to 2x the ear's height, which
// puts the curve's actual peak at the intended height — see the quadratic
// Bézier midpoint formula) rather than two straight lines meeting at a
// point, for a softer, rounder "kitten ear" silhouette instead of a sharp
// triangle spike (confirmed live: an earlier straight-edged version didn't
// read as cat-like enough on its own). The ears sit entirely above `y`
// (outside the card's own height), so callers positioning content by
// fractions of `height` from `y` don't need to account for them.
export function drawCatEarCard(ctx, x, y, width, height, radius) {
  const ear = earGeometry(width, height);

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + ear.inset, y);
  ctx.quadraticCurveTo(
    x + ear.inset + ear.width / 2, y - ear.height * 2,
    x + ear.inset + ear.width, y
  );
  ctx.lineTo(x + width - ear.inset - ear.width, y);
  ctx.quadraticCurveTo(
    x + width - ear.inset - ear.width / 2, y - ear.height * 2,
    x + width - ear.inset, y
  );
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

// The two-tone "inner ear" accent real cat ears have — a smaller, inset
// curve nested inside each outer ear from drawCatEarCard above, meant to
// be filled with a different (usually darker/richer) color in a second
// fill() call after the card's own body is painted. Builds both ears as
// one path (two subpaths) so the caller only needs one fill() for both,
// same one-call convention as the other builders here. Deliberately
// smaller and set back from the outer ear's own tip/edges (via `inset`
// below) rather than a scaled copy centered on it, so a visible rim of the
// outer ear color remains all the way around — an inner shape sized flush
// to the outer one reads as two overlapping shapes, not a two-tone ear.
// Sized noticeably smaller than a first pass at this (0.22/0.62 insets) —
// confirmed live that a thin remaining rim wasn't visually distinguishable
// from the border stroke drawn over the outer ear's own edge, so the two
// tones just merged into what looked like one solid-color ear.
export function drawCatEarInner(ctx, x, y, width, height) {
  const ear = earGeometry(width, height);
  const inset = ear.width * 0.32;
  const innerHeight = ear.height * 0.5;
  const baseY = y - ear.height * 0.22;

  ctx.beginPath();
  [x + ear.inset, x + width - ear.inset - ear.width].forEach((earLeftX) => {
    const left = earLeftX + inset;
    const right = earLeftX + ear.width - inset;
    const centerX = (left + right) / 2;
    ctx.moveTo(left, baseY);
    ctx.quadraticCurveTo(centerX, baseY - innerHeight * 2, right, baseY);
    ctx.lineTo(left, baseY);
  });
  ctx.closePath();
}
