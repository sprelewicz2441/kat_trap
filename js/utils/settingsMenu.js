import { isMusicMuted, isSfxMuted, toggleMusicMuted, toggleSfxMuted } from './audio.js';
import { isTouch } from './scale.js';

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

// Desktop only — mobile keeps its fixed top-right corner spot entirely via
// CSS (see styles.css's `@media (pointer: coarse)` override), since the
// action-button cluster is already crowded there. On desktop the menu
// instead sits in line with where that action-icon column lives (the right
// gutter, vertically centered) — same horizontal-center formula
// touchControls.js uses for #actionButtons — so it reads as anchored to the
// game/canvas rather than floating in the page's raw top corner.
function layoutSettingsMenuDesktop() {
  if (isTouch()) return;

  const canvas = document.getElementById('gameCanvas');
  const menu = document.getElementById('settingsMenu');
  if (!canvas || !menu) return;

  const rect = canvas.getBoundingClientRect();
  menu.style.left = `${(rect.right + window.innerWidth) / 2}px`;
}

export function setupSettingsMenu() {
  const toggleBtn = document.getElementById('settingsToggle');
  const panel = document.getElementById('settingsPanel');
  const musicBtn = document.getElementById('musicToggleBtn');
  const sfxBtn = document.getElementById('sfxToggleBtn');
  if (!toggleBtn || !panel || !musicBtn || !sfxBtn) return;

  updateMusicButton(musicBtn);
  updateSfxButton(sfxBtn);

  layoutSettingsMenuDesktop();
  window.addEventListener('resize', layoutSettingsMenuDesktop);
  window.addEventListener('orientationchange', layoutSettingsMenuDesktop);

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

  // Clicking anywhere outside the open panel closes it — standard menu
  // behavior, and without it the panel would sit open over the board for
  // the rest of the round once opened.
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== toggleBtn) {
      setOpen(false);
    }
  });
}
