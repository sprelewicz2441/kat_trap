import { isTouch } from './scale.js';

// On-screen D-pad + action buttons for touch devices. InputHandler.js only
// listens for real `keydown`/`keyup` window events — rather than teaching
// it (and by extension GameScreen) anything about touch, each button here
// just dispatches the exact same KeyboardEvent a physical key would send.
// InputHandler doesn't need to know touch controls exist at all, and
// there's nothing to keep in sync if key bindings change later.
const DIRECTION_KEYS = {
  dpadUp: 'ArrowUp',
  dpadDown: 'ArrowDown',
  dpadLeft: 'ArrowLeft',
  dpadRight: 'ArrowRight',
};

const ACTION_KEYS = {
  punchBtn: 'p',
  tootBtn: ' ',
  meowBtn: 'm',
};

function dispatchKey(type, key) {
  window.dispatchEvent(new KeyboardEvent(type, { key }));
}

// Movement is continuous while InputHandler sees the key as held (polled
// every frame via getDirection()), so these need a real press/release pair
// — pointerleave/pointercancel are included so a finger sliding off the
// button (rather than a clean release) doesn't leave the direction "stuck".
function wireHoldButton(id, key) {
  const button = document.getElementById(id);
  if (!button) return;

  const press = (e) => {
    e.preventDefault();
    dispatchKey('keydown', key);
  };
  const release = (e) => {
    e.preventDefault();
    dispatchKey('keyup', key);
  };

  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointerleave', release);
  button.addEventListener('pointercancel', release);
}

// Punch/toot/meow are one-shot actions (InputHandler fires their custom
// event straight from keydown) — only a press is needed.
function wireTapButton(id, key) {
  const button = document.getElementById(id);
  if (!button) return;

  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dispatchKey('keydown', key);
  });
}

// Natural (unscaled) footprint of each control — must match the width/
// height set in styles.css for #dpad and .action-btn respectively, since
// they're the reference sizes the shrink-to-fit scale below is computed
// against. Design-director pass (see CLAUDE.md): bumped up from 168/64 —
// bigger targets across the board, not just at the floor below.
const DPAD_NATURAL_SIZE = 210;
const ACTION_BTN_NATURAL_SIZE = 76;

// The d-pad divides one disc into 4 direction zones — unlike a single
// plain tap target, shrinking it further doesn't just make it "a bit
// harder to hit," it makes hitting the *specific direction* you meant
// unreliable. Confirmed live (and by hand-computing layoutTouchControls()'s
// old formula across a spread of real device widths) that the old
// no-floor policy let the d-pad shrink to ~70-125px on an iPhone SE,
// a standard iPad landscape, and a touch laptop — genuinely too small.
// This floor, combined with resizeCanvas() (js/main.js) reserving
// MIN_TOUCH_CONTROL_GUTTER of side margin *only when the board's natural
// size wouldn't already provide it*, guarantees the d-pad never renders
// smaller than DPAD_NATURAL_SIZE * MIN_DPAD_SCALE (130px) — the board
// gives up some width before the control gives up usability, per explicit
// product direction. Action buttons keep the old no-floor policy: they're
// simple one-shot taps, not a divided disc, and in practice they now
// always land at full size anyway once the gutter is wide enough to
// satisfy the d-pad's own (larger) floor.
//
// 0.62, not a rounder-looking 0.75: the first pass used 0.75 (157.5px) and
// caused a real regression — hand-computing resizeCanvas()'s formula
// across the same device spread showed it forcing a visible board-height
// shortfall even on an ordinary iPhone (whose *natural* gutter, with no
// floor at all, already gave a very reasonable ~150px d-pad — this floor
// was demanding more than that device actually needed, at real cost to
// board size). 0.62 (130px) still turns the genuinely-bad old cases
// (iPhone SE ~72px, a standard iPad ~96px) into a meaningfully bigger,
// comfortably-usable control, while landing below what ordinary phones
// already provide naturally — so it only ever costs board space on the
// handful of devices that actually need the help.
const MIN_DPAD_SCALE = 0.62;
// Small safety margin so a control at its max scale doesn't touch the
// canvas edge or the viewport frame right at the gutter's boundary.
const GUTTER_SAFETY_MARGIN = 12;
// Exported so resizeCanvas() (js/main.js) can reserve enough canvas-side
// margin, up front, to guarantee MIN_DPAD_SCALE is achievable — computed
// from the same constants the floor itself uses so the two can never drift
// out of sync with each other.
export const MIN_TOUCH_CONTROL_GUTTER = DPAD_NATURAL_SIZE * MIN_DPAD_SCALE + GUTTER_SAFETY_MARGIN;

