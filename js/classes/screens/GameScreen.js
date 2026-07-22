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

// Furniture sprite paths
const FURNITURE_SPRITES = {
  FRIDGE: './assets/kitchen_fridge.png',
  DINING_SET: './assets/dining_set.png', // table + chairs cropped as one connected piece
  ISLAND_STOVE: './assets/kitchen_island_stove.png',
  ISLAND_RANGE: './assets/kitchen_island_range.png',
  SIDE_TABLE: './assets/kitchen_side_table.png',
  // Add more as we expand
};

// Every wall is a run of several natural-seam tiles (one per appliance/
// cabinet section) cropped from assets/kitchen_reference_scene.jpg and
// placed edge-to-edge in the same left-to-right order they appear in the
// source photo — NOT one single wide strip. A single strip per wall was
// tried and reverted: it meant the wall could never have a gap, so any
// mouse hole placed along it was always hidden behind solid furniture
// (Mouse.js intentionally isn't blocked by furniture and is drawn under it —
// see Mouse.js above — so a solid wall makes the mouse invisible whenever
// it's under that wall). Tiles restore the ability to leave exactly one
// tile slot empty per game (see generateKitchenFurniture) so there's a real
// gap of open floor for a visible mouse hole.
//
// These are photographic-style crops with baked-in lighting/shadow from a
// single fixed camera angle, unlike the old flat sprite-sheet pieces —
// rotating them to face a different wall would make the shadows point the
// wrong way and look broken. So each is only ever placed at rotation 0, used
// only for the wall it was actually cropped from. `FRIDGE` is the one
// exception — it's the old flat Reakain sprite, which genuinely was
// designed to rotate.
//
// Scale is 1 (native) rather than shrunk, specifically so any floor-tile
// pixels caught at a crop's edge are the same size as the tiled
// `floor_tile.png` background behind them — shrinking these independently
// of the floor tile is what caused a visible tile-size mismatch before.
const REF1_SCALE = 1;

// The freestanding "island" accents (stove, range, side table) don't share
// the wall tiles' floor-tile-edge-matching concern — they're small, tightly
// cropped standalone objects, not long strips with floor bleeding along
// their edges — so they're free to scale independently. Confirmed live via
// a debug hook that at native size, the interior floor band between the two
// walls (~190px tall once cat/dog spawn clearance is accounted for) is too
// narrow to ever fit all three islands plus the dining set at once: they
// silently failed to place every game. Scaled down, they fit reliably.
const ISLAND_SCALE = 0.55;

// Height is uniform across all tiles on the same wall (they're all cropped
// from the same horizontal band of the source photo) — TOP_WALL_HEIGHT/
// BOTTOM_WALL_HEIGHT below assert that rather than re-deriving it per tile.
const TOP_WALL_TILES = [
  { type: 'top_stove_single', sprite: './assets/kitchen_top_stove_single.png', width: 135, height: 215 },
  { type: 'top_range', sprite: './assets/kitchen_top_range.png', width: 350, height: 215 },
  { type: 'top_vent', sprite: './assets/kitchen_top_vent.png', width: 90, height: 215 },
  { type: 'top_cabinets', sprite: './assets/kitchen_top_cabinets.png', width: 305, height: 215 },
  { type: 'top_rack', sprite: './assets/kitchen_top_rack.png', width: 120, height: 215 },
];
const BOTTOM_WALL_TILES = [
  { type: 'bottom_sink', sprite: './assets/kitchen_bottom_sink.png', width: 420, height: 205 },
  { type: 'bottom_stove', sprite: './assets/kitchen_bottom_stove.png', width: 325, height: 205 },
  { type: 'bottom_utility', sprite: './assets/kitchen_bottom_utility.png', width: 255, height: 205 },
];

const REF1_PIECES = {
  // dining_set is scaled slightly down from native (unlike the wall tiles,
  // it isn't a long strip with floor-tile bleed to keep in sync) — at full
  // size it was the single largest freestanding piece, larger than any one
  // scaled-down island, and reliably starved whichever piece got placed
  // after it. A modest trim gives every piece a realistic shot at fitting.
  dining_set: { sprite: FURNITURE_SPRITES.DINING_SET, width: 250, height: 130, scale: 0.85 },
  island_stove: { sprite: FURNITURE_SPRITES.ISLAND_STOVE, width: 185, height: 148, scale: ISLAND_SCALE },
  island_range: { sprite: FURNITURE_SPRITES.ISLAND_RANGE, width: 270, height: 115, scale: ISLAND_SCALE },
  side_table: { sprite: FURNITURE_SPRITES.SIDE_TABLE, width: 180, height: 155, scale: ISLAND_SCALE },
};

