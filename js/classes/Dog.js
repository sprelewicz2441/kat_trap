import { aabbOverlap } from '../utils/collision.js';

export default class Dog {
  // `scale` (see js/utils/scale.js) shrinks speed/wallOffset on a small
  // canvas. `sizeScale` (getCharacterScale() — defaults to `scale` if not
  // given) separately controls size/frameWidth/frameHeight — kept apart
  // from `scale` so a desktop size boost doesn't also speed the dog up
  // (see DESKTOP_CHARACTER_SIZE_MULTIPLIER in scale.js). wallOffset stays
  // tied to `scale`, not sizeScale — it's a board-margin concept (how close
  // to the canvas edge is allowed), not a function of how big the dog looks.
  // nativeFrameWidth/nativeFrameHeight are the sprite sheet's real pixel
  // dimensions — used only to slice the *source* image; frameWidth/
  // frameHeight are the scaled on-screen size, used for both drawing and
  // collision (isColliding() below).
  constructor(x, y, canvasWidth, canvasHeight, escapes = [], boundaries = [], playSoundCallback, scale = 1, sizeScale = scale) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.size = 50 * sizeScale; // Match height of the sprite
    // Autonomous-wander speed only — GameScreen.tryMoveDog() (the player-
    // controlled Dog-mode path) uses its own layout.dogPlayerSpeed instead,
    // deliberately matched to Cat/Mouse's own player speed so all three
    // characters feel the same to actually pilot; this.speed is free to be
    // tuned purely for how fast the *autonomous* dog should feel as a
    // hazard, with no fairness constraint pulling it toward a player-
    // control-friendly value. Previously the same field served both roles,
    // which meant it could never be both "not too fast to pilot" and "not
    // too slow as a wandering hazard" at once — confirmed live as the
    // actual complaint, not two independent bugs.
    //
    // Derived from the *original* discrete-hop system's effective speed,
    // not picked by eye — the original moved 20*scale px every 2000ms (a
    // 10*scale px/sec average), and the ask was "twice as fast as it used
    // to be", i.e. 20*scale px/sec. Continuous movement (see below) ticks
    // ~60x/sec, so hitting that target per-tick means dividing by 60, not
    // picking a value that merely looks reasonable next to Cat's own
    // per-tick speed the way an earlier pass here did (8*scale/tick, which
    // is ~480*scale px/sec — nearly 50x the old effective speed, hence
    // "wayyyy too fast"). The jump from "once every 2 seconds" to "every
    // tick" is roughly a 120x multiplier all on its own, so almost any
    // per-tick value in a player-speed-like range was always going to feel
    // wildly faster than the dog used to be, regardless of which one.
    this.speed = (20 / 60) * scale;
    this.wallOffset = 40 * scale; // How close the dog can get to the board edge
    // Continuous per-tick wander, re-picking direction on an interval or
    // immediately on a blocked move — same pattern Cat's own wanderCat()
    // already uses (see GameScreen.js), adopted here for the same reason it
    // was adopted there: a hop once every couple of seconds (the previous
    // moveInterval-based design) reads as the dog freezing then teleporting,
    // not as "moving," regardless of how large a single hop's distance is.
    this.wanderDirection = null;
    this.wanderDirectionChangeInterval = 1500; // ms — a bit lazier than the cat's own 1200ms CAT_WANDER_DIRECTION_INTERVAL, fitting "Dummy the dumb dog"
    this.lastWanderDirectionChange = 0;

    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    this.escapes = escapes;
    this.boundaries = boundaries;

    this.spriteSheet = new Image();
    this.spriteSheet.src = './assets/dog_medium.png';

    this.nativeFrameWidth = 60; // Native frame width — for source-rect slicing only
    this.nativeFrameHeight = 38; // Native frame height — for source-rect slicing only
    this.frameWidth = this.nativeFrameWidth * sizeScale; // On-screen width — draw + collision
    this.frameHeight = this.nativeFrameHeight * sizeScale; // On-screen height — draw + collision
    this.rows = 6; // Total rows
    this.currentFrame = 0;
    this.frameSpeed = 20; // Speed of animation
    this.frameCounter = 0;

    this.column = 1; // Fixed column for the animation

    // dog_medium.png only has leftward-facing frames (confirmed by slicing
    // the sheet into its 6x6 grid and inspecting individual cells — the
    // head/nose is on the left, tail trailing right, in every populated
    // cell; each column is a different gait/pose, not a different facing
    // direction), so there's no "right-facing" source art to switch to.
    // Flipping the leftward frame horizontally (see draw()) when moving
    // right is the actual fix for the dog visibly moving right while its
    // sprite still faced left. Starts true (native orientation, no flip)
    // and is only updated on an actual left/right move (see update()) —
    // vertical-only motion keeps whichever way it was last actually facing,
    // the common convention for side-view sprites with no dedicated up/down
    // art.
    this.facingLeft = true;

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

