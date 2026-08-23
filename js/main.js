import ScreenManager from './classes/screens/ScreenManager.js';
import SetupScreen from './classes/screens/SetupScreen.js';
import { setupOrientationGate } from './utils/orientationGate.js';
import { setupTouchControls, MIN_TOUCH_CONTROL_GUTTER } from './utils/touchControls.js';
import { setupSettingsMenu, MIN_DESKTOP_SETTINGS_GUTTER } from './utils/settingsMenu.js';
import { setupHomeScreenHint } from './utils/homeScreenHint.js';
import { setupLoginModal } from './utils/loginModal.js';
import { setupStoreModal } from './utils/storeModal.js?v=6';
import { isTouch } from './utils/scale.js?v=1';

let gameCanvas, ctx, screenManager;

// Canvas width is capped at a fraction of the viewport, leaving the rest as
// side margin. On a touch device that margin is where the d-pad/action
// buttons live (see touchControls.js), and on aspect ratios close to the
// canvas's own 4:3 (a standard iPad landscape, notably) the default 90%
// leaves as little as ~50px per side — not enough room for a usable touch
// control. Reserving more width (80%) specifically on touch devices fixes
// that; it has no effect on the common case where a touch device's aspect
// ratio makes the canvas *height*-constrained instead (most phones in
// landscape), since this fraction is only ever the binding constraint on
// wider/squarer aspect ratios. Desktop keeps 90% — there's no touch control
// competing for that space there, and shrinking the board for no benefit
// isn't worth it.
//
// No hard pixel caps on either axis (previously 1280x960): those caps were
// what left a visible margin above/below the canvas on most desktop/laptop
// viewports even though nothing else needed it — the four scale functions
// in scale.js already derive every size from canvasWidth/REFERENCE_WIDTH,
// so a canvas taller or wider than the old caps scales up cleanly instead
// of needing a ceiling. Height gets the full viewport (maxCanvasHeight),
// so on any landscape-oriented viewport (guaranteed by the orientation
// gate) the board ends up height-constrained and sits flush top-to-bottom;
// width then follows from the 4:3 aspect ratio and is only ever bounded by
// maxCanvasWidth on unusually short/wide windows.
//
// Design-director pass (see CLAUDE.md): on touch devices, the board also
// gives up width when needed so each side gutter can't fall below
// MIN_TOUCH_CONTROL_GUTTER (touchControls.js) — hand-computing the old
// formula across a spread of real device widths showed the d-pad shrinking
// to ~70-125px on an iPhone SE, a standard iPad landscape, and a touch
// laptop, well past comfortable. Explicit product direction: the control
// must always stay playable, even if that costs some board width.
//
// First attempt at this got the ordering wrong and caused a real
// regression: it capped maxCanvasWidth by the gutter requirement *before*
// checking whether the board was actually going to be width- or
// height-constrained, so on ordinary phones that were always going to end
// up height-constrained anyway (and already had plenty of natural gutter
// as a side effect — see the comment above), the cap still shaved width
// off, which shaved the *height* off too (canvasHeight is always derived
// from canvasWidth to hold the 4:3 ratio) — leaving a real, visible gap
// above/below a board that used to sit flush top-to-bottom. Fixed by
// computing the natural (fraction-only, pre-existing) fit first, exactly
// as before, and only reaching for the extra width cap if that natural
// fit's own gutter actually falls short — which only happens on the
// width-constrained aspect ratios (iPad-like, or the very narrowest
// phones) this was meant to target in the first place. Verified by hand
// across the same device spread: ordinary phones (iPhone 14 and larger)
// now get zero height loss, and the narrowest devices get a much smaller,
// bounded loss than the first attempt's.
function resizeCanvas() {
  const touch = isTouch();
  const widthFraction = touch ? 0.8 : 0.9;
  const maxCanvasWidthFraction = window.innerWidth * widthFraction;
  const maxCanvasHeight = window.innerHeight;

  let canvasWidth = maxCanvasWidthFraction;
  let canvasHeight = canvasWidth * (3 / 4);
  if (canvasHeight > maxCanvasHeight) {
    canvasHeight = maxCanvasHeight;
    canvasWidth = canvasHeight * (4 / 3);
  }

  if (touch) {
    const naturalGutter = (window.innerWidth - canvasWidth) / 2;
    if (naturalGutter < MIN_TOUCH_CONTROL_GUTTER) {
      canvasWidth = window.innerWidth - 2 * MIN_TOUCH_CONTROL_GUTTER;
      canvasHeight = canvasWidth * (3 / 4);
    }
  } else {
    // Same reservation, same reasoning, for the desktop hamburger menu
    // instead of the touch d-pad — see MIN_DESKTOP_SETTINGS_GUTTER's own
    // comment in settingsMenu.js. #settingsMenu sits at a plain fixed
    // `top: 20px; right: 20px` on desktop (styles.css) — this reservation
    // is what makes that static position safe; without it, the hamburger
    // could have nowhere to go on a narrower desktop window, the exact
    // "overlaps the gameboard" bug this fixes.
    const naturalGutter = (window.innerWidth - canvasWidth) / 2;
    if (naturalGutter < MIN_DESKTOP_SETTINGS_GUTTER) {
      canvasWidth = window.innerWidth - 2 * MIN_DESKTOP_SETTINGS_GUTTER;
      canvasHeight = canvasWidth * (3 / 4);
    }
  }

  gameCanvas.width = canvasWidth;
  gameCanvas.height = canvasHeight;
}

function gameLoop(timestamp) {
  screenManager.update(timestamp);
  screenManager.render();
  requestAnimationFrame(gameLoop);
}

// main.js is loaded with `script async` (see index.html) specifically so it
// doesn't wait on the render-blocking Tailwind CDN stylesheet before running
// — on a slow mobile connection that stylesheet alone could take a second or
// more, during which the canvas just sat there as a blank white box (its own
// bg-white class, painted before any JS had run). Unlike a deferred/module
// script (which always waits for the whole document to finish parsing
// first), `async` can start executing as soon as its own import graph is
// fetched — possibly before the parser has reached <body> and the canvas
// element actually exists. init() is guarded on document.readyState so it
// runs immediately if the DOM's already there, or waits for
// DOMContentLoaded if it somehow isn't, rather than assuming one or the
// other.
function init() {
  gameCanvas = document.getElementById('gameCanvas');
  ctx = gameCanvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  // Rotating a phone doesn't reliably fire a plain 'resize' the way resizing
  // a desktop window does — every other layout-critical module in this repo
  // (orientationGate.js, touchControls.js, settingsMenu.js) already listens
  // for 'orientationchange' too; resizeCanvas() was the one exception, which
  // could leave the canvas sized off its pre-rotation dimensions (leaving a
  // gap) until something else happened to trigger a 'resize'.
  window.addEventListener('orientationchange', resizeCanvas);
  setupOrientationGate();
  setupTouchControls();
  setupSettingsMenu();
  setupHomeScreenHint();
  setupLoginModal();
  setupStoreModal();

  screenManager = new ScreenManager(ctx);
  const setupScreen = new SetupScreen(screenManager, gameCanvas, ctx);

  // Start with the setup screen
  screenManager.setScreen(setupScreen);

  gameLoop();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
