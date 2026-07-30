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

// Lazily created — browsers require a user gesture before an AudioContext
// can actually produce sound, and every caller of playModalPopSound()
// below is already reacting to a click (Cutscene's "Next", the credits
// button), so creating it on first real use rather than at module load
// satisfies that without any special-casing here.
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// A short "pfff" whoosh — the soft air-puff pop console games play when a
// dialog/card appears. Every other sound in this game is a supplied audio
// file (see GameScreen.js's loadSounds()), but nothing in sounds/ fit this,
// and unlike art, a one-shot effect this simple is easy to synthesize
// directly rather than waiting on a supplied file: filtered noise (a
// "puff of air" reads as noise, not a tone) with a fast attack/decay
// amplitude envelope and a downward filter sweep for the "whoosh" motion,
// gone in ~0.2s. Deliberately NOT used by GameScreen's win/loss modal —
// that one's a bigger, more celebratory/dramatic moment and is getting its
// own dedicated sound later (see CLAUDE.md Planned work) rather than
// reusing this small transitional pop.
export function playModalPopSound() {
  if (isSfxMuted()) return;

  const ctx = getAudioContext();
  const duration = 0.22;
  const now = ctx.currentTime;

  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(1800, now);
  filter.frequency.exponentialRampToValueAtTime(350, now + duration);

  const gain = ctx.createGain();
  // exponentialRampToValueAtTime can't ramp to/from exactly 0 — start at a
  // near-silent epsilon instead of 0 so the ramp is valid.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + duration);
}
