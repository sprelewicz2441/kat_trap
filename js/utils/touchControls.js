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

export function setupTouchControls() {
  Object.entries(DIRECTION_KEYS).forEach(([id, key]) => wireHoldButton(id, key));
  Object.entries(ACTION_KEYS).forEach(([id, key]) => wireTapButton(id, key));
}
