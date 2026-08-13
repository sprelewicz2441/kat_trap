export default class Mouse {
  // `scale` (see js/utils/scale.js) shrinks movement speed on a small
  // canvas. `sizeScale` (getCharacterScale() — defaults to `scale` if not
  // given) separately controls this.size, the on-screen/collision size —
  // kept apart from `scale` so a desktop size boost doesn't also speed the
  // mouse's wander velocity up (see DESKTOP_CHARACTER_SIZE_MULTIPLIER in
  // scale.js). frameWidth/frameHeight stay native (used only to slice the
  // source sheet).
  constructor(x, y, canvasWidth, canvasHeight, scale = 1, sizeScale = scale) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.size = 32 * sizeScale; // Match in-game size to sprite size
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.speedX = (Math.random() * 2 + 1) * scale * (Math.random() < 0.5 ? 1 : -1);
    this.speedY = (Math.random() * 2 + 1) * scale * (Math.random() < 0.5 ? 1 : -1);

    // Sprite sheet
    this.spriteSheet = new Image();
    // mouse_v2.png — Disneyfied redraw, same 3-col x 4-row grid (walk-cycle
    // frames x facing direction) and same all-fours top-down poses as v1's
    // mouse.png, just at native (327x327/frame) resolution instead of v1's
    // 32x32 — frameWidth/frameHeight below are native source-slicing size
    // only; this.size (on-screen/collision size, above) is untouched so
    // gameplay feel doesn't change. v1 stays on disk, unreferenced.
    this.spriteSheet.src = './assets/mouse_v2.png?v=1';
    this.frameWidth = 327;
    this.frameHeight = 327;
    this.currentFrame = 0;
    this.totalFrames = 12; // 3 frames per direction, 4 directions
    this.frameSpeed = 10; // Adjust for smoother animation
    this.frameCounter = 0;

    // Current animation state
    this.currentDirection = 'south'; // Default starting direction
    this.animations = {
      north: [0, 1, 2],
      east: [3, 4, 5],
      south: [6, 7, 8],
      west: [9, 10, 11],
    };
    this.wallHitCallback = null;
    // Separate from wallHitCallback (sound only) — this fires only from
    // this.update()'s own autonomous bounce below, not from GameScreen's
    // player-controlled path, per GameScreen.movePlayerMouse()'s own
    // comment for why the two need to trigger the escape check
    // differently.
    this.escapeCheckCallback = null;
  }

  setWallHitCallback(callback) {
    this.wallHitCallback = callback; // Allow GameScreen to set the callback
  }

  setEscapeCheckCallback(callback) {
    this.escapeCheckCallback = callback;
  }

  // this.size is already the scaled on-screen size (see constructor) — this
  // just gives Cutscene.js a name it can read the same way across
  // Cat/Dog/Mouse regardless of what each class calls its own internal
  // fields.
  get displayWidth() {
    return this.size;
  }

  get displayHeight() {
    return this.size;
  }

  update() {
    // Randomize movement
    if (Math.random() < 0.03) {
      this.speedX = (Math.random() * 2 + 1) * this.scale * (Math.random() < 0.5 ? 1 : -1);
      this.speedY = (Math.random() * 2 + 1) * this.scale * (Math.random() < 0.5 ? 1 : -1);
    }

    // Move the mouse
    this.x += this.speedX;
    this.y += this.speedY;

    // Bounce off walls
    if (this.x <= 0 || this.x + this.size >= this.canvasWidth) {
      this.speedX *= -1;
      this.x = Math.max(0, Math.min(this.x, this.canvasWidth - this.size));
      if (this.wallHitCallback) this.wallHitCallback();
      if (this.escapeCheckCallback) this.escapeCheckCallback();
    }
    if (this.y <= 0 || this.y + this.size >= this.canvasHeight) {
      this.speedY *= -1;
      this.y = Math.max(0, Math.min(this.y, this.canvasHeight - this.size));
      if (this.wallHitCallback) this.wallHitCallback();
      if (this.escapeCheckCallback) this.escapeCheckCallback();
    }

    // Face whichever way it's actually heading (post-bounce, so a wall hit
    // updates the facing the same tick it turns around) — previously only
    // set from player input in Mouse-controlled mode, so the autonomous
    // mouse stayed visually stuck facing 'south' (its construction default)
    // for the whole game regardless of which way it was really moving.
    // Dominant-axis pick, same idea as GameScreen's moveCatTowardMouse().
    if (Math.abs(this.speedX) >= Math.abs(this.speedY)) {
      this.currentDirection = this.speedX > 0 ? 'east' : 'west';
    } else {
      this.currentDirection = this.speedY > 0 ? 'south' : 'north';
    }

    // Update animation
    this.updateAnimations();
  }

  updateAnimations() {
    this.frameCounter++;
    if (this.frameCounter >= this.frameSpeed) {
      const frames = this.animations[this.currentDirection];
      this.currentFrame = (this.currentFrame + 1) % frames.length;
      this.frameCounter = 0;
    }
  }

  draw(ctx) {
    const frameIndex = this.animations[this.currentDirection][this.currentFrame];
    const sx = (frameIndex % 3) * this.frameWidth; // Assuming 3 frames per row
    const sy = Math.floor(frameIndex / 3) * this.frameHeight;

    ctx.drawImage(
      this.spriteSheet,
      sx, sy, this.frameWidth, this.frameHeight, // Source frame
      this.x, this.y, this.size, this.size // Destination
    );
  }
}
