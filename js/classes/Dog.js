import { aabbOverlap } from '../utils/collision.js';

export default class Dog {
  // `scale` (see js/utils/scale.js) shrinks size/speed/on-screen dimensions
  // together on a small canvas. nativeFrameWidth/nativeFrameHeight are the
  // sprite sheet's real pixel dimensions — used only to slice the *source*
  // image; frameWidth/frameHeight are the scaled on-screen size, used for
  // both drawing and collision (isColliding() below).
  constructor(x, y, canvasWidth, canvasHeight, escapes = [], boundaries = [], playSoundCallback, scale = 1) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.size = 50 * scale; // Match height of the sprite
    this.speed = 20 * scale; // Movement speed
    this.wallOffset = 40 * scale; // How close the dog can get to the board edge
    this.moveInterval = 2000; // Move every 2 seconds
    this.lastMoveTime = 0;

    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    this.escapes = escapes;
    this.boundaries = boundaries;

    this.spriteSheet = new Image();
    this.spriteSheet.src = './assets/dog_medium.png';

    this.nativeFrameWidth = 60; // Native frame width — for source-rect slicing only
    this.nativeFrameHeight = 38; // Native frame height — for source-rect slicing only
    this.frameWidth = this.nativeFrameWidth * scale; // On-screen width — draw + collision
    this.frameHeight = this.nativeFrameHeight * scale; // On-screen height — draw + collision
    this.rows = 6; // Total rows
    this.currentFrame = 0;
    this.frameSpeed = 20; // Speed of animation
    this.frameCounter = 0;

    this.column = 1; // Fixed column for the animation

    this.playSound = playSoundCallback; 
    this.barkTimeoutId = null;

    //We want more control over the bark action, not to call it on construction. Commenting out for now.
    //this.setNextBark();
  }

  setNextBark() {
    const randomDelay = Math.random() * 9000 + 1000;
    this.barkTimeoutId = setTimeout(() => {
      if (this.playSound) {
        this.playSound('dogBark');
      }
      this.setNextBark();
    }, randomDelay);
  }

  update(timestamp, cat, onCatCollision) {
    if (timestamp - this.lastMoveTime >= this.moveInterval) {
        this.lastMoveTime = timestamp;

        const direction = Math.floor(Math.random() * 4);
        let proposedX = this.x;
        let proposedY = this.y;

        if (direction === 0) proposedY -= this.speed; // Up
        if (direction === 1) proposedY += this.speed; // Down
        if (direction === 2) proposedX -= this.speed; // Left
        if (direction === 3) proposedX += this.speed; // Right

        // ✅ Check if the dog is on an escape
        const isOnEscape = this.escapes.some(escape => escape.isMouseInside(this));

        // ✅ Ensure dog does not pass through boundaries
        const WALL_OFFSET = this.wallOffset;
        const insideWalls = (
            proposedX >= WALL_OFFSET - this.size &&
            proposedX <= this.canvasWidth - WALL_OFFSET &&
            proposedY >= WALL_OFFSET - this.size &&
            proposedY <= this.canvasHeight - WALL_OFFSET
        );

        if ((insideWalls || isOnEscape) && 
            !this.boundaries.some(boundary => boundary.isColliding({ x: proposedX, y: proposedY, size: this.size }))) {
            this.x = proposedX;
            this.y = proposedY;
        }
    }

    if (this.isColliding(cat)) {
        onCatCollision();
    }
    this.updateAnimation();
  }

  updateAnimation() {
    this.frameCounter++;
    if (this.frameCounter >= this.frameSpeed) {
      this.currentFrame = (this.currentFrame + 1) % this.rows; // Loop through rows
      this.frameCounter = 0;
    }
  }

  // frameWidth/frameHeight are already the scaled on-screen size (see
  // constructor) — these just give Cutscene.js a name it can read the same
  // way across Cat/Dog/Mouse regardless of what each class calls its own
  // internal fields.
  get displayWidth() {
    return this.frameWidth;
  }

  get displayHeight() {
    return this.frameHeight;
  }

  isColliding(entity) {
    if (!entity) return false; // Prevents crash if entity is undefined
    return aabbOverlap(
      this.x, this.y, this.frameWidth, this.frameHeight,
      entity.x, entity.y, entity.size, entity.size
    );
  }

  draw(ctx) {
    const sx = this.column * this.nativeFrameWidth; // Use column 2 (index 1)
    const sy = this.currentFrame * this.nativeFrameHeight; // Move vertically through rows

    ctx.drawImage(
      this.spriteSheet,
      sx, sy, this.nativeFrameWidth, this.nativeFrameHeight, // Native source rectangle
      this.x, this.y, this.frameWidth, this.frameHeight // Scaled destination rectangle
    );
  }

  cleanup() {
    if (this.barkTimeoutId) {
      clearTimeout(this.barkTimeoutId);
      this.barkTimeoutId = null;
    }
  }
}
