import { aabbOverlap, insetBox } from '../utils/collision.js';
import { getSpriteSrc } from '../utils/outfits.js';

// Poop-drop "squat and release" — a quick vertical squash timed to the
// drop itself (see startPoopAnim()/draw() below), so the moment reads as
// the dog actually doing something rather than a pile just silently
// appearing. Sized modestly (22% compression at the peak) since this is a
// quick gag beat, not a big showy animation.
const POOP_ANIM_DURATION = 450; // ms
const POOP_ANIM_MAX_SQUASH = 0.22; // fraction of height compressed at the peak

// How long the dog's very first autonomous poop of a round takes — see
// setNextPoop()'s own comment for why this is a short fixed delay rather
// than the normal random 8-18s range every poop after it uses.
const POOP_FIRST_DELAY = 2000; // ms

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

    // v2: a redrawn, "Disneyfied" walk-cycle sheet, replacing the original
    // dog_medium.png art — same husky identity (white/gray fur, black
    // saddle patch, black-tipped ears, black nose, bushy tail), now in a
    // purple ballerina tutu, generated as a direct 6-frame walk-cycle
    // sprite-sheet request (see CLAUDE.md for the full generation history).
    // Unlike dog_medium.png (a 6x6 grid of which only column index 1 was
    // ever actually used), dog_v2.png is a single column of 6 frames.
    this.spriteSheet = new Image();
    // ?v cache-busts the browser's cached copy of this file whenever it's
    // rebuilt — bump on every asset change, not just the first time (a real
    // gap hit mid-session: the file was rebuilt without bumping this,
    // silently reintroducing a stale-cache risk).
    // Routed through getSpriteSrc() (js/utils/outfits.js) — see Cat.js's
    // own comment on this same pattern.
    this.spriteSheet.src = getSpriteSrc('dog');

    // BASE_FRAME_WIDTH/HEIGHT are the *logical* on-screen size this sprite
    // is drawn at — originally matched dog_medium.png's own 60x38 frame
    // exactly, now 20% bigger per explicit request ("make the dog about
    // 20% bigger"), chosen once the resolution redo (see CLAUDE.md) gave
    // enough native pixel headroom (473x296) that a 20% bigger on-screen
    // draw is still a comfortable downscale, not an upscale — no quality
    // loss, confirmed live. This is what frameWidth/frameHeight (on-screen
    // draw size AND collision box) are computed from, deliberately kept
    // independent of whatever pixel resolution the actual source art
    // happens to be at. nativeFrameWidth/nativeFrameHeight are the sprite
    // sheet's *real* pixel dimensions, used only for the source-rect
    // slicing args in draw()'s drawImage() call — reusing those directly
    // for on-screen size (the old v1-era approach) would render the dog
    // several times too big on screen, so the two are tracked separately.
    const BASE_FRAME_WIDTH = 72; // 60 * 1.2
    const BASE_FRAME_HEIGHT = 45.6; // 38 * 1.2 — same aspect ratio, no stretch
    this.nativeFrameWidth = 473; // Actual dog_v2.png per-frame pixel width — source-rect slicing only
    this.nativeFrameHeight = 296; // Actual dog_v2.png per-frame pixel height — source-rect slicing only
    this.frameWidth = BASE_FRAME_WIDTH * sizeScale; // On-screen width — draw + collision
    this.frameHeight = BASE_FRAME_HEIGHT * sizeScale; // On-screen height — draw + collision
    this.rows = 6; // Total rows
    this.currentFrame = 0;
    this.frameSpeed = 20; // Autonomous-wander walk-cycle speed only — see playerFrameSpeed below
    // Player-controlled Dog mode's own walk-cycle speed — kept separate from
    // frameSpeed above for the same "one field can't serve two speeds at
    // once" reason this.speed/layout.dogPlayerSpeed were already split (see
    // that field's own comment). Reported live as "too slow to tell the dog
    // is walking" at frameSpeed's original value once movePlayerDog() only
    // advanced the walk-cycle while actually moving (previously it animated
    // continuously regardless of input, which happened to read as a normal
    // pace purely by coincidence). Matched to Cat.js's own frameSpeed (10)
    // since both characters now move at the identical per-tick player speed
    // (BASE_DOG_PLAYER_SPEED === Cat.speed — see Character selection &
    // playable modes) and both have a 6-frame cycle, so the same per-frame
    // hold time reads as the same walking pace for either.
    this.playerFrameSpeed = 10;
    this.frameCounter = 0;

    this.column = 0; // dog_v2.png is a single column (see comment above) — was 1 for the old 6x6 dog_medium.png

    // dog_v2.png (like v1's dog_medium.png before it — see the src comment
    // above) only has leftward-facing frames, so there's no "right-facing"
    // source art to switch to. Flipping the leftward frame horizontally
    // (see draw()) when moving
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

    // Poop hazard — only scheduled by GameScreen.resetGameObjects() when
    // the dog is autonomous (not the player's own controlledEntity); see
    // setPoopCallback()/setNextPoop() below. Kept as an external callback
    // (set via setPoopCallback(), not a constructor param) rather than
    // threading a fourth thing through the already-long constructor
    // signature — same pattern Mouse.js already uses for
    // setWallHitCallback()/setEscapeCheckCallback().
    this.poopCallback = null;
    this.poopTimeoutId = null;

    // Poop-drop squat animation state — see startPoopAnim()/draw() below.
    // Not reset back to false once triggered (same convention as
    // Furniture.js's own knockedOver/shaking flags): the squash amount
    // itself decays to exactly 0 by POOP_ANIM_DURATION via the sine easing
    // in draw(), so leaving `pooping` true afterward is harmless — draw()
    // just keeps computing a squash of 0.
    this.pooping = false;
    this.poopStartTime = null;
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

  setPoopCallback(callback) {
    this.poopCallback = callback;
  }

  // Same self-rescheduling setTimeout shape as setNextBark() above, but a
  // slower, wider interval (8-18s vs bark's 1-10s) — this is a gameplay
  // hazard the mouse can benefit from and the cat has to actually watch
  // out for, not ambient flavor, so it shouldn't carpet the board the way
  // a frequent decorative sound safely can. Fires with no arguments —
  // GameScreen.handleDogPoop() (the callback, wired in
  // resetGameObjects()) reads this dog's own current x/y itself rather
  // than this passing position through, since it's the one that knows
  // where poop piles actually live (this.poops) and how to lay one out.
  //
  // `isFirst` (only ever passed `true` by resetGameObjects()'s initial
  // kick-off, not by resumePooping() or this method's own reschedule) uses
  // a short, fixed 2s delay instead of the normal random range — per
  // explicit direction, the dog's very first poop of a round shouldn't
  // make the mouse/cat wait as long as a mid-round one might, since 2s in
  // it's a predictable "here's a hazard in play" beat rather than a random
  // wait. Every poop after that (including the very next one this
  // schedules) goes back to the normal random 8-18s range.
  setNextPoop(isFirst = false) {
    const delay = isFirst ? POOP_FIRST_DELAY : Math.random() * 10000 + 8000;
    this.poopTimeoutId = setTimeout(() => {
      if (this.poopCallback) {
        this.poopCallback();
      }
      this.setNextPoop();
    }, delay);
  }

  // Same pause/resume shape as pauseBarking()/resumeBarking() above, for
  // the same reason — a raw setTimeout chain runs on wall-clock time
  // regardless of GameScreen.running, so it needs its own way to actually
  // pause alongside the rest of the game (settings menu open) rather than
  // only ever being cancelled for good (cleanup()).
  pausePooping() {
    if (this.poopTimeoutId) {
      clearTimeout(this.poopTimeoutId);
      this.poopTimeoutId = null;
    }
  }

  resumePooping() {
    if (!this.poopTimeoutId) {
      this.setNextPoop();
    }
  }

  // Called by GameScreen.handleDogPoop() the instant a pile is actually
  // placed (both the player-triggered 'p' press and the autonomous timer).
  // Always restarts from the beginning, same "replayable, not a one-shot"
  // convention as Furniture.js's startKnockOver()/startShake() — though in
  // practice handleDogPoop() only allows one pile on the board at a time,
  // so this only ever fires once per approach anyway.
  startPoopAnim(timestamp) {
    this.pooping = true;
    this.poopStartTime = timestamp;
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
    // check for the full explanation of why the cat/mouse clamps' old
    // "position can dip below WALL_OFFSET by up to size" convention wasn't
    // safe for the dog specifically (frameWidth/frameHeight are larger than
    // WALL_OFFSET at any scale — the cat's own wall clamp has since been
    // switched to this same strict style, for the same reason).
    const WALL_OFFSET = this.wallOffset;
    const insideWalls = (
        proposedX >= WALL_OFFSET &&
        proposedX <= this.canvasWidth - WALL_OFFSET - this.frameWidth &&
        proposedY >= WALL_OFFSET &&
        proposedY <= this.canvasHeight - WALL_OFFSET - this.frameHeight
    );

    // Furniture collision uses the dog's actual rendered box (frameWidth/
    // frameHeight — the same dimensions the wall clamp above and isColliding()
    // below already use), not this.size (50*sizeScale, a plain square that
    // doesn't match frameWidth/frameHeight's real 60/38 aspect ratio at all
    // — confirmed by direct measurement that it let the dog visually clip
    // ~15px into furniture approached horizontally while stopping ~20px
    // short of furniture approached vertically). Not routed through
    // Furniture.isColliding() (which assumes a square `entity.size`) for the
    // same reason Cat.js's own furniture check bypasses it — aabbOverlap
    // directly, with the dog's real (non-square) box.
    const canMove = (insideWalls || isOnEscape) &&
        !this.boundaries.some(boundary => aabbOverlap(proposedX, proposedY, this.frameWidth, this.frameHeight, boundary.x, boundary.y, boundary.width, boundary.height));
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

  // Cutscene.js calls `characterAnimation.update()` with no arguments at
  // all (it just wants the walk-cycle frame to advance for the preview
  // portrait) — with `timestamp` undefined, the wander logic below used to
  // still run (`!this.wanderDirection` is true on the very first call,
  // picking a real direction and then actually moving this.x/this.y via
  // tryMove() every single tick), so the dog visibly drifted across the
  // cutscene card instead of standing still. Bail out to animation-only
  // when there's no real timestamp, matching Cat.update()'s own
  // animation-only behavior (Cat has no movement logic in update() at
  // all) rather than letting a missing argument silently fall through into
  // full autonomous-wander behavior.
  update(timestamp, cat, onCatCollision) {
    if (timestamp === undefined) {
      this.updateAnimation();
      return;
    }

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

  // frameSpeed defaults to the autonomous-wander cadence; GameScreen's
  // movePlayerDog() passes playerFrameSpeed instead so the two modes can
  // each have their own walk-cycle pace (see playerFrameSpeed's own
  // comment in the constructor).
  updateAnimation(frameSpeed = this.frameSpeed) {
    this.frameCounter++;
    if (this.frameCounter >= frameSpeed) {
      this.currentFrame = (this.currentFrame + 1) % this.rows; // Loop through rows
      this.frameCounter = 0;
    }
  }

  // Called from GameScreen.movePlayerDog() whenever no direction key is
  // held or the attempted move was blocked, so the walk-cycle snaps back
  // to a resting pose instead of continuing to animate in place while the
  // dog isn't actually going anywhere — mirrors Cat.js's own stand().
  // Only used by the player-controlled path: the autonomous wander
  // (update() above) is essentially always moving every tick, so it has
  // no real idle state to snap back to.
  stand() {
    this.currentFrame = 0;
    this.frameCounter = 0;
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

  // Only ever called with the cat (see GameScreen's dog-pauses-cat check
  // and this.update() below) — uses entity.displayWidth/displayHeight
  // (the cat's actual visible sprite box) rather than entity.size (the
  // cat's oversized logical box), matching GameScreen.checkCollision()'s
  // own fix for the same "catches from too far away" complaint. Both boxes
  // are further shrunk via insetBox() (see collision.js) to their central
  // CATCH_HITBOX_SCALE — the full display box still reaches out to ear/
  // tail tips well past where the dog and cat actually look like they're
  // touching, which is what kept this catching from too far away even
  // after the displayWidth/displayHeight fix alone.
  isColliding(entity) {
    if (!entity) return false; // Prevents crash if entity is undefined
    const dogBox = insetBox(this.x, this.y, this.frameWidth, this.frameHeight);
    const entityBox = insetBox(entity.x, entity.y, entity.displayWidth, entity.displayHeight);
    return aabbOverlap(
      dogBox.x, dogBox.y, dogBox.width, dogBox.height,
      entityBox.x, entityBox.y, entityBox.width, entityBox.height
    );
  }

  draw(ctx) {
    const sx = this.column * this.nativeFrameWidth; // Use column 2 (index 1)
    const sy = this.currentFrame * this.nativeFrameHeight; // Move vertically through rows

    // No longer disables imageSmoothingEnabled here — that was a workaround
    // for cross-frame bleed in the old low-resolution sheet (see CLAUDE.md
    // for the full history: the real cause turned out to be stray pixels
    // baked into the asset itself, not a smoothing/GPU artifact, and is now
    // fixed at the source). dog_v2.png's much higher native resolution (see
    // the constructor comment) means this draw is a downscale, so leaving
    // smoothing on gives a clean downsample instead of an aliased/pixelated
    // one — same lesson as Furniture.js's own smoothing fix.
    ctx.save();

    // Poop-drop squat (see startPoopAnim() above) — a quick vertical
    // squash-and-release, eased via a plain sine over [0, π] so it starts
    // and ends at 0 with a peak at the animation's midpoint, no separate
    // decay math needed the way Furniture.js's shake needs. Anchored to the
    // sprite's bottom-center (its feet), not its middle, so the dog visibly
    // hunkers down toward the ground and springs back rather than
    // squashing from its own center — a little horizontal give in the
    // opposite direction keeps the silhouette reading as a squish rather
    // than a flat vertical scale. Applied before the facing-direction
    // transform below so it composes correctly with the mirror flip.
    if (this.pooping) {
      const elapsed = performance.now() - this.poopStartTime;
      const t = Math.min(1, elapsed / POOP_ANIM_DURATION);
      const squat = Math.sin(t * Math.PI) * POOP_ANIM_MAX_SQUASH;
      if (squat > 0) {
        const pivotX = this.x + this.frameWidth / 2;
        const pivotY = this.y + this.frameHeight;
        ctx.translate(pivotX, pivotY);
        ctx.scale(1 + squat * 0.35, 1 - squat);
        ctx.translate(-pivotX, -pivotY);
      }
    }

    // The source art only faces left (see facingLeft above) — mirror the
    // draw itself when moving right rather than needing a second set of
    // frames. translate to the sprite's right edge first so scale(-1, 1)
    // flips it back over the same x/y position instead of off to one side.
    if (!this.facingLeft) {
      ctx.translate(this.x + this.frameWidth, this.y);
      ctx.scale(-1, 1);
      ctx.drawImage(
        this.spriteSheet,
        sx, sy, this.nativeFrameWidth, this.nativeFrameHeight,
        0, 0, this.frameWidth, this.frameHeight
      );
    } else {
      ctx.drawImage(
        this.spriteSheet,
        sx, sy, this.nativeFrameWidth, this.nativeFrameHeight, // Native source rectangle
        this.x, this.y, this.frameWidth, this.frameHeight // Scaled destination rectangle
      );
    }
    ctx.restore();
  }

  cleanup() {
    this.pauseBarking();
    this.pausePooping();
  }
}
