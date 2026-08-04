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

// Plays a single synthesized note: fast attack, ramps toward `endFreq` (or
// stays flat if omitted) over the note's length, exponential decay to
// silence. Shared by playWinSound()/playLoseSound() below so their per-note
// envelope logic can't drift apart between the two.
function playNote(ctx, { freq, endFreq = freq, start, duration, type = 'triangle', peakGain = 0.3, filterFreq = null }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq !== freq) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration * 0.9);
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  let lastNode = osc;
  if (filterFreq) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    osc.connect(filter);
    lastNode = filter;
  }
  lastNode.connect(gain);
  gain.connect(ctx.destination);

  osc.start(start);
  osc.stop(start + duration + 0.05);
}

// Win fanfare: a quick ascending "ta-da" arpeggio into a held, slightly
// shimmering final note. Every other sound tied to the game-over modal
// (see GameScreen.endGame()) was, until now, just the neutral event sound
// (a meow, a mouse squeak) — identical whether that event was a win or a
// loss for whoever's playing, since the same event means different things
// depending on controlledEntity (see Character selection & playable modes
// in CLAUDE.md). This plays *in addition* to that event sound, keyed off
// endGame()'s own `isWin` flag, so the modal finally has a distinct "you
// won" cue rather than relying on the player to read the headline.
// Synthesized like playModalPopSound() above (a musical one this time —
// oscillators and note envelopes instead of filtered noise) since nothing
// in sounds/ fit this either and a short fanfare like this doesn't need a
// supplied audio file.
export function playWinSound() {
  if (isSfxMuted()) return;

  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6 — bright major arpeggio
  const stepDuration = 0.12;

  notes.forEach((freq, i) => {
    const start = now + i * stepDuration;
    const isLast = i === notes.length - 1;
    playNote(ctx, { freq, start, duration: isLast ? 0.6 : stepDuration, type: 'triangle', peakGain: 0.35 });
  });

  // A soft high shimmer layered under the held final note, so the ending
  // has a bit of sparkle rather than one flat tone carrying it alone.
  const shimmerStart = now + (notes.length - 1) * stepDuration;
  playNote(ctx, { freq: notes[notes.length - 1] * 2, start: shimmerStart, duration: 0.6, type: 'sine', peakGain: 0.12 });
}

// Loss stinger: three descending, pitch-bent notes — the classic cartoon
// "womp womp womp" trombone, not a somber dirge. Matches the game-over
// modal's own deliberately-still-playful teal/blue loss palette (see
// COLORS.MODAL — "deliberately playful either way... not somber on a
// loss") rather than reaching for a sad tone just because it's a loss.
// Sawtooth (brighter/buzzier than the win fanfare's triangle, appropriately
// more "honking") through a lowpass filter for warmth, rather than a bare
// sawtooth's harsher edge.
export function playLoseSound() {
  if (isSfxMuted()) return;

  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const notes = [392.0, 349.23, 293.66]; // G4, F4, D4 — descending
  const noteDuration = 0.26;

  notes.forEach((freq, i) => {
    const start = now + i * noteDuration;
    playNote(ctx, {
      freq,
      endFreq: freq * 0.85,
      start,
      duration: noteDuration,
      type: 'sawtooth',
      peakGain: 0.28,
      filterFreq: 1200,
    });
  });
}
