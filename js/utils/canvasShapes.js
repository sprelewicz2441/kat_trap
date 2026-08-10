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

// Shared geometry for the mouse card's ears — see drawMouseEarCard below.
function mouseEarGeometry(width) {
  return {
    inset: width * 0.13,
    radius: width * 0.155,
  };
}

// Big, perfectly round Mickey-style ears, in place of the cat's pointed
// spike — CharacterSelectScreen keeps the cat card as-is but wants the
// mouse/dog cards reading as their own animal at a glance rather than all
// three wearing the same cat ears. Built the same way drawCatEarCard
// integrates its ear curve directly into the card's own top-edge boundary
// (one continuous path, not a separate overlapping shape) so a stroke()
// call has no seam where the ear meets the body — here that means tracing
// the ear as a true arc() (a quadraticCurveTo can approximate a curve but
// never a perfect circle) whose start/end angles land exactly on the top
// edge line itself, so the straight edge and the round ear meet without a
// visible kink. `ctx.arc(cx, y, r, Math.PI, 2*Math.PI, false)` traces the
// upper half of a circle centered ON the top edge — from the ear's left
// base, up and over the top, down to its right base — which is exactly
// that seamless join. Sized so its poke-height (== radius, a plain
// semicircle) stays comfortably under the cat ear's own ~52px peak (at
// BASE scale) that CharacterSelectScreen's BASE_TITLE_GAP was already
// tuned to clear, so the title never needed retuning for this.
export function drawMouseEarCard(ctx, x, y, width, height, radius) {
  const ear = mouseEarGeometry(width);
  const leftCenterX = x + ear.inset + ear.radius;
  const rightCenterX = x + width - ear.inset - ear.radius;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(leftCenterX - ear.radius, y);
  ctx.arc(leftCenterX, y, ear.radius, Math.PI, 2 * Math.PI, false);
  ctx.lineTo(rightCenterX - ear.radius, y);
  ctx.arc(rightCenterX, y, ear.radius, Math.PI, 2 * Math.PI, false);
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

// Two-tone accent for the mouse's round ears — same flat-bottomed-dome
// convention as drawCatEarInner (a smaller concentric arc nested inside
// the outer ear, not a scaled copy flush against it, so a visible rim of
// the outer color remains).
export function drawMouseEarInner(ctx, x, y, width, height) {
  const ear = mouseEarGeometry(width);
  const innerRadius = ear.radius * 0.55;

  ctx.beginPath();
  [x + ear.inset + ear.radius, x + width - ear.inset - ear.radius].forEach((cx) => {
    ctx.moveTo(cx - innerRadius, y);
    ctx.arc(cx, y, innerRadius, Math.PI, 2 * Math.PI, false);
    ctx.lineTo(cx - innerRadius, y);
  });
  ctx.closePath();
}

// Shared geometry for the dog card's ears — see drawDogEarCard below.
// Two earlier attempts hung the ears off the *side* edges (a symmetric
// petal, then a tapered teardrop) — both read as an odd side-bump rather
// than an ear ("hard to tell they are ears"), since a shape stuck onto the
// side of a rectangle doesn't obviously read as "attached to a head" the
// way a shape poking up from the top does. Back to poking up from the top
// edge like the cat/mouse cards (same layout convention, same zero
// collision-with-neighbor risk this time), but built so the peak visibly
// *leans and droops* — see the "flop" comment on drawDogEarCard — rather
// than standing straight up (cat) or forming a plain symmetric dome
// (mouse).
function dogEarGeometry(width, height) {
  return {
    inset: width * 0.12,
    earWidth: width * 0.26,
    // A cubic Bézier's actual rendered peak falls well short of this
    // nominal value (the curve is pulled by *two* independently-weighted
    // control points, not one) — checked numerically rather than assumed:
    // 0.22 (an earlier value here) only reached ~29px actual, reading as
    // a timid nub next to the cat/mouse ears' own ~52px presence. 0.4
    // actually renders to ~51px, matching the cat ear's own peak height
    // while staying safely under CharacterSelectScreen's BASE_TITLE_GAP
    // (70).
    peakHeight: height * 0.4,
    foldHeight: height * 0.08,
  };
}

// Builds one ear's "flop" as a single cubic Bézier from (fromX, y) to
// (toX, y) — a real floppy ear rises near where it attaches to the head,
// then the tip droops back down before it settles, which a *symmetric*
// curve (equal control-point weight on both ends, what the cat/mouse ears
// use) can't produce; a cubic needs two independently-weighted control
// points to pull one end up high (the near-attachment rise) and the other
// down low (the droop) within the same curve. `peakNearStart` picks which
// endpoint the rise is anchored to — left and right ears are mirror
// images of each other, but both need their rise anchored on their own
// *inner* (attachment/center-facing) side and their droop on their own
// *outer* (corner-facing) side, and since the boundary path below
// traverses the left ear outer→inner but the right ear inner→outer,
// "inner side" is the curve's *end* point for one ear and its *start*
// point for the other. Shared by both the full-size outer ear and the
// smaller inset inner-ear accent so the two curves can't drift apart into
// different silhouettes.
function dogEarFlopCurve(ctx, fromX, toX, y, peakHeight, foldHeight, peakNearStart) {
  const w = toX - fromX;
  if (peakNearStart) {
    ctx.bezierCurveTo(
      fromX + w * 0.15, y - peakHeight,
      toX - w * 0.1, y - foldHeight,
      toX, y
    );
  } else {
    ctx.bezierCurveTo(
      fromX + w * 0.1, y - foldHeight,
      toX - w * 0.15, y - peakHeight,
      toX, y
    );
  }
}

// Floppy ears poking up from the top edge, integrated into the card's own
// boundary path the same way the cat/mouse ears are (one continuous
// outline, so stroke() has no seam where the ear meets the body) — just
// with an asymmetric "flop" curve (see dogEarFlopCurve above) instead of
// the cat's symmetric point or the mouse's symmetric dome. Each ear rises
// steeply on its *inner* (center-facing) side up to peakHeight, then
// droops back down on its *outer* (corner-facing) side, settling near
// foldHeight before reaching the far base — the visible dip between the
// two is what should read as "drooping/floppy" rather than "standing
// upright." peakHeight (0.22 * height ≈ 57 at BASE scale) stays
// comfortably under CharacterSelectScreen's BASE_TITLE_GAP (70), the same
// margin the cat ear's own ~52px peak already relied on. Doesn't extend
// past the card's left/right edges at all, so — unlike the side-hanging
// attempts — there's no BASE_CARD_GAP collision risk to check here.
export function drawDogEarCard(ctx, x, y, width, height, radius) {
  const ear = dogEarGeometry(width, height);
  const leftOuterX = x + ear.inset;
  const leftInnerX = leftOuterX + ear.earWidth;
  const rightInnerX = x + width - ear.inset - ear.earWidth;
  const rightOuterX = x + width - ear.inset;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(leftOuterX, y);
  // Left ear: outer (corner-facing) base → droop → rise → inner
  // (center-facing) base. Peak anchored near the end (inner side).
  dogEarFlopCurve(ctx, leftOuterX, leftInnerX, y, ear.peakHeight, ear.foldHeight, false);
  ctx.lineTo(rightInnerX, y);
  // Right ear: mirror — inner base → rise → droop → outer base. Peak
  // anchored near the start (inner side) this time, since this ear is
  // traversed in the opposite direction.
  dogEarFlopCurve(ctx, rightInnerX, rightOuterX, y, ear.peakHeight, ear.foldHeight, true);
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

// Two-tone accent for the dog's floppy ears — same nested, smaller-and-
// inset convention as drawCatEarInner/drawMouseEarInner (a smaller shape
// set back from the outer ear's own edge, not a scaled copy flush against
// it), reusing dogEarFlopCurve so the accent's own droop always matches
// the outer ear's droop exactly.
export function drawDogEarInner(ctx, x, y, width, height) {
  const ear = dogEarGeometry(width, height);
  const inset = ear.earWidth * 0.3;
  const peakHeight = ear.peakHeight * 0.55;
  const foldHeight = ear.foldHeight * 0.6;

  const leftOuterX = x + ear.inset + inset;
  const leftInnerX = x + ear.inset + ear.earWidth - inset;
  const rightInnerX = x + width - ear.inset - ear.earWidth + inset;
  const rightOuterX = x + width - ear.inset - inset;

  ctx.beginPath();
  ctx.moveTo(leftOuterX, y);
  dogEarFlopCurve(ctx, leftOuterX, leftInnerX, y, peakHeight, foldHeight, false);
  ctx.lineTo(leftOuterX, y);

  ctx.moveTo(rightInnerX, y);
  dogEarFlopCurve(ctx, rightInnerX, rightOuterX, y, peakHeight, foldHeight, true);
  ctx.lineTo(rightInnerX, y);
  ctx.closePath();
}
