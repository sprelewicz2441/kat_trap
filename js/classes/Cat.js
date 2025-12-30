export default class Cat {
  constructor(x, y, canvasWidth, canvasHeight) {
    this.x = x;
    this.y = y;
    this.originalWidth = 118;
    this.originalHeight = 153;
    this.size = this.originalWidth / 3;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    // Sprite sheet details
    this.spriteSheet = new Image();
    this.spriteSheet.src = './assets/cat.png';
    this.frameWidth = 118; // Original frame width
    this.frameHeight = 150; // Original frame height
    this.totalFrames = 6;
    this.currentFrame = 0;
    this.frameSpeed = 10;
    this.frameCounter = 0;

    // Movement properties
    this.speed = 10; // Movement speed
  }

  move(direction) {
    const scaledHeight = this.frameHeight / 4; // Scaled height for collision detection
    const scaledWidth = this.frameWidth / 4;  // Scaled width for collision detection

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
    const sy = this.currentFrame * this.frameHeight;

    // Scale the destination to half size
    const scaledWidth = this.frameWidth / 4;
    const scaledHeight = this.frameHeight / 4;

    ctx.drawImage(
      this.spriteSheet,
      sx, sy, this.frameWidth, this.frameHeight, // Source rectangle
      this.x, this.y, scaledWidth, scaledHeight // Scaled destination rectangle
    );
  }
}
