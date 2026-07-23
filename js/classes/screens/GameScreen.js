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

// ==============================
//  CONSTANTS
// ==============================
const WALL_THICKNESS = 15;
const ESCAPE_SIZE = 15;
const NUM_OF_ESCAPES = 6;

// Furniture sprite paths — AI-generated photorealistic renders (via
// yeri.ai/Stable Diffusion), one object per image, each individually
// trimmed to its own bounding box with the white studio background made
// transparent (see the pixel-processing step in git history / commit
// message — near-white pixels converted to alpha 0 on an offscreen canvas).
// This is the THIRD kitchen art direction this project has had — see
// CLAUDE.md Kitchen furniture section for why the flat-cartoon PtPt pack
// (and the photo-crop scene before that) were replaced: the user wanted
// the kitchen to look "as realistic as possible," which a hand-drawn pack
// couldn't deliver no matter how well it matched the layout mechanics.
// Individual AI-generated objects (rather than one big AI scene, which is
// what the *first* art direction tried and which caused all the alignment
// problems) keep the modular wall-building/gap mechanic intact.
const FURNITURE_SPRITES = {
  CABINET: './assets/realistic_cabinet.png',
  SINK: './assets/realistic_sink.png',
  STOVE: './assets/realistic_stove.png',
  FRIDGE: './assets/realistic_fridge.png',
  TABLE: './assets/realistic_table.png',
  CHAIR: './assets/realistic_chair.png',
};

// Unlike the old PtPt pack (uniform 64px-wide sprites), these renders each
// have their own native size — cropped tightly to their own content, not to
// a shared grid. Wall modules are placed edge-to-edge using each piece's own
// scaled width (see buildWall() below) rather than a fixed cell size, and
// aligned to a shared baseline (the floor line) since their heights differ
// too — same principle as before, just without a uniform width to lean on.
const MODULE_SCALE = 0.22;
const MODULE_SPECS = {
  cabinet: { sprite: FURNITURE_SPRITES.CABINET, width: 914, height: 797 },
  sink: { sprite: FURNITURE_SPRITES.SINK, width: 947, height: 817 },
  stove: { sprite: FURNITURE_SPRITES.STOVE, width: 850, height: 703 },
};
// Only 3 distinct wall-module renders exist (no separate plain "counter"
// render this round) — cabinet doubles as filler, same role COUNTER played
// with the PtPt pack.
const TOP_WALL_ORDER = ['cabinet', 'stove', 'sink', 'cabinet'];
const BOTTOM_WALL_ORDER = ['sink', 'cabinet', 'stove', 'cabinet'];

const FRIDGE_SPEC = { width: 462, height: 957 };
// Dining set: table and one chair placed side by side (not front/back
// chairs around the table like the PtPt round) — this photorealistic chair
// render only exists from one angle, and stacking chair+table+chair
// vertically (as PtPt's two-chair layout did) needed far more interior
// height than these much-taller-relative-to-canvas renders leave room for.
// Side-by-side needs only as much height as the taller of the two pieces.
const TABLE_SPEC = { width: 642, height: 617 };
const CHAIR_SPEC = { width: 835, height: 840 };
const DINING_SCALE = MODULE_SCALE;

// Wall clearance must cover the tallest thing on that wall — the fridge
// (957 native, much taller than any counter module) sits on the top wall,
// so TOP_WALL_HEIGHT is sized from the fridge, not from the counter modules,
// or the cat/dog spawn points would land inside the fridge's collision box
// (the same class of stuck-spawn bug hit twice already in this project's
// history — see CLAUDE.md).
const TOP_WALL_HEIGHT = Math.ceil(FRIDGE_SPEC.height * MODULE_SCALE);
const BOTTOM_WALL_HEIGHT = Math.ceil(MODULE_SPECS.sink.height * MODULE_SCALE);
const SPAWN_CLEARANCE = 60;

const DOG_PAUSE_DURATION = 2000;
const DOG_COLLISION_COOLDOWN = 1000;
const PUNCH_DISTANCE = 40;
const PUNCH_SHOCKWAVE_DURATION = 200;

const CAT_OUTLINE_WIDTH = 3;
const MESSAGE_FONT_SIZE = 24;
const PLAY_BUTTON_WIDTH = 150;
const PLAY_BUTTON_HEIGHT = 50;
const PLAY_BUTTON_OFFSET_Y = 50;

const COLORS = {
  WALL: 'blue',
  MESSAGE: 'purple',
  PLAY_BUTTON: {
    BACKGROUND: 'navy',
    TEXT: 'white',
  },
  CAT_OUTLINE: 'red',
  // A simple two-tone checker instead of a photographic floor crop — see
  // drawFloor(). Warm cream/peach tones picked to sit behind the PtPt
  // counter sprites' own palette without competing with it.
  FLOOR_LIGHT: '#fdf1e0',
  FLOOR_DARK: '#f6ddbe',
};

const FONTS = {
  MESSAGE: `${MESSAGE_FONT_SIZE}px Arial`,
  PLAY_BUTTON: '24px Arial',
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

    this.cat = new Cat(
      this.canvas.width / 2,
      this.canvas.height - BOTTOM_WALL_HEIGHT - SPAWN_CLEARANCE,
      this.canvas.width,
      this.canvas.height
    );
    this.mouse = new Mouse(100, 100, this.canvas.width, this.canvas.height);
    this.dog = new Dog(
                  200, TOP_WALL_HEIGHT + SPAWN_CLEARANCE, this.canvas.width, this.canvas.height,
                  this.escapes, this.furniture,
                  (soundKey) => this.playSound(SOUND_KEYS.DOG_BARK)
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
    const catAnimation = new Cat(0, 0, this.canvas.width, this.canvas.height);
    const mouseAnimation = new Mouse(0, 0, this.canvas.width, this.canvas.height);
    const dogAnimation = new Dog(0, 0, this.canvas.width, this.canvas.height);
    
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
      x: this.cat.x + (this.cat.frameWidth / 4) / 2,
      y: this.cat.y + (this.cat.frameHeight / 4) / 2,
      startTime: performance.now()
    };

    // Move dog away
    if (this.dog.x < this.cat.x) this.dog.x -= PUNCH_DISTANCE;
    else this.dog.x += PUNCH_DISTANCE;
    if (this.dog.y < this.cat.y) this.dog.y -= PUNCH_DISTANCE;
    else this.dog.y += PUNCH_DISTANCE;

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

    const WALL_OFFSET = 40;
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
    // A simple two-tone checker generated on an offscreen canvas, rather
    // than a photographic crop — the old floor_tile.png was cropped from
    // the same AI-generated kitchen photo as the furniture we've since
    // replaced, and would clash with the PtPt cartoon sprites' flat color
    // style. Built once and cached on this.floorPattern (no image to wait
    // on, so it's available synchronously, unlike the old image-load path).
    if (!this.floorPattern) {
      const tileSize = 40;
      const patternCanvas = document.createElement('canvas');
      patternCanvas.width = tileSize * 2;
      patternCanvas.height = tileSize * 2;
      const patternCtx = patternCanvas.getContext('2d');
      patternCtx.fillStyle = COLORS.FLOOR_LIGHT;
      patternCtx.fillRect(0, 0, tileSize * 2, tileSize * 2);
      patternCtx.fillStyle = COLORS.FLOOR_DARK;
      patternCtx.fillRect(0, 0, tileSize, tileSize);
      patternCtx.fillRect(tileSize, tileSize, tileSize, tileSize);
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
    const maxRadius = 60;
    const radius = progress * maxRadius;
    const alpha = 1 - progress;

    this.ctx.save();
    this.ctx.strokeStyle = `rgba(138, 43, 226, ${alpha})`; 
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.arc(this.shockwave.x, this.shockwave.y, radius, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawRedOutline() {
    this.ctx.save();
    this.ctx.strokeStyle = COLORS.CAT_OUTLINE;
    this.ctx.lineWidth = CAT_OUTLINE_WIDTH;
    const { frameWidth, frameHeight, x, y } = this.cat;
    this.ctx.strokeRect(x, y, frameWidth / 4, frameHeight / 4);
    this.ctx.restore();
  }

  displayMessage() {
    this.ctx.fillStyle = COLORS.MESSAGE;
    this.ctx.font = FONTS.MESSAGE;
    this.ctx.textAlign = 'center';

    // Adjust message position higher
    const messageY = this.canvas.height / 2 - 80; // Position higher above the button
    this.ctx.fillText(this.message, this.canvas.width / 2, messageY);

    if (this.gameOver) {
        this.displayPlayAgainButton(messageY); // Pass messageY to ensure alignment
    }
  }

  displayPlayAgainButton(messageY) {
    // Place the button distinctly below the message
    const buttonX = this.canvas.width / 2 - PLAY_BUTTON_WIDTH / 2;
    const buttonY = messageY + 40; // Offset below the message

    this.ctx.fillStyle = COLORS.PLAY_BUTTON.BACKGROUND;
    this.ctx.fillRect(buttonX, buttonY, PLAY_BUTTON_WIDTH, PLAY_BUTTON_HEIGHT);
    this.ctx.fillStyle = COLORS.PLAY_BUTTON.TEXT;
    this.ctx.font = FONTS.PLAY_BUTTON;
    this.ctx.fillText('Play Again', this.canvas.width / 2, buttonY + 33);

    // Update the playAgainButtonArea for accurate click detection
    this.playAgainButtonArea = { x: buttonX, y: buttonY, width: PLAY_BUTTON_WIDTH, height: PLAY_BUTTON_HEIGHT };
  }

  drawWallBorders() {
    const WALL_OFFSET = 40; // Creates space for cat and dog behind walls

    this.ctx.fillStyle = COLORS.WALL;
    this.ctx.fillRect(WALL_OFFSET, WALL_OFFSET, this.canvas.width - WALL_OFFSET * 2, WALL_THICKNESS); // Top
    this.ctx.fillRect(WALL_OFFSET, this.canvas.height - WALL_THICKNESS - WALL_OFFSET, this.canvas.width - WALL_OFFSET * 2, WALL_THICKNESS); // Bottom
    this.ctx.fillRect(WALL_OFFSET, WALL_OFFSET, WALL_THICKNESS, this.canvas.height - WALL_OFFSET * 2); // Left
    this.ctx.fillRect(this.canvas.width - WALL_THICKNESS - WALL_OFFSET, WALL_OFFSET, WALL_THICKNESS, this.canvas.height - WALL_OFFSET * 2); // Right
  }

  // One guaranteed-visible mouse hole: generateKitchenFurniture() leaves a
  // real gap in one wall's tile run each game and records it as
  // this.wallGap. That gap gets the first escape, placed exactly in the
  // open floor space where a tile would otherwise be — since nothing is
  // drawn over that spot, the mouse stays visible there instead of ducking
  // under solid furniture (see Mouse.js / FURNITURE_SPRITES comment above).
  generateEscapes(count) {
    const escapes = [];

    if (this.wallGap) {
      const gap = this.wallGap;
      const x = gap.x + gap.width / 2 - ESCAPE_SIZE / 2;
      const y = gap.wall === 'top' ? 0 : this.canvas.height - ESCAPE_SIZE;
      escapes.push(new Escape(x, y, ESCAPE_SIZE, ESCAPE_SIZE));
    }

    while (escapes.length < count) {
      const wall = Math.floor(Math.random() * 4);
      const x = wall === 2 ? 0 : wall === 3 ? this.canvas.width - ESCAPE_SIZE : Math.random() * (this.canvas.width - ESCAPE_SIZE);
      const y = wall === 0 ? 0 : wall === 1 ? this.canvas.height - ESCAPE_SIZE : Math.random() * (this.canvas.height - ESCAPE_SIZE);
      escapes.push(new Escape(x, y, ESCAPE_SIZE, ESCAPE_SIZE));
    }

    return escapes;
  }

  generateKitchenFurniture() {
    const furniture = [];
    const WALL_OFFSET = 40;
    const SPACING = 10;

    // Builds one wall module, aligned to a shared baseline (the floor line)
    // rather than a shared top — these renders have different native
    // heights (no shared grid unlike the old PtPt pack), so aligning by
    // their bottom edge is what makes them read as sitting on the same
    // floor, the way real counters of different heights actually do.
    const makeModule = (type, x, baselineY) => {
      const spec = MODULE_SPECS[type];
      const height = spec.height * MODULE_SCALE;
      return new Furniture(x, baselineY - height, type, spec.sprite, 0, spec.width, spec.height, MODULE_SCALE);
    };

    // Places `order` edge-to-edge using each piece's own scaled width
    // (unlike the old fixed-cell-width layout, since these renders aren't a
    // uniform size), centered as a group. One slot is skipped if this wall
    // was chosen for the mouse-hole gap this game.
    const buildWall = (order, isTop) => {
      const scaledWidths = order.map(type => MODULE_SPECS[type].width * MODULE_SCALE);
      const totalWidth = scaledWidths.reduce((a, b) => a + b, 0);
      let cursorX = Math.max(0, (this.canvas.width - totalWidth) / 2);
      const wallName = isTop ? 'top' : 'bottom';
      const gapIndex = gapWall === wallName ? Math.floor(Math.random() * order.length) : -1;
      const baselineY = isTop ? TOP_WALL_HEIGHT : this.canvas.height;
      const wallHeight = isTop ? TOP_WALL_HEIGHT : BOTTOM_WALL_HEIGHT;

      order.forEach((type, i) => {
        const w = scaledWidths[i];
        if (i === gapIndex) {
          this.wallGap = { x: cursorX, y: isTop ? 0 : this.canvas.height - BOTTOM_WALL_HEIGHT, width: w, height: wallHeight, wall: wallName };
        } else {
          furniture.push(makeModule(type, cursorX, baselineY));
        }
        cursorX += w;
      });

      return cursorX;
    };

    // Pick exactly one wall to leave one module out of, each game — that gap
    // becomes this.wallGap, read by generateEscapes() to place a guaranteed-
    // visible mouse hole there. The other wall stays a complete run.
    const gapWall = Math.random() < 0.5 ? 'top' : 'bottom';
    this.wallGap = null;

    // 1. Top wall: cabinet/stove/sink/cabinet, flush against the top edge.
    // The fridge (much taller than the counter modules) sits right after,
    // its top flush with the wall's top edge like the counters, so it reads
    // as standing on the same floor rather than floating or sunken.
    const topEndX = buildWall(TOP_WALL_ORDER, true);
    furniture.push(new Furniture(topEndX, 0, 'fridge', FURNITURE_SPRITES.FRIDGE, 0, FRIDGE_SPEC.width, FRIDGE_SPEC.height, MODULE_SCALE));

    // 2. Bottom wall: same treatment, flush against the bottom edge, with a
    // different order than the top wall for a bit of variety.
    buildWall(BOTTOM_WALL_ORDER, false);

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
    const catSpawnY = this.canvas.height - BOTTOM_WALL_HEIGHT - SPAWN_CLEARANCE;
    const catSize = 39; // Approximate cat size
    const mouseSpawnX = 100;
    const mouseSpawnY = 100;
    const mouseSize = 32;
    const dogSpawnX = 200;
    const dogSpawnY = TOP_WALL_HEIGHT + SPAWN_CLEARANCE;
    const dogSize = 50;
    const SPAWN_BUFFER = 20;

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

    const INTERIOR_MARGIN = 20;
    const playableX = WALL_OFFSET + INTERIOR_MARGIN;
    const playableY = TOP_WALL_HEIGHT + INTERIOR_MARGIN;
    const playableMaxWidth = this.canvas.width - playableX * 2;
    const playableMaxHeight = this.canvas.height - BOTTOM_WALL_HEIGHT - INTERIOR_MARGIN - playableY;

    // 3. Dining set: table and one chair placed side by side (not stacked
    // front/back like an earlier round), sharing a random-search footprint
    // sized to the taller of the two pieces — placing them front-and-back
    // would need combined chair+table+chair height, which doesn't fit the
    // interior band at this scale (confirmed live). Side-by-side only needs
    // as much vertical room as the taller piece.
    const DINING_GAP = 10;
    const tableWidth = TABLE_SPEC.width * DINING_SCALE;
    const tableHeight = TABLE_SPEC.height * DINING_SCALE;
    const chairWidth = CHAIR_SPEC.width * DINING_SCALE;
    const chairHeight = CHAIR_SPEC.height * DINING_SCALE;
    const setWidth = tableWidth + DINING_GAP + chairWidth;
    const setHeight = Math.max(tableHeight, chairHeight);

    let diningAttempts = 0;
    while (diningAttempts < 300) {
      const x = playableX + Math.random() * Math.max(0, playableMaxWidth - setWidth);
      const y = playableY + Math.random() * Math.max(0, playableMaxHeight - setHeight);

      if (!overlaps(x, y, setWidth, setHeight) && !blocksSpawn(x, y, setWidth, setHeight)) {
        furniture.push(new Furniture(x, y + (setHeight - tableHeight) / 2, 'table', FURNITURE_SPRITES.TABLE, 0, TABLE_SPEC.width, TABLE_SPEC.height, DINING_SCALE));
        furniture.push(new Furniture(x + tableWidth + DINING_GAP, y + (setHeight - chairHeight) / 2, 'chair', FURNITURE_SPRITES.CHAIR, 0, CHAIR_SPEC.width, CHAIR_SPEC.height, DINING_SCALE));
        break;
      }
      diningAttempts++;
    }

    return furniture;
  }
}
