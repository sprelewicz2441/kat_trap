import { aabbOverlap } from '../utils/collision.js';

// Knock-over fall animation (see startKnockOver()/draw() below) — an
// ease-out rotation to a resting tipped-over angle, not a full 90°
// (a plant landing perfectly flat reads as a broken transform snapping to
// an exact right angle; landing a bit short of that reads more like it
// actually toppled and settled against the floor/its own pot).
const KNOCK_OVER_DURATION = 350; // ms
const KNOCK_OVER_ANGLE = (75 * Math.PI) / 180; // radians

// Shake reaction (see startShake()/draw() below) — a small decaying
// oscillation rather than a fall, for furniture that's passable but
// should still visibly react to being brushed past (currently only the
// table — see GameScreen's updateTableBump()). SHAKE_MAX_ANGLE is
// deliberately small (a real tip-over already exists for the plant, this
// is a rattle, not a topple) and the sine wave decays to 0 by
// SHAKE_DURATION so it always settles back to resting rather than ending
// mid-wobble.
const SHAKE_DURATION = 400; // ms
const SHAKE_MAX_ANGLE = (5 * Math.PI) / 180; // radians
const SHAKE_CYCLES = 3; // back-and-forth oscillations over the full duration

export default class Furniture {
  // Defaults match the Reakain "Kitchen Assets" appliance/counter sprites
  // (32x64 native). Table/chair sprites come from a different pack with
  // different native sizes, so callers pass their own spriteWidth/
  // spriteHeight/scale for those instead of relying on the defaults.
  // cropX/cropY: offset within the source image to start reading from.
  // Several kitchen renders have a few pixels of transparent padding baked
  // into the file around the actual content, which — since spriteWidth/
  // spriteHeight (and therefore the collision box) are meant to describe
  // just the visible object — would otherwise leave a visible gap between
  // two modules placed edge-to-edge. Passing the content's real offset
  // here (rather than 0,0) makes the drawn sprite match the content-only
  // spriteWidth/spriteHeight exactly. Defaults to 0 so callers that don't
  // need cropping (or a sprite with no padding) are unaffected.
  constructor(x, y, type, spriteSrc, rotation = 0, spriteWidth = 32, spriteHeight = 64, scale = 1.5, cropX = 0, cropY = 0) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.rotation = rotation; // 0, 90, 180, 270 degrees

    this.spriteWidth = spriteWidth;
    this.spriteHeight = spriteHeight;
    this.scale = scale;
    this.cropX = cropX;
    this.cropY = cropY;
    
    // Actual dimensions depend on rotation
    if (rotation === 90 || rotation === 270) {
      this.width = this.spriteHeight * this.scale;
      this.height = this.spriteWidth * this.scale;
    } else {
      this.width = this.spriteWidth * this.scale;
      this.height = this.spriteHeight * this.scale;
    }
    
    // Load sprite
    this.sprite = new Image();
    this.sprite.src = spriteSrc;
    
    // Placement type
    this.isWallItem = ['fridge', 'stove', 'sink', 'counter'].includes(type);

    // Knock-over reaction (currently only ever triggered for 'plant' — see
    // GameScreen's updatePlantBump()) — replayable, not a one-shot: every
    // fresh bump (see updatePlantBump()'s own edge-detection, which is what
    // stops a single continuous touch from restarting this every frame)
    // restarts the fall from upright, so the plant visibly wobbles/re-tips
    // each time the cat or dog runs into it rather than only reacting once
    // per round. Kept as plain instance state on Furniture itself (not a
    // separate tracking object) since `draw()` is what actually needs to
    // read it every frame.
    this.knockedOver = false;
    this.knockStartTime = null;

