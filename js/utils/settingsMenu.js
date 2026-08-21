import { isMusicMuted, isSfxMuted, toggleMusicMuted, toggleSfxMuted, playModalPopSound } from './audio.js?v=3';

function updateMusicButton(button) {
  const muted = isMusicMuted();
  button.textContent = `${muted ? '\u{1F507}' : '\u{1F3B5}'} Music: ${muted ? 'Off' : 'On'}`;
  button.setAttribute('aria-pressed', String(!muted));
}

function updateSfxButton(button) {
  const muted = isSfxMuted();
  button.textContent = `${muted ? '\u{1F507}' : '\u{1F50A}'} Sounds: ${muted ? 'Off' : 'On'}`;
  button.setAttribute('aria-pressed', String(!muted));
}

// Desktop button size (see styles.css's #settingsToggle, non-touch case) —
// needed here so the gutter-reservation math in main.js's resizeCanvas()
// can't quietly drift out of sync with the CSS if that size ever changes.
const DESKTOP_BUTTON_SIZE = 40;
// Gap kept on both sides of the button: between the canvas's right edge
// and the button, and between the button and the viewport's own right
// edge — matches styles.css's `#settingsMenu { right: -60px }` (that's
// -(DESKTOP_BUTTON_SIZE + DESKTOP_MARGIN), positioning it just past
// <main>'s own edge — see that rule's comment for the full picture).
const DESKTOP_MARGIN = 20;
// Exported so main.js's resizeCanvas() can reserve this much gutter width
// up front — same "guarantee the room instead of hoping it's there"
// pattern touchControls.js's MIN_TOUCH_CONTROL_GUTTER already uses for the
// d-pad. Desktop positioning has no JS in this file at all anymore —
// #settingsMenu is a DOM child of the same shrink-wrapped <main> the
// canvas sits in (see index.html), positioned via a plain
// `position: absolute` CSS rule anchored to main's own edges (which
// coincide exactly with the canvas's, since main shrink-wraps it). Two
// earlier JS-measured approaches lived here before — gutter-centering,
// then a resize-listener computing `canvas.getBoundingClientRect()` — and
// both were flagged live as still overlapping the board in some
// environment this project couldn't fully reproduce or diagnose (a
// leading theory for the second: the async-loaded Tailwind stylesheet
// finishing *after* that one-time position calculation ran, shifting the
// canvas's flex-centered position with no 'resize' event to trigger a
// recompute). Removing the JS measurement removes that whole failure
// class — there's nothing to go stale, because there's no separate
// "measure, then position" step; the position is resolved by the same
// layout pass that places the canvas. This constant now exists purely so
// `resizeCanvas()` can guarantee enough gutter exists for that CSS
// position to land somewhere visible on a narrow window, not to compute
// anything about the button's actual placement.
export const MIN_DESKTOP_SETTINGS_GUTTER = DESKTOP_BUTTON_SIZE + DESKTOP_MARGIN * 2;

export function setupSettingsMenu() {
  const toggleBtn = document.getElementById('settingsToggle');
  const panel = document.getElementById('settingsPanel');
  const musicBtn = document.getElementById('musicToggleBtn');
  const sfxBtn = document.getElementById('sfxToggleBtn');
  const creditsBtn = document.getElementById('creditsBtn');
  const creditsModal = document.getElementById('creditsModal');
  const creditsCloseBtn = document.getElementById('creditsCloseBtn');
  if (!toggleBtn || !panel || !musicBtn || !sfxBtn) return;

  updateMusicButton(musicBtn);
  updateSfxButton(sfxBtn);

  // Fires `settingsmenutoggle` on every open/close (not just the toggle
  // button's own click — also the outside-click close below) so GameScreen
  // can pause/resume in lockstep with the panel's actual visible state,
  // rather than each side tracking it separately and risking drift.
  const setOpen = (open) => {
    panel.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', String(open));
    document.dispatchEvent(new CustomEvent('settingsmenutoggle', { detail: { open } }));
  };

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });

  musicBtn.addEventListener('click', () => {
    toggleMusicMuted();
    updateMusicButton(musicBtn);
  });

  sfxBtn.addEventListener('click', () => {
    toggleSfxMuted();
    updateSfxButton(sfxBtn);
  });

  // Credits: swaps the plain settingsPanel dropdown for the cute
  // creditsModal card rather than stacking one on top of the other.
  // Doesn't call setOpen(false) here — the game should stay paused (the
  // dropdown's own open already dispatched settingsmenutoggle{open:true})
  // while credits is showing, exactly as if the settings panel were still
  // open; only actually closing credits resumes play.
  if (creditsBtn && creditsModal) {
    const closeCredits = () => {
      creditsModal.hidden = true;
      setOpen(false);
    };

    creditsBtn.addEventListener('click', () => {
      panel.hidden = true;
      creditsModal.hidden = false;
      playModalPopSound();
    });

    if (creditsCloseBtn) {
      creditsCloseBtn.addEventListener('click', closeCredits);
    }

    // Clicking the dimmed backdrop (not the card itself) closes it too —
    // same "click outside to dismiss" convention as the settings panel.
    creditsModal.addEventListener('click', (e) => {
      if (e.target === creditsModal) closeCredits();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !creditsModal.hidden) closeCredits();
    });
  }

  // Clicking anywhere outside the open panel closes it — standard menu
  // behavior, and without it the panel would sit open over the board for
  // the rest of the round once opened.
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== toggleBtn) {
      setOpen(false);
    }
  });
}
