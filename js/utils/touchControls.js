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
// against.
const DPAD_NATURAL_SIZE = 116;
const ACTION_BTN_NATURAL_SIZE = 52;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Positions #dpad/#actionButtons within the empty "gutter" beside the
// canvas (the space between the viewport frame and the canvas's left/
// right edge) instead of at a fixed offset from the viewport edge — the
// canvas's width isn't fixed (see resizeCanvas() in js/main.js), so the
// gutter width changes with viewport size and has to be read from the
// canvas's actual rendered position rather than assumed. Vertical
// centering doesn't need this: the gutter runs the full viewport height
// regardless of where the canvas sits vertically, so the CSS `top: 50%`
// already set in styles.css covers that axis on its own.
//
// Also shrinks each control to fit when the gutter is narrower than its
// natural size — confirmed via a spread of real device viewports that on
// tablets close to the canvas's own 4:3 aspect (a standard iPad landscape,
// notably) the gutter can be as little as ~50px, well under the 116px
// d-pad. Without this, the d-pad would spill over onto the canvas itself
// on those devices — exactly the board-overlap the side-margin anchor was
// chosen to avoid in the first place (see styles.css). Scaled via
// `transform: scale()` (a CSS variable set here) rather than resizing
// width/height directly, so the internal padding/gaps/icon sizes shrink
// proportionally instead of a fixed-px interior cramming into a smaller
// box. No minimum floor: the whole point is to guarantee the control never
// overlaps the board, which a floor would undermine on a narrow enough
// gutter — phones (with much roomier gutters) are never affected, this
// only ever kicks in on tablet-class devices.
function layoutTouchControls() {
  const canvas = document.getElementById('gameCanvas');
  const dpad = document.getElementById('dpad');
  const actionButtons = document.getElementById('actionButtons');
  if (!canvas || !dpad || !actionButtons) return;

  const rect = canvas.getBoundingClientRect();
  dpad.style.left = `${rect.left / 2}px`;
  actionButtons.style.left = `${(rect.right + window.innerWidth) / 2}px`;

  const leftGutter = rect.left;
  const rightGutter = window.innerWidth - rect.right;
  const gutter = Math.min(leftGutter, rightGutter);
  // Small safety margin so a control at its max scale doesn't touch the
  // canvas edge or the viewport frame right at the gutter's boundary.
  const usableGutter = Math.max(0, gutter - 12);

  const dpadScale = clamp(usableGutter / DPAD_NATURAL_SIZE, 0, 1);
  const actionScale = clamp(usableGutter / ACTION_BTN_NATURAL_SIZE, 0, 1);
  document.documentElement.style.setProperty('--dpad-scale', dpadScale);
  document.documentElement.style.setProperty('--action-scale', actionScale);
}

export function setupTouchControls() {
  Object.entries(DIRECTION_KEYS).forEach(([id, key]) => wireHoldButton(id, key));
  Object.entries(ACTION_KEYS).forEach(([id, key]) => wireTapButton(id, key));

  layoutTouchControls();
  window.addEventListener('resize', layoutTouchControls);
  window.addEventListener('orientationchange', layoutTouchControls);
}
