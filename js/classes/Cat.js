// cat.png is a symmetric, front-facing portrait (confirmed by looking at
// the actual pixel art — matching ears/whiskers, centered face), not a
// directional side-view sprite like Dog.js's — there's no left/right art to
// flip and no up/down art to swap to, so facingDirection can't be shown the
// way Dog/Mouse show theirs. Cat.applyDirectionalTransform() below applies
// a small rotation leaning into the turn for left/right, and a small
// vertical stretch/squash for up/down (taller reaching "up", shorter
// settling "down") instead — a cheap code-only directional cue rather than
// commissioning new art. Kept deliberately small since a literal 90-degree
// rotation of a round mascot head reads as broken, not directional.
const TILT_ANGLE = 0.14; // radians, ~8 degrees
const STRETCH_AMOUNT = 0.08; // 8% taller/shorter

export default class Cat {
  // `scale` (see js/utils/scale.js) shrinks speed on a small canvas.
  // `sizeScale` (getCharacterScale() — defaults to `scale` if not given)
  // separately controls on-screen/collision size: kept apart from `scale`
  // so a desktop size boost doesn't also speed the cat up (see
  // DESKTOP_CHARACTER_SIZE_MULTIPLIER in scale.js). frameWidth/frameHeight
  // stay at their native sprite-sheet pixel values below — they're used to
  // slice the *source* image, which has a fixed pixel size regardless of
  // display scale; only the drawn destination size and movement figures
  // scale.
  constructor(x, y, canvasWidth, canvasHeight, scale = 1, sizeScale = scale) {
    this.x = x;
    this.y = y;
    this.sizeScale = sizeScale;
    this.originalWidth = 118;
    this.originalHeight = 153;
    this.size = (this.originalWidth / 3) * sizeScale;
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

    // Last committed movement direction — persisted so the Mouse-controlled
    // mode's cat AI can test line-of-sight against it (see
    // GameScreen.catHasLineOfSightToMouse()). Unused when the player
    // controls the cat directly, but harmless to always track.
    this.facingDirection = 'down';
    // True once move() has actually been called at least once — lets
    // applyDirectionalTransform() (see below) skip the tilt/stretch until
    // the cat has really moved, rather than applying it based on the
    // arbitrary 'down' default above. Matters for Cutscene.js's cat
    // preview, which constructs a Cat purely to animate/display it and
    // never calls move() — without this it would render permanently
    // squashed (the 'down' stretch) for the entire cutscene, a visible
    // regression from before this transform existed.
    this.hasMoved = false;
  }

  // The actual on-screen size (see draw()) — GameScreen uses this instead
  // of re-deriving frameWidth/4*sizeScale itself.
  get displayWidth() {
    return (this.frameWidth / 4) * this.sizeScale;
  }

  get displayHeight() {
    return (this.frameHeight / 4) * this.sizeScale;
  }

  // `speed` defaults to the cat's own speed, but GameScreen's tryMoveCat()
  // can pass a different value (e.g. the AI's wander speed) — it must match
  // whatever distance was used to validate the move, or the validated and
  // applied positions diverge.
  move(direction, speed = this.speed) {
    this.facingDirection = direction;
    this.hasMoved = true;

    const scaledHeight = this.displayHeight; // Scaled height for collision detection
    const scaledWidth = this.displayWidth;  // Scaled width for collision detection

    if (direction === 'up' && this.y >= speed) {
      this.y -= speed;
    }
    if (direction === 'down' && this.y + scaledHeight <= this.canvasHeight - speed) {
      this.y += speed;
    }
    if (direction === 'left' && this.x >= speed) {
      this.x -= speed;
    }
    if (direction === 'right' && this.x + scaledWidth <= this.canvasWidth - speed) {
      this.x += speed;
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

  // Exposed as its own method (rather than inlined in draw()) so
  // GameScreen's drawRedOutline() (the catPaused ring effect) can apply the
  // identical rotation/stretch to its silhouette and stay visually aligned
  // with the actual sprite, instead of drawing an axis-aligned outline
  // under a now-tilted cat. Caller is responsible for having already
  // translated to the cat's center — this only rotates/scales around
  // whatever the current transform origin is.
  applyDirectionalTransform(ctx) {
    if (!this.hasMoved) return;
    if (this.facingDirection === 'left') ctx.rotate(-TILT_ANGLE);
    else if (this.facingDirection === 'right') ctx.rotate(TILT_ANGLE);
    else if (this.facingDirection === 'up') ctx.scale(1, 1 + STRETCH_AMOUNT);
    else if (this.facingDirection === 'down') ctx.scale(1, 1 - STRETCH_AMOUNT);
  }

  draw(ctx) {
    const sx = 0; // Since all frames are in a single column
    const sy = this.currentFrame * this.frameHeight; // Native frameHeight — indexes the source sheet
    const width = this.displayWidth;
    const height = this.displayHeight;

    ctx.save();
    ctx.translate(this.x + width / 2, this.y + height / 2);
    this.applyDirectionalTransform(ctx);

    ctx.drawImage(
      this.spriteSheet,
      sx, sy, this.frameWidth, this.frameHeight, // Native source rectangle
      -width / 2, -height / 2, width, height // Centered, scaled destination rectangle
    );
    ctx.restore();
  }
}
