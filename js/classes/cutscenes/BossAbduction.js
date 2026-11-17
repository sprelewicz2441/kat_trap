import { CHARACTER_NAMES } from '../../utils/characterNames.js?v=2';
import { drawRoundedRect } from '../../utils/canvasShapes.js';

// "Bruno the Brute crashes the kitchen and snatches the dog" - the animated
// lead-in to an in-game boss battle (see GameScreen.startBossEvent()). Pure
// presentation: GameScreen owns the freeze/resume, the dog's real position and
// the fight itself; this class only owns the timeline and the drawing.
//
// Timeline (ms from start):
//   WARN    rumble + red vignette + a "!" over the dog
//   CHARGE  Bruno stampedes in from the edge, dust and speed lines
//   SLAM    impact flash/starburst, a cage slams down over the dog
//   CARRY   Bruno hauls the cage back off the edge the way he came
//   TITLE   letterbox bars, "BOSS BATTLE!" slams in, fade to black
// then `done` flips and GameScreen hands the canvas to the boss fight.
//
// Two draw passes so screen shake can wrap only the world: renderWorld()
// (boss, dog, cage, dust - shaken) and renderScreen() (vignette, bars, title,
// fade - never shaken, so text stays crisp and readable).

const WARN_END = 800;
const CHARGE_END = 1700;
const SLAM_END = 2050;
const CARRY_END = 3250;
const TOTAL = 4600;
const FADE_MS = 350;

const BOSS_NAME = 'Buttface';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeInQuad = (t) => t * t;
const easeInCubic = (t) => t * t * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