// A control sitting dead-center in a gutter that's much wider than it
// needs to be reads as floating in empty space, roughly as far from the
// viewport's physical edge (where a thumb actually rests) as it is from
// the board — confirmed live as the "too much blank space… hard to press
// the right direction" complaint on wider gutters. EDGE_ANCHOR_MARGIN is
// the fixed, comfortable distance from the viewport edge a control
// prefers to sit at once the gutter has room to spare; below that, it
// falls back to plain gutter-centering (see the Math.min in
// positionControl() below), which is also what guarantees it can never
// overlap the canvas.
const EDGE_ANCHOR_MARGIN = 20;

// Fixed distance from the viewport's top edge #settingsMenu (the hamburger)
// sits at on touch — deliberately NOT vertically centered like
// #actionButtons below it, so the two read as related-but-distinct groups
// rather than a fourth button in the action column. Matches
// styles.css's `#settingsMenu { top: 20px }` under pointer:coarse; kept
// here too since layoutTouchControls() needs the exact value to compute
// the action-button cluster's own minimum safe position (see
// ICON_GROUP_GAP below) — this is the one thing CSS can't just default on
// its own, since it depends on the hamburger's actual (possibly shrunk)
// on-screen size.
const SETTINGS_TOP_MARGIN = 20;
// Deliberate visual gap between the hamburger and the action-button
// cluster below it — enough that they read as two groups, not a running
// list of four identical icons.
const ICON_GROUP_GAP = 24;
// Matches #actionButtons' own `gap: 10px` in styles.css — needed here to
// compute the actual on-screen height of the 3-button column (which the
// CSS `gap` alone doesn't expose to JS).
const ACTION_BTN_GAP = 10;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Shared by #dpad (left gutter) and #actionButtons (right gutter): picks
// the control's center-line distance from its nearest viewport edge.
// Prefers a fixed, thumb-reach-friendly distance from that edge
// (EDGE_ANCHOR_MARGIN + half the control's own on-screen size); only
// falls back to splitting the gutter evenly (gutter / 2, the Math.min
// below) when the gutter is too tight for that preferred distance to fit
// without the control creeping toward — or past — the canvas edge. The
// tight-gutter case is exactly the existing shrink-to-fit scenario, so
// this never introduces a new way to overlap the board; it only changes
// where a *roomy* gutter's leftover space ends up (beside the board, not
// beside the viewport edge).
function edgeAnchoredOffset(gutter, onScreenSize) {
  const preferred = EDGE_ANCHOR_MARGIN + onScreenSize / 2;
  return Math.min(preferred, gutter / 2);
}

