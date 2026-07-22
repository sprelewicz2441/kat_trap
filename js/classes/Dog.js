export default class Dog {
  constructor(x, y, canvasWidth, canvasHeight, escapes = [], boundaries = [], playSoundCallback) {
    this.x = x;
    this.y = y;
    this.size = 50; // Match height of the sprite
    this.speed = 20; // Movement speed
    this.moveInterval = 2000; // Move every 2 seconds
    this.lastMoveTime = 0;

    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    
    this.escapes = escapes;
    this.boundaries = boundaries; 

    this.spriteSheet = new Image();
    this.spriteSheet.src = './assets/dog_medium.png';

    this.frameWidth = 60; // Each frame width
    this.frameHeight = 38; // Each frame height
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
        const WALL_OFFSET = 40;
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

  isColliding(entity) {
    if (!entity) return false; // Prevents crash if entity is undefined
    return (
      this.x < entity.x + entity.size &&
      this.x + this.frameWidth > entity.x &&
      this.y < entity.y + entity.size &&
      this.y + this.frameHeight > entity.y
    );
  }

  draw(ctx) {
    const sx = this.column * this.frameWidth; // Use column 2 (index 1)
    const sy = this.currentFrame * this.frameHeight; // Move vertically through rows

    ctx.drawImage(
      this.spriteSheet,
      sx, sy, this.frameWidth, this.frameHeight, // Source rectangle
      this.x, this.y, this.frameWidth, this.frameHeight // Destination rectangle
    );
  }

  cleanup() {
    if (this.barkTimeoutId) {
      clearTimeout(this.barkTimeoutId);
      this.barkTimeoutId = null;
    }
  }
}
