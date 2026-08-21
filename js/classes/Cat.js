import { getSpriteSrc } from '../utils/outfits.js';

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

// Poop-stun "yuck" reaction — a quick decaying side-to-side wobble layered
// on top of whatever directional tilt/stretch is already active (see
// startYuckReaction()/draw() below), the same oscillate-and-decay shape
// Furniture.js's own shake reaction uses for a bumped piece of furniture,
// borrowed here for the cat's own "shaking it off" recoil. A bit bigger
// than Furniture's shake angle (10° vs 5°) since this is a full-body
// recoil, not a small piece of furniture rattling.
const YUCK_SHAKE_DURATION = 450; // ms
const YUCK_SHAKE_MAX_ANGLE = (10 * Math.PI) / 180; // radians
const YUCK_SHAKE_CYCLES = 3; // back-and-forth oscillations over the full duration

// cat.png's frame is a big round head (with ears/whiskers sticking out to
// both sides) over a much narrower body/legs section — see getHitboxAt()
// below for where this is actually used. Ratios measured directly off the
// asset's alpha channel (the legs/body region specifically, not the
// whisker-affected head): the legs are about 35% of the frame's width and
// the bottom ~30% of its height.
const HITBOX_WIDTH_RATIO = 0.35;
const HITBOX_HEIGHT_RATIO = 0.3;

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
    // v2: a redrawn, more polished/glossy "Disneyfied" version of the same
    // character (same white fur, coral inner ears, purple hair tufts and
    // whiskers, big grin), now in a pink ballerina outfit, generated as a
    // direct 6-frame sprite-sheet replacement — see CLAUDE.md for the full
    // generation/verification history.
    this.spriteSheet = new Image();
    // Routed through getSpriteSrc() (js/utils/outfits.js) rather than a
    // hardcoded literal — always resolves to the same default today (no
    // purchasable outfit art exists yet), but this is the one seam a
    // future cosmetic-outfit feature needs to change, not this file.
    // ?v cache-busts the browser's cached copy of this file whenever it's
    // rebuilt — bump on every asset change, not just the first time.
    this.spriteSheet.src = getSpriteSrc('cat');
    // BASE_FRAME_WIDTH/HEIGHT are the *logical* size this sprite has always
    // used for on-screen display (matches the original v1 cat.png's own
    // 118x150 frame) — displayWidth/displayHeight below are computed from
    // these, deliberately independent of the actual source art's pixel
    // resolution. this.frameWidth/frameHeight are the sprite sheet's *real*
    // pixel dimensions, used only for source-rect slicing in draw()'s
    // drawImage() call. v1 happened to be built at exactly the logical
    // size, so one pair of numbers served both roles — but v2's rebuild
    // (see CLAUDE.md) intentionally kept far more native resolution
    // (256x296) specifically so the browser downsamples this on display
    // instead of upscaling a tiny source, fixing the softness/pixelation
    // the earlier low-res build had. Reusing the native size directly for
    // on-screen display (the old approach) would render the cat far too
    // big, so the two now have to be tracked separately.
    const BASE_FRAME_WIDTH = 118;
    const BASE_FRAME_HEIGHT = 150;
    this.baseFrameWidth = BASE_FRAME_WIDTH;
    this.baseFrameHeight = BASE_FRAME_HEIGHT;
    this.frameWidth = 256; // Actual cat_v2.png per-frame pixel width — source-rect slicing only
    this.frameHeight = 296; // Actual cat_v2.png per-frame pixel height — source-rect slicing only
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

    // Poop-stun "yuck" reaction state — see startYuckReaction()/draw()
    // below. Not reset back to false once triggered (same convention as
    // Furniture.js's own shaking flag): the wobble angle itself decays to
    // exactly 0 by YUCK_SHAKE_DURATION via the sine easing in draw(), so
    // leaving `yucking` true afterward is harmless.
    this.yucking = false;
    this.yuckStartTime = null;
  }

  // The actual on-screen size (see draw()) — GameScreen uses this instead
  // of re-deriving baseFrameWidth/4*sizeScale itself. Computed from
  // baseFrameWidth/baseFrameHeight (the logical size), not this.frameWidth/
  // frameHeight (the sprite sheet's real, much larger, pixel dimensions —
  // see the constructor comment) — using the native size here would render
  // the cat far too big on screen.
  get displayWidth() {
    return (this.baseFrameWidth / 4) * this.sizeScale;
  }

  get displayHeight() {
    return (this.baseFrameHeight / 4) * this.sizeScale;
  }

  get hitboxWidth() {
    return this.displayWidth * HITBOX_WIDTH_RATIO;
  }

  get hitboxHeight() {
    return this.displayHeight * HITBOX_HEIGHT_RATIO;
  }

  // The furniture-collision box (see GameScreen.tryMoveCat()) — sized to
  // just the legs/body, not the full head+ears+whiskers sprite, so the cat
  // can walk right up next to (and visually appear to pass close beside)
  // furniture instead of stopping short with an obvious gap while its wide
  // head/ears are still clear of it. Confirmed live: the previous
  // full-sprite-sized hitbox (this.size, a square bigger than even the
  // full display box) made the cat stop well before it looked like it
  // should, next to a corner counter.
  //
  // Takes an explicit (x, y) rather than always using this.x/this.y
  // because GameScreen.tryMoveCat() needs the hitbox for a *proposed*
  // position it hasn't committed to yet, not just the cat's current one —
  // same reasoning as move()'s own `speed` parameter (see its comment).
  // Horizontally centered under the full sprite, vertically anchored to
  // its bottom edge (where the legs actually are), rather than sharing the
  // sprite's own top-left origin directly.
  //
  // Deliberately NOT used for anything else `this.size` still drives
  // (wall-edge clamping, the cat-catches-mouse win check, the AI's
  // line-of-sight lane width) — those are different concerns (board-edge
  // margin, core win-condition feel, AI perception width) that didn't have
  // the same "invisible box bigger than the visible sprite" complaint, and
  // shrinking them too was never asked for.
  getHitboxAt(x, y) {
    const width = this.hitboxWidth;
    const height = this.hitboxHeight;
    return {
      x: x + (this.displayWidth - width) / 2,
      y: y + this.displayHeight - height,
      width,
      height,
    };
  }

  // `speed` defaults to the cat's own speed, but GameScreen's tryMoveCat()
  // can pass a different value (e.g. the AI's wander speed) — it must match
  // whatever distance was used to validate the move, or the validated and
  // applied positions diverge.
  move(direction, speed = this.speed) {
    this.facingDirection = direction;
    this.hasMoved = true;
    // Only called when a move actually goes through (tryMoveCat() gates
    // this on canMove), so the walk-cycle only plays while the cat is
    // actually moving rather than continuously like Dog/Mouse — unlike
    // those two, cat.png's frames read as a walk cycle, not idle poses, so
    // animating in place looked wrong.
    this.updateAnimations();

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

  // Called whenever a tick ends without move() running (see tryMoveCat() in
  // GameScreen), so the walk-cycle snaps back to a resting pose instead of
  // freezing on whatever frame the cat happened to be mid-stride on.
  stand() {
    this.currentFrame = 0;
    this.frameCounter = 0;
  }

  // Exposed as its own method (rather than inlined in draw()) so any other
  // caller that needs to replicate the cat's own tilt/stretch (previously
  // GameScreen's now-removed drawRedOutline() catPaused silhouette; draw()
  // below is the only caller today) can apply the identical rotation/
  // stretch and stay visually aligned with the actual sprite, instead of
  // drawing something axis-aligned under a now-tilted cat. Caller is
  // responsible for having already translated to the cat's center — this
  // only rotates/scales around whatever the current transform origin is.
  applyDirectionalTransform(ctx) {
    if (!this.hasMoved) return;
    if (this.facingDirection === 'left') ctx.rotate(-TILT_ANGLE);
    else if (this.facingDirection === 'right') ctx.rotate(TILT_ANGLE);
    else if (this.facingDirection === 'up') ctx.scale(1, 1 + STRETCH_AMOUNT);
    else if (this.facingDirection === 'down') ctx.scale(1, 1 - STRETCH_AMOUNT);
  }

  // Called by GameScreen.updatePoops() the instant the cat actually steps
  // in a poop pile. Always restarts from the beginning — same "replayable,
  // not a one-shot" convention as Dog.js's startPoopAnim()/Furniture.js's
  // startShake() — though in practice a pile is consumed on contact (see
  // updatePoops()), so this only ever fires once per pile.
  startYuckReaction(timestamp) {
    this.yucking = true;
    this.yuckStartTime = timestamp;
  }

  draw(ctx) {
    const sx = 0; // Since all frames are in a single column
    const sy = this.currentFrame * this.frameHeight; // Native frameHeight — indexes the source sheet
    const width = this.displayWidth;
    const height = this.displayHeight;

    ctx.save();
    ctx.translate(this.x + width / 2, this.y + height / 2);
    this.applyDirectionalTransform(ctx);
    // Poop-stun wobble (see startYuckReaction() above) — a plain sine over
    // [0, YUCK_SHAKE_CYCLES full cycles] times a linear decay, so it starts
    // and ends at 0 with no separate decay math needed, same shape
    // Furniture.js's shake uses. Composes with applyDirectionalTransform()'s
    // own rotate/scale above rather than replacing it, since both act on
    // the same already-centered transform origin.
    if (this.yucking) {
      const elapsed = performance.now() - this.yuckStartTime;
      const t = Math.min(1, elapsed / YUCK_SHAKE_DURATION);
      const decay = 1 - t;
      ctx.rotate(Math.sin(t * Math.PI * 2 * YUCK_SHAKE_CYCLES) * YUCK_SHAKE_MAX_ANGLE * decay);
    }
    // No longer disables imageSmoothingEnabled here — that was a workaround
    // for cross-frame bleed in the old low-resolution sheet (see CLAUDE.md),
    // which is now fixed at the asset level (stray pixels stripped from the
    // source, not papered over with nearest-neighbor). cat_v2.png's much
    // higher native resolution (see the constructor comment) means this
    // draw is a downscale, and leaving smoothing on gives a clean
    // downsample instead of an aliased/pixelated one — same lesson as
    // Furniture.js's own smoothing fix.

    ctx.drawImage(
      this.spriteSheet,
      sx, sy, this.frameWidth, this.frameHeight, // Native source rectangle
      -width / 2, -height / 2, width, height // Centered, scaled destination rectangle
    );
    ctx.restore();
  }
}
