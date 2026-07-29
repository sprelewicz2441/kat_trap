import ScreenManager from './classes/screens/ScreenManager.js';
import SetupScreen from './classes/screens/SetupScreen.js';
import { setupOrientationGate } from './utils/orientationGate.js';
import { setupTouchControls } from './utils/touchControls.js';
import { setupSettingsMenu } from './utils/settingsMenu.js';
import { isTouch } from './utils/scale.js';

const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
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

const screenManager = new ScreenManager(ctx);
const setupScreen = new SetupScreen(screenManager, gameCanvas, ctx);

// Start with the setup screen
screenManager.setScreen(setupScreen);

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
function resizeCanvas() {
  const widthFraction = isTouch() ? 0.8 : 0.9;
  const maxCanvasWidth = window.innerWidth * widthFraction;
  const maxCanvasHeight = window.innerHeight;
  let canvasWidth = maxCanvasWidth;
  let canvasHeight = canvasWidth * (3 / 4);
  if (canvasHeight > maxCanvasHeight) {
    canvasHeight = maxCanvasHeight;
    canvasWidth = canvasHeight * (4 / 3);
  }
  gameCanvas.width = canvasWidth;
  gameCanvas.height = canvasHeight;
}

function gameLoop(timestamp) {
  screenManager.update(timestamp);
  screenManager.render();
  requestAnimationFrame(gameLoop);
}

gameLoop();