  // This setTimeout-based schedule runs on real wall-clock time — nothing
  // about it was ever tied to GameScreen's own running/paused state, so a
  // bark could keep firing while the settings menu was open (gameplay
  // visibly paused underneath it) or bleed past the moment a round ended,
  // in both cases because nothing had ever told this loop to stop short of
  // the full teardown in cleanup() below. pauseBarking()/resumeBarking()
  // give GameScreen a way to actually pause this alongside the rest of the
  // game rather than only being able to cancel it for good.
  pauseBarking() {
    if (this.barkTimeoutId) {
      clearTimeout(this.barkTimeoutId);
      this.barkTimeoutId = null;
    }
  }

  // Picks a fresh random delay rather than trying to preserve exactly how
  // much of the paused interval had already elapsed — barks are an
  // ambient/decorative random-interval cue to begin with, so there's
  // nothing a player could notice about resuming "early" or "late".
  resumeBarking() {
    if (!this.barkTimeoutId) {
      this.setNextBark();
    }
  }

  // Shared by the autonomous wander below and available the same way
  // GameScreen.tryMoveDog() (the player-controlled path) makes its own
  // move attempts — kept as this.speed's own consumer rather than also
  // being reused by tryMoveDog() itself, since that path needs a
  // completely different (fairness-matched) speed value, not just a
  // different caller of the same movement math.
  tryMove(direction, speed) {
    let proposedX = this.x;
    let proposedY = this.y;

    if (direction === 'up') proposedY -= speed;
    if (direction === 'down') proposedY += speed;
    if (direction === 'left') proposedX -= speed;
    if (direction === 'right') proposedX += speed;

    const isOnEscape = this.escapes.some(escape => escape.isMouseInside(this));

    // Strict containment — see GameScreen.tryMoveDog()'s own copy of this
    // check for the full explanation of why the cat/mouse clamps' "position
    // can dip below WALL_OFFSET by up to size" convention isn't safe for
    // the dog specifically (frameWidth/frameHeight are larger than
    // WALL_OFFSET at any scale, unlike the cat's own oversized `size`).
    const WALL_OFFSET = this.wallOffset;
    const insideWalls = (
        proposedX >= WALL_OFFSET &&
        proposedX <= this.canvasWidth - WALL_OFFSET - this.frameWidth &&
        proposedY >= WALL_OFFSET &&
        proposedY <= this.canvasHeight - WALL_OFFSET - this.frameHeight
    );

    const canMove = (insideWalls || isOnEscape) &&
        !this.boundaries.some(boundary => boundary.isColliding({ x: proposedX, y: proposedY, size: this.size }));
    if (canMove) {
      this.x = proposedX;
      this.y = proposedY;
      // Only left/right actually change facing (see facingLeft above) —
      // only set on a move that actually happened, so a rejected step
      // (wall/furniture) doesn't flip the sprite for a move that never
      // occurred.
      if (direction === 'left') this.facingLeft = true;
      if (direction === 'right') this.facingLeft = false;
    }
    return canMove;
  }

  pickRandomDirection() {
    const directions = ['up', 'down', 'left', 'right'];
    return directions[Math.floor(Math.random() * directions.length)];
  }

  update(timestamp, cat, onCatCollision) {
    const directionExpired = !this.wanderDirection ||
        (timestamp - this.lastWanderDirectionChange >= this.wanderDirectionChangeInterval);
    if (directionExpired) {
      this.wanderDirection = this.pickRandomDirection();
      this.lastWanderDirectionChange = timestamp;
    }

    const moved = this.tryMove(this.wanderDirection, this.speed);
    if (!moved) {
      // Hit a wall/furniture — pick a new direction immediately rather than
      // waiting out the rest of the interval stuck in place (same reasoning
      // as Cat's own wanderCat()).
      this.wanderDirection = this.pickRandomDirection();
      this.lastWanderDirectionChange = timestamp;
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

    // The source art only faces left (see facingLeft above) — mirror the
    // draw itself when moving right rather than needing a second set of
    // frames. translate to the sprite's right edge first so scale(-1, 1)
    // flips it back over the same x/y position instead of off to one side.
    if (!this.facingLeft) {
      ctx.save();
      ctx.translate(this.x + this.frameWidth, this.y);
      ctx.scale(-1, 1);
      ctx.drawImage(
        this.spriteSheet,
        sx, sy, this.nativeFrameWidth, this.nativeFrameHeight,
        0, 0, this.frameWidth, this.frameHeight
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        this.spriteSheet,
        sx, sy, this.nativeFrameWidth, this.nativeFrameHeight, // Native source rectangle
        this.x, this.y, this.frameWidth, this.frameHeight // Scaled destination rectangle
      );
    }
  }

  cleanup() {
    this.pauseBarking();
  }
}
