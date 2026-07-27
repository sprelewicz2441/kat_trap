// Two independent mute flags, not one — see the in-game settings menu
// (js/utils/settingsMenu.js). Module-level state rather than per-GameScreen,
// so it survives "Play Again" (a fresh GameScreen instance each round) and
// stays consistent for the rest of the session instead of resetting.
//
// Music starts muted: there's no way to know a first-time player wants a
// looping background track starting unprompted. SFX starts unmuted: punch/
// toot/meow/etc. are short sounds tied directly to a player's own action,
// not a surprise loop — muting those by default would make actions feel
// like they're doing nothing.
let musicMuted = true;
let sfxMuted = false;

export function isMusicMuted() {
  return musicMuted;
}

export function isSfxMuted() {
  return sfxMuted;
}

// Each fires its own event so a track that's already playing (background
// music) can react immediately, not just future playSound() calls.
export function setMusicMuted(value) {
  musicMuted = value;
  document.dispatchEvent(new CustomEvent('musicmutechange', { detail: { muted: musicMuted } }));
}

export function setSfxMuted(value) {
  sfxMuted = value;
  document.dispatchEvent(new CustomEvent('sfxmutechange', { detail: { muted: sfxMuted } }));
}

export function toggleMusicMuted() {
  setMusicMuted(!musicMuted);
  return musicMuted;
}

export function toggleSfxMuted() {
  setSfxMuted(!sfxMuted);
  return sfxMuted;
}
