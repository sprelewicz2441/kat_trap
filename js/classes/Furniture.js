import { aabbOverlap } from '../utils/collision.js';

// Knock-over fall animation (see startKnockOver()/draw() below) — an
// ease-out rotation to a resting tipped-over angle, not a full 90°
// (a plant landing perfectly flat reads as a broken transform snapping to
// an exact right angle; landing a bit short of that reads more like it
// actually toppled and settled against the floor/its own pot).
const KNOCK_OVER_DURATION = 350; // ms
const KNOCK_OVER_ANGLE = (75 * Math.PI) / 180; // radians

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
  }

  // Always (re)starts the fall from upright, even if one is already in
  // progress or already settled — see the comment above on why this is
  // deliberately replayable rather than a one-shot.
  startKnockOver(timestamp) {
    this.knockedOver = true;
    this.knockStartTime = timestamp;
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

    // Apply rotation
    if (this.rotation !== 0 || knockOverRotation !== 0) {
      ctx.translate(centerX, centerY);
      ctx.rotate((this.rotation * Math.PI) / 180 + knockOverRotation);
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
      ctx.imageSmoothingEnabled = false;
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