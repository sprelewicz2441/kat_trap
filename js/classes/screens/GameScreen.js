// ==============================
//  IMPORTS
// ==============================
import Cat from '../Cat.js';
import Mouse from '../Mouse.js';
import Dog from '../Dog.js';
import InputHandler from '../InputHandler.js';
import Escape from '../Escape.js';
import CutsceneManager from '../cutscenes/CutsceneManager.js';
import Cutscene from '../cutscenes/Cutscene.js';
import Furniture from '../Furniture.js';
import { aabbOverlap } from '../../utils/collision.js';
import { getScale, getUIScale } from '../../utils/scale.js';

// ==============================
//  CONSTANTS
// ==============================
// Every BASE_* constant below was tuned by eye against a ~1280px-wide
// desktop canvas. computeLayout() (bottom of this section) multiplies each
// by the canvas's actual scale factor (see js/utils/scale.js) so furniture,
// walls, and UI chrome keep the same *proportion* of the board at any
// canvas size — confirmed live that without this, a single stove alone ate
// ~40% of the board height on a 350px-wide mobile canvas. this.layout
// (computed once in the constructor) is what every method below reads
// instead of a bare module-level constant — see "Mobile responsiveness" in
// CLAUDE.md.

// Thickness of the visual wall band drawn around the board perimeter (see
// drawWalls()) — purely presentational, independent of WALL_OFFSET (the
// separate value moveCat() uses to clamp how close the cat can get to the
// edge).
const BASE_WALL_BAND_THICKNESS = 16;
const BASE_ESCAPE_SIZE = 15;
const NUM_OF_ESCAPES = 6;

// Furniture sprite paths — the FOURTH kitchen art direction this project
// has had (see CLAUDE.md Kitchen furniture section for why the previous
// three — a photo-crop scene, the flat-cartoon PtPt pack, and individually-
// generated photorealistic objects — were each replaced). These are new
// individually-generated renders provided directly for this pass; the
// modular wall-building/gap mechanic carries forward unchanged from the
// last two rounds — only the asset source and each piece's native
// dimensions changed.
const FURNITURE_SPRITES = {
  CABINET: './assets/kitchen_cabinet.png',
  SINK: './assets/kitchen_sink.png',
  STOVE: './assets/kitchen_stove.png',
  FRIDGE: './assets/kitchen_fridge.png',
  TABLE: './assets/kitchen_table.png',
  CHAIR: './assets/kitchen_chair.png',
};

// Each render has its own native size (not a shared grid) — dimensions
// below are each render's actual *content* size, not its file size: every
// kitchen_*.png has a few pixels of transparent padding baked in around
// the object (confirmed by scanning each file's alpha channel), which left
// a visible gap between adjacent wall modules even though buildWall()
// places their bounding boxes truly edge-to-edge. width/height here are the
// trimmed content dimensions (used for layout/collision), and cropX/cropY
// are that content's offset within the source file (used by Furniture's
// draw() to source-rect only the real content, skipping the padding) — see
// Furniture.js. Wall modules are placed edge-to-edge using each piece's own
// scaled width (see buildWall() below) rather than a fixed cell size, and
// aligned to a shared baseline (the floor line) since their heights differ
// too.
const BASE_MODULE_SCALE = 0.15;
const MODULE_SPECS = {
  cabinet: { sprite: FURNITURE_SPRITES.CABINET, width: 832, height: 497, cropX: 7, cropY: 7 },
  sink: { sprite: FURNITURE_SPRITES.SINK, width: 980, height: 669, cropX: 9, cropY: 11 },
  stove: { sprite: FURNITURE_SPRITES.STOVE, width: 981, height: 703, cropX: 9, cropY: 8 },
};
// Only 3 distinct wall-module renders exist (no separate plain "counter"
// render this round) — cabinet doubles as filler, same role COUNTER played
// with the PtPt pack.
// Only one sink and one stove render exist, so each appears exactly once
// (top wall only) — the bottom wall is all cabinet so the kitchen doesn't
// read as having two sinks/two stoves. Revisit once dedicated additional
// appliance renders exist (see CLAUDE.md Planned work — v2 furniture pack).
const TOP_WALL_ORDER = ['cabinet', 'stove', 'sink', 'cabinet'];
const BOTTOM_WALL_ORDER = ['cabinet', 'cabinet', 'cabinet', 'cabinet'];
// Left/right walls (new this round) reuse cabinet as filler, rotated 90/270
// via Furniture's existing rotation support so their long edge runs along
// the wall — same "cabinet doubles as filler" precedent as top/bottom.
const LEFT_WALL_ORDER = ['cabinet', 'cabinet'];
const RIGHT_WALL_ORDER = ['cabinet', 'cabinet'];
const LEFT_WALL_ROTATION = 90;
const RIGHT_WALL_ROTATION = 270;

// Trimmed content size + crop offset, same reasoning as MODULE_SPECS above.
const FRIDGE_SPEC = { width: 384, height: 696, cropX: 7, cropY: 7 };
// Dining set: table and one chair placed side by side (not front/back
// chairs around the table like the PtPt round) — this chair render only
// exists from one angle, and stacking chair+table+chair vertically (as
// PtPt's two-chair layout did) needed far more interior height than these
// much-taller-relative-to-canvas renders leave room for. Side-by-side needs
// only as much height as the taller of the two pieces.
// Trimmed content size + crop offset, same reasoning as MODULE_SPECS above.
const TABLE_SPEC = { width: 958, height: 651, cropX: 8, cropY: 7 };
const CHAIR_SPEC = { width: 565, height: 615, cropX: 9, cropY: 7 };

