export default class Cat {
  // `scale` (see js/utils/scale.js) shrinks size/speed/on-screen dimensions
  // together on a small canvas, keeping the cat's proportion of the board
  // constant. frameWidth/frameHeight stay at their native sprite-sheet
  // pixel values below — they're used to slice the *source* image, which
  // has a fixed pixel size regardless of display scale; only the drawn
  // destination size and movement figures scale.
  constructor(x, y, canvasWidth, canvasHeight, scale = 1) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.originalWidth = 118;
    this.originalHeight = 153;
    this.size = (this.originalWidth / 3) * scale;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    // Sprite sheet details
    this.spriteSheet = new Image();
    this.spriteSheet.src = './assets/cat.png';
    this.frameWidth = 118; // Native frame width — for source-rect slicing only
    this.frameHeight = 150; // Native frame height — for source-rect slicing only
    this.totalFrames = 6;
    this.currentFrame = 0;
    this.frameSpeed = 10;
    this.frameCounter = 0;

    // Movement properties
    this.speed = 10 * scale; // Movement speed
  }

  // The actual on-screen size (see draw()) — GameScreen uses this instead
  // of re-deriving frameWidth/4*scale itself.
  get displayWidth() {
    return (this.frameWidth / 4) * this.scale;
  }

  get displayHeight() {
    return (this.frameHeight / 4) * this.scale;
  }

  move(direction) {
    const scaledHeight = this.displayHeight; // Scaled height for collision detection
    const scaledWidth = this.displayWidth;  // Scaled width for collision detection

    if (direction === 'up' && this.y >= this.speed) {
      this.y -= this.speed;
    }
    if (direction === 'down' && this.y + scaledHeight <= this.canvasHeight - this.speed) {
      this.y += this.speed;
    }
    if (direction === 'left' && this.x >= this.speed) {
      this.x -= this.speed;
    }
    if (direction === 'right' && this.x + scaledWidth <= this.canvasWidth - this.speed) {
      this.x += this.speed;
    }
  }


  update() {
    // Update animation
    this.updateAnimations();
  }

  updateAnimations() {
    this.frameCounter++;
    if (this.frameCounter >= this.frameSpeed) {
      this.currentFrame = (this.currentFrame + 1) % this.totalFrames;
      this.frameCounter = 0;
    }
  }

  draw(ctx) {
    const sx = 0; // Since all frames are in a single column
    const sy = this.currentFrame * this.frameHeight; // Native frameHeight — indexes the source sheet

    ctx.drawImage(
      this.spriteSheet,
      sx, sy, this.frameWidth, this.frameHeight, // Native source rectangle
      this.x, this.y, this.displayWidth, this.displayHeight // Scaled destination rectangle
    );
  }
}