// The wall tiles are much deeper than furniture used to be (215px/205px vs
// ~96px), so entity spawn points that used to sit safely in front of them
// can now land inside their collision box. Shared here so the cat/dog spawn
// positions used in resetGameObjects() stay in lockstep with the same
// points generateKitchenFurniture() keeps the dining table clear of.
const TOP_WALL_HEIGHT = 215;
const BOTTOM_WALL_HEIGHT = 205;
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
  FLOOR_FALLBACK: '#e8c9a3', // shown briefly before floor_tile.png loads
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

    this.floorImage = new Image();
    this.floorImage.src = './assets/floor_tile.png';
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
    if (!this.floorPattern && this.floorImage.complete) {
      this.floorPattern = this.ctx.createPattern(this.floorImage, 'repeat');
    }
    this.ctx.fillStyle = this.floorPattern || COLORS.FLOOR_FALLBACK;
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

    // Builds a Furniture instance for a freestanding ref1-cropped piece
    // (dining set / islands) using its own native size, always at rotation 0
    // (see FURNITURE_SPRITES comment above — these can't be rotated without
    // the baked-in lighting looking wrong). The fridge is the one exception:
    // it's still the old Reakain-sourced flat sprite, which was actually
    // designed to rotate, so it keeps using Furniture's own defaults.
    const makePiece = (type, x, y) => {
      if (type === 'fridge') {
        return new Furniture(x, y, 'fridge', FURNITURE_SPRITES.FRIDGE, 0);
      }
      const piece = REF1_PIECES[type];
      return new Furniture(x, y, type, piece.sprite, 0, piece.width, piece.height, piece.scale);
    };

    // Helper to check overlap
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

    // Extra space around spawn points, kept modest since the interior band
    // between the two wall runs is fairly narrow (~190px) — a larger buffer
    // here previously combined with the dining set's footprint to exclude
    // nearly the entire interior, leaving no room for the freestanding
    // island accents to ever find a valid spot (confirmed live: they always
    // failed to place until this was reduced).
    const SPAWN_BUFFER = 20;

    // Helper to check if furniture would block entity spawns
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

    // Pick exactly one wall to leave one tile out of, each game — that gap
    // becomes this.wallGap, read by generateEscapes() to place a guaranteed-
    // visible mouse hole there. The other wall stays a complete run.
    const gapWall = Math.random() < 0.5 ? 'top' : 'bottom';
    const gapTileIndex = Math.floor(
      Math.random() * (gapWall === 'top' ? TOP_WALL_TILES.length : BOTTOM_WALL_TILES.length)
    );
    this.wallGap = null;

    // 1. Top wall: natural-seam tiles placed edge-to-edge in source order
    // (stove, range/cabinets, vent, cabinets, dish rack), centered
    // horizontally and flush against the top edge. The fridge (still a real
    // rotatable sprite) sits right after the last tile.
    const topWallWidth = TOP_WALL_TILES.reduce((sum, t) => sum + t.width, 0);
    let cursorX = Math.max(0, (this.canvas.width - topWallWidth) / 2);
    TOP_WALL_TILES.forEach((tile, i) => {
      if (gapWall === 'top' && i === gapTileIndex) {
        this.wallGap = { x: cursorX, y: 0, width: tile.width, height: tile.height, wall: 'top' };
      } else {
        furniture.push(new Furniture(cursorX, 0, tile.type, tile.sprite, 0, tile.width, tile.height, REF1_SCALE));
      }
      cursorX += tile.width;
    });
    furniture.push(makePiece('fridge', cursorX, 0));

    // 2. Bottom wall: natural-seam tiles (sink run, double stove, utility
    // run) placed the same way, flush against the bottom edge.
    const bottomWallWidth = BOTTOM_WALL_TILES.reduce((sum, t) => sum + t.width, 0);
    let cursorBottomX = Math.max(0, (this.canvas.width - bottomWallWidth) / 2);
    const bottomY = this.canvas.height - BOTTOM_WALL_HEIGHT;
    BOTTOM_WALL_TILES.forEach((tile, i) => {
      if (gapWall === 'bottom' && i === gapTileIndex) {
        this.wallGap = { x: cursorBottomX, y: bottomY, width: tile.width, height: tile.height, wall: 'bottom' };
      } else {
        furniture.push(new Furniture(cursorBottomX, bottomY, tile.type, tile.sprite, 0, tile.width, tile.height, REF1_SCALE));
      }
      cursorBottomX += tile.width;
    });

    // 3. Freestanding pieces — the dining set plus a handful of "island"
    // accents (a 4-burner stove, a 3-burner range, a small side table) — each
    // placed randomly in the open interior via the same overlaps/blocksSpawn
    // random-search, avoiding the two wall runs and the cat/mouse/dog spawn
    // points. The interior is tight, so a piece that can't find a free spot
    // in 200 tries is simply skipped that game rather than forced to overlap.
    //
    // INTERIOR_MARGIN keeps furniture a bit clear of the wall tiles rather
    // than touching them — this used to double-count WALL_OFFSET (the outer
    // game-border margin, unrelated to the walls) on top of the full wall
    // heights, which left a negative/near-zero height budget: every
    // freestanding piece got clamped to the exact same y, so only the first
    // one placed could ever avoid colliding with the rest. A real bug, not
    // just too few attempts — confirmed live via a debug hook showing
    // island_range/island_stove/side_table all silently failing to place.
    const INTERIOR_MARGIN = 20;
    const playableX = WALL_OFFSET + INTERIOR_MARGIN;
    const playableY = TOP_WALL_HEIGHT + INTERIOR_MARGIN;
    const playableMaxWidth = this.canvas.width - playableX * 2;
    const playableMaxHeight = this.canvas.height - BOTTOM_WALL_HEIGHT - INTERIOR_MARGIN - playableY;

    const placeFreestanding = (type) => {
      const spec = REF1_PIECES[type];
      const width = spec.width * spec.scale;
      const height = spec.height * spec.scale;

      let attempts = 0;
      while (attempts < 300) {
        const x = playableX + Math.random() * Math.max(0, playableMaxWidth - width);
        const y = playableY + Math.random() * Math.max(0, playableMaxHeight - height);

        if (!overlaps(x, y, width, height) && !blocksSpawn(x, y, width, height)) {
          furniture.push(makePiece(type, x, y));
          return;
        }
        attempts++;
      }
    };

    // dining_set goes first (it's the priority centerpiece and now scaled
    // closer in size to the islands — see REF1_PIECES.dining_set — so it no
    // longer starves whichever piece is placed last).
    ['dining_set', 'island_range', 'island_stove', 'side_table'].forEach(placeFreestanding);

    return furniture;
  }
}