const BASE_SPAWN_CLEARANCE = 60;
// How close the cat/dog can get to the board edge — independent of the
// wall band's own thickness (see BASE_WALL_BAND_THICKNESS above).
const BASE_WALL_OFFSET = 40;

const DOG_PAUSE_DURATION = 2000; // ms — a duration, not a size, so this doesn't scale with canvas size
const DOG_COLLISION_COOLDOWN = 1000; // ms
const BASE_PUNCH_DISTANCE = 40;
const PUNCH_SHOCKWAVE_DURATION = 200; // ms
const BASE_PUNCH_SHOCKWAVE_MAX_RADIUS = 60;

const BASE_CAT_OUTLINE_WIDTH = 3;
const BASE_MESSAGE_FONT_SIZE = 24;
const BASE_MESSAGE_Y_OFFSET = 80;
const BASE_PLAY_BUTTON_WIDTH = 150;
const BASE_PLAY_BUTTON_HEIGHT = 50;
const BASE_PLAY_BUTTON_GAP = 40; // Vertical gap between the message and the button
const BASE_PLAY_BUTTON_TEXT_OFFSET_Y = 33; // Vertical centering of "Play Again" text within the button
const BASE_FLOOR_TILE_SIZE = 24;

// Rough approximations of the cat/mouse/dog's on-screen size, used only to
// keep the freestanding dining set and furniture placement clear of where
// they'll spawn — generateKitchenFurniture() runs before those instances
// exist (see resetGameObjects()), so it can't ask them for their real size.
// Must stay in the same ballpark as Cat.js/Mouse.js/Dog.js's own base sizes.
const BASE_CAT_SIZE = 39;
const BASE_MOUSE_SIZE = 32;
const BASE_DOG_SIZE = 50;

// Wall clearance must cover the tallest thing placed on that wall, plus the
// wall band itself — every module's back is flush against the wall band's
// front face (see makeModule()/buildWallVertical() below), so the interior
// boundary is the wall band plus whichever piece reaches furthest into the
// room. Unlike the previous asset set (where the fridge was clearly the
// tallest single piece, so clearance was hardcoded off it), this set's
// fridge/sink/stove are all roughly the same height — so clearance is
// computed generically as the max scaled height among whatever's actually
// placed on each wall, rather than assuming any one piece is always
// tallest. This is what keeps cat/dog spawn points clear of furniture
// collision boxes (the same class of stuck-spawn bug hit twice already in
// this project's history — see CLAUDE.md).
//
// Everything here is a function of the canvas's scale factor (see
// js/utils/scale.js) rather than a bare module constant, so it can be
// recomputed against the actual canvas size — see the Mobile responsiveness
// note at the top of this section.
function computeLayout(canvasWidth) {
  const scale = getScale(canvasWidth);
  // Buttons/messages (play-again button, win/lose text) use their own
  // mobile multiplier — allowed to stay a little bigger than in-game assets
  // rather than following the same reduction. See js/utils/scale.js.
  const uiScale = getUIScale(canvasWidth);
  const moduleScale = BASE_MODULE_SCALE * scale;
  const wallBandThickness = BASE_WALL_BAND_THICKNESS * scale;

  const topWallHeight = wallBandThickness + Math.ceil(Math.max(
    ...TOP_WALL_ORDER.map(type => MODULE_SPECS[type].height),
    FRIDGE_SPEC.height
  ) * moduleScale);
  const bottomWallHeight = wallBandThickness + Math.ceil(
    Math.max(...BOTTOM_WALL_ORDER.map(type => MODULE_SPECS[type].height)) * moduleScale
  );
  // Left/right wall "width" is the wall band plus the rotated depth into
  // the room — rotation swaps the axes, so a rotated module's depth is its
  // native *height* times scale (see Furniture.js), not its native width.
  const leftWallWidth = wallBandThickness + Math.ceil(
    Math.max(...LEFT_WALL_ORDER.map(type => MODULE_SPECS[type].height)) * moduleScale
  );
  const rightWallWidth = wallBandThickness + Math.ceil(
    Math.max(...RIGHT_WALL_ORDER.map(type => MODULE_SPECS[type].height)) * moduleScale
  );

  return {
    scale,
    moduleScale,
    diningScale: moduleScale,
    wallBandThickness,
    escapeSize: BASE_ESCAPE_SIZE * scale,
    wallOffset: BASE_WALL_OFFSET * scale,
    spawnClearance: BASE_SPAWN_CLEARANCE * scale,
    punchDistance: BASE_PUNCH_DISTANCE * scale,
    punchShockwaveMaxRadius: BASE_PUNCH_SHOCKWAVE_MAX_RADIUS * scale,
    catOutlineWidth: BASE_CAT_OUTLINE_WIDTH * scale,
    messageFontSize: BASE_MESSAGE_FONT_SIZE * uiScale,
    messageYOffset: BASE_MESSAGE_Y_OFFSET * uiScale,
    playButtonWidth: BASE_PLAY_BUTTON_WIDTH * uiScale,
    playButtonHeight: BASE_PLAY_BUTTON_HEIGHT * uiScale,
    playButtonGap: BASE_PLAY_BUTTON_GAP * uiScale,
    playButtonTextOffsetY: BASE_PLAY_BUTTON_TEXT_OFFSET_Y * uiScale,
    floorTileSize: BASE_FLOOR_TILE_SIZE * scale,
    catSizeApprox: BASE_CAT_SIZE * scale,
    mouseSizeApprox: BASE_MOUSE_SIZE * scale,
    dogSizeApprox: BASE_DOG_SIZE * scale,
    topWallHeight,
    bottomWallHeight,
    leftWallWidth,
    rightWallWidth,
  };
}

