import InputHandler from '../InputHandler.js';
import ModeSelectScreen from './ModeSelectScreen.js?v=1';
import { CHARACTER_NAMES } from '../../utils/characterNames.js';
import { getUIScale } from '../../utils/scale.js?v=1';
import { drawRoundedRect } from '../../utils/canvasShapes.js';
import { getSpriteSrc, PORTRAITS } from '../../utils/outfits.js?v=1';
import { isLoggedIn, getEquipped } from '../../utils/api.js';
import { isSfxMuted, playWinSound, playLoseSound } from '../../utils/audio.js';

// "Adventures" mode: a Punch-Out-style boss fight. The player (Cat or
// Mouse) stays put at the bottom of the screen and fights by dodging,
// ducking and punching; the boss telegraphs each attack with a visible
// wind-up, and an attack that whiffs leaves it open for big damage. The
// Dog is locked in a cage in the background and is freed when the boss
// goes down.
//
// Controls (all keyboard events, so the on-screen touch controls drive it
// too - see touchControls.js):
//   Left / Right arrow  lean out of the way of a side swipe
//   Down arrow          duck under an overhead slam
//   P                   punch (only from the center lane, not ducking)
//   Space               special, once the meter is full
//
// Separate from GameScreen on purpose - that class is already ~5800 lines
// and none of its chase/furniture/economy machinery applies here.

const BOSS_NAME = 'Bruno the Brute';
const BOSS_MAX_HP = 100;
const BOSS_ART_SRC = './assets/boss_dog.png';

// Per-fighter tuning. Cat hits harder, Mouse hits faster.
const FIGHTERS = {
  cat: { name: CHARACTER_NAMES.CAT, damage: 6, cooldown: 380, hearts: 5, specialName: 'TOOT BLAST!', specialSound: 'toot', hurtSound: 'meow' },
  mouse: { name: CHARACTER_NAMES.MOUSE, damage: 4, cooldown: 280, hearts: 5, specialName: 'SQUEAK SLAM!', specialSound: 'squeak', hurtSound: 'squeak' },
};

const OPEN_HIT_MULTIPLIER = 3; // a punch landed while the boss is recovering/stunned
const SPECIAL_DAMAGE = 15;
const SPECIAL_STUN_MS = 2000;
const METER_MAX = 100;
const METER_CHIP_HIT = 10;
const METER_OPEN_HIT = 25;
const METER_PERFECT_DODGE = 15;

const PLAYER_INVULN_MS = 900;
const PLAYER_PUNCH_ANIM_MS = 180;
const PLAYER_STAGGER_MS = 450; // after punching into a guard

const INTRO_ROUND_MS = 1100;
const INTRO_TOTAL_MS = 1900;

const ATTACKS = ['swipeLeft', 'swipeRight', 'overhead'];
const STRIKE_MS = 180;
const RECOVER_MS = 1000; // the "open" window after a whiffed attack
const HIT_RECOVER_MS = 600; // short breather after the boss lands a hit
const GUARD_MS = 900;

// Phase is derived from boss HP; later phases wind up faster, pause less,
// start guarding, and chain two attacks together.
const PHASES = {
  1: { windup: 750, idleMin: 1100, idleMax: 1800, guardChance: 0, comboChance: 0 },
  2: { windup: 560, idleMin: 800, idleMax: 1400, guardChance: 0.2, comboChance: 0 },
  3: { windup: 420, idleMin: 600, idleMax: 1000, guardChance: 0.2, comboChance: 0.5 },
};
const COMBO_WINDUP_FACTOR = 0.7;

// Victory sequence timeline, ms after the boss's HP hits zero.
const WIN_FALL_END = 1200;
const WIN_CAGE_END = 2100;
const WIN_DOG_END = 3200;
const WIN_MODAL_AT = 3500;

const HINT_VISIBLE_MS = 7000;

