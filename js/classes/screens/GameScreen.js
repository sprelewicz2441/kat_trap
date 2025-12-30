// ==============================
//  IMPORTS
// ==============================
import Cat from '../Cat.js';
import Mouse from '../Mouse.js';
import Dog from '../Dog.js';
import InputHandler from '../InputHandler.js';
import Escape from '../Escape.js';
import Boundary from '../Boundary.js';
import CutsceneManager from '../cutscenes/CutsceneManager.js';
import Cutscene from '../cutscenes/Cutscene.js';

// ==============================
//  CONSTANTS
// ==============================
const WALL_THICKNESS = 15;
const ESCAPE_SIZE = 15;
const NUM_OF_ESCAPES = 6;
const BOUNDARY_SIZE = 20;
const NUM_OF_BOUNDARIES = 20;
const DOG_PAUSE_DURATION = 2000;
const DOG_COLLISION_COOLDOWN = 1000;

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
  CAT_CATCH: 'mouseEscape',
  MOUSE_ESCAPE: 'catCatch',
  TOOT: 'toot',
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
    console.log("Construcitn gameScreen");
    console.log(isReplay);

    this.cat = null;
    this.mouse = null;
    this.dog = null;
    this.escapes = [];
    this.boundaries = [];

    this.running = false;
    this.catPaused = false;
    this.pauseEndTime = 0;
    this.dogCollisionCooldown = 0;
    this.gameOver = false;
    this.message = '';

    this.sounds = this.loadSounds();
    this.playAgainButtonArea = null;
    this.cutsceneManager = new CutsceneManager(screenManager, canvas, ctx);
  }

  init() {
    this.resetGameObjects();

    if (!this.isReplay) {
        this.sounds[SOUND_KEYS.BACKGROUND].play();
    }

    console.log("Init GameScreen");
    console.log("isReplay:", this.isReplay);

    // Always add the click handler
    this.clickHandler = this.handleClick.bind(this);
    this.canvas.addEventListener('click', this.clickHandler);
    document.addEventListener('toot', () => {
      this.playSound(SOUND_KEYS.TOOT);
      this.handleToot();
    });

    if (!this.isReplay) {
        console.log("Not a replay: Starting cutscenes");
        this.running = false;
        this.startCutscenes();
    } else {
        console.log("Is a replay: Skipping cutscenes");
        this.running = true;
    }
  }

  resetGameObjects() {
    this.boundaries = this.generateRandomBoundaries(NUM_OF_BOUNDARIES);
    this.escapes = this.generateEscapes(NUM_OF_ESCAPES);

    this.cat = new Cat(
      this.canvas.width / 2,
      this.canvas.height - 50,
      this.canvas.width,
      this.canvas.height
    );
    this.mouse = new Mouse(100, 100, this.canvas.width, this.canvas.height);
    this.dog = new Dog(
                  200, 200, this.canvas.width, this.canvas.height, 
                  this.escapes, this.boundaries,
                  (soundKey) => this.playSound(SOUND_KEYS.DOG_BARK)
                );

    this.inputHandler = new InputHandler();
    this.mouse.setWallHitCallback(() => this.playSound(SOUND_KEYS.WALL_HIT));
  }

  loadSounds() {
    return {
      [SOUND_KEYS.BACKGROUND]: this.loadSound('../../../sounds/christmas_tree_farm.mp3', true, 0.1),
      [SOUND_KEYS.WALL_HIT]: this.loadSound('../../../sounds/bounce.flac'),
      [SOUND_KEYS.CAT_CATCH]: this.loadSound('../../../sounds/mouse.wav'),
      [SOUND_KEYS.MOUSE_ESCAPE]: this.loadSound('../../../sounds/meow.ogg'),
      [SOUND_KEYS.TOOT]: this.loadSound('../../../sounds/toot.wav', false),
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

    this.cutsceneManager.addCutscene(new Cutscene(this.ctx, catAnimation, 'Meet Mia, the best cat!'));
    this.cutsceneManager.addCutscene(new Cutscene(this.ctx, mouseAnimation, 'This is Poop, the butt!'));
    this.cutsceneManager.addCutscene(new Cutscene(this.ctx, dogAnimation, 'Say hello to Dummy, the dumb dog!'));

    this.cutsceneManager.start(() => {
      this.startGame();
    });
  }

  startGame() {
    this.resetGameObjects();
    this.running = true;
  }

  handleClick(event) {
    const { offsetX, offsetY } = event;

    if (this.gameOver) {
        // Check if the click is within the "Play Again" button area
        if (this.isClickInside(offsetX, offsetY, this.playAgainButtonArea)) {
            console.log("Click detected on Play Again button");
            this.restartGame();
            return;
        }

        // Prevent clicking on the message from triggering any action
        console.log("Click detected outside of Play Again button");
        return;
    }
  }

  restartGame() {
    console.log('Restarting Game'); 
    this.gameOver = false;
    //this.sounds[SOUND_KEYS.BACKGROUND].pause();
    //this.sounds[SOUND_KEYS.BACKGROUND].currentTime = 0;

    this.canvas.removeEventListener('click', this.clickHandler);
    this.screenManager.setScreen(new GameScreen(this.screenManager, this.canvas, this.ctx, true));
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
    console.log("Toot! Moving the dog away.");

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

    if ((insideWalls || isOnEscape) && !this.boundaries.some(boundary => boundary.isColliding(proposedPosition))) {
        this.cat.move(direction);
    }
  }

  updateMouse() {
    this.mouse.update();
    const mouseColliding = this.boundaries.some(boundary => boundary.isColliding(this.mouse));
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
  }

  checkCollision(cat, mouse) {
    return (
      cat.x < mouse.x + mouse.size &&
      cat.x + cat.size > mouse.x &&
      cat.y < mouse.y + mouse.size &&
      cat.y + cat.size > mouse.y
    );
  }

  checkMouseEscaped() {
    return this.escapes.some(escape => escape.isMouseInside(this.mouse));
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawWallsAndBoundaries();
    this.drawGameObjects();

    if (this.message) this.displayMessage();
  }

    drawWallsAndBoundaries() {
    this.drawWallBorders();
    this.boundaries.forEach(boundary => boundary.draw(this.ctx));
    this.escapes.forEach(escape => escape.draw(this.ctx));
  }

  drawGameObjects() {
    this.dog.draw(this.ctx);
    if (this.mouse) this.mouse.draw(this.ctx);

    if (this.catPaused) this.drawRedOutline();
    this.cat.draw(this.ctx);
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

    //console.log('Updated Play Again Button Area:', this.playAgainButtonArea); // Debugging info
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

  generateRandomBoundaries(count) {
    const boundaries = [];
    while (boundaries.length < count) {
      const x = Math.random() * (this.canvas.width - BOUNDARY_SIZE);
      const y = Math.random() * (this.canvas.height - BOUNDARY_SIZE);
      const newBoundary = new Boundary(x, y, BOUNDARY_SIZE, BOUNDARY_SIZE);
      if (!boundaries.some(b => this.areOverlapping(b, newBoundary))) boundaries.push(newBoundary);
    }
    return boundaries;
  }

  areOverlapping(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }
}