const COLORS = {
  // A warm greige band (see drawWalls()) — distinct enough from the near-
  // white floor to read as a separate surface, and from the cream/tan
  // furniture so counters/fridge/table still stand out against it.
  WALL_FILL: '#e4ddcf',
  WALL_TRIM: '#b9ae98',
  MESSAGE: 'purple',
  PLAY_BUTTON: {
    BACKGROUND: 'navy',
    TEXT: 'white',
  },
  CAT_OUTLINE: 'red',
  // A small white/off-white two-tone tile look (see drawFloor()) — plain
  // and neutral rather than matched to the kitchen_*.png furniture's warm
  // cream/tan/honey-oak palette. Two earlier versions of this floor (large
  // warm-toned tiles with marble veining, then smaller but still warm/tan
  // tiles) were both tried and rejected live for blending into the
  // furniture instead of reading as floor beneath it — white/off-white
  // reads as a distinct, neutral surface regardless of what furniture
  // palette sits on top of it.
  FLOOR_LIGHT: '#ffffff',
  FLOOR_DARK: '#f9f8f4',
  FLOOR_GROUT: '#d9d5c9',
};

const CHARACTER_NAMES = {
  CAT: 'Mia',
  MOUSE: 'Poop',
  DOG: 'Dummy',
};

const SOUND_KEYS = {
  BACKGROUND: 'background',
  WALL_HIT: 'wallHit',
  CAT_CATCH: 'catCatch',
  MOUSE_ESCAPE: 'mouseEscape',
  TOOT: 'toot',
  PUNCH: 'punch',
};

const MESSAGES = {
  DOG_CAUGHT: `${CHARACTER_NAMES.DOG} caught ${CHARACTER_NAMES.CAT}!`,
  CAT_CAUGHT_MOUSE: `${CHARACTER_NAMES.CAT} caught ${CHARACTER_NAMES.MOUSE}!`,
  MOUSE_ESCAPED: `${CHARACTER_NAMES.MOUSE} escaped!`,
};

// ==============================
//  GAME SCREEN CLASS
// ==============================
export default class GameScreen {
  constructor(screenManager, canvas, ctx, isReplay = false) {
    this.screenManager = screenManager;
    this.canvas = canvas;
    this.ctx = ctx;
    this.isReplay = isReplay;

    // Canvas size is fixed for the lifetime of a GameScreen (live-resize
    // mid-game is a known separate gap — see CLAUDE.md), so this is
    // computed once here rather than per-frame.
    this.layout = computeLayout(this.canvas.width);

    this.cat = null;
    this.mouse = null;
    this.dog = null;
    this.escapes = [];
    this.furniture = [];
    this.wallGap = null;

    this.running = false;
    this.catPaused = false;
    this.pauseEndTime = 0;
    this.dogCollisionCooldown = 0;
    this.gameOver = false;
    this.message = '';
    this.shockwave = null;

    this.sounds = this.loadSounds();
    this.playAgainButtonArea = null;
    this.cutsceneManager = new CutsceneManager(screenManager, canvas, ctx);

    this.floorPattern = null;
  }

  init() {
    // Reveals the touch D-pad/action buttons (see styles.css) — only
    // during actual gameplay, not the setup screen.
    document.body.classList.add('in-game');

    this.resetGameObjects();

    if (!this.isReplay) {
        this.sounds[SOUND_KEYS.BACKGROUND].play();
    }

    // Always add the click handler
    this.clickHandler = this.handleClick.bind(this);
    this.canvas.addEventListener('click', this.clickHandler);

    this.tootHandler = () => {
      this.playSound(SOUND_KEYS.TOOT);
      this.handleToot();
    };
    document.addEventListener('toot', this.tootHandler);

    this.punchHandler = () => {
      this.playSound(SOUND_KEYS.PUNCH);
      this.handlePunch();
    };
    document.addEventListener('punch', this.punchHandler);

    this.meowHandler = () => {
      this.playSound(SOUND_KEYS.MOUSE_ESCAPE);
    };
    document.addEventListener('meow', this.meowHandler);

    if (!this.isReplay) {
        this.running = false;
        this.startCutscenes();
    } else {
        this.running = true;
    }
  }

  resetGameObjects() {
    this.furniture = this.generateKitchenFurniture();
    this.escapes = this.generateEscapes(NUM_OF_ESCAPES);

    if (this.inputHandler) this.inputHandler.cleanup();

    const { scale, topWallHeight, bottomWallHeight, spawnClearance } = this.layout;

    this.cat = new Cat(
      this.canvas.width / 2,
      this.canvas.height - bottomWallHeight - spawnClearance,
      this.canvas.width,
      this.canvas.height,
      scale
    );
    // Mouse's fixed (100, 100)-style spawn scales with the board too, so it
    // doesn't end up pinned near the true corner on a small canvas.
    this.mouse = new Mouse(100 * scale, 100 * scale, this.canvas.width, this.canvas.height, scale);
    this.dog = new Dog(
                  200 * scale, topWallHeight + spawnClearance, this.canvas.width, this.canvas.height,
                  this.escapes, this.furniture,
                  (soundKey) => this.playSound(SOUND_KEYS.DOG_BARK),
                  scale
                );
    this.dog.setNextBark();

    this.inputHandler = new InputHandler();
    this.mouse.setWallHitCallback(() => this.playSound(SOUND_KEYS.WALL_HIT));
  }