    // Shake reaction (currently only ever triggered for 'table' — see
    // GameScreen's updateTableBump()) — same "replayable, not a one-shot"
    // precedent as knockedOver above: every fresh bump restarts the
    // wobble from the beginning. Unlike knockedOver (a permanent tipped-
    // over pose), the shake itself always decays back to 0 by the end of
    // SHAKE_DURATION (see draw()), so replaying it just means a fresh
    // wobble-and-settle, not an accumulating tilt.
    this.shaking = false;
    this.shakeStartTime = null;
  }

  // Always (re)starts the fall from upright, even if one is already in
  // progress or already settled — see the comment above on why this is
  // deliberately replayable rather than a one-shot.
  startKnockOver(timestamp) {
    this.knockedOver = true;
    this.knockStartTime = timestamp;
  }

  // Always (re)starts the wobble from the beginning, even if one is
  // already in progress — same reasoning as startKnockOver() above.
  startShake(timestamp) {
    this.shaking = true;
    this.shakeStartTime = timestamp;
  }

  draw(ctx) {
    ctx.save();

    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;

    // Knock-over fall — an ease-out rotation added on top of this piece's
    // own base `rotation` (which stays 0 for a freestanding piece like the
    // plant; this is purely additive so it doesn't interfere with a
    // wall-module's own rotation if this were ever used on one of those).
    let knockOverRotation = 0;
    if (this.knockedOver) {
      const elapsed = performance.now() - this.knockStartTime;
      const t = Math.min(1, elapsed / KNOCK_OVER_DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      knockOverRotation = eased * KNOCK_OVER_ANGLE;
    }

    // Shake — a small decaying oscillation, also additive on top of this
    // piece's own base `rotation`, so a table rattles in place rather
    // than tipping over. Decays linearly to 0 by SHAKE_DURATION (rather
    // than a hard cutoff), so it always reads as settling down, never
    // stopping mid-wobble.
    let shakeRotation = 0;
    if (this.shaking) {
      const elapsed = performance.now() - this.shakeStartTime;
      const t = Math.min(1, elapsed / SHAKE_DURATION);
      const decay = 1 - t;
      shakeRotation = Math.sin(t * Math.PI * 2 * SHAKE_CYCLES) * SHAKE_MAX_ANGLE * decay;
    }

    // Apply rotation
    if (this.rotation !== 0 || knockOverRotation !== 0 || shakeRotation !== 0) {
      ctx.translate(centerX, centerY);
      ctx.rotate((this.rotation * Math.PI) / 180 + knockOverRotation + shakeRotation);
      ctx.translate(-centerX, -centerY);
    }

    // Draw the sprite at its native (unrotated) size, centered on the same
    // pivot the rotation transform uses, so the rendered sprite lines up
    // with the rotated collision box (this.width/this.height).
    const drawWidth = this.spriteWidth * this.scale;
    const drawHeight = this.spriteHeight * this.scale;
    const drawX = centerX - drawWidth / 2;
    const drawY = centerY - drawHeight / 2;

    // Draw sprite if loaded, otherwise draw placeholder
    if (this.sprite.complete) {
      // `imageSmoothingEnabled = false` used to sit here as a leftover from
      // when kitchen sprites were small pixel art needing crisp nearest-
      // neighbor scaling (see CLAUDE.md) — but every current kitchen_*.webp
      // is a large photorealistic render (roughly 1000-1500px) drawn at a
      // much smaller on-screen size (drawWidth/drawHeight above), i.e. a
      // downscale, not an upscale. Nearest-neighbor downscaling drops most
      // of the source detail and looks aliased/gritty rather than crisp —
      // confirmed live as visibly lower quality than the source renders
      // themselves. There's also no adjacent-frame sprite-sheet content to
      // protect against here (unlike Cat.js/Dog.js) — each of these is its
      // own standalone image file, so there was never actually a bleed risk
      // this was guarding against. Left at the canvas default (smoothing
      // on) instead, which downsamples cleanly.
      ctx.drawImage(
        this.sprite,
        this.cropX, this.cropY, this.spriteWidth, this.spriteHeight,
        drawX, drawY,
        drawWidth, drawHeight
      );
    } else {
      // Placeholder while loading
      ctx.fillStyle = this.getPlaceholderColor();
      ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
      ctx.strokeStyle = 'black';
      ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);
    }

    ctx.restore();
  }

  getPlaceholderColor() {
    const colors = {
      fridge: '#E0E0E0',
      stove: '#505050',
      sink: '#87CEEB',
      table: '#8B4513',
      island: '#D2691E',
      counter: '#A0A0A0',
      chair: '#B5651D'
    };
    return colors[this.type] || '#CCCCCC';
  }

  isColliding(entity) {
    return aabbOverlap(
      entity.x, entity.y, entity.size, entity.size,
      this.x, this.y, this.width, this.height
    );
  }
}