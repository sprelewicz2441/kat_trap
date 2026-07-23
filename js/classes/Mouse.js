export default class Mouse {
  // `scale` (see js/utils/scale.js) shrinks size/speed together on a small
  // canvas. frameWidth/frameHeight stay native (used only to slice the
  // source sheet); this.size is the scaled on-screen/collision size.
  constructor(x, y, canvasWidth, canvasHeight, scale = 1) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.size = 32 * scale; // Match in-game size to sprite size
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.speedX = (Math.random() * 2 + 1) * scale * (Math.random() < 1.0 ? 1 : -1);
    this.speedY = (Math.random() * 2 + 1) * scale * (Math.random() < 1.0 ? 1 : -1);

    // Sprite sheet
    this.spriteSheet = new Image();
    this.spriteSheet.src = './assets/mouse.png';
    this.frameWidth = 32;
    this.frameHeight = 32;
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
  }

  setWallHitCallback(callback) {
    this.wallHitCallback = callback; // Allow GameScreen to set the callback
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
    }
    if (this.y <= 0 || this.y + this.size >= this.canvasHeight) {
      this.speedY *= -1;
      this.y = Math.max(0, Math.min(this.y, this.canvasHeight - this.size));
      if (this.wallHitCallback) this.wallHitCallback();
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