  loadSounds() {
    return {
      //[SOUND_KEYS.BACKGROUND]: this.loadSound('../../../sounds/christmas_tree_farm.mp3', true, 0.1),
      [SOUND_KEYS.BACKGROUND]: this.loadSound('', true, 0.1),
      [SOUND_KEYS.WALL_HIT]: this.loadSound('../../../sounds/bounce.flac'),
      [SOUND_KEYS.CAT_CATCH]: this.loadSound('../../../sounds/mouse.wav'),
      [SOUND_KEYS.MOUSE_ESCAPE]: this.loadSound('../../../sounds/meow.ogg'),
      [SOUND_KEYS.TOOT]: this.loadSound('../../../sounds/toot.wav', false),
      [SOUND_KEYS.PUNCH]: this.loadSound('../../../sounds/punch.ogg', false),
      [SOUND_KEYS.DOG_BARK]: this.loadSound('../../../sounds/dog_barking.wav', false),
    };
  }

  loadSound(src, loop = false, volume = 1.0) {
    const sound = new Audio(src);
    sound.loop = loop;
    sound.volume = volume;
    return sound;
  }

  startCutscenes() {
    const { scale } = this.layout;
    const catAnimation = new Cat(0, 0, this.canvas.width, this.canvas.height, scale);
    const mouseAnimation = new Mouse(0, 0, this.canvas.width, this.canvas.height, scale);
    const dogAnimation = new Dog(0, 0, this.canvas.width, this.canvas.height, [], [], undefined, scale);
    
    // Store cutscene entities
    this.cutsceneCat = catAnimation;
    this.cutsceneMouse = mouseAnimation;
    this.cutsceneDog = dogAnimation;
    
    this.cutsceneManager.addCutscene(
      new Cutscene(this.ctx, catAnimation, 'Meet Mia, the best cat!', () => this.playSound(SOUND_KEYS.MOUSE_ESCAPE))
    );
    this.cutsceneManager.addCutscene(
      new Cutscene(this.ctx, mouseAnimation, 'This is Poop, the butt!', () => this.playSound(SOUND_KEYS.WALL_HIT))
    );
    this.cutsceneManager.addCutscene(
      new Cutscene(this.ctx, dogAnimation, 'Say hello to Dummy, the dumb dog!', () => this.playSound(SOUND_KEYS.DOG_BARK))
    );
    
    this.cutsceneManager.start(() => {
      this.startGame();
    });
  }

  startGame() {
    if (this.cutsceneDog) this.cutsceneDog.cleanup();
    this.resetGameObjects();
    this.running = true;
  }

  handleClick(event) {
    const { offsetX, offsetY } = event;

    if (this.gameOver) {
        // Check if the click is within the "Play Again" button area
        if (this.isClickInside(offsetX, offsetY, this.playAgainButtonArea)) {
            this.restartGame();
            return;
        }

        // Prevent clicking on the message from triggering any action
        return;
    }
  }

  restartGame() {
    this.gameOver = false;
    //this.sounds[SOUND_KEYS.BACKGROUND].pause();
    //this.sounds[SOUND_KEYS.BACKGROUND].currentTime = 0;

    this.cleanup();
    this.screenManager.setScreen(new GameScreen(this.screenManager, this.canvas, this.ctx, true));
  }

  cleanup() {
    document.body.classList.remove('in-game');
    document.removeEventListener('toot', this.tootHandler);
    document.removeEventListener('punch', this.punchHandler);
    document.removeEventListener('meow', this.meowHandler);
    this.canvas.removeEventListener('click', this.clickHandler);
    if (this.inputHandler) this.inputHandler.cleanup();
    if (this.dog) this.dog.cleanup();
  }

  isClickInside(x, y, area) {
    return (
        area &&
        x >= area.x &&
        x <= area.x + area.width &&
        y >= area.y &&
        y <= area.y + area.height
    );
  }

  playSound(soundKey) {
    const sound = this.sounds[soundKey];
    if (sound) {
      sound.currentTime = 0;
      sound.play();
    }
  }

  update(timestamp) {
    if (!this.running) return;

    this.handleCatPause(timestamp);
    this.updateDogCollision(timestamp);

    if (!this.catPaused) {
      this.moveCat();
    }

    this.updateMouse();
    this.dog.update(timestamp, this.cat, () => this.handleDogCollision());
  }

  handleCatPause(timestamp) {
    if (this.catPaused && timestamp >= this.pauseEndTime) {
      this.catPaused = false;
      this.message = '';
      this.dogCollisionCooldown = timestamp + DOG_COLLISION_COOLDOWN;
    }
  }

  handleToot() {
    const MOVE_DISTANCE = 10;
    if (!this.dog) return;

    // Move dog directly away from the cat
    if (this.dog.x < this.cat.x) this.dog.x -= MOVE_DISTANCE;
    else this.dog.x += MOVE_DISTANCE;
    if (this.dog.y < this.cat.y) this.dog.y -= MOVE_DISTANCE;
    else this.dog.y += MOVE_DISTANCE;

    // Ensure the dog stays within bounds
    this.dog.x = Math.max(0, Math.min(this.canvas.width - this.dog.size, this.dog.x));
    this.dog.y = Math.max(0, Math.min(this.canvas.height - this.dog.size, this.dog.y));
  }

  handlePunch() {
    if (!this.dog) return;

    // Start shockwave animation
    this.shockwave = {
      x: this.cat.x + this.cat.displayWidth / 2,
      y: this.cat.y + this.cat.displayHeight / 2,
      startTime: performance.now()
    };

    // Move dog away
    const punchDistance = this.layout.punchDistance;
    if (this.dog.x < this.cat.x) this.dog.x -= punchDistance;
    else this.dog.x += punchDistance;
    if (this.dog.y < this.cat.y) this.dog.y -= punchDistance;
    else this.dog.y += punchDistance;

    // Ensure the dog stays within bounds
    this.dog.x = Math.max(0, Math.min(this.canvas.width - this.dog.size, this.dog.x));
    this.dog.y = Math.max(0, Math.min(this.canvas.height - this.dog.size, this.dog.y));
  }

  moveCat() {
    const direction = this.inputHandler.getDirection();
    if (!direction) return;

    const proposedPosition = { x: this.cat.x, y: this.cat.y };

    if (direction === 'up') proposedPosition.y -= this.cat.speed;
    if (direction === 'down') proposedPosition.y += this.cat.speed;
    if (direction === 'left') proposedPosition.x -= this.cat.speed;
    if (direction === 'right') proposedPosition.x += this.cat.speed;

    const isOnEscape = this.escapes.some(escape => escape.isMouseInside(this.cat));

    const WALL_OFFSET = this.layout.wallOffset;
    const insideWalls = (
        proposedPosition.x >= WALL_OFFSET - this.cat.size &&
        proposedPosition.x <= this.canvas.width - WALL_OFFSET &&
        proposedPosition.y >= WALL_OFFSET - this.cat.size &&
        proposedPosition.y <= this.canvas.height - WALL_OFFSET
    );

    // Add size property for collision check
    const proposedEntity = { x: proposedPosition.x, y: proposedPosition.y, size: this.cat.size };

    if ((insideWalls || isOnEscape) && !this.furniture.some(furniture => furniture.isColliding(proposedEntity))) {
        this.cat.move(direction);
    }
  }

  updateMouse() {
    this.mouse.update();
    const mouseColliding = false; // Mouse can pass through furniture

    if (mouseColliding) {
      this.mouse.speedX *= -1;
      this.mouse.speedY *= -1;
    }

    if (this.checkCollision(this.cat, this.mouse)) {
      this.endGame(MESSAGES.CAT_CAUGHT_MOUSE, SOUND_KEYS.CAT_CATCH);
    } else if (this.checkMouseEscaped()) {
      this.endGame(MESSAGES.MOUSE_ESCAPED, SOUND_KEYS.MOUSE_ESCAPE);
    }
  }

  updateDogCollision(timestamp) {
    if (!this.catPaused && timestamp >= this.dogCollisionCooldown) {
      this.dog.update(timestamp, this.cat, () => this.handleDogCollision());
    }
  }

  handleDogCollision() {
    this.catPaused = true;
    this.pauseEndTime = performance.now() + DOG_PAUSE_DURATION;
    this.message = MESSAGES.DOG_CAUGHT;

    const OFFSET = 20;
    if (this.dog.x < this.cat.x) this.dog.x -= OFFSET;
    else this.dog.x += OFFSET;
    if (this.dog.y < this.cat.y) this.dog.y -= OFFSET;
    else this.dog.y += OFFSET;
  }

  endGame(message, soundKey) {
    this.running = false;
    this.gameOver = true;
    this.message = message;
    this.playSound(soundKey);

    // Cleanup autonomous behaviors
    if (this.dog) this.dog.cleanup();
  }

  checkCollision(cat, mouse) {
    return aabbOverlap(
      cat.x, cat.y, cat.size, cat.size,
      mouse.x, mouse.y, mouse.size, mouse.size
    );
  }

  checkMouseEscaped() {
    return this.escapes.some(escape => escape.isMouseInside(this.mouse));
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawFloor();
    this.drawWalls();
    this.escapes.forEach(escape => escape.draw(this.ctx));
    // Mouse draws before furniture so it visually ducks under furniture
    // it's overlapping, even though it isn't blocked by it (see updateMouse).
    if (this.mouse) this.mouse.draw(this.ctx);
    this.furniture.forEach(furniture => furniture.draw(this.ctx));
    this.drawGameObjects();
    this.drawShockwave();

    if (this.message) this.displayMessage();
  }

  drawFloor() {
    // A small, crisp two-tone tile pattern with grout lines, generated on
    // an offscreen canvas rather than a photographic crop — no image to
    // wait on, so it's available synchronously. Built once and cached on
    // this.floorPattern. Sized like a real modern kitchen floor tile (much
    // smaller than the counters/fridge) and kept plain/flat rather than
    // textured, so it reads as floor sitting behind the furniture instead
    // of competing with it — see COLORS.FLOOR_* above for why the tones are
    // deliberately cooler/more neutral than the furniture's warm palette.
    if (!this.floorPattern) {
      const tileSize = this.layout.floorTileSize;
      const patternCanvas = document.createElement('canvas');
      patternCanvas.width = tileSize * 2;
      patternCanvas.height = tileSize * 2;
      const patternCtx = patternCanvas.getContext('2d');

      patternCtx.fillStyle = COLORS.FLOOR_LIGHT;
      patternCtx.fillRect(0, 0, tileSize * 2, tileSize * 2);
      patternCtx.fillStyle = COLORS.FLOOR_DARK;
      patternCtx.fillRect(tileSize, 0, tileSize, tileSize);
      patternCtx.fillRect(0, tileSize, tileSize, tileSize);

      // Grout lines between every tile, including the seam where this 2x2
      // block repeats, so the repeat doesn't read as a doubled-up tile.
      // Clamped to at least 1px so it doesn't vanish at a small canvas scale.
      patternCtx.strokeStyle = COLORS.FLOOR_GROUT;
      patternCtx.lineWidth = Math.max(1, 2 * this.layout.scale);
      [0, tileSize, tileSize * 2].forEach(pos => {
        patternCtx.beginPath();
        patternCtx.moveTo(pos, 0);
        patternCtx.lineTo(pos, tileSize * 2);
        patternCtx.stroke();
        patternCtx.beginPath();
        patternCtx.moveTo(0, pos);
        patternCtx.lineTo(tileSize * 2, pos);
        patternCtx.stroke();
      });

      this.floorPattern = this.ctx.createPattern(patternCanvas, 'repeat');
    }
    this.ctx.fillStyle = this.floorPattern;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawGameObjects() {
    this.dog.draw(this.ctx);

    if (this.catPaused) this.drawRedOutline();
    this.cat.draw(this.ctx);
  }

  drawShockwave() {
    if (!this.shockwave) return;

    const elapsed = performance.now() - this.shockwave.startTime;

    if (elapsed > PUNCH_SHOCKWAVE_DURATION) {
      this.shockwave = null;
      return;
    }

    const progress = elapsed / PUNCH_SHOCKWAVE_DURATION;
    const radius = progress * this.layout.punchShockwaveMaxRadius;
    const alpha = 1 - progress;

    this.ctx.save();
    this.ctx.strokeStyle = `rgba(138, 43, 226, ${alpha})`;
    this.ctx.lineWidth = Math.max(1, 3 * this.layout.scale);
    this.ctx.beginPath();
    this.ctx.arc(this.shockwave.x, this.shockwave.y, radius, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawRedOutline() {
    this.ctx.save();
    this.ctx.strokeStyle = COLORS.CAT_OUTLINE;
    this.ctx.lineWidth = Math.max(1, this.layout.catOutlineWidth);
    const { x, y, displayWidth, displayHeight } = this.cat;
    this.ctx.strokeRect(x, y, displayWidth, displayHeight);
    this.ctx.restore();
  }

  displayMessage() {
    this.ctx.fillStyle = COLORS.MESSAGE;
    this.ctx.font = `${this.layout.messageFontSize}px Arial`;
    this.ctx.textAlign = 'center';

    // Adjust message position higher
    const messageY = this.canvas.height / 2 - this.layout.messageYOffset; // Position higher above the button
    this.ctx.fillText(this.message, this.canvas.width / 2, messageY);

    if (this.gameOver) {
        this.displayPlayAgainButton(messageY); // Pass messageY to ensure alignment
    }
  }

  displayPlayAgainButton(messageY) {
    const { playButtonWidth, playButtonHeight, playButtonGap, playButtonTextOffsetY, messageFontSize } = this.layout;

    // Place the button distinctly below the message
    const buttonX = this.canvas.width / 2 - playButtonWidth / 2;
    const buttonY = messageY + playButtonGap; // Offset below the message

    this.ctx.fillStyle = COLORS.PLAY_BUTTON.BACKGROUND;
    this.ctx.fillRect(buttonX, buttonY, playButtonWidth, playButtonHeight);
    this.ctx.fillStyle = COLORS.PLAY_BUTTON.TEXT;
    this.ctx.font = `${messageFontSize}px Arial`;
    this.ctx.fillText('Play Again', this.canvas.width / 2, buttonY + playButtonTextOffsetY);

    // Update the playAgainButtonArea for accurate click detection
    this.playAgainButtonArea = { x: buttonX, y: buttonY, width: playButtonWidth, height: playButtonHeight };
  }

  // A wall band flush against all four canvas edges, drawn under the
  // furniture/escapes/characters (called right after drawFloor()) so it
  // reads as the room's wall: furniture sits in front of it (and covers
  // most of it, since furniture is placed flush to the same edges), while
  // any wall left uncovered by furniture — corners, the gaps beside a
  // centered wall run, and crucially the mouse-hole gap left in
  // generateKitchenFurniture() — stays visible. Drawn as two stroked
  // borders (outer at the canvas edge, inner where the band meets the
  // floor) around a filled band, to read as wall thickness rather than a
  // flat painted stripe.
  drawWalls() {
    const t = this.layout.wallBandThickness;
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.save();
    this.ctx.fillStyle = COLORS.WALL_FILL;
    this.ctx.fillRect(0, 0, w, t); // top
    this.ctx.fillRect(0, h - t, w, t); // bottom
    this.ctx.fillRect(0, 0, t, h); // left
    this.ctx.fillRect(w - t, 0, t, h); // right

    this.ctx.strokeStyle = COLORS.WALL_TRIM;
    this.ctx.lineWidth = Math.max(1, 2 * this.layout.scale);
    this.ctx.strokeRect(1, 1, w - 2, h - 2); // outer border
    this.ctx.strokeRect(t, t, w - t * 2, h - t * 2); // inner border
    this.ctx.restore();
  }

  // One guaranteed-visible mouse hole: generateKitchenFurniture() leaves a
  // real gap in one wall's tile run each game and records it as
  // this.wallGap. That gap gets the first escape, placed exactly in the
  // open floor space where a tile would otherwise be — since nothing is
  // drawn over that spot, the mouse stays visible there instead of ducking
  // under solid furniture (see Mouse.js / FURNITURE_SPRITES comment above).
  generateEscapes(count) {
    const escapes = [];
    const escapeSize = this.layout.escapeSize;

    if (this.wallGap) {
      const gap = this.wallGap;
      const x = gap.x + gap.width / 2 - escapeSize / 2;
      const y = gap.wall === 'top' ? 0 : this.canvas.height - escapeSize;
      escapes.push(new Escape(x, y, escapeSize, escapeSize, gap.wall));
    }

    // Escape draws itself rotated per wall (see Escape.js) so the hole's
    // opening always faces into the room rather than always facing "down".
    const WALL_NAMES = ['top', 'bottom', 'left', 'right'];
    while (escapes.length < count) {
      const wall = Math.floor(Math.random() * 4);
      const x = wall === 2 ? 0 : wall === 3 ? this.canvas.width - escapeSize : Math.random() * (this.canvas.width - escapeSize);
      const y = wall === 0 ? 0 : wall === 1 ? this.canvas.height - escapeSize : Math.random() * (this.canvas.height - escapeSize);
      escapes.push(new Escape(x, y, escapeSize, escapeSize, WALL_NAMES[wall]));
    }

    return escapes;
  }

  generateKitchenFurniture() {
    const furniture = [];
    const {
      scale, moduleScale, diningScale, wallBandThickness, wallOffset,
      topWallHeight, bottomWallHeight, leftWallWidth, rightWallWidth,
      spawnClearance, catSizeApprox, mouseSizeApprox, dogSizeApprox,
    } = this.layout;
    const SPACING = 10 * scale;

    // Builds one wall module with its back (the edge facing the wall) flush
    // against the wall band's front face — wallBandThickness in from the
    // canvas edge, not a shared floor baseline. Every piece's back touches
    // the wall this way regardless of its native height, so there's never a
    // strip of bare floor visible between a shorter piece and the wall;
    // only the front (facing the room) varies by height instead.
    const makeModule = (type, x, isTop) => {
      const spec = MODULE_SPECS[type];
      const height = spec.height * moduleScale;
      const y = isTop ? wallBandThickness : this.canvas.height - wallBandThickness - height;
      return new Furniture(x, y, type, spec.sprite, 0, spec.width, spec.height, moduleScale, spec.cropX, spec.cropY);
    };

    // Places `order` edge-to-edge using each piece's own scaled width
    // (unlike the old fixed-cell-width layout, since these renders aren't a
    // uniform size), centered as a group. One slot is skipped if this wall
    // was chosen for the mouse-hole gap this game.
    const buildWall = (order, isTop) => {
      const scaledWidths = order.map(type => MODULE_SPECS[type].width * moduleScale);
      const totalWidth = scaledWidths.reduce((a, b) => a + b, 0);
      let cursorX = Math.max(0, (this.canvas.width - totalWidth) / 2);
      const wallName = isTop ? 'top' : 'bottom';
      const gapIndex = gapWall === wallName ? Math.floor(Math.random() * order.length) : -1;
      const wallHeight = isTop ? topWallHeight : bottomWallHeight;

      order.forEach((type, i) => {
        const w = scaledWidths[i];
        if (i === gapIndex) {
          this.wallGap = { x: cursorX, y: isTop ? 0 : this.canvas.height - wallHeight, width: w, height: wallHeight, wall: wallName };
        } else {
          furniture.push(makeModule(type, cursorX, isTop));
        }
        cursorX += w;
      });

      return cursorX;
    };

    // Places `order` edge-to-edge vertically along the left or right wall,
    // rotated 90/270 so each module's long edge runs along the wall.
    // Confined strictly to the band between the top and bottom walls (not
    // flush to the very top/bottom of the canvas) so it can never corner-
    // overlap the top wall's fridge or the bottom wall's run. Each module's
    // back is flush against the wall band's front face — x=wallBandThickness
    // for left, canvas.width-wallBandThickness-depth for right — the same
    // back-to-wall alignment as the horizontal walls, rather than flush to
    // the raw canvas edge.
    const buildWallVertical = (order, isLeft) => {
      const scaledLengths = order.map(type => MODULE_SPECS[type].width * moduleScale);
      const totalLength = scaledLengths.reduce((a, b) => a + b, 0);
      const bandTop = topWallHeight;
      const bandHeight = this.canvas.height - bottomWallHeight - topWallHeight;
      let cursorY = bandTop + Math.max(0, (bandHeight - totalLength) / 2);
      const rotation = isLeft ? LEFT_WALL_ROTATION : RIGHT_WALL_ROTATION;

      order.forEach((type, i) => {
        const spec = MODULE_SPECS[type];
        const depth = spec.height * moduleScale;
        const x = isLeft ? wallBandThickness : this.canvas.width - wallBandThickness - depth;
        furniture.push(new Furniture(x, cursorY, type, spec.sprite, rotation, spec.width, spec.height, moduleScale, spec.cropX, spec.cropY));
        cursorY += scaledLengths[i];
      });
    };

    // Pick exactly one wall to leave one module out of, each game — that gap
    // becomes this.wallGap, read by generateEscapes() to place a guaranteed-
    // visible mouse hole there. Only top/bottom are in the pool — left/right
    // are solid runs with no gap (generateEscapes()'s x/y math only handles
    // horizontal walls today).
    const gapWall = Math.random() < 0.5 ? 'top' : 'bottom';
    this.wallGap = null;

    // 1. Top wall: cabinet/stove/sink/cabinet, back flush against the wall
    // band. The fridge sits right after, back-aligned the same way as the
    // counters (its top edge flush with the wall band's front face) so it
    // reads as standing against the same wall rather than floating or sunken.
    const topEndX = buildWall(TOP_WALL_ORDER, true);
    furniture.push(new Furniture(topEndX, wallBandThickness, 'fridge', FURNITURE_SPRITES.FRIDGE, 0, FRIDGE_SPEC.width, FRIDGE_SPEC.height, moduleScale, FRIDGE_SPEC.cropX, FRIDGE_SPEC.cropY));

    // 2. Bottom wall: same treatment, flush against the bottom edge, with a
    // different order than the top wall for a bit of variety.
    buildWall(BOTTOM_WALL_ORDER, false);

    // 3. Left and right walls (new): cabinet runs rotated to stand against
    // the vertical walls, confined to the band between the top and bottom
    // walls so nothing corners-overlaps.
    buildWallVertical(LEFT_WALL_ORDER, true);
    buildWallVertical(RIGHT_WALL_ORDER, false);

    // Helper to check overlap, used for the freestanding dining set.
    const overlaps = (x, y, width, height) => {
      return furniture.some(f => {
        return !(x + width + SPACING < f.x ||
                 x > f.x + f.width + SPACING ||
                 y + height + SPACING < f.y ||
                 y > f.y + f.height + SPACING);
      });
    };

    // Entity spawn positions to avoid — must match resetGameObjects() exactly
    const catSpawnX = this.canvas.width / 2;
    const catSpawnY = this.canvas.height - bottomWallHeight - spawnClearance;
    const catSize = catSizeApprox;
    const mouseSpawnX = 100 * scale;
    const mouseSpawnY = 100 * scale;
    const mouseSize = mouseSizeApprox;
    const dogSpawnX = 200 * scale;
    const dogSpawnY = topWallHeight + spawnClearance;
    const dogSize = dogSizeApprox;
    const SPAWN_BUFFER = 20 * scale;

    const blocksSpawn = (x, y, width, height) => {
      const spawns = [
        { x: catSpawnX, y: catSpawnY, size: catSize },
        { x: mouseSpawnX, y: mouseSpawnY, size: mouseSize },
        { x: dogSpawnX, y: dogSpawnY, size: dogSize }
      ];

      return spawns.some(spawn => {
        return !(x > spawn.x + spawn.size + SPAWN_BUFFER ||
                 x + width < spawn.x - SPAWN_BUFFER ||
                 y > spawn.y + spawn.size + SPAWN_BUFFER ||
                 y + height < spawn.y - SPAWN_BUFFER);
      });
    };

    const INTERIOR_MARGIN = 20 * scale;
    const playableX = wallOffset + INTERIOR_MARGIN + leftWallWidth;
    const playableY = topWallHeight + INTERIOR_MARGIN;
    const playableRightEdge = this.canvas.width - wallOffset - INTERIOR_MARGIN - rightWallWidth;
    const playableMaxWidth = playableRightEdge - playableX;
    const playableMaxHeight = this.canvas.height - bottomWallHeight - INTERIOR_MARGIN - playableY;

    // 4. Dining set: table and one chair placed side by side (not stacked
    // front/back like an earlier round), sharing a random-search footprint
    // sized to the taller of the two pieces — placing them front-and-back
    // would need combined chair+table+chair height, which doesn't fit the
    // interior band at this scale (confirmed live). Side-by-side only needs
    // as much vertical room as the taller piece.
    const DINING_GAP = 10 * scale;
    const tableWidth = TABLE_SPEC.width * diningScale;
    const tableHeight = TABLE_SPEC.height * diningScale;
    const chairWidth = CHAIR_SPEC.width * diningScale;
    const chairHeight = CHAIR_SPEC.height * diningScale;
    const setWidth = tableWidth + DINING_GAP + chairWidth;
    const setHeight = Math.max(tableHeight, chairHeight);

    let diningAttempts = 0;
    while (diningAttempts < 300) {
      const x = playableX + Math.random() * Math.max(0, playableMaxWidth - setWidth);
      const y = playableY + Math.random() * Math.max(0, playableMaxHeight - setHeight);

      if (!overlaps(x, y, setWidth, setHeight) && !blocksSpawn(x, y, setWidth, setHeight)) {
        furniture.push(new Furniture(x, y + (setHeight - tableHeight) / 2, 'table', FURNITURE_SPRITES.TABLE, 0, TABLE_SPEC.width, TABLE_SPEC.height, diningScale, TABLE_SPEC.cropX, TABLE_SPEC.cropY));
        furniture.push(new Furniture(x + tableWidth + DINING_GAP, y + (setHeight - chairHeight) / 2, 'chair', FURNITURE_SPRITES.CHAIR, 0, CHAIR_SPEC.width, CHAIR_SPEC.height, diningScale, CHAIR_SPEC.cropX, CHAIR_SPEC.cropY));
        break;
      }
      diningAttempts++;
    }

    return furniture;
  }
}