// Positions #dpad/#actionButtons within the empty "gutter" beside the
// canvas (the space between the viewport frame and the canvas's left/
// right edge) instead of at a fixed offset from the viewport edge — the
// canvas's width isn't fixed (see resizeCanvas() in js/main.js), so the
// gutter width changes with viewport size and has to be read from the
// canvas's actual rendered position rather than assumed. Vertical
// centering mostly doesn't need this — the gutter runs the full viewport
// height regardless of where the canvas sits vertically, so the CSS
// `top: 50%` already set in styles.css covers that axis on its own — except
// for #actionButtons specifically sharing its column with the settings
// menu above it, where JS does need to nudge `top` on short viewports (see
// below).
//
// Also shrinks each control to fit when the gutter is narrower than its
// natural size — confirmed via a spread of real device viewports that on
// tablets close to the canvas's own 4:3 aspect (a standard iPad landscape,
// notably) the gutter can be as little as ~50px, well under the d-pad's
// natural size. resizeCanvas() now keeps this from ever going below
// MIN_DPAD_SCALE for the d-pad specifically (see above) by reserving
// enough gutter up front; action buttons still have no floor, since they
// end up with room to spare once that reservation is in place. Scaled via
// `transform: scale()` (a CSS variable set here) rather than resizing
// width/height directly, so the internal padding/gaps/icon sizes shrink
// proportionally instead of a fixed-px interior cramming into a smaller
// box.
function layoutTouchControls() {
  const canvas = document.getElementById('gameCanvas');
  const dpad = document.getElementById('dpad');
  const actionButtons = document.getElementById('actionButtons');
  if (!canvas || !dpad || !actionButtons) return;

  const rect = canvas.getBoundingClientRect();
  const leftGutter = rect.left;
  const rightGutter = window.innerWidth - rect.right;
  const gutter = Math.min(leftGutter, rightGutter);
  const usableGutter = Math.max(0, gutter - GUTTER_SAFETY_MARGIN);

  const dpadScale = clamp(usableGutter / DPAD_NATURAL_SIZE, MIN_DPAD_SCALE, 1);
  const actionScale = clamp(usableGutter / ACTION_BTN_NATURAL_SIZE, 0, 1);
  document.documentElement.style.setProperty('--dpad-scale', dpadScale);
  document.documentElement.style.setProperty('--action-scale', actionScale);

  dpad.style.left = `${edgeAnchoredOffset(leftGutter, DPAD_NATURAL_SIZE * dpadScale)}px`;
  const actionOffset = edgeAnchoredOffset(rightGutter, ACTION_BTN_NATURAL_SIZE * actionScale);
  const rightColumnLeft = window.innerWidth - actionOffset;
  actionButtons.style.left = `${rightColumnLeft}px`;

  // Settings (hamburger) menu: on touch, shares this exact column with
  // #actionButtons — same horizontal center, same size/shrink scale — so
  // the two can't drift apart the way the old independent fixed-corner
  // position did (confirmed live: it overlapped the punch button once the
  // action-button cluster grew). Desktop positioning is untouched — that's
  // a plain fixed `top/right` in styles.css with no JS involved at all, so
  // this only runs its effects on touch.
  const settingsMenu = document.getElementById('settingsMenu');
  if (settingsMenu && isTouch()) {
    settingsMenu.style.left = `${rightColumnLeft}px`;

    // #actionButtons defaults to true vertical centering (styles.css's
    // `top: 50%`), which is fine on any viewport tall enough to leave a
    // real gap below the hamburger — but on a short landscape viewport it
    // can center high enough to actually overlap the hamburger sitting at
    // a fixed SETTINGS_TOP_MARGIN from the top. Compute both edges in real
    // pixels and only override `top` (pushing the cluster down, never up)
    // when centering would violate ICON_GROUP_GAP — a no-op on anything
    // but the shortest viewports, so this doesn't change the common case.
    const settingsOnScreenSize = ACTION_BTN_NATURAL_SIZE * actionScale;
    const settingsBottom = SETTINGS_TOP_MARGIN + settingsOnScreenSize;
    const clusterHeight = actionScale * (3 * ACTION_BTN_NATURAL_SIZE + 2 * ACTION_BTN_GAP);
    const minClusterCenterY = settingsBottom + ICON_GROUP_GAP + clusterHeight / 2;
    const centeredY = window.innerHeight / 2;
    actionButtons.style.top = `${Math.max(centeredY, minClusterCenterY)}px`;
  }
}

export function setupTouchControls() {
  Object.entries(DIRECTION_KEYS).forEach(([id, key]) => wireHoldButton(id, key));
  Object.entries(ACTION_KEYS).forEach(([id, key]) => wireTapButton(id, key));

  layoutTouchControls();
  window.addEventListener('resize', layoutTouchControls);
  window.addEventListener('orientationchange', layoutTouchControls);
}