// A small overshoot-then-settle ease for the title's slam-in.
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export default class BossAbduction {
  // dogRect: the dog's on-canvas top-left + display size at the moment of capture.
  // drawBossBody(ctx, w, h): paints Bruno into a w x h box (BossBattleScreen's own
  // art/procedural fallback, so the cutscene boss can never drift from the fight's).
  // onCue(name): fired once each at 'warn' | 'charge' | 'slam' | 'title' for sound.
  constructor({ width, height, ui, dogRect, drawBossBody, onCue }) {
    this.w = width;
    this.h = height;
    this.ui = ui;
    this.dogRect = dogRect;
    this.drawBossBody = drawBossBody;
    this.onCue = onCue || (() => {});
    this.t = 0;
    this.done = false;
    this.cuesFired = new Set();
    this.bossLayer = document.createElement('canvas');

    const dogCx = dogRect.x + dogRect.width / 2;
    // Bruno enters from whichever side has more room beyond the dog and leaves the same way.
    this.side = dogCx < width / 2 ? 1 : -1;
    this.bossH = height * 0.42;
    this.bossW = this.bossH * 0.95;
    this.feetY = Math.min(height - 8, dogRect.y + dogRect.height + this.bossH * 0.04);
    this.standX = dogCx + this.side * (this.bossW * 0.5 + dogRect.width * 0.4);
    this.startX = this.side > 0 ? width + this.bossW : -this.bossW;
    this.exitX = this.side > 0 ? width + this.bossW * 1.2 : -this.bossW * 1.2;

    this.cageW = dogRect.width * 1.35;
    this.cageH = dogRect.height * 1.7;
    this.origCage = { cx: dogCx, bottom: dogRect.y + dogRect.height + 4 };
  }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    this.fireCue('warn', 0);
    this.fireCue('charge', WARN_END);
    this.fireCue('slam', CHARGE_END);
    this.fireCue('title', CARRY_END);
    if (this.t >= TOTAL) this.done = true;
  }

  fireCue(name, at) {
    if (this.t >= at && !this.cuesFired.has(name)) {
      this.cuesFired.add(name);
      this.onCue(name);
    }
  }

  // ---- geometry over time -------------------------------------------------
  bossX(t = this.t) {
    if (t < WARN_END) return this.startX;
    if (t < CHARGE_END) return lerp(this.startX, this.standX, easeInQuad((t - WARN_END) / (CHARGE_END - WARN_END)));
    if (t < SLAM_END) return this.standX;
    if (t < CARRY_END) return lerp(this.standX, this.exitX, easeInOutQuad(clamp01((t - SLAM_END - 150) / (CARRY_END - SLAM_END - 150))));
    return this.exitX;
  }

  // Stomping bounce while Bruno is moving.
  bossHop(t = this.t) {
    const moving = (t >= WARN_END && t < CHARGE_END) || (t >= SLAM_END + 300 && t < CARRY_END);
    if (!moving) return 0;
    return Math.abs(Math.sin(t / 95)) * this.bossH * 0.045;
  }

  // Cage centre-x / bottom-y right now, or null before it has dropped.
  cageState() {
    const t = this.t;
    if (t < CHARGE_END) return null;
    const holdCx = this.bossX();
    const holdBottom = this.feetY - this.bossH * 0.12 - this.bossHop();
    let cx = this.origCage.cx;
    let bottom = this.origCage.bottom;
    if (t < SLAM_END) {
      // Falls from above the canvas, accelerating, with a small settle bounce at the end.
      const p = clamp01((t - CHARGE_END) / 180);
      const fall = easeInCubic(p);
      const startBottom = -this.cageH * 0.2;
      bottom = lerp(startBottom, this.origCage.bottom, fall);
      if (p >= 1) bottom -= Math.abs(Math.sin((t - CHARGE_END - 180) / 55)) * 10 * (1 - clamp01((t - CHARGE_END - 180) / 170));
    } else {
      const lift = easeOutCubic(clamp01((t - SLAM_END) / 320));
      cx = lerp(this.origCage.cx, holdCx, lift);
      bottom = lerp(this.origCage.bottom, holdBottom, lift);
    }
    return { cx, bottom };
  }

  // Offset to apply to the real dog sprite so it rides along inside the cage.
  dogOffset() {
    const c = this.cageState();
    if (!c) return { dx: 0, dy: 0 };
    return { dx: c.cx - this.origCage.cx, dy: c.bottom - this.origCage.bottom };
  }

  // Strongest shake amplitude (canvas px) at the current time.
  shakeAmount() {
    const t = this.t;
    const k = this.w / 1280;
    if (t < WARN_END) return (t / WARN_END) * 4 * k;
    if (t < CHARGE_END) return 6 * k;
    if (t < SLAM_END) return (1 - (t - CHARGE_END) / (SLAM_END - CHARGE_END)) * 16 * k;
    if (t < CARRY_END) return 4 * k;
    return 0;
  }

  // ---- world pass ---------------------------------------------------------
  renderWorld(ctx, drawDog) {
    if (this.t >= CARRY_END && this.bossX() === this.exitX) {
      // Bruno and the cage are off-screen for the title phase - nothing in the world to draw.
      return;
    }
    this.drawDust(ctx);
    this.drawSpeedLines(ctx);
    this.drawBoss(ctx);
    drawDog();
    this.drawCage(ctx);
    this.drawImpact(ctx);
    this.drawHelpBubble(ctx);
  }

  drawDust(ctx) {
    // Puffs kicked up behind Bruno's feet, derived from time (no stored particles).
    const stamps = [];
    for (let s = WARN_END; s < CHARGE_END; s += 70) stamps.push(s);
    for (let s = SLAM_END + 300; s < CARRY_END; s += 90) stamps.push(s);
    ctx.save();
    stamps.forEach((s) => {
      const age = this.t - s;
      if (age < 0 || age > 520) return;
      const p = age / 520;
      const x = this.bossX(s) - (s < SLAM_END ? -this.side : this.side) * this.bossW * 0.18;
      const y = this.feetY - p * this.bossH * 0.1;
      const r = (10 + p * 26) * (this.w / 1280) * 1.4;
      ctx.globalAlpha = (1 - p) * 0.55;
      ctx.fillStyle = '#d9c9a8';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  drawSpeedLines(ctx) {
    if (this.t < WARN_END || this.t > CHARGE_END) return;
    const p = (this.t - WARN_END) / (CHARGE_END - WARN_END);
    const bx = this.bossX();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const y = this.feetY - this.bossH * (0.08 + i * 0.1);
      const len = (80 + ((i * 37) % 60)) * (this.w / 1280) * (0.5 + p);
      const x0 = bx + this.side * (this.bossW * 0.5 + 10 + ((i * 53) % 40));
      ctx.lineWidth = Math.max(2, 3 * (this.w / 1280));
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + this.side * len, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBoss(ctx) {
    const bw = Math.max(1, Math.round(this.bossW));
    const bh = Math.max(1, Math.round(this.bossH));
    const layer = this.bossLayer;
    // Compose at the on-screen pixel density (the main canvas is pre-scaled
    // for high-DPI displays, see utils/hidpi.js) so the boss isn't upscaled.
    const ct = ctx.getTransform();
    const s = Math.min(3, Math.max(1, Math.hypot(ct.a, ct.b)));
    const pw = Math.max(1, Math.round(bw * s));
    const ph = Math.max(1, Math.round(bh * s));
    if (layer.width !== pw || layer.height !== ph) {
      layer.width = pw;
      layer.height = ph;
    }
    const lctx = layer.getContext('2d');
    lctx.setTransform(pw / bw, 0, 0, ph / bh, 0, 0);
    lctx.clearRect(0, 0, bw, bh);
    this.drawBossBody(lctx, bw, bh);

    const x = this.bossX();
    const hop = this.bossHop();
    const moving = hop > 0;
    const dir = this.t < SLAM_END ? -this.side : this.side; // direction of travel
    const rot = moving ? dir * 0.1 : 0;
    // Squash on impact for a bit of weight.
    let sx = 1;
    let sy = 1;
    if (this.t >= CHARGE_END && this.t < CHARGE_END + 220) {
      const k = 1 - (this.t - CHARGE_END) / 220;
      sx = 1 + 0.12 * k;
      sy = 1 - 0.12 * k;
    }

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, this.feetY + 2, this.bossW * 0.4, this.bossH * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(x, this.feetY - hop);
    ctx.rotate(rot);
    ctx.scale(sx, sy);
    ctx.drawImage(layer, -bw / 2, -bh, bw, bh);
    ctx.restore();
  }

  drawCage(ctx) {
    const c = this.cageState();
    if (!c) return;
    const w = this.cageW;
    const h = this.cageH;
    const x = c.cx - w / 2;
    const y = c.bottom - h;
    const barW = Math.max(3, this.w / 240);
    const swing = this.t >= SLAM_END + 300 && this.t < CARRY_END ? Math.sin(this.t / 140) * 0.05 : 0;

    ctx.save();
    ctx.translate(c.cx, c.bottom);
    ctx.rotate(swing);
    ctx.translate(-c.cx, -c.bottom);

    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#9aa4ad';
    const bars = 7;
    for (let i = 0; i <= bars; i++) {
      ctx.fillRect(x + (w - barW) * (i / bars), y, barW, h);
    }
    // Bar highlight so they read as metal, not flat lines.
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i <= bars; i++) {
      ctx.fillRect(x + (w - barW) * (i / bars) + barW * 0.15, y, Math.max(1, barW * 0.25), h);
    }
    ctx.fillStyle = '#6d757d';
    ctx.fillRect(x - 5, y - 8, w + 10, 10);
    ctx.fillRect(x - 5, y + h - 4, w + 10, 8);
    // Top handle + padlock
    ctx.strokeStyle = '#6d757d';
    ctx.lineWidth = Math.max(4, barW * 1.3);
    ctx.beginPath();
    ctx.arc(c.cx, y - 8, w * 0.12, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#e0b53a';
    ctx.fillRect(c.cx - 10, y + h * 0.55, 20, 17);
    ctx.restore();
  }

  drawImpact(ctx) {
    const age = this.t - CHARGE_END;
    if (age < 0 || age > 520) return;
    const cx = this.dogRect.x + this.dogRect.width / 2;
    const cy = this.dogRect.y + this.dogRect.height * 0.5;
    const p = age / 520;
    const k = this.w / 1280;

    ctx.save();
    ctx.translate(cx, cy);
    // starburst
    ctx.globalAlpha = (1 - p) * 0.95;
    const spikes = 12;
    const outer = (50 + 190 * easeOutCubic(p)) * k;
    const inner = outer * 0.5;
    ctx.fillStyle = '#ffd54f';
    ctx.strokeStyle = '#ff8f00';
    ctx.lineWidth = Math.max(3, 5 * k);
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? outer : inner;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // comic word
    ctx.globalAlpha = 1 - clamp01((p - 0.5) * 2);
    ctx.rotate(-0.14);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fs = Math.round(58 * this.ui * (0.8 + 0.4 * easeOutCubic(clamp01(p * 3))));
    ctx.font = `900 ${fs}px Impact, 'Arial Black', sans-serif`;
    ctx.lineWidth = Math.max(4, 8 * this.ui);
    ctx.strokeStyle = '#7a1a00';
    ctx.strokeText('WHAM!', 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('WHAM!', 0, 0);
    ctx.restore();
  }

  drawHelpBubble(ctx) {
    if (this.t < SLAM_END + 250 || this.t > CARRY_END) return;
    const c = this.cageState();
    if (!c) return;
    const wob = Math.sin(this.t / 120) * 3;
    const text = 'HELP!';
    ctx.save();
    ctx.font = `900 ${Math.round(26 * this.ui)}px Impact, 'Arial Black', sans-serif`;
    const tw = ctx.measureText(text).width;
    const bw = tw + 26 * this.ui;
    const bh = 42 * this.ui;
    const bx = c.cx - bw / 2;
    // Above Bruno's head (not the cage) so the bubble never covers his face.
    const by = this.feetY - this.bossH - bh - 20 * this.ui + wob - this.bossHop();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#2a1248';
    ctx.lineWidth = Math.max(2, 3 * this.ui);
    drawRoundedRect(ctx, bx, by, bw, bh, 14 * this.ui);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.cx - 8 * this.ui, by + bh);
    ctx.lineTo(c.cx, by + bh + 14 * this.ui);
    ctx.lineTo(c.cx + 8 * this.ui, by + bh);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d81b60';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, c.cx, by + bh / 2 + 1);
    ctx.restore();
  }

  // ---- screen pass --------------------------------------------------------
  renderScreen(ctx) {
    const { w, h, t, ui } = this;

    // Red alarm vignette, pulsing, strongest during the warning.
    const vig =
      t < WARN_END ? 0.15 + 0.35 * Math.abs(Math.sin(t / 110)) : t < CARRY_END ? 0.22 : 0;
    if (vig > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(180,0,0,0)');
      g.addColorStop(1, `rgba(180,0,0,${vig * 1.6})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    if (t < WARN_END) this.drawAlarm(ctx);

    if (t >= CARRY_END - 300) this.drawTitle(ctx);

    // Final fade to black into the fight.
    const fade = clamp01((t - (TOTAL - FADE_MS)) / FADE_MS);
    if (fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Bouncing "!" over the dog before anything has even appeared.
  drawAlarm(ctx) {
    const { dogRect, ui, t } = this;
    const cx = dogRect.x + dogRect.width / 2;
    const bounce = Math.abs(Math.sin(t / 90)) * 14 * ui;
    const r = 26 * ui * (0.8 + 0.2 * Math.min(1, t / 150));
    const cy = dogRect.y - r - 10 * ui - bounce;
    ctx.save();
    ctx.fillStyle = '#e53935';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(3, 4 * ui);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.round(r * 1.5)}px Impact, 'Arial Black', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', cx, cy + 2 * ui);
    ctx.restore();
  }

  drawTitle(ctx) {
    const { w, h, t, ui } = this;
    const p = clamp01((t - (CARRY_END - 300)) / 500); // bars/dim ease in just before Bruno exits
    const barH = h * 0.13 * easeOutCubic(p);

    ctx.save();
    ctx.fillStyle = `rgba(10,0,20,${0.62 * p})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, barH);
    ctx.fillRect(0, h - barH, w, barH);

    const tp = clamp01((t - CARRY_END) / 420);
    if (tp > 0) {
      const scale = lerp(3.2, 1, easeOutBack(tp));
      const jitter = tp < 1 ? (Math.random() - 0.5) * 6 * ui : 0;
      ctx.translate(w / 2 + jitter, h * 0.46 + jitter);
      ctx.scale(scale, scale);
      ctx.globalAlpha = clamp01(tp * 2.5);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fs = Math.round(Math.min(110 * ui, w * 0.12));
      ctx.font = `900 ${fs}px Impact, 'Arial Black', sans-serif`;
      ctx.lineJoin = 'round';
      // red glow, black outline, hot gradient fill
      ctx.shadowColor = '#ff1a1a';
      ctx.shadowBlur = 30 * ui;
      ctx.lineWidth = Math.max(6, 14 * ui);
      ctx.strokeStyle = '#1a0008';
      ctx.strokeText('BOSS BATTLE!', 0, 0);
      ctx.shadowBlur = 0;
      const grad = ctx.createLinearGradient(0, -fs / 2, 0, fs / 2);
      grad.addColorStop(0, '#fff59d');
      grad.addColorStop(0.5, '#ffb300');
      grad.addColorStop(1, '#e53935');
      ctx.fillStyle = grad;
      ctx.fillText('BOSS BATTLE!', 0, 0);
    }
    ctx.restore();

    // Subtitle fades in after the title lands.
    const sp = clamp01((t - CARRY_END - 380) / 350);
    if (sp > 0) {
      ctx.save();
      ctx.globalAlpha = sp;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(26 * ui)}px Arial`;
      ctx.lineWidth = Math.max(3, 5 * ui);
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      const line = `${BOSS_NAME} has captured ${CHARACTER_NAMES.DOG}!`;
      ctx.strokeText(line, w / 2, h * 0.46 + Math.min(110 * ui, w * 0.12) * 0.75);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line, w / 2, h * 0.46 + Math.min(110 * ui, w * 0.12) * 0.75);
      ctx.restore();
    }
  }
}
