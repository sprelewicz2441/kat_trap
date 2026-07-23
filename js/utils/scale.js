// Every fixed-pixel size in this game (furniture, characters, wall
// thickness, escape holes, UI chrome) was originally tuned by eye against
// a desktop-sized canvas — effectively ~1280px wide, the cap resizeCanvas()
// applies in js/main.js. On a small mobile canvas those same absolute pixel
// values ate up a hugely disproportionate share of the board (e.g. a single
// stove at ~40% of the board height on a 350px-wide canvas). getScale()
// gives every class a single multiplier, derived from how far the actual
// canvas width is from that reference, so a size written as `BASE * scale`
// keeps the same proportion of the board at any canvas size.
export const REFERENCE_WIDTH = 1280;

// Confirmed live on an actual phone: even with the proportion-preserving
// scale above, assets still read as too small on mobile — the fix isn't a
// bigger/smaller REFERENCE_WIDTH (that would change desktop's scale too,
// since desktop canvases already sit near REFERENCE_WIDTH), it's making
// mobile specifically bigger. `pointer: coarse` is the same signal
// styles.css already uses to show/hide the D-pad and action buttons (see
// touchControls.js) — reusing it here means asset scaling and touch-control
// visibility can never disagree, and there's no new device-detection
// heuristic to invent. Doesn't need its own landscape check: the
// orientation gate already blocks gameplay in portrait, so during actual
// play a coarse pointer alone is a sufficient proxy for "the mobile path."
//
// Two different multipliers, confirmed live: a first pass at a flat 2x for
// everything read as too big for in-game assets (furniture/characters/board
// chrome) once actually tested on-device, so that category was pulled back
// to 1.5x. Buttons/messages (play-again button, win/lose text, cutscene
// modal/button/text) read fine at the original 2x and were explicitly asked
// to stay a little bigger than the in-game assets, so they keep their own
// multiplier rather than following the reduction.
const MOBILE_ASSET_MULTIPLIER = 1.5;
const MOBILE_UI_MULTIPLIER = 2;

function isTouch() {
  return window.matchMedia('(pointer: coarse)').matches;
}

// In-game assets: furniture, characters, wall/floor chrome, spawn clearance.
export function getScale(canvasWidth) {
  const base = canvasWidth / REFERENCE_WIDTH;
  return isTouch() ? base * MOBILE_ASSET_MULTIPLIER : base;
}

// UI/interactive chrome: buttons, win/lose messages, cutscene modal/text/button.
export function getUIScale(canvasWidth) {
  const base = canvasWidth / REFERENCE_WIDTH;
  return isTouch() ? base * MOBILE_UI_MULTIPLIER : base;
}
