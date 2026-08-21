// Every importer of this file uses '../../utils/audio.js?v=1' (or the
// equivalent relative path), not a bare './audio.js' - this file has been
// edited repeatedly since first written (new synthesized SFX added over
// time) without ever picking up the module-level cache-busting convention
// Cat.js/Dog.js/Mouse.js/scale.js already use (see CLAUDE.md's "Module-
// level cache-busting"). Caught live: a stale cached copy missing a
// just-added export threw a SyntaxError on import, breaking the whole
// game silently for anyone still on the old cached copy - the same
// symptom class documented for Dog.js. Bump the query string on every
// future edit to this file, exactly like those other four.
//
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

// Background music is a page-lifetime singleton, not per-GameScreen — a
// single shared Audio element, lazily created on first actual need,
// reused (never replaced or reset) by every GameScreen instance for the
// rest of the page's life. This is what lets "Play Again" (a fresh
// GameScreen each round — see GameScreen.js's own comments) leave the
// track playing right through the transition rather than restarting it:
// per explicit direction, "It should run through even after a game over.
// The only thing that should start it over is a refresh." Same module-
// level-state pattern the mute flags above already use for the same
// "survive a fresh GameScreen instance" reason.
let backgroundMusic = null;
function getBackgroundMusic() {
  if (!backgroundMusic) {
    backgroundMusic = new Audio('../../sounds/you_can.mp3');
    backgroundMusic.loop = true;
    backgroundMusic.volume = 0.1;
  }
  return backgroundMusic;
}

// Called from GameScreen.startGame() (and the skipCutscenes branch that
// bypasses it) — i.e. the moment actual gameplay begins, not screen
// construction — per explicit direction: "Dont start it until in game
// though." Safe to call every round: if the shared track is already
// playing, `.play()` on an already-playing element is a harmless no-op
// (doesn't restart `currentTime`), so a second/third/etc. round's call
// just continues wherever the track already was.
export function startBackgroundMusic() {
  const music = getBackgroundMusic();
  if (!isMusicMuted() && music.paused) {
    music.play();
  }
}

// Exposes the shared element itself for the settings-menu mute toggle
// (GameScreen's musicMuteChangeHandler) to play()/pause() directly.
export function getBackgroundMusicElement() {
  return getBackgroundMusic();
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

// Plant knock-over "thump": a low pitch-dropping thud (the pot hitting the
// floor) plus a short burst of high-passed noise (loose dirt/leaves
// scattering), layered together rather than sequenced — a real toppling
// object's impact and scatter happen at the same instant, not one after
// the other. Same synthesis toolkit as the rest of this file (playNote()'s
// oscillator envelope for the thud, playModalPopSound()'s noise-buffer
// approach for the scatter) since, as with every other one-shot in this
// game, nothing in sounds/ is a plant-pot thud and a sound this short is
// easier to synthesize than to source. Triggered directly from
// GameScreen.updatePlantBump() the instant Furniture.startKnockOver() is
// called, not routed through GameScreen.playSound() (which only knows
// about the file-backed SOUND_KEYS map) — mirrors how playModalPopSound()
// is already called directly by its own trigger sites.
export function playPlantKnockOverSound() {
  if (isSfxMuted()) return;

  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // The thud: a short, punchy low-end drop rather than a held tone — a pot
  // hitting the floor is a single impact, not a note.
  playNote(ctx, {
    freq: 150,
    endFreq: 55,
    start: now,
    duration: 0.18,
    type: 'sine',
    peakGain: 0.45,
  });

  // The scatter: brief high-passed noise for loose dirt/leaves, quieter and
  // shorter than the thud so it reads as texture riding on top of the
  // impact rather than a competing second sound.
  const scatterDuration = 0.22;
  const bufferSize = Math.floor(ctx.sampleRate * scatterDuration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2500;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + scatterDuration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + scatterDuration);
}

// Dog poop drop: a squelchy "plop" — a short low thud (the pile landing)
// layered with a brief wet, bandpassed noise burst for the squish texture,
// same "impact and texture happen at the same instant" approach as
// playPlantKnockOverSound() above, just pitched squishier/wetter than that
// one's dry dirt-scatter. Triggered directly from GameScreen.handleDogPoop()
// (both the player-triggered 'p' press in Dog mode and the autonomous
// random-interval drop) rather than routed through GameScreen.playSound()
// (file-backed SOUND_KEYS only) — same reasoning as every other synthesized
// one-shot in this file.
export function playPoopSound() {
  if (isSfxMuted()) return;

  const ctx = getAudioContext();
  const now = ctx.currentTime;

  playNote(ctx, {
    freq: 220,
    endFreq: 90,
    start: now,
    duration: 0.14,
    type: 'sine',
    peakGain: 0.35,
  });

  const squishDuration = 0.16;
  const bufferSize = Math.floor(ctx.sampleRate * squishDuration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(900, now);
  filter.frequency.exponentialRampToValueAtTime(250, now + squishDuration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + squishDuration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + squishDuration);
}

// Cat-steps-in-it reaction: a short comedic "eww" wobble — a descending
// triangle-wave note with a fast, exaggerated pitch vibrato (a second LFO
// oscillator modulating the main one's frequency), landing low. Deliberately
// not a straight melodic tone like playWinSound()/playLoseSound() — this is
// a gag reaction mid-round, not a round-ending fanfare/stinger. Triggered
// directly from GameScreen.updatePoops() the instant the cat's stun actually
// starts, same "call directly, don't route through playSound()" pattern as
// every other synthesized one-shot here.
export function playCatStuckSound() {
  if (isSfxMuted()) return;

  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const duration = 0.4;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(500, now);
  osc.frequency.exponentialRampToValueAtTime(180, now + duration);

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 18;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 30;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.3, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  lfo.start(now);
  osc.stop(now + duration + 0.05);
  lfo.stop(now + duration + 0.05);
}

// Doober pickup "ding" (a "doober" is this game's term for the
// in-gameplay coin drop, borrowed from FrontierVille): a quick two-note
// ascending chime (B5 into G6), the classic bright arcade-coin feel —
// short on purpose (unlike playWinSound()'s fanfare) since only one
// doober is ever on the board at a time (see GameScreen's
// MAX_ACTIVE_DOOBERS), but a round can still collect several across its
// lifetime. Synthesized via playNote() like every other one-shot here;
// nothing in sounds/ fit. Triggered directly from
// GameScreen.updateDoobers() the instant one is collected, same "call
// directly, don't route through playSound()" pattern as every other
// synthesized sound in this file.
export function playDooberSound() {
  if (isSfxMuted()) return;

  const ctx = getAudioContext();
  const now = ctx.currentTime;
  playNote(ctx, { freq: 987.77, start: now, duration: 0.08, type: 'triangle', peakGain: 0.25 });
  playNote(ctx, { freq: 1567.98, start: now + 0.06, duration: 0.16, type: 'triangle', peakGain: 0.25 });
}
