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
  TOP_WALL: './assets/kitchen_top_wall.png',
  BOTTOM_WALL: './assets/kitchen_bottom_wall.png',
  DINING_SET: './assets/dining_set.png', // table + chairs cropped as one connected piece
  // Add more as we expand
};

// Each of TOP_WALL/BOTTOM_WALL/DINING_SET is a whole continuous section
// lifted directly from the reference kitchen photo (assets/kitchen_reference_scene.jpg)
// rather than individual appliances cropped separately and reassembled —
// cropping whole wall sections guarantees the counters/appliances inside
// them stay exactly as aligned as they are in the source, since there's no
// reassembly step left to get wrong.
//
// These are photographic-style crops with baked-in lighting/shadow from a
// single fixed camera angle, unlike the old flat sprite-sheet pieces —
// rotating them to face a different wall would make the shadows point the
// wrong way and look broken. So each is only ever placed at rotation 0, used
// only for the wall it was actually cropped from (the bottom wall crop is
// already correctly oriented for the bottom of the room in the source photo,
// not rotated to face that way). `FRIDGE` is the one exception — it's the
// old flat Reakain sprite, which genuinely was designed to rotate.
//
// Scale is 1 (native) rather than shrunk, specifically so any floor-tile
// pixels caught at a crop's edge are the same size as the tiled
// `floor_tile.png` background behind them — shrinking these independently
// of the floor tile is what caused a visible tile-size mismatch before.
const REF1_SCALE = 1;
const REF1_PIECES = {
  top_wall: { sprite: FURNITURE_SPRITES.TOP_WALL, width: 900, height: 215 },
  bottom_wall: { sprite: FURNITURE_SPRITES.BOTTOM_WALL, width: 900, height: 205 },
  dining_set: { sprite: FURNITURE_SPRITES.DINING_SET, width: 250, height: 130 },
};

// The wall strips are much deeper than the old individual-appliance crops
// (215px/205px vs ~96px), so entity spawn points that used to sit safely in
// front of them can now land inside their collision box. Shared here so the
// cat/dog spawn positions used in resetGameObjects() stay in lockstep with
// the same points generateKitchenFurniture() keeps the dining table clear of.
const TOP_WALL_HEIGHT = REF1_PIECES.top_wall.height * REF1_SCALE;
const BOTTOM_WALL_HEIGHT = REF1_PIECES.bottom_wall.height * REF1_SCALE;
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

  generateEscapes(count) {
    return Array.from({ length: count }, () => {
      const wall = Math.floor(Math.random() * 4);
      const x = wall === 2 ? 0 : wall === 3 ? this.canvas.width - ESCAPE_SIZE : Math.random() * (this.canvas.width - ESCAPE_SIZE);
      const y = wall === 0 ? 0 : wall === 1 ? this.canvas.height - ESCAPE_SIZE : Math.random() * (this.canvas.height - ESCAPE_SIZE);
      return new Escape(x, y, ESCAPE_SIZE, ESCAPE_SIZE);
    });
  }

  generateKitchenFurniture() {
    const furniture = [];
    const WALL_OFFSET = 40;
    const SPACING = 10;

    // Builds a Furniture instance for a ref1-cropped piece using its own
    // native size (they aren't all the same aspect ratio/size, unlike the
    // old itch.io sprites) and always rotation 0 (see REF1_PIECES comment
    // above — these can't be rotated without the baked-in lighting looking
    // wrong). The fridge is the one exception: it's still the old
    // Reakain-sourced flat sprite, which was actually designed to rotate,
    // so it keeps using Furniture's own defaults and can face any wall.
    const makePiece = (type, x, y) => {
      if (type === 'fridge') {
        return new Furniture(x, y, 'fridge', FURNITURE_SPRITES.FRIDGE, 0);
      }
      const piece = REF1_PIECES[type];
      return new Furniture(x, y, type, piece.sprite, 0, piece.width, piece.height, REF1_SCALE);
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

    const SPAWN_BUFFER = 50; // Extra space around spawn points

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

    // 1. Top wall: one whole cropped wall section (cabinets/stove/sink all
    // together, already aligned as photographed), centered horizontally,
    // flush against the top edge. The fridge (still a real rotatable
    // sprite) sits right after it.
    const topWall = makePiece('top_wall', 0, 0);
    topWall.x = Math.max(0, (this.canvas.width - topWall.width) / 2);
    furniture.push(topWall);
    furniture.push(makePiece('fridge', topWall.x + topWall.width, 0));

    // 2. Bottom wall: the other whole wall section, cropped from the
    // reference photo's bottom wall so it's already correctly oriented
    // there — flush against the bottom edge, centered horizontally.
    const bottomWall = makePiece('bottom_wall', 0, 0);
    bottomWall.x = Math.max(0, (this.canvas.width - bottomWall.width) / 2);
    bottomWall.y = this.canvas.height - bottomWall.height;
    furniture.push(bottomWall);

    // 3. Dining set (table + chairs cropped as one connected piece), placed
    // randomly in the open interior, avoiding the two wall runs and the
    // cat/mouse/dog spawn points.
    const diningSpec = REF1_PIECES.dining_set;
    const diningWidth = diningSpec.width * REF1_SCALE;
    const diningHeight = diningSpec.height * REF1_SCALE;
    const playableX = WALL_OFFSET + 40;
    const playableY = WALL_OFFSET + 40 + topWall.height;
    const playableMaxWidth = this.canvas.width - WALL_OFFSET * 2 - 80;
    const playableMaxHeight = this.canvas.height - WALL_OFFSET * 2 - 80 - topWall.height - bottomWall.height;

    let attempts = 0;
    let placed = false;

    while (!placed && attempts < 100) {
      const x = playableX + Math.random() * Math.max(0, playableMaxWidth - diningWidth);
      const y = playableY + Math.random() * Math.max(0, playableMaxHeight - diningHeight);

      if (!overlaps(x, y, diningWidth, diningHeight) && !blocksSpawn(x, y, diningWidth, diningHeight)) {
        furniture.push(makePiece('dining_set', x, y));
        placed = true;
      }

      attempts++;
    }

    return furniture;
  }
}