const POPUP_LIFE_MS = 900;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export default class BossBattleScreen {
  constructor(screenManager, canvas, character = 'cat') {
    this.screenManager = screenManager;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.character = character;
    this.fighter = FIGHTERS[character] || FIGHTERS.cat;

    this.inputHandler = new InputHandler();
    this.paused = false;
    this.lastTimestamp = null;
    this.t = 0; // animation clock (ms), frozen while paused

    // 'intro' -> 'fight' -> 'won' | 'lost'; modalVisible layers on top of the
    // last two once their end-of-fight animation finishes.
    this.stage = 'intro';
    this.stageTime = 0;
    this.modalVisible = false;
    this.modalButtons = [];
    this.hoveredButton = -1;

    this.player = {
      hearts: this.fighter.hearts,
      lane: 'center', // logical lane (-> hit detection)
      laneX: 0, // visual offset, eased toward the logical lane
      ducking: false,
      duckAmt: 0,
      cooldown: 0,
      punchAnim: 0,
      stagger: 0,
      invuln: 0,
      meter: 0,
      meterFlash: 0,
    };

    this.boss = {
      hp: BOSS_MAX_HP,
      displayHp: BOSS_MAX_HP, // eased toward hp for a draining bar
      state: 'idle',
      timer: 1200,
      attack: null,
      queue: [],
      windupTotal: 1,
      strikeHitPlayer: false,
      hurtFlash: 0,
      phase: 1,
    };

    this.popups = [];
    this.shake = 0;
    this.specialFx = 0;
    this.phaseBanner = 0;
    this.cageOpen = 0; // 0 closed .. 1 fully raised
    this.dogProgress = 0; // 0 in cage .. 1 standing in the room
    this.bossFall = 0;

    this.sounds = this.loadSounds();

    this.bossImg = new Image();
    this.bossImg.src = BOSS_ART_SRC;
    this.dogImg = new Image();
    this.dogImg.src = getSpriteSrc('dog');
    this.playerImg = new Image();
    this.playerImg.src = getSpriteSrc(character);
    if (isLoggedIn()) {
      getEquipped(character)
        .then((equipped) => {
          if (equipped.outfit) this.playerImg.src = getSpriteSrc(character, equipped.outfit);
        })
        .catch((err) => console.warn(`Could not load ${character}'s equipped outfit:`, err.message));
    }

    // Offscreen layer the boss is composed on, so hit/windup tints can be
    // applied with source-atop to just the boss's own pixels (works the
    // same for the real art and the procedural fallback).
    this.bossLayer = document.createElement('canvas');
  }

  loadSounds() {
    const make = (src, volume) => {
      const audio = new Audio(src);
      audio.volume = volume;
      return audio;
    };
    return {
      punch: make('./sounds/punch.ogg', 0.7),
      bark: make('./sounds/dog_barking.wav', 0.6),
      toot: make('./sounds/toot.wav', 0.7),
      meow: make('./sounds/meow.ogg', 0.7),
      squeak: make('./sounds/mouse.wav', 0.7),
    };
  }

  playSound(key) {
    if (isSfxMuted()) return;
    const sound = this.sounds[key];
    if (!sound) return;
    try {
      sound.currentTime = 0;
      sound.play().catch(() => {});
    } catch {
      // Same guard GameScreen.playSound() uses: a missing/unsupported source
      // throws synchronously on currentTime.
    }
  }

  // ==============================
  //  LIFECYCLE
  // ==============================
  init() {
    this.punchHandler = () => this.tryPunch();
    this.tootHandler = () => this.trySpecial();
    this.meowHandler = () => this.playSound('meow'); // a taunt, no gameplay effect
    document.addEventListener('punch', this.punchHandler);
    document.addEventListener('toot', this.tootHandler);
    document.addEventListener('meow', this.meowHandler);

    // Same overlay-pause hook GameScreen uses for the hamburger menu.
    this.settingsMenuToggleHandler = (e) => {
      this.paused = e.detail.open;
    };
    document.addEventListener('settingsmenutoggle', this.settingsMenuToggleHandler);

    this.clickHandler = (e) => {
      if (!this.modalVisible) return;
      const hit = this.modalButtons.find((b) => this.isInside(b, e.offsetX, e.offsetY));
      if (hit) hit.action();
    };
    this.canvas.addEventListener('click', this.clickHandler);

    this.moveHandler = (e) => {
      if (!this.modalVisible) return;
      const idx = this.modalButtons.findIndex((b) => this.isInside(b, e.offsetX, e.offsetY));
      this.hoveredButton = idx;
      this.canvas.style.cursor = idx >= 0 ? 'pointer' : 'default';
    };
    this.canvas.addEventListener('mousemove', this.moveHandler);
  }

  cleanup() {
    document.removeEventListener('punch', this.punchHandler);
    document.removeEventListener('toot', this.tootHandler);
    document.removeEventListener('meow', this.meowHandler);
    document.removeEventListener('settingsmenutoggle', this.settingsMenuToggleHandler);
    this.canvas.removeEventListener('click', this.clickHandler);
    this.canvas.removeEventListener('mousemove', this.moveHandler);
    this.canvas.style.cursor = 'default';
    this.inputHandler.cleanup();
  }

  isInside(rect, x, y) {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  }

  restart() {
    this.screenManager.setScreen(new BossBattleScreen(this.screenManager, this.canvas, this.character));
  }

  backToMenu() {
    this.screenManager.setScreen(new ModeSelectScreen(this.screenManager, this.canvas));
  }

  // ==============================
  //  UPDATE
  // ==============================
  update(timestamp) {
    const dt = this.lastTimestamp == null ? 16 : Math.min(50, timestamp - this.lastTimestamp);
    this.lastTimestamp = timestamp;
    if (this.paused) return;

    this.t += dt;
    this.stageTime += dt;
    this.updateEffects(dt);

    if (this.stage === 'intro') {
      if (this.stageTime >= INTRO_TOTAL_MS) {
        this.stage = 'fight';
        this.stageTime = 0;
        this.playSound('bark');
      }
    } else if (this.stage === 'fight') {
      this.updatePlayer(dt);
      this.updateBoss(dt);
    } else if (this.stage === 'won') {
      this.updateVictory();
    } else if (this.stage === 'lost') {
      if (this.stageTime >= 1400) this.modalVisible = true;
    }
  }

  updateEffects(dt) {
    const b = this.boss;
    b.hurtFlash = Math.max(0, b.hurtFlash - dt);
    b.displayHp += (b.hp - b.displayHp) * Math.min(1, dt / 180);
    this.shake = Math.max(0, this.shake - dt);
    this.specialFx = Math.max(0, this.specialFx - dt);
    this.phaseBanner = Math.max(0, this.phaseBanner - dt);
    this.player.meterFlash = Math.max(0, this.player.meterFlash - dt);
    this.popups.forEach((p) => { p.age += dt; });
    this.popups = this.popups.filter((p) => p.age < POPUP_LIFE_MS);
  }

  getHeldLane() {
    const keys = this.inputHandler.keys;
    const left = keys['ArrowLeft'];
    const right = keys['ArrowRight'];
    if (left && !right) return 'left';
    if (right && !left) return 'right';
    return 'center';
  }

  updatePlayer(dt) {
    const p = this.player;
    p.lane = this.getHeldLane();
    p.ducking = !!this.inputHandler.keys['ArrowDown'];
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.punchAnim = Math.max(0, p.punchAnim - dt);
    p.stagger = Math.max(0, p.stagger - dt);
    p.invuln = Math.max(0, p.invuln - dt);

    const targetX = p.lane === 'left' ? -0.2 : p.lane === 'right' ? 0.2 : 0;
    const ease = Math.min(1, dt / 70);
    p.laneX += (targetX - p.laneX) * ease;
    p.duckAmt += ((p.ducking ? 1 : 0) - p.duckAmt) * ease;
  }

  getPhase() {
    const hp = this.boss.hp;
    return hp > 60 ? 1 : hp > 30 ? 2 : 3;
  }

  randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  updateBoss(dt) {
    const b = this.boss;
    const phaseConfig = PHASES[b.phase];
    b.timer -= dt;
    if (b.timer > 0) return;

    switch (b.state) {
      case 'idle': {
        if (phaseConfig.guardChance > 0 && Math.random() < phaseConfig.guardChance) {
          b.state = 'guard';
          b.timer = GUARD_MS;
          break;
        }
        const count = Math.random() < phaseConfig.comboChance ? 2 : 1;
        b.queue = Array.from({ length: count }, () => ATTACKS[Math.floor(Math.random() * ATTACKS.length)]);
        this.startWindup(1);
        break;
      }
      case 'windup':
        this.resolveStrike();
        break;
      case 'strike': {
        if (b.strikeHitPlayer) {
          // Landed a hit: back off briefly, combo cancelled.
          b.queue = [];
          this.enterIdle(HIT_RECOVER_MS);
        } else if (b.queue.length > 0) {
          this.startWindup(COMBO_WINDUP_FACTOR);
        } else {
          // Whiffed with nothing left in the combo: wide open.
          b.state = 'recover';
          b.timer = RECOVER_MS;
        }
        break;
      }
      case 'recover':
      case 'stun':
      case 'guard':
        this.enterIdle(b.state === 'guard' ? 500 : 400);
        break;
      default:
        break;
    }
  }

  enterIdle(minDelay) {
    const b = this.boss;
    const cfg = PHASES[b.phase];
    b.state = 'idle';
    b.timer = Math.max(minDelay, this.randomBetween(cfg.idleMin, cfg.idleMax));
  }

  startWindup(speedFactor) {
    const b = this.boss;
    b.attack = b.queue.shift();
    b.state = 'windup';
    b.windupTotal = PHASES[b.phase].windup * speedFactor;
    b.timer = b.windupTotal;
  }

  attackHitsPlayer(attack) {
    const p = this.player;
    if (attack === 'swipeLeft') return p.lane !== 'right';
    if (attack === 'swipeRight') return p.lane !== 'left';
    return !p.ducking; // overhead
  }

  resolveStrike() {
    const b = this.boss;
    b.state = 'strike';
    b.timer = STRIKE_MS;
    b.strikeHitPlayer = false;
    this.shake = Math.max(this.shake, 90);

    if (this.attackHitsPlayer(b.attack)) {
      if (this.player.invuln <= 0) {
        b.strikeHitPlayer = true;
        this.hurtPlayer();
      }
    } else {
      this.player.meter = Math.min(METER_MAX, this.player.meter + METER_PERFECT_DODGE);
      this.addPopup('DODGED!', 0.5, 0.62, '#9be7ff');
    }
  }

  hurtPlayer() {
    const p = this.player;
    p.hearts -= 1;
    p.invuln = PLAYER_INVULN_MS;
    this.shake = 320;
    this.playSound(this.fighter.hurtSound);
    this.addPopup('OUCH!', 0.5, 0.7, '#ff6b6b');
    if (p.hearts <= 0) {
      this.stage = 'lost';
      this.stageTime = 0;
      playLoseSound();
    }
  }

  tryPunch() {
    if (this.stage !== 'fight' || this.paused) return;
    const p = this.player;
    // Punching takes a planted stance: no punching mid-dodge, mid-duck, or
    // while recovering from a bounced punch. That's the risk/reward core.
    if (p.cooldown > 0 || p.stagger > 0 || p.lane !== 'center' || p.ducking) return;

    p.cooldown = this.fighter.cooldown;
    p.punchAnim = PLAYER_PUNCH_ANIM_MS;
    const b = this.boss;

    if (b.state === 'guard') {
      p.stagger = PLAYER_STAGGER_MS;
      this.addPopup('BLOCKED!', 0.5, 0.45, '#cfd8dc');
      return;
    }

    const open = b.state === 'recover' || b.state === 'stun';
    this.playSound('punch');
    p.meter = Math.min(METER_MAX, p.meter + (open ? METER_OPEN_HIT : METER_CHIP_HIT));
    this.damageBoss(this.fighter.damage * (open ? OPEN_HIT_MULTIPLIER : 1), open ? 'OPEN HIT!' : null);
  }

  trySpecial() {
    if (this.stage !== 'fight' || this.paused) return;
    const p = this.player;
    if (p.meter < METER_MAX) {
      p.meterFlash = 300;
      return;
    }
    p.meter = 0;
    this.playSound(this.fighter.specialSound);
    this.specialFx = 700;
    const b = this.boss;
    b.queue = [];
    b.state = 'stun';
    b.timer = SPECIAL_STUN_MS;
    this.addPopup(this.fighter.specialName, 0.5, 0.35, '#b6ff6b');
    this.damageBoss(SPECIAL_DAMAGE, null);
  }

  damageBoss(amount, label) {
    const b = this.boss;
    b.hp = Math.max(0, b.hp - amount);
    b.hurtFlash = 150;
    this.shake = Math.max(this.shake, 140);
    this.addPopup(label ? `${label} -${amount}` : `-${amount}`, 0.5 + (Math.random() - 0.5) * 0.12, 0.3, label ? '#ffd54f' : '#ffffff');

    if (b.hp <= 0) {
      this.startVictory();
      return;
    }
    const newPhase = this.getPhase();
    if (newPhase > b.phase) {
      b.phase = newPhase;
      this.phaseBanner = 1500;
      this.playSound('bark');
    }
  }

  startVictory() {
    this.stage = 'won';
    this.stageTime = 0;
    this.boss.state = 'defeated';
    this.boss.queue = [];
    playWinSound();
  }

  updateVictory() {
    const t = this.stageTime;
    this.bossFall = easeOutCubic(clamp01(t / WIN_FALL_END));
    this.cageOpen = easeOutCubic(clamp01((t - WIN_FALL_END) / (WIN_CAGE_END - WIN_FALL_END)));
    this.dogProgress = clamp01((t - WIN_CAGE_END) / (WIN_DOG_END - WIN_CAGE_END));
    if (t >= WIN_MODAL_AT) this.modalVisible = true;
  }

  addPopup(text, xFrac, yFrac, color) {
    this.popups.push({ text, xFrac, yFrac, color, age: 0 });
  }

  // ==============================
  //  RENDER
  // ==============================
  render() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const ui = getUIScale(width);

    ctx.save();
    ctx.clearRect(0, 0, width, height);
    if (this.shake > 0) {
      const mag = Math.min(8, this.shake / 30) * (width / 1280);
      ctx.translate((Math.random() - 0.5) * 2 * mag, (Math.random() - 0.5) * 2 * mag);
    }

    this.drawBackground(ctx, width, height);
    this.drawCage(ctx, width, height);
    this.drawFreedDog(ctx, width, height);
    this.drawBoss(ctx, width, height);
    this.drawAttackEffects(ctx, width, height);
    this.drawSpecialFx(ctx, width, height);
    this.drawPlayer(ctx, width, height);
    this.drawPopups(ctx, width, height, ui);
    ctx.restore();

    this.drawHud(ctx, width, height, ui);
    this.drawBanners(ctx, width, height, ui);
    if (this.modalVisible) this.drawModal(ctx, width, height, ui);
  }

  drawBackground(ctx, w, h) {
    const wallBottom = h * 0.62;
    const wall = ctx.createLinearGradient(0, 0, 0, wallBottom);
    wall.addColorStop(0, '#2a1638');
    wall.addColorStop(1, '#5b2a52');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, wallBottom);

    // Brick-ish stripes so the wall reads as a lair, not a flat gradient.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.lineWidth = Math.max(1, w / 640);
    for (let y = h * 0.08; y < wallBottom; y += h * 0.07) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const floor = ctx.createLinearGradient(0, wallBottom, 0, h);
    floor.addColorStop(0, '#3b2a2a');
    floor.addColorStop(1, '#1d1414');
    ctx.fillStyle = floor;
    ctx.fillRect(0, wallBottom, w, h - wallBottom);

    // Spotlight behind the boss.
    const spot = ctx.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, h * 0.6);
    spot.addColorStop(0, 'rgba(255, 220, 160, 0.28)');
    spot.addColorStop(1, 'rgba(255, 220, 160, 0)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, w, h);
  }

  getCageRect(w, h) {
    return { x: w * 0.04, y: h * 0.16, width: w * 0.21, height: h * 0.4 };
  }

  drawCage(ctx, w, h) {
    const cage = this.getCageRect(w, h);
    const barCount = 6;
    const barW = Math.max(3, w / 220);

    // Back panel and the dog inside (bars draw over it).
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(cage.x, cage.y, cage.width, cage.height);

    if (this.dogProgress < 1) {
      const frame = this.getDogFrame(0);
      if (frame) {
        const dogW = cage.width * 0.78;
        const dogH = dogW * (frame.sh / frame.sw);
        const bob = this.stage === 'won' ? 0 : Math.sin(this.t / 500) * 2;
        ctx.drawImage(
          this.dogImg, frame.sx, frame.sy, frame.sw, frame.sh,
          cage.x + (cage.width - dogW) / 2, cage.y + cage.height - dogH - 6 + bob, dogW, dogH
        );
      }
      if (this.stage !== 'won') {
        ctx.font = `bold ${Math.round(h * 0.035)}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText('HELP!', cage.x + cage.width / 2, cage.y + cage.height * 0.22 + Math.sin(this.t / 300) * 3);
      }
    }

    // Front bars lift out on victory, clipped so they vanish into the top frame.
    ctx.save();
    ctx.beginPath();
    ctx.rect(cage.x - 4, cage.y, cage.width + 8, cage.height + 8);
    ctx.clip();
    ctx.translate(0, -this.cageOpen * (cage.height + 12));
    ctx.fillStyle = '#9aa4ad';
    for (let i = 0; i <= barCount; i++) {
      const bx = cage.x + (cage.width - barW) * (i / barCount);
      ctx.fillRect(bx, cage.y, barW, cage.height);
    }
    // Padlock
    ctx.fillStyle = '#e0b53a';
    ctx.fillRect(cage.x + cage.width / 2 - 10, cage.y + cage.height * 0.55, 20, 18);
    ctx.restore();

    // Fixed frame (top bar, base).
    ctx.fillStyle = '#6d757d';
    ctx.fillRect(cage.x - 6, cage.y - 8, cage.width + 12, 10);
    ctx.fillRect(cage.x - 6, cage.y + cage.height, cage.width + 12, 8);
  }

  // dog_v2.png is a vertical strip of walk-cycle frames, one per row.
  getDogFrame(index) {
    const img = this.dogImg;
    if (!img.complete || img.naturalWidth === 0) return null;
    const rows = 6;
    const sh = img.naturalHeight / rows;
    return { sx: 0, sy: (index % rows) * sh, sw: img.naturalWidth, sh };
  }

  drawFreedDog(ctx, w, h) {
    if (this.dogProgress <= 0) return;
    const cage = this.getCageRect(w, h);
    const startX = cage.x + cage.width / 2;
    const startY = cage.y + cage.height;
    const endX = w * 0.3;
    const endY = h * 0.78;
    const p = easeOutCubic(this.dogProgress);

    // Hops down from the cage to the floor, bouncing along the way.
    const x = startX + (endX - startX) * p;
    const hop = Math.abs(Math.sin(this.dogProgress * Math.PI * 3)) * h * 0.08 * (1 - this.dogProgress);
    const y = startY + (endY - startY) * p - hop;

    const frame = this.getDogFrame(this.dogProgress < 1 ? Math.floor(this.t / 90) : 0);
    if (!frame) return;
    const dogW = w * 0.2;
    const dogH = dogW * (frame.sh / frame.sw);
    ctx.drawImage(this.dogImg, frame.sx, frame.sy, frame.sw, frame.sh, x - dogW / 2, y - dogH, dogW, dogH);
  }

  getBossRect(w, h) {
    const bh = h * 0.52;
    const img = this.bossImg;
    const aspect = img.complete && img.naturalWidth > 0 ? img.naturalWidth / img.naturalHeight : 0.95;
    const bw = bh * aspect;
    return { cx: w * 0.5, feetY: h * 0.74, width: bw, height: bh };
  }

  drawBoss(ctx, w, h) {
    const rect = this.getBossRect(w, h);
    const bw = Math.max(1, Math.round(rect.width));
    const bh = Math.max(1, Math.round(rect.height));
    const layer = this.bossLayer;
    if (layer.width !== bw || layer.height !== bh) {
      layer.width = bw;
      layer.height = bh;
    }
    const lctx = layer.getContext('2d');
    lctx.clearRect(0, 0, bw, bh);
    this.drawBossBody(lctx, bw, bh);

    const pose = this.getBossPose(rect);
    const tint = (color, alpha) => {
      if (alpha <= 0) return;
      lctx.save();
      lctx.globalCompositeOperation = 'source-atop';
      lctx.globalAlpha = clamp01(alpha);
      lctx.fillStyle = color;
      lctx.fillRect(0, 0, bw, bh);
      lctx.restore();
    };
    tint('#ff1a1a', pose.tintRed);
    tint('#6ab7ff', pose.tintBlue);
    tint('#ffffff', pose.tintWhite);

    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(rect.cx, rect.feetY, rect.width * 0.4, rect.height * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(rect.cx + pose.dx, rect.feetY + pose.dy);
    ctx.rotate(pose.rot);
    ctx.scale(pose.scale, pose.scale);
    ctx.globalAlpha = pose.alpha;
    ctx.drawImage(layer, -bw / 2, -bh, bw, bh);
    ctx.restore();

    if (this.boss.state === 'recover' || this.boss.state === 'stun') {
      this.drawStars(ctx, rect.cx + pose.dx, rect.feetY - rect.height * 1.02 + pose.dy, rect.width * 0.28);
    }
    if (this.boss.state === 'guard') {
      ctx.strokeStyle = 'rgba(140, 200, 255, 0.85)';
      ctx.lineWidth = Math.max(3, w / 200);
      ctx.beginPath();
      ctx.arc(rect.cx, rect.feetY - rect.height * 0.5, rect.height * 0.55, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  }

  getBossPose(rect) {
    const b = this.boss;
    const pose = { dx: 0, dy: 0, rot: 0, scale: 1, alpha: 1, tintRed: 0, tintBlue: 0, tintWhite: b.hurtFlash / 150 * 0.8 };
    const side = b.attack === 'swipeLeft' ? -1 : b.attack === 'swipeRight' ? 1 : 0;

    switch (b.state) {
      case 'idle':
        pose.dy = Math.sin(this.t / 400) * 3;
        pose.scale = 1 + Math.sin(this.t / 400) * 0.01;
        break;
      case 'windup': {
        const p = 1 - b.timer / b.windupTotal;
        const pulse = 0.5 + 0.5 * Math.sin(this.t / 40);
        pose.tintRed = 0.12 + 0.38 * p * (0.6 + 0.4 * pulse);
        if (side !== 0) {
          pose.dx = side * p * rect.width * 0.12;
          pose.rot = side * p * 0.18;
          pose.scale = 1 + 0.04 * p;
        } else {
          pose.dy = -p * rect.height * 0.08;
          pose.scale = 1 + 0.1 * p;
        }
        break;
      }
      case 'strike':
        pose.scale = 1.22;
        if (side !== 0) {
          pose.dx = side * rect.width * 0.14;
          pose.rot = side * -0.12;
        } else {
          pose.dy = rect.height * 0.12;
        }
        break;
      case 'recover':
      case 'stun':
        pose.rot = Math.sin(this.t / 90) * 0.05;
        pose.dy = rect.height * 0.03;
        break;
      case 'guard':
        pose.scale = 0.96;
        pose.dy = rect.height * 0.02;
        pose.tintBlue = 0.2;
        break;
      case 'defeated':
        pose.rot = -1.35 * this.bossFall;
        pose.dy = rect.height * 0.18 * this.bossFall;
        pose.dx = -rect.width * 0.15 * this.bossFall;
        pose.alpha = 1 - 0.3 * this.bossFall;
        break;
      default:
        break;
    }
    return pose;
  }

  // Real art if boss_dog.png exists; otherwise a drawn stand-in so the mode
  // is fully playable before the art is generated.
  drawBossBody(c, w, h) {
    const img = this.bossImg;
    if (img.complete && img.naturalWidth > 0) {
      c.drawImage(img, 0, 0, w, h);
      return;
    }

    const fill = (color, drawPath) => {
      c.fillStyle = color;
      c.beginPath();
      drawPath();
      c.fill();
    };

    // Body & arms
    fill('#5c3a1e', () => c.ellipse(w * 0.5, h * 0.74, w * 0.36, h * 0.27, 0, 0, Math.PI * 2));
    fill('#6b4423', () => c.ellipse(w * 0.13, h * 0.7, w * 0.1, h * 0.17, 0.2, 0, Math.PI * 2));
    fill('#6b4423', () => c.ellipse(w * 0.87, h * 0.7, w * 0.1, h * 0.17, -0.2, 0, Math.PI * 2));
    // Claws
    c.fillStyle = '#f5f0e0';
    [0.08, 0.13, 0.18].forEach((fx) => {
      [fx, 1 - fx].forEach((x) => {
        c.beginPath();
        c.moveTo(w * (x - 0.015), h * 0.85);
        c.lineTo(w * x, h * 0.93);
        c.lineTo(w * (x + 0.015), h * 0.85);
        c.fill();
      });
    });
    // Ears
    fill('#3b2412', () => c.ellipse(w * 0.26, h * 0.17, w * 0.07, h * 0.14, 0.5, 0, Math.PI * 2));
    fill('#3b2412', () => c.ellipse(w * 0.74, h * 0.17, w * 0.07, h * 0.14, -0.5, 0, Math.PI * 2));
    // Head & snout
    fill('#7a4e2a', () => c.ellipse(w * 0.5, h * 0.34, w * 0.26, h * 0.24, 0, 0, Math.PI * 2));
    fill('#c9a07a', () => c.ellipse(w * 0.5, h * 0.45, w * 0.14, h * 0.1, 0, 0, Math.PI * 2));
    fill('#111', () => c.ellipse(w * 0.5, h * 0.4, w * 0.04, h * 0.025, 0, 0, Math.PI * 2));
    // Snarl with teeth
    c.strokeStyle = '#111';
    c.lineWidth = Math.max(2, w / 120);
    c.beginPath();
    c.moveTo(w * 0.38, h * 0.5);
    c.quadraticCurveTo(w * 0.5, h * 0.56, w * 0.62, h * 0.5);
    c.stroke();
    c.fillStyle = '#fff';
    [0.42, 0.47, 0.53, 0.58].forEach((x) => {
      c.beginPath();
      c.moveTo(w * (x - 0.012), h * 0.515);
      c.lineTo(w * x, h * 0.555);
      c.lineTo(w * (x + 0.012), h * 0.515);
      c.fill();
    });
    // Glowing red eyes and angry brows
    [0.4, 0.6].forEach((x) => {
      const glow = c.createRadialGradient(w * x, h * 0.3, 0, w * x, h * 0.3, w * 0.06);
      glow.addColorStop(0, '#ffdddd');
      glow.addColorStop(0.4, '#ff2a2a');
      glow.addColorStop(1, 'rgba(255, 0, 0, 0)');
      c.fillStyle = glow;
      c.beginPath();
      c.arc(w * x, h * 0.3, w * 0.06, 0, Math.PI * 2);
      c.fill();
    });
    c.strokeStyle = '#1a0d05';
    c.lineWidth = Math.max(3, w / 80);
    c.beginPath();
    c.moveTo(w * 0.33, h * 0.22);
    c.lineTo(w * 0.46, h * 0.27);
    c.moveTo(w * 0.67, h * 0.22);
    c.lineTo(w * 0.54, h * 0.27);
    c.stroke();
    // Spiked collar
    c.strokeStyle = '#26262b';
    c.lineWidth = Math.max(6, w / 40);
    c.beginPath();
    c.ellipse(w * 0.5, h * 0.56, w * 0.2, h * 0.07, 0, 0.05 * Math.PI, 0.95 * Math.PI);
    c.stroke();
    c.fillStyle = '#d6dbe0';
    for (let i = 0; i < 7; i++) {
      const a = (0.1 + (i / 6) * 0.8) * Math.PI;
      const sx = w * 0.5 + Math.cos(a) * w * 0.2;
      const sy = h * 0.56 + Math.sin(a) * h * 0.07;
      c.beginPath();
      c.moveTo(sx - w * 0.012, sy);
      c.lineTo(sx, sy + h * 0.06);
      c.lineTo(sx + w * 0.012, sy);
      c.fill();
    }
  }

  drawStars(ctx, cx, cy, radius) {
    ctx.save();
    ctx.fillStyle = '#ffe14d';
    for (let i = 0; i < 4; i++) {
      const a = this.t / 250 + (i / 4) * Math.PI * 2;
      const sx = cx + Math.cos(a) * radius;
      const sy = cy + Math.sin(a) * radius * 0.3;
      const r = radius * 0.13;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 === 0 ? r : r * 0.45;
        const aa = (k / 10) * Math.PI * 2 - Math.PI / 2;
        ctx[k === 0 ? 'moveTo' : 'lineTo'](sx + Math.cos(aa) * rr, sy + Math.sin(aa) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawAttackEffects(ctx, w, h) {
    const b = this.boss;
    if (this.stage !== 'fight' || (b.state !== 'windup' && b.state !== 'strike')) return;

    // Dodge hints: an arrow on the safe side, or "duck" for an overhead.
    const arrowSize = h * 0.09;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${arrowSize}px Arial`;
    const flash = 0.55 + 0.45 * Math.sin(this.t / 60);
    ctx.globalAlpha = b.state === 'windup' ? flash : 0.4;
    ctx.fillStyle = '#ffe14d';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 5;
    let hint = null;
    if (b.attack === 'swipeLeft') hint = { text: '➡', x: w * 0.8, y: h * 0.8 };
    else if (b.attack === 'swipeRight') hint = { text: '⬅', x: w * 0.2, y: h * 0.8 };
    else hint = { text: '⬇', x: w * 0.5, y: h * 0.58 };
    ctx.strokeText(hint.text, hint.x, hint.y);
    ctx.fillText(hint.text, hint.x, hint.y);
    ctx.restore();

    if (b.state === 'strike') {
      // Three claw slashes across the attacked area.
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(5, w / 110);
      const dir = b.attack === 'swipeLeft' ? 1 : b.attack === 'swipeRight' ? -1 : 0;
      const baseX = dir === 0 ? w * 0.5 : dir === 1 ? w * 0.25 : w * 0.75;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        if (dir === 0) {
          ctx.moveTo(baseX + i * w * 0.07, h * 0.45);
          ctx.lineTo(baseX + i * w * 0.07, h * 0.9);
        } else {
          ctx.moveTo(baseX - dir * w * 0.12 + i * w * 0.03, h * 0.5 + i * h * 0.05);
          ctx.lineTo(baseX + dir * w * 0.25 + i * w * 0.03, h * 0.9 + i * h * 0.05);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawSpecialFx(ctx, w, h) {
    if (this.specialFx <= 0) return;
    const p = 1 - this.specialFx / 700;
    ctx.save();
    ctx.globalAlpha = 0.55 * (1 - p);
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.6, 0, w * 0.5, h * 0.6, h * (0.2 + 0.7 * p));
    grad.addColorStop(0, 'rgba(190, 255, 110, 0.9)');
    grad.addColorStop(1, 'rgba(120, 200, 40, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  drawPlayer(ctx, w, h) {
    const img = this.playerImg;
    if (!img.complete || img.naturalWidth === 0) return;
    const portrait = PORTRAITS[this.character];
    const p = this.player;

    const drawH = h * 0.34;
    const drawW = drawH * (portrait.sw / portrait.sh);
    const punchP = p.punchAnim > 0 ? Math.sin((1 - p.punchAnim / PLAYER_PUNCH_ANIM_MS) * Math.PI) : 0;
    const lost = this.stage === 'lost' ? easeOutCubic(clamp01(this.stageTime / 700)) : 0;

    const cx = w * 0.5 + p.laneX * w;
    const baseY = h * 1.02 + p.duckAmt * h * 0.07 + lost * h * 0.2;
    const scaleY = 1 - 0.28 * p.duckAmt;
    const scale = 1 + 0.22 * punchP;
    const staggerTilt = p.stagger > 0 ? Math.sin(this.t / 40) * 0.08 : 0;

    ctx.save();
    // Blink while invulnerable after a hit.
    if (p.invuln > 0 && Math.floor(this.t / 70) % 2 === 0) ctx.globalAlpha = 0.45;
    if (lost) ctx.globalAlpha *= 1 - 0.5 * lost;
    ctx.translate(cx, baseY - punchP * h * 0.05);
    ctx.rotate(staggerTilt + lost * 0.9);
    ctx.scale(scale, scale * scaleY);
    ctx.drawImage(img, portrait.sx, portrait.sy, portrait.sw, portrait.sh, -drawW / 2, -drawH, drawW, drawH);
    ctx.restore();
  }

  drawPopups(ctx, w, h, ui) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.popups.forEach((pop) => {
      const t = pop.age / POPUP_LIFE_MS;
      ctx.globalAlpha = 1 - t * t;
      ctx.font = `900 ${Math.round(26 * ui)}px Impact, 'Arial Black', sans-serif`;
      const x = pop.xFrac * w;
      const y = pop.yFrac * h - t * h * 0.08;
      ctx.lineWidth = Math.max(3, 5 * ui);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.strokeText(pop.text, x, y);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, x, y);
    });
    ctx.restore();
  }

  drawHud(ctx, w, h, ui) {
    const b = this.boss;
    ctx.save();

    // Boss health bar, top center.
    const barW = w * 0.5;
    const barH = Math.max(14, 20 * ui);
    const barX = (w - barW) / 2;
    const barY = h * 0.045;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `900 ${Math.round(22 * ui)}px Impact, 'Arial Black', sans-serif`;
    ctx.lineWidth = Math.max(3, 4 * ui);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(BOSS_NAME, w / 2, barY - 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(BOSS_NAME, w / 2, barY - 4);

    drawRoundedRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fill();
    const frac = clamp01(b.displayHp / BOSS_MAX_HP);
    if (frac > 0) {
      ctx.save();
      drawRoundedRect(ctx, barX, barY, barW, barH, barH / 2);
      ctx.clip();
      const g = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      g.addColorStop(0, '#ff5252');
      g.addColorStop(1, '#ffb300');
      ctx.fillStyle = g;
      ctx.fillRect(barX, barY, barW * frac, barH);
      ctx.restore();
    }
    drawRoundedRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.lineWidth = Math.max(2, 3 * ui);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.stroke();

    // Player hearts, bottom-left.
    const heartSize = Math.round(30 * ui);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${heartSize}px Arial`;
    for (let i = 0; i < this.fighter.hearts; i++) {
      const alive = i < this.player.hearts;
      ctx.fillStyle = alive ? '#ff4d6d' : 'rgba(255,255,255,0.3)';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 4;
      ctx.fillText(alive ? '♥' : '♡', 16 * ui + i * heartSize * 1.05, h - 26 * ui);
    }
    ctx.shadowBlur = 0;

    // Special meter, bottom-right.
    const mW = Math.max(110, 190 * ui);
    const mH = Math.max(12, 16 * ui);
    const mX = w - mW - 16 * ui;
    const mY = h - 34 * ui;
    const full = this.player.meter >= METER_MAX;
    const pulse = full ? 0.6 + 0.4 * Math.sin(this.t / 120) : 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.font = `bold ${Math.round(15 * ui)}px Arial`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(full ? 'SPECIAL READY — SPACE!' : 'SPECIAL', mX + mW, mY - 4);
    drawRoundedRect(ctx, mX, mY, mW, mH, mH / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill();
    if (this.player.meter > 0) {
      ctx.save();
      drawRoundedRect(ctx, mX, mY, mW, mH, mH / 2);
      ctx.clip();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = full ? '#b6ff6b' : '#6bd0ff';
      ctx.fillRect(mX, mY, mW * clamp01(this.player.meter / METER_MAX), mH);
      ctx.restore();
    }
    drawRoundedRect(ctx, mX, mY, mW, mH, mH / 2);
    ctx.lineWidth = Math.max(2, 2 * ui);
    ctx.strokeStyle = this.player.meterFlash > 0 ? '#ff6b6b' : 'rgba(255,255,255,0.8)';
    ctx.stroke();

    // Controls hint, fading out after the fight starts.
    if (this.stage === 'fight' && this.stageTime < HINT_VISIBLE_MS) {
      ctx.globalAlpha = clamp01((HINT_VISIBLE_MS - this.stageTime) / 1000);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(16 * ui)}px Arial`;
      ctx.lineWidth = Math.max(3, 4 * ui);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      const hint = '← → dodge   ↓ duck   P punch   Space special';
      ctx.strokeText(hint, w / 2, h * 0.115);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(hint, w / 2, h * 0.115);
    }
    ctx.restore();
  }

  drawBanners(ctx, w, h, ui) {
    let text = null;
    let color = '#ffffff';
    if (this.stage === 'intro') {
      text = this.stageTime < INTRO_ROUND_MS ? 'ROUND 1' : 'FIGHT!';
      if (text === 'FIGHT!') color = '#ffd54f';
    } else if (this.phaseBanner > 0 && this.stage === 'fight') {
      text = this.boss.phase === 3 ? 'HE\'S ENRAGED!' : 'HE\'S GETTING MAD!';
      color = '#ff7a7a';
    } else if (this.stage === 'won' && this.stageTime > WIN_FALL_END && !this.modalVisible) {
      text = `${CHARACTER_NAMES.DOG} is free!`;
      color = '#b6ff6b';
    }
    if (!text) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(64 * ui)}px Impact, 'Arial Black', sans-serif`;
    ctx.lineWidth = Math.max(4, 8 * ui);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, w / 2, h * 0.4);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h * 0.4);
    ctx.restore();
  }

  drawModal(ctx, w, h, ui) {
    const won = this.stage === 'won';
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, w, h);

    const cardW = Math.min(w * 0.8, 520 * ui);
    const cardH = 300 * ui;
    const cardX = (w - cardW) / 2;
    const cardY = (h - cardH) / 2;
    const grad = ctx.createLinearGradient(0, cardY, 0, cardY + cardH);
    if (won) {
      grad.addColorStop(0, '#ffe082');
      grad.addColorStop(1, '#ff9800');
    } else {
      grad.addColorStop(0, '#5fb3d9');
      grad.addColorStop(1, '#2c5b9e');
    }
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28 * ui);
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2, 3 * ui);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(48 * ui)}px Impact, 'Arial Black', sans-serif`;
    ctx.lineWidth = Math.max(3, 6 * ui);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    const title = won ? 'VICTORY!' : 'KNOCKED OUT!';
    ctx.strokeText(title, w / 2, cardY + cardH * 0.2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(title, w / 2, cardY + cardH * 0.2);

    ctx.font = `bold ${Math.round(22 * ui)}px Arial`;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    const subtitle = won
      ? `${this.fighter.name} beat ${BOSS_NAME} and freed ${CHARACTER_NAMES.DOG}!`
      : `${BOSS_NAME} won this round.`;
    ctx.fillText(subtitle, w / 2, cardY + cardH * 0.42, cardW * 0.9);
    ctx.shadowBlur = 0;

    const btnW = cardW * 0.4;
    const btnH = 52 * ui;
    const gap = cardW * 0.05;
    const btnY = cardY + cardH * 0.64;
    const buttons = [
      { label: won ? 'Play Again' : 'Try Again', colors: ['#ffb238', '#fb8c00'], action: () => this.restart() },
      { label: 'Menu', colors: ['#8a2be2', '#6a1fc2'], action: () => this.backToMenu() },
    ];
    this.modalButtons = buttons.map((btn, i) => {
      const rect = { x: w / 2 - gap / 2 - btnW + i * (btnW + gap), y: btnY, width: btnW, height: btnH, action: btn.action };
      const hovered = i === this.hoveredButton;
      const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + btnH);
      g.addColorStop(0, btn.colors[0]);
      g.addColorStop(1, btn.colors[1]);
      drawRoundedRect(ctx, rect.x, rect.y - (hovered ? 2 : 0), btnW, btnH, btnH / 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(22 * ui)}px Arial`;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      ctx.fillText(btn.label, rect.x + btnW / 2, rect.y + btnH / 2 + 1 - (hovered ? 2 : 0));
      ctx.shadowBlur = 0;
      return rect;
    });
    ctx.restore();
  }
}
