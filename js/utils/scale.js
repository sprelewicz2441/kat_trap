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

// Furniture specifically (not characters, not wall/floor chrome) reads
// noticeably smaller on desktop than it used to: the kitchen_*.png asset
// swap (see CLAUDE.md Kitchen furniture) came with new native pixel
// dimensions, and GameScreen's BASE_MODULE_SCALE was re-tuned against those
// files without being checked live at full desktop size — flagged as an
// unverified estimate in CLAUDE.md's Planned Work, and confirmed live to
// in fact be too small. Restoring it to roughly its previous on-screen
// size is a desktop-only correction — mobile's furniture size was already
// tuned and approved separately via MOBILE_ASSET_MULTIPLIER above, so this
// only applies when NOT on a touch device, leaving that already-approved
// mobile sizing untouched.
const DESKTOP_FURNITURE_MULTIPLIER = 2;

// Design-director pass (see CLAUDE.md): furniture had no equivalent of
// MOBILE_CHARACTER_SIZE_MULTIPLIER below — mobile furniture just used
// getScale() as-is (base * MOBILE_ASSET_MULTIPLIER, i.e. an effective ×1.5),
// while desktop furniture got its own ×2 on top of an unmultiplied base.
// Ratio-wise that's 2 : 1.5 — desktop furniture was permanently occupying
// 33% more of the board, width-for-width, than mobile furniture, which is
// exactly the "assets don't scale consistently with board size" symptom
// reported live (furniture-to-board proportion swinging depending on
// device class, not smoothly varying with canvas size the way every BASE_*
// constant elsewhere in GameScreen.js already does via computeLayout()).
// Derived the same way MOBILE_CHARACTER_SIZE_MULTIPLIER is below
// (DESKTOP_FURNITURE_MULTIPLIER / MOBILE_ASSET_MULTIPLIER) so mobile
// furniture ends up at the *same* fraction of canvas width desktop
// furniture already has, rather than picking a new number by eye.
const MOBILE_FURNITURE_MULTIPLIER = DESKTOP_FURNITURE_MULTIPLIER / MOBILE_ASSET_MULTIPLIER;

// Characters (cat/dog/mouse) read noticeably small on a laptop-size desktop
// canvas — this boosts their on-screen/collision *size* only, desktop-only,
// same shape as DESKTOP_FURNITURE_MULTIPLIER above. Deliberately NOT part
// of getScale() itself: getScale() also drives movement speed (Cat/Dog/
// Mouse each multiply their speed by the same `scale` they're constructed
// with), and speed was just carefully tuned (see CAT_WANDER_SPEED_MULTIPLIER
// in GameScreen.js) — a blanket scale bump here would silently re-speed-up
// characters along with resizing them. Each entity class takes this as a
// separate `sizeScale` constructor param, used only for size/display
// fields, while `scale` keeps driving speed alone. Started at 1.5 (50%
// bigger); bumped to 1.95 (another 30% on top, i.e. 1.5 * 1.3) after that
// still read as too small live.
const DESKTOP_CHARACTER_SIZE_MULTIPLIER = 1.95;

// Confirmed live on an actual phone: even with MOBILE_ASSET_MULTIPLIER
// applied, characters read as too small relative to the board compared to
// desktop — the two platforms' characters weren't actually the same size
// *relative to their own canvas width*. Desktop's character-to-canvas-width
// ratio is (1 * DESKTOP_CHARACTER_SIZE_MULTIPLIER) / REFERENCE_WIDTH;
// mobile's (before this) was just MOBILE_ASSET_MULTIPLIER / REFERENCE_WIDTH,
// i.e. missing an equivalent size-only boost. This constant is exactly
// DESKTOP_CHARACTER_SIZE_MULTIPLIER / MOBILE_ASSET_MULTIPLIER (1.95 / 1.5),
// so mobile characters end up at the *same* proportion of the board desktop
// characters have — not bigger or smaller, just matched. Same split from
// getScale() as DESKTOP_CHARACTER_SIZE_MULTIPLIER: speed isn't affected,
// only on-screen/collision size.
const MOBILE_CHARACTER_SIZE_MULTIPLIER = 1.3;

// Exported so main.js's resizeCanvas() can reserve extra side-margin width
// for the touch d-pad/action buttons — see resizeCanvas() for why.
export function isTouch() {
  return window.matchMedia('(pointer: coarse)').matches;
}

// In-game assets: character movement speed, wall/floor chrome, spawn
// clearance. Character *size* uses getCharacterScale() below instead —
// see DESKTOP_CHARACTER_SIZE_MULTIPLIER for why the two are split.
export function getScale(canvasWidth) {
  const base = canvasWidth / REFERENCE_WIDTH;
  return isTouch() ? base * MOBILE_ASSET_MULTIPLIER : base;
}

// Furniture only — see DESKTOP_FURNITURE_MULTIPLIER/MOBILE_FURNITURE_MULTIPLIER
// above for why this isn't just getScale(). Both branches now carry an
// explicit furniture-specific multiplier (previously only desktop did),
// keeping furniture's board-width proportion identical on both device
// classes.
export function getFurnitureScale(canvasWidth) {
  const scale = getScale(canvasWidth);
  return isTouch() ? scale * MOBILE_FURNITURE_MULTIPLIER : scale * DESKTOP_FURNITURE_MULTIPLIER;
}

// Character on-screen/collision size only (not speed) — see
// DESKTOP_CHARACTER_SIZE_MULTIPLIER above for why this is split from
// getScale(). No-op on touch, since mobile character sizing was already
// tuned separately via MOBILE_ASSET_MULTIPLIER.
export function getCharacterScale(canvasWidth) {
  const scale = getScale(canvasWidth);
  return isTouch() ? scale * MOBILE_CHARACTER_SIZE_MULTIPLIER : scale * DESKTOP_CHARACTER_SIZE_MULTIPLIER;
}

// UI/interactive chrome: buttons, win/lose messages, cutscene modal/text/button.
export function getUIScale(canvasWidth) {
  const base = canvasWidth / REFERENCE_WIDTH;
  return isTouch() ? base * MOBILE_UI_MULTIPLIER : base;
}
