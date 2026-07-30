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
import { getScale, getUIScale, getFurnitureScale, getCharacterScale } from '../../utils/scale.js';
import { CHARACTER_NAMES } from '../../utils/characterNames.js';
import { isMusicMuted, isSfxMuted } from '../../utils/audio.js';
import { drawRoundedRect } from '../../utils/canvasShapes.js';

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

// Thresholds for the mouse-escape-danger indicator (the power LED in the
// viewport frame — see styles.css body::before/body[data-mouse-danger]).
// Distance from the mouse to the nearest escape hole, scaled like every
// other board distance so "close" means the same relative thing at any
// canvas size. Danger < warning, obviously — anything farther than
// the warning radius reads as "far from it" (green).
const BASE_ESCAPE_DANGER_DISTANCE = 90;
const BASE_ESCAPE_WARNING_DISTANCE = 220;

// Furniture sprite paths — the FOURTH kitchen art direction this project
// has had (see CLAUDE.md Kitchen furniture section for why the previous
// three — a photo-crop scene, the flat-cartoon PtPt pack, and individually-
// generated photorealistic objects — were each replaced). These are new
// individually-generated renders provided directly for this pass; the
// modular wall-building/gap mechanic carries forward unchanged from the
// last two rounds — only the asset source and each piece's native
// dimensions changed.
// .webp, not .png — same pixel dimensions and alpha channel as the
// original renders (converted losslessly-in-dimension, quality=90 lossy
// compression), just ~85-90% smaller on disk. width/height/cropX/cropY
// below are keyed to those pixel dimensions, which format conversion
// didn't change, so none of that math needed updating.
const FURNITURE_SPRITES = {
  CABINET: './assets/kitchen_cabinet.webp',
  SINK: './assets/kitchen_sink.webp',
  STOVE: './assets/kitchen_stove.webp',
  FRIDGE: './assets/kitchen_fridge.webp',
  TABLE: './assets/kitchen_table.webp',
  CHAIR: './assets/kitchen_chair.webp',
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
// cabinet's cropY/height are trimmed further than a plain padding-removal
// crop would need: the raw render has an identical wood ledge/trim band on
// BOTH its top and bottom edges (confirmed by sampling the raw file's pixel
// rows — marble content spans y=35-474 of 512, with a symmetric ~28px wood
// band above and below it), which read as a "double-sided" shelf once
// rendered in-game regardless of which side faced the wall. cropY=34 (vs the
// padding-only 7 the other modules use) skips the top band entirely, keeping
// only the bottom band — see makeModule()/LEFT_WALL_ROTATION/
// RIGHT_WALL_ROTATION below for how rotation is chosen per wall so that
// remaining (single) trim band always ends up facing the room, never the
// wall, regardless of which of the four walls this module is placed on.
const MODULE_SPECS = {
  cabinet: { sprite: FURNITURE_SPRITES.CABINET, width: 832, height: 470, cropX: 7, cropY: 34 },
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
// These two, plus makeModule()'s isTop-dependent rotation just below, are
// no longer an arbitrary cosmetic choice ("flip if it looks wrong") now that
// cabinet only has a trim band on one edge (see MODULE_SPECS.cabinet above):
// each rotation value is specifically the one that puts cabinet's *plain*
// (cropped) edge against the wall and its trimmed edge facing the room, on
// every one of the four walls. Worked out from ctx.rotate()'s direction
// (positive = clockwise, since canvas y points down): unrotated (top wall)
// already has the plain edge — which is now the sprite's top row — facing
// up/into the wall band, so top wall needs no rotation; the other three
// walls each face the opposite way from top, so each needs whichever
// rotation sends the sprite's top row toward that wall instead of the room.
const LEFT_WALL_ROTATION = 270;
const RIGHT_WALL_ROTATION = 90;

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
// Minimum distance apart entities are allowed to spawn from each other —
// see resolveClearSpawn()'s `avoid` param. The bottom wall's 4 cabinets
// span ~78% of the board width and are centered, same as the cat's
// preferred spawn X, so the cat's "bottom-center, away from everything"
// spawn is actually covered by furniture most games — the furniture-only
// fallback search then picked any clear spot in the whole interior with no
// regard for the mouse's fixed corner spawn, occasionally landing right
// next to it and ending the round before a player could react.
const BASE_MIN_SPAWN_SEPARATION = 280;
// Mouse-controlled mode: fixed per-tick step speed for direct player input,
// analogous to Cat's own BASE speed — independent of the autonomous mouse's
// speedX/speedY wander velocity (see Mouse.js), which stays untouched.
const BASE_MOUSE_PLAYER_SPEED = 8;

const DOG_PAUSE_DURATION = 2000; // ms — a duration, not a size, so this doesn't scale with canvas size
const DOG_COLLISION_COOLDOWN = 1000; // ms

// Mouse-controlled mode: the cat becomes an autonomous chaser (see
// updateCatAI()). When it can't see the mouse it actively searches — moving
// continuously every tick in a chosen direction (respecting bounds/
// furniture via tryMoveCat()), rather than Dog.js's leisurely once-every-
// few-seconds hop, since a cat "searching" for the mouse should read as
// purposeful movement, not a background wander. CAT_WANDER_DIRECTION_INTERVAL
// governs how often it *changes* direction while doing so — see wanderCat().
const CAT_WANDER_DIRECTION_INTERVAL = 1200; // ms between random direction changes
// Only wall-mounted pieces occlude the cat's line of sight to the mouse —
// freestanding furniture (table/chair) never blocks it. See
// catHasLineOfSightToMouse().
const WALL_FURNITURE_TYPES = ['cabinet', 'sink', 'stove', 'fridge'];
// Multiplier on top of the cat's normal speed while wandering blind (no
// line of sight to the mouse) — not a BASE_* pixel value since it's a ratio
// applied to the already-scaled this.cat.speed, so it stays proportionate
// at any canvas size without its own layout entry.
//
// NOTE: until a since-fixed bug, this multiplier never actually reached
// real movement — tryMoveCat() validated a position at the boosted speed
// but Cat.move() silently ignored the override and always moved by its own
// fixed this.speed. So every earlier tuning pass (1.5, then 1.15, then 1.0)
// was tuning a value that had no real effect on movement distance; the
// "too fast" feel back then came entirely from wandering moving every tick
// instead of once every 2 seconds (see CAT_WANDER_DIRECTION_INTERVAL) and,
// after later fixes, from the AI no longer stalling behind furniture and
// spotting the mouse more reliably. Now that Cat.move() actually honors the
// passed-in speed, this constant has a real, working effect for the first
// time — set below 1.0 to make wandering genuinely slower than the chase
// (a deliberate "cautious search, fast pounce" feel), 1.0 for parity, above
// 1.0 for a more urgent search. Tuned by eye — adjust if it feels off.
const CAT_WANDER_SPEED_MULTIPLIER = 0.5;

const BASE_PUNCH_DISTANCE = 40;
const PUNCH_SHOCKWAVE_DURATION = 200; // ms
const BASE_PUNCH_SHOCKWAVE_MAX_RADIUS = 60;

// Toot's little wind/fart puff — purely cosmetic (unlike the shove
// distance above, nothing here affects gameplay), triggered from
// handleToot() alongside the actual dog-shove mechanic and gated behind
// the same "not playing as the dog" check for consistency with how
// handlePunch()'s shockwave already behaves. Longer-lived than the punch
// shockwave (500ms vs 200ms) since a little puff of gas drifting and
// fading reads better slower than the punch's snappy ring.
const TOOT_EFFECT_DURATION = 500; // ms — a duration, not a size, doesn't scale
const BASE_TOOT_EFFECT_MAX_DRIFT = 32; // how far the puff drifts from the cat over its lifetime
const BASE_TOOT_EFFECT_MAX_RADIUS = 18; // each puff circle's radius at full growth — bumped up from an initial 12, which read as too subtle live
// Which way the puff drifts is always opposite the cat's own facing
// direction (Cat.facingDirection) — it comes out its *back*, not wherever
// it happens to be pointed.
const TOOT_EFFECT_DIRECTIONS = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
};

const BASE_CAT_OUTLINE_WIDTH = 3;
// Still used by the transient (non-game-over) "Dummy caught Mia!" pause
// message — plain text over the live board is fine there since gameplay is
// still visibly running underneath. The actual game-over screen uses the
// modal below instead (see displayGameOverModal()).
const BASE_MESSAGE_FONT_SIZE = 24;
const BASE_MESSAGE_Y_OFFSET = 80;

// Game-over modal (see displayGameOverModal()) — a proper overlay with a
// dimming scrim and a card, replacing plain text drawn directly on top of
// the live board, which was sometimes hard to read depending on what was
// underneath it. UI chrome, so sized with uiScale like the rest of this
// section rather than the in-game scale.
const BASE_MODAL_WIDTH = 420;
const BASE_MODAL_HEIGHT = 280;
const BASE_MODAL_RADIUS = 24;
const BASE_MODAL_TITLE_FONT_SIZE = 52;
const BASE_MODAL_SUBTITLE_FONT_SIZE = 22;
const BASE_MODAL_BUTTON_WIDTH = 200;
const BASE_MODAL_BUTTON_HEIGHT = 60;
const BASE_MODAL_BUTTON_RADIUS = 16;
const BASE_MODAL_BUTTON_FONT_SIZE = 24;
// How long the modal takes to pop/scale in once the round ends — a
// duration, not a size, so this doesn't scale with canvas size (same
// reasoning as DOG_PAUSE_DURATION below).
const MODAL_POP_IN_DURATION = 250; // ms

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
  // Furniture only (not characters, walls, or anything else here) uses its
  // own scale — see getFurnitureScale() in js/utils/scale.js for why:
  // desktop furniture needed to be restored to roughly its pre-asset-swap
  // size independent of mobile's already-tuned sizing.
  const furnitureScale = getFurnitureScale(canvasWidth);
  const moduleScale = BASE_MODULE_SCALE * furnitureScale;
  // Character on-screen/collision size only — see getCharacterScale() in
  // js/utils/scale.js for why this is split from `scale` (which still
  // drives Cat/Dog/Mouse movement speed, unaffected by this).
  const characterScale = getCharacterScale(canvasWidth);
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
    characterScale,
    moduleScale,
    diningScale: moduleScale,
    wallBandThickness,
    escapeSize: BASE_ESCAPE_SIZE * scale,
    wallOffset: BASE_WALL_OFFSET * scale,
    mousePlayerSpeed: BASE_MOUSE_PLAYER_SPEED * scale,
    spawnClearance: BASE_SPAWN_CLEARANCE * scale,
    minSpawnSeparation: BASE_MIN_SPAWN_SEPARATION * scale,
    escapeDangerDistance: BASE_ESCAPE_DANGER_DISTANCE * scale,
    escapeWarningDistance: BASE_ESCAPE_WARNING_DISTANCE * scale,
    punchDistance: BASE_PUNCH_DISTANCE * scale,
    punchShockwaveMaxRadius: BASE_PUNCH_SHOCKWAVE_MAX_RADIUS * scale,
    tootEffectMaxDrift: BASE_TOOT_EFFECT_MAX_DRIFT * scale,
    tootEffectMaxRadius: BASE_TOOT_EFFECT_MAX_RADIUS * scale,
    catOutlineWidth: BASE_CAT_OUTLINE_WIDTH * scale,
    messageFontSize: BASE_MESSAGE_FONT_SIZE * uiScale,
    messageYOffset: BASE_MESSAGE_Y_OFFSET * uiScale,
    modalWidth: BASE_MODAL_WIDTH * uiScale,
    modalHeight: BASE_MODAL_HEIGHT * uiScale,
    modalRadius: BASE_MODAL_RADIUS * uiScale,
    modalTitleFontSize: BASE_MODAL_TITLE_FONT_SIZE * uiScale,
    modalSubtitleFontSize: BASE_MODAL_SUBTITLE_FONT_SIZE * uiScale,
    modalButtonWidth: BASE_MODAL_BUTTON_WIDTH * uiScale,
    modalButtonHeight: BASE_MODAL_BUTTON_HEIGHT * uiScale,
    modalButtonRadius: BASE_MODAL_BUTTON_RADIUS * uiScale,
    modalButtonFontSize: BASE_MODAL_BUTTON_FONT_SIZE * uiScale,
    floorTileSize: BASE_FLOOR_TILE_SIZE * scale,
    catSizeApprox: BASE_CAT_SIZE * characterScale,
    mouseSizeApprox: BASE_MOUSE_SIZE * characterScale,
    dogSizeApprox: BASE_DOG_SIZE * characterScale,
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
  // Still used by the transient (non-game-over) pause message only — see
  // BASE_MESSAGE_FONT_SIZE above.
  MESSAGE: 'purple',
  // Game-over modal (see displayGameOverModal()) — intentionally playful
  // either way (this is a kids' game), not somber on a loss: a warm gold
  // gradient for a win, a bright teal/blue gradient for a loss, rather than
  // switching to dark/muted tones.
  MODAL: {
    SCRIM: 'rgba(10, 8, 20, 0.6)',
    WIN_GRADIENT_START: '#ffe082',
    WIN_GRADIENT_END: '#ff8f00',
    LOSE_GRADIENT_START: '#4fc3f7',
    LOSE_GRADIENT_END: '#5c6bc0',
    BORDER: 'rgba(255, 255, 255, 0.85)',
    TITLE_FILL: '#ffffff',
    TITLE_STROKE: 'rgba(0, 0, 0, 0.45)',
    SUBTITLE: '#2b1d3d',
    BUTTON_BACKGROUND: '#ffffff',
    BUTTON_TEXT: '#2b1d3d',
    BUTTON_SHADOW: 'rgba(0, 0, 0, 0.25)',
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

const SOUND_KEYS = {
  BACKGROUND: 'background',
  WALL_HIT: 'wallHit',
  CAT_CATCH: 'catCatch',
  MOUSE_ESCAPE: 'mouseEscape',
  TOOT: 'toot',
  PUNCH: 'punch',
  DOG_BARK: 'dogBark',
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
  constructor(screenManager, canvas, ctx, isReplay = false, controlledEntity = 'cat') {
    this.screenManager = screenManager;
    this.canvas = canvas;
    this.ctx = ctx;
    this.isReplay = isReplay;
    // 'cat' (default, original behavior), 'mouse', or 'dog' — which entity
    // reads player input; the other two run autonomously (the cat via AI
    // chase-or-wander, the other via its own passive behavior). See
    // moveCat()/updateCatAI(), updateMouse()/movePlayerMouse(), and
    // updateDog()/movePlayerDog() for where this branches.
    this.controlledEntity = controlledEntity;

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
    this.tootEffect = null;
    // Whether the just-ended round was a win *for the player controlling
    // this.controlledEntity* — set by endGame(), read by
    // displayGameOverModal() to pick "You Win!"/"You Lose!" and the
    // gold-vs-teal color scheme. Meaningless while gameOver is false.
    this.gameOverIsWin = false;
    // performance.now() timestamp from endGame() — drives the modal's
    // pop-in animation (same performance.now()-diff pattern as
    // drawShockwave()'s this.shockwave.startTime).
    this.gameOverStartTime = 0;
    // True once the mouse has reached an escape hole (see
    // checkMouseEscaped()) — it then disappears rather than staying visible
    // sitting at/in the hole for the rest of the (now-ended) round. Applies
    // regardless of controlledEntity — the mouse escaping ends the round the
    // same way whether it was player- or AI-driven.
    this.mouseEscaped = false;
    // this.running's value at the moment the settings menu opened — restored
    // when it closes (see the settingsmenutoggle handler in init()), so
    // closing the menu can never resume something that was already stopped
    // for another reason (cutscenes, game over) just because the menu also
    // happened to be open at the time.
    this.wasRunningBeforeMenu = null;

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

    // Each GameScreen (including a "Play Again" replay) owns its own fresh
    // Audio object here — restartGame() pauses the previous instance's
    // track before swapping screens, so it's safe to always start this
    // one rather than special-casing isReplay (the old special-case left
    // background music permanently silent after the first replay, back
    // when this track was still disabled — see loadSounds()).
    if (!isMusicMuted()) {
      this.sounds[SOUND_KEYS.BACKGROUND].play();
    }

    // Lets the settings menu's Music toggle affect a track that's already
    // looping, not just future playSound() calls — see js/utils/audio.js.
    // SFX doesn't need an equivalent listener: playSound() (below) checks
    // isSfxMuted() at play-time, and one-shot sounds have nothing already
    // playing to react to.
    this.musicMuteChangeHandler = (e) => {
      const background = this.sounds[SOUND_KEYS.BACKGROUND];
      if (e.detail.muted) {
        background.pause();
      } else {
        background.play();
      }
    };
    document.addEventListener('musicmutechange', this.musicMuteChangeHandler);

    // Pauses gameplay while the settings menu (js/utils/settingsMenu.js) is
    // open, resuming to whatever this.running actually was beforehand
    // rather than unconditionally to true — see wasRunningBeforeMenu above.
    this.settingsMenuToggleHandler = (e) => {
      if (e.detail.open) {
        this.wasRunningBeforeMenu = this.running;
        this.running = false;
      } else if (this.wasRunningBeforeMenu !== null) {
        this.running = this.wasRunningBeforeMenu;
        this.wasRunningBeforeMenu = null;
      }
    };
    document.addEventListener('settingsmenutoggle', this.settingsMenuToggleHandler);

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

    const { scale, characterScale, topWallHeight, bottomWallHeight, spawnClearance, minSpawnSeparation, catSizeApprox, mouseSizeApprox, dogSizeApprox } = this.layout;

    // The cat's bottom-center spawn was assumed safe (see CLAUDE.md history
    // of this exact bug class) back when the cat's actual size roughly
    // matched catSizeApprox/spawnClearance's tuning — but getCharacterScale()
    // later made desktop characters ~2x bigger without touching
    // spawnClearance (a board-margin value, independent of character size),
    // so the cat's now-larger box can spawn already overlapping the
    // bottom-wall furniture row, with no legal move out of it. Same
    // fallback search as the mouse/dog below. Resolved first (nothing to
    // avoid yet) so the mouse/dog below can steer clear of wherever it
    // actually ends up.
    const catSpawn = this.resolveClearSpawn(
      this.canvas.width / 2,
      this.canvas.height - bottomWallHeight - spawnClearance,
      catSizeApprox
    );
    this.cat = new Cat(
      catSpawn.x,
      catSpawn.y,
      this.canvas.width,
      this.canvas.height,
      scale,
      characterScale
    );
    // Mouse's fixed (100, 100)-style spawn scales with the board too, so it
    // doesn't end up pinned near the true corner on a small canvas. That
    // corner isn't checked against wall-mounted furniture the way the
    // freestanding dining set is (see blocksSpawn() in
    // generateKitchenFurniture()), so on some layouts a cabinet/fridge can
    // land right on top of it — resolveClearSpawn() falls back to a clear
    // spot in that case so the mouse never starts the game hidden. Also
    // kept minSpawnSeparation away from the cat's just-resolved spawn: the
    // bottom wall's cabinets span most of the board width and are centered
    // right where the cat prefers to spawn, so the cat's fallback search
    // (furniture-only, no distance check) used to be free to land right
    // next to the mouse's fixed corner — ending the round in under a
    // second, before a player could do anything.
    const mouseSpawn = this.resolveClearSpawn(
      100 * scale, 100 * scale, mouseSizeApprox,
      [{ x: catSpawn.x, y: catSpawn.y, size: catSizeApprox }],
      minSpawnSeparation
    );
    this.mouse = new Mouse(mouseSpawn.x, mouseSpawn.y, this.canvas.width, this.canvas.height, scale, characterScale);
    // Same protection for the dog's fixed corner spawn — it isn't
    // hardcoded-safe against every possible LEFT_WALL_ORDER (see CLAUDE.md's
    // Planned work: taller left-wall modules are an explicit future
    // possibility), so it gets the same fallback search as the mouse, also
    // kept clear of both the cat and mouse's now-resolved spawns.
    const dogSpawn = this.resolveClearSpawn(
      200 * scale, topWallHeight + spawnClearance, dogSizeApprox,
      [
        { x: catSpawn.x, y: catSpawn.y, size: catSizeApprox },
        { x: mouseSpawn.x, y: mouseSpawn.y, size: mouseSizeApprox },
      ],
      minSpawnSeparation
    );
    this.dog = new Dog(
                  dogSpawn.x, dogSpawn.y, this.canvas.width, this.canvas.height,
                  this.escapes, this.furniture,
                  (soundKey) => this.playSound(SOUND_KEYS.DOG_BARK),
                  scale,
                  characterScale
                );
    this.dog.setNextBark();

    this.inputHandler = new InputHandler();
    this.mouse.setWallHitCallback(() => this.playSound(SOUND_KEYS.WALL_HIT));

    // State for the cat AI's active-search wander (Mouse-controlled mode
    // only — see wanderCat()), reset each game like the dog's own cooldowns.
    this.catWander = { direction: null, lastDirectionChange: 0 };
  }

  // Returns preferredX/Y unchanged unless it's hidden under furniture (see
  // isHiddenByFurniture()) or within minSeparation of an already-resolved
  // entity spawn (see `avoid`), in which case it random-searches
  // this.playableArea (the same interior bounds generateKitchenFurniture()
  // already uses for the dining set — see its INTERIOR_MARGIN/playableX/Y
  // block) for a clear spot. Falls back to the preferred spot if the search
  // somehow can't find one (a small board with a large minSeparation could
  // legitimately have no valid spot — better to let two characters spawn
  // close than to leave one undefined). `avoid` is a list of
  // {x, y, size} spawns already committed this reset (see resetGameObjects()
  // — cat resolves first, so mouse avoids it, then dog avoids both) so a
  // later entity's fallback search can't land right on top of an earlier
  // one just because it happened to be clear of furniture.
  resolveClearSpawn(preferredX, preferredY, size, avoid = [], minSeparation = 0) {
    const isTooCloseToOthers = (x, y) => avoid.some(spot => {
      const dx = (x + size / 2) - (spot.x + spot.size / 2);
      const dy = (y + size / 2) - (spot.y + spot.size / 2);
      return Math.hypot(dx, dy) < minSeparation;
    });

    if (!this.isHiddenByFurniture(preferredX, preferredY, size) && !isTooCloseToOthers(preferredX, preferredY)) {
      return { x: preferredX, y: preferredY };
    }

    const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = this.playableArea;
    for (let attempts = 0; attempts < 300; attempts++) {
      const x = areaX + Math.random() * Math.max(0, areaWidth - size);
      const y = areaY + Math.random() * Math.max(0, areaHeight - size);
      if (!this.isHiddenByFurniture(x, y, size) && !isTooCloseToOthers(x, y)) return { x, y };
    }

    return { x: preferredX, y: preferredY };
  }

  loadSounds() {
    return {
      // Was disabled pending a mute button (looping music with no way to
      // turn it off is worse than no music at all) — now gated by
      // isMusicMuted() (see init()/restartGame() below), which starts muted
      // by default (js/utils/audio.js — the settings menu's Music toggle),
      // so nothing changes for a player until they explicitly unmute.
      [SOUND_KEYS.BACKGROUND]: this.loadSound('../../../sounds/christmas_tree_farm.mp3', true, 0.1),
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
    const { scale, characterScale } = this.layout;
    const catAnimation = new Cat(0, 0, this.canvas.width, this.canvas.height, scale, characterScale);
    const mouseAnimation = new Mouse(0, 0, this.canvas.width, this.canvas.height, scale, characterScale);
    const dogAnimation = new Dog(0, 0, this.canvas.width, this.canvas.height, [], [], undefined, scale, characterScale);
    
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
    // The next GameScreen starts its own fresh background track in init()
    // (see the comment there) — stop this instance's first so the old one
    // doesn't keep looping in the background, orphaned, once this instance
    // is replaced.
    this.sounds[SOUND_KEYS.BACKGROUND].pause();

    this.cleanup();
    this.screenManager.setScreen(new GameScreen(this.screenManager, this.canvas, this.ctx, true, this.controlledEntity));
  }

  cleanup() {
    document.body.classList.remove('in-game');
    delete document.body.dataset.mouseDanger;
    document.removeEventListener('toot', this.tootHandler);
    document.removeEventListener('punch', this.punchHandler);
    document.removeEventListener('meow', this.meowHandler);
    document.removeEventListener('musicmutechange', this.musicMuteChangeHandler);
    document.removeEventListener('settingsmenutoggle', this.settingsMenuToggleHandler);
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
    if (isSfxMuted()) return;
    const sound = this.sounds[soundKey];
    if (sound) {
      sound.currentTime = 0;
      sound.play();
    }
  }

  update(timestamp) {
    if (!this.running) return;

    this.handleCatPause(timestamp);

    if (!this.catPaused) {
      // The cat is AI-driven (updateCatAI — chase-or-wander, see below)
      // whenever the player isn't the one controlling it directly, which is
      // now two modes (Mouse, Dog) rather than one.
      if (this.controlledEntity === 'cat') {
        this.moveCat();
      } else {
        this.updateCatAI(timestamp);
      }
    }

    this.updateMouse();
    this.updateDog(timestamp);
  }

  // Dog-controlled mode: player-driven, same per-tick movement granularity
  // as moveCat()/movePlayerMouse() (see tryMoveDog() below) rather than the
  // autonomous once-every-couple-seconds hop. Otherwise (Cat/Mouse modes,
  // where the dog has always just been a hazard) Dog.update() keeps running
  // its own autonomous wander exactly as before — this is the one place the
  // three modes genuinely diverge in *how* the dog moves. The collision-vs-
  // cat check that pauses the cat (see handleDogCollisionIfReady()) applies
  // either way, since "run the dog into the cat" is the whole point of
  // playing as the dog — it's the same rule, just now something the player
  // can aim on purpose instead of it happening by chance.
  updateDog(timestamp) {
    if (this.controlledEntity === 'dog') {
      this.movePlayerDog();
      if (this.dog.isColliding(this.cat)) {
        this.handleDogCollisionIfReady(timestamp);
      }
    } else {
      // Dog.update() runs exactly once per frame — it always moves/animates
      // regardless of catPaused, but the collision *response* is gated (see
      // handleDogCollisionIfReady()) so a still-overlapping dog/cat pair
      // doesn't re-trigger the pause every single frame.
      this.dog.update(timestamp, this.cat, () => this.handleDogCollisionIfReady(timestamp));
    }
  }

  // Guards handleDogCollision() so it only fires once per actual catch:
  // not while already paused, and not during the grace period right after
  // a pause ends (dogCollisionCooldown) — gives the dog and cat a moment to
  // separate before another collision can retrigger the pause.
  handleDogCollisionIfReady(timestamp) {
    if (this.catPaused || timestamp < this.dogCollisionCooldown) return;
    this.handleDogCollision();
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
    // Both toot and punch (below) shove the dog away from the cat — makes
    // sense as a way to protect whoever's nearby from the autonomous dog
    // hazard, but not when the player IS the dog: it would fling their own
    // character away from the cat they're actively trying to reach. The
    // sound still plays either way (see the tootHandler in init()) since
    // there's no harm in the button making noise.
    if (!this.dog || this.controlledEntity === 'dog') return;

    // Little wind/fart puff — purely cosmetic, gated behind the same
    // "not playing as the dog" check as the shove below (and as
    // handlePunch()'s shockwave) for consistency, even though nothing
    // about it actually depends on the dog existing. Drifts out the cat's
    // *back* — opposite whichever way it's currently facing, via
    // TOOT_EFFECT_DIRECTIONS — rather than a fixed screen direction.
    const puffDirection = TOOT_EFFECT_DIRECTIONS[this.cat.facingDirection] || TOOT_EFFECT_DIRECTIONS.down;
    this.tootEffect = {
      x: this.cat.x + this.cat.displayWidth / 2,
      y: this.cat.y + this.cat.displayHeight / 2,
      dirX: puffDirection.x,
      dirY: puffDirection.y,
      startTime: performance.now(),
    };

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
    // See handleToot() above — same reasoning for skipping the dog-shoving
    // effect (though not the sound) when the player is controlling the dog.
    if (!this.dog || this.controlledEntity === 'dog') return;

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
    if (!direction) {
      this.cat.stand();
      return;
    }
    this.tryMoveCat(direction);
  }

  // Shared by player-driven movement (moveCat()) and the autonomous cat AI
  // (moveCatTowardMouse()/wanderCat(), Mouse- and Dog-controlled modes) — the
  // bounds/furniture check is identical regardless of who picked the
  // direction, only how the direction gets picked differs. `speed` defaults
  // to the cat's normal speed; wanderCat() passes its own scaled speed while
  // it can't see the mouse (see CAT_WANDER_SPEED_MULTIPLIER). Returns
  // whether the move actually happened, so wanderCat() can tell it hit a
  // wall/furniture and should pick a new direction right away.
  tryMoveCat(direction, speed = this.cat.speed) {
    const proposedPosition = { x: this.cat.x, y: this.cat.y };

    if (direction === 'up') proposedPosition.y -= speed;
    if (direction === 'down') proposedPosition.y += speed;
    if (direction === 'left') proposedPosition.x -= speed;
    if (direction === 'right') proposedPosition.x += speed;

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

    const canMove = (insideWalls || isOnEscape) && !this.furniture.some(furniture => furniture.isColliding(proposedEntity));
    if (canMove) {
        this.cat.move(direction, speed);
    } else {
        this.cat.stand();
    }
    return canMove;
  }

  // Mouse- and Dog-controlled modes only: whenever the cat isn't the one the
  // player is driving, it needs its own behavior — chase the mouse when it
  // can see it, otherwise wander randomly. See catHasLineOfSightToMouse()
  // for the sight check. Falls back to wandering (for this tick) if the
  // direct chase move is blocked — e.g. by freestanding furniture, which
  // doesn't block sight but does block movement — so the cat routes around
  // instead of stalling in
  // place while it can still see the mouse.
  updateCatAI(timestamp) {
    if (this.catHasLineOfSightToMouse()) {
      if (!this.moveCatTowardMouse()) {
        this.wanderCat(timestamp);
      }
    } else {
      this.wanderCat(timestamp);
    }
  }

  // True only if the mouse is strictly in the cat's current facing
  // direction (cardinal — up/down/left/right, not a cone) AND no
  // wall-mounted furniture crosses the straight line between their centers.
  // Freestanding furniture (table/chair) never blocks sight. No memory of
  // last-known position — once sight is lost it's pure wander until the
  // cat's facing direction happens to line up with the mouse again. Uses
  // cat.size throughout (the same hitbox tryMoveCat()/checkCollision() use
  // for movement/catching), not cat.displayWidth/displayHeight (the smaller
  // render box) — sight and collision need to agree on what "the cat" is.
  catHasLineOfSightToMouse() {
    const cat = this.cat;
    const mouse = this.mouse;
    const direction = cat.facingDirection;

    // The half-plane the cat is facing — its own edge extended to the
    // canvas boundary, spanning the cat's cross-axis extent. The mouse has
    // to overlap this rectangle to be "in front of" the cat at all
    // (cardinal-only, not a cone), tested via the shared aabbOverlap helper.
    let laneX, laneY, laneWidth, laneHeight;
    if (direction === 'right') {
      laneX = cat.x + cat.size;
      laneY = cat.y;
      laneWidth = this.canvas.width - laneX;
      laneHeight = cat.size;
    } else if (direction === 'left') {
      laneX = 0;
      laneY = cat.y;
      laneWidth = cat.x;
      laneHeight = cat.size;
    } else if (direction === 'down') {
      laneX = cat.x;
      laneY = cat.y + cat.size;
      laneWidth = cat.size;
      laneHeight = this.canvas.height - laneY;
    } else {
      laneX = cat.x;
      laneY = 0;
      laneWidth = cat.size;
      laneHeight = cat.y;
    }

    if (!aabbOverlap(laneX, laneY, laneWidth, laneHeight, mouse.x, mouse.y, mouse.size, mouse.size)) {
      return false;
    }

    // No wall-mounted furniture piece crosses the straight line between
    // their centers — modeled as a 1px-thick segment rectangle so the
    // shared aabbOverlap helper can test it directly, rather than
    // hand-rolling the overlap arithmetic.
    const isHorizontal = direction === 'left' || direction === 'right';
    const catCenterX = cat.x + cat.size / 2;
    const catCenterY = cat.y + cat.size / 2;
    const mouseCenterX = mouse.x + mouse.size / 2;
    const mouseCenterY = mouse.y + mouse.size / 2;
    const wallFurniture = this.furniture.filter(f => WALL_FURNITURE_TYPES.includes(f.type));

    const blocked = wallFurniture.some(f => {
      if (isHorizontal) {
        const xMin = Math.min(catCenterX, mouseCenterX);
        const xMax = Math.max(catCenterX, mouseCenterX);
        return aabbOverlap(xMin, catCenterY, xMax - xMin, 1, f.x, f.y, f.width, f.height);
      }
      const yMin = Math.min(catCenterY, mouseCenterY);
      const yMax = Math.max(catCenterY, mouseCenterY);
      return aabbOverlap(catCenterX, yMin, 1, yMax - yMin, f.x, f.y, f.width, f.height);
    });

    return !blocked;
  }

  // Moves the cat one cardinal step toward the mouse's current position —
  // whichever axis has the larger gap this tick, matching the same
  // single-direction-per-tick granularity as player movement (no diagonal
  // movement introduced). Speed is unchanged/fixed for now. Uses cat.size,
  // consistent with catHasLineOfSightToMouse() above. Returns whether the
  // move actually happened, so updateCatAI() can fall back to wandering
  // (routing around) if something — e.g. freestanding furniture — blocks it.
  moveCatTowardMouse() {
    const catCenterX = this.cat.x + this.cat.size / 2;
    const catCenterY = this.cat.y + this.cat.size / 2;
    const mouseCenterX = this.mouse.x + this.mouse.size / 2;
    const mouseCenterY = this.mouse.y + this.mouse.size / 2;

    const dx = mouseCenterX - catCenterX;
    const dy = mouseCenterY - catCenterY;

    const direction = Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');

    return this.tryMoveCat(direction);
  }

  // Actively searches rather than idly wandering: moves every tick (unlike
  // Dog's once-every-couple-seconds hop) in a chosen direction, scaled by
  // CAT_WANDER_SPEED_MULTIPLIER (currently 1.0 — no boost, see its comment),
  // only re-picking that direction every CAT_WANDER_DIRECTION_INTERVAL — or
  // immediately, if the current direction just ran into a wall/furniture,
  // so it doesn't sit stuck in a corner until the timer happens to expire.
  wanderCat(timestamp) {
    const wander = this.catWander;
    const directionExpired = !wander.direction || (timestamp - wander.lastDirectionChange >= CAT_WANDER_DIRECTION_INTERVAL);

    if (directionExpired) {
      wander.direction = this.pickRandomDirection();
      wander.lastDirectionChange = timestamp;
    }

    const moved = this.tryMoveCat(wander.direction, this.cat.speed * CAT_WANDER_SPEED_MULTIPLIER);

    if (!moved) {
      wander.direction = this.pickRandomDirection();
      wander.lastDirectionChange = timestamp;
    }
  }

  pickRandomDirection() {
    const directions = ['up', 'down', 'left', 'right'];
    return directions[Math.floor(Math.random() * directions.length)];
  }

  updateMouse() {
    if (this.controlledEntity === 'mouse') {
      this.movePlayerMouse();
    } else {
      this.mouse.update();
      const mouseColliding = false; // Mouse can pass through furniture

      if (mouseColliding) {
        this.mouse.speedX *= -1;
        this.mouse.speedY *= -1;
      }
    }

    this.updateEscapeDangerIndicator();

    if (this.checkCollision(this.cat, this.mouse)) {
      // The cat catching the mouse is a win for whoever's playing the cat,
      // a loss for whoever's playing the mouse OR the dog — the dog's whole
      // job is to stop this from happening (pause the cat, buy the mouse
      // time), so it's on the mouse's "team" for win/lose purposes even
      // though it never touches the mouse directly. Same trigger, meaning
      // depends on controlledEntity (see Character selection & Mouse-
      // controlled mode in CLAUDE.md).
      this.endGame(MESSAGES.CAT_CAUGHT_MOUSE, SOUND_KEYS.CAT_CATCH, this.controlledEntity === 'cat');
    } else if (this.checkMouseEscaped()) {
      this.mouseEscaped = true;
      this.endGame(MESSAGES.MOUSE_ESCAPED, SOUND_KEYS.MOUSE_ESCAPE, this.controlledEntity !== 'cat');
    }
  }

  // Mouse-controlled mode only: reads arrow-key input directly, same
  // pattern as tryMoveCat(), but the mouse intentionally ignores furniture
  // collision — it ducks under furniture visually rather than being blocked
  // by it (see Mouse.js / drawMouseSilhouette() below) — so only canvas
  // bounds are checked here.
  movePlayerMouse() {
    const direction = this.inputHandler.getDirection();

    if (direction) {
      const DIRECTION_TO_FACING = { up: 'north', down: 'south', left: 'west', right: 'east' };
      this.mouse.currentDirection = DIRECTION_TO_FACING[direction];

      const speed = this.layout.mousePlayerSpeed;
      let proposedX = this.mouse.x;
      let proposedY = this.mouse.y;

      if (direction === 'up') proposedY -= speed;
      if (direction === 'down') proposedY += speed;
      if (direction === 'left') proposedX -= speed;
      if (direction === 'right') proposedX += speed;

      const clampedX = Math.max(0, Math.min(proposedX, this.canvas.width - this.mouse.size));
      const clampedY = Math.max(0, Math.min(proposedY, this.canvas.height - this.mouse.size));

      // Match the autonomous mouse's wall-bounce path, which always fires
      // this on contact — otherwise player-controlled mode never plays the
      // wall-hit sound at all.
      if ((clampedX !== proposedX || clampedY !== proposedY) && this.mouse.wallHitCallback) {
        this.mouse.wallHitCallback();
      }

      this.mouse.x = clampedX;
      this.mouse.y = clampedY;
    }

    this.mouse.updateAnimations();
  }

  // Dog-controlled mode only: reads arrow-key input directly, same per-tick
  // granularity and bounds/furniture rules as tryMoveCat() (the dog is a
  // solid obstacle for itself the same way the cat is — no reason for the
  // player-driven dog to suddenly ignore furniture just because the
  // autonomous dog also happens to avoid it via a different check).
  tryMoveDog(direction) {
    const speed = this.dog.speed;
    let proposedX = this.dog.x;
    let proposedY = this.dog.y;

    if (direction === 'up') proposedY -= speed;
    if (direction === 'down') proposedY += speed;
    if (direction === 'left') proposedX -= speed;
    if (direction === 'right') proposedX += speed;

    const isOnEscape = this.escapes.some(escape => escape.isMouseInside(this.dog));

    const WALL_OFFSET = this.layout.wallOffset;
    const insideWalls = (
        proposedX >= WALL_OFFSET - this.dog.size &&
        proposedX <= this.canvas.width - WALL_OFFSET &&
        proposedY >= WALL_OFFSET - this.dog.size &&
        proposedY <= this.canvas.height - WALL_OFFSET
    );

    const proposedEntity = { x: proposedX, y: proposedY, size: this.dog.size };
    const canMove = (insideWalls || isOnEscape) && !this.furniture.some(furniture => furniture.isColliding(proposedEntity));
    if (canMove) {
      this.dog.x = proposedX;
      this.dog.y = proposedY;
      // Only left/right change facing (see Dog.js's facingLeft) — up/down
      // keep whichever way it was last actually facing, same convention
      // the autonomous dog uses.
      if (direction === 'left') this.dog.facingLeft = true;
      if (direction === 'right') this.dog.facingLeft = false;
    }
    return canMove;
  }

  movePlayerDog() {
    const direction = this.inputHandler.getDirection();
    if (direction) {
      this.tryMoveDog(direction);
    }
    this.dog.updateAnimation();
  }

  // Drives the power-LED-as-danger-meter in the viewport frame (see
  // styles.css body::before / body[data-mouse-danger]) — red when the
  // mouse is right on top of an escape hole, yellow approaching one,
  // green otherwise. Distance is to the nearest escape's center, since the
  // mouse can slip out through any of them, not just the guaranteed one.
  updateEscapeDangerIndicator() {
    const mouseCenterX = this.mouse.x + this.mouse.size / 2;
    const mouseCenterY = this.mouse.y + this.mouse.size / 2;

    const nearestDistance = Math.min(...this.escapes.map(escape => {
      const escapeCenterX = escape.x + escape.width / 2;
      const escapeCenterY = escape.y + escape.height / 2;
      return Math.hypot(mouseCenterX - escapeCenterX, mouseCenterY - escapeCenterY);
    }));

    const { escapeDangerDistance, escapeWarningDistance } = this.layout;
    let danger = 'low';
    if (nearestDistance <= escapeDangerDistance) danger = 'high';
    else if (nearestDistance <= escapeWarningDistance) danger = 'medium';

    document.body.dataset.mouseDanger = danger;
  }

  handleDogCollision() {
    this.catPaused = true;
    this.pauseEndTime = performance.now() + DOG_PAUSE_DURATION;
    this.message = MESSAGES.DOG_CAUGHT;
    this.playSound(SOUND_KEYS.DOG_BARK);

    const OFFSET = 20;
    if (this.dog.x < this.cat.x) this.dog.x -= OFFSET;
    else this.dog.x += OFFSET;
    if (this.dog.y < this.cat.y) this.dog.y -= OFFSET;
    else this.dog.y += OFFSET;
  }

  endGame(message, soundKey, isWin) {
    this.running = false;
    this.gameOver = true;
    this.message = message;
    this.gameOverIsWin = isWin;
    this.gameOverStartTime = performance.now();
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
    // Skipped once it's escaped (see checkMouseEscaped()) so it doesn't
    // stay visibly sitting at the hole for the rest of the ended round.
    if (this.mouse && !this.mouseEscaped) this.mouse.draw(this.ctx);
    this.furniture.forEach(furniture => furniture.draw(this.ctx));
    this.drawMouseSilhouette();
    this.drawGameObjects();
    this.drawShockwave();

    if (this.gameOver) {
      this.displayGameOverModal();
    } else if (this.message) {
      this.displayMessage();
    }
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

  // Shared "is this box hidden beneath furniture" test — used both to decide
  // whether to draw the under-furniture silhouette (drawMouseSilhouette())
  // and to guarantee the mouse/dog never *start* the game hidden (see
  // resolveClearSpawn()), so both share one definition of "hidden".
  isHiddenByFurniture(x, y, size) {
    return this.furniture.some(f => aabbOverlap(x, y, size, size, f.x, f.y, f.width, f.height));
  }

  // The mouse draws *under* furniture (see render() above / Mouse.js) so it
  // visually ducks beneath cabinets etc. instead of being blocked by them —
  // that leaves it fully invisible while hidden there, which matters more
  // now that Mouse-controlled mode means a player is actively steering it.
  // Draws a faint shadow-like silhouette on top of furniture whenever the
  // mouse's box overlaps any furniture box, so its position stays legible
  // without undoing the "ducking under" look. Runs in both modes — harmless
  // in Cat-controlled mode, just a rendering nicety there.
  drawMouseSilhouette() {
    if (!this.mouse || this.mouseEscaped) return;
    if (!this.isHiddenByFurniture(this.mouse.x, this.mouse.y, this.mouse.size)) return;

    const centerX = this.mouse.x + this.mouse.size / 2;
    const centerY = this.mouse.y + this.mouse.size / 2;

    this.ctx.save();
    this.ctx.globalAlpha = 0.35;
    this.ctx.fillStyle = '#000000';
    this.ctx.beginPath();
    this.ctx.ellipse(centerX, centerY, this.mouse.size / 2, this.mouse.size / 2.5, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  drawGameObjects() {
    this.dog.draw(this.ctx);

    // Drawn here (not in render()'s own top-level sequence) specifically so
    // it lands behind the cat's own sprite — drawing it after the cat, like
    // drawShockwave(), had it visibly painting over the cat's face.
    this.drawTootEffect();

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

  // Little wind/fart puff from handleToot() — three soft pale-green circles
  // drifting out the cat's back (opposite Cat.facingDirection, see
  // TOOT_EFFECT_DIRECTIONS) and fading out. Staggered start times (each
  // puff's own `delay`) so they don't move/fade in lockstep as one blob —
  // reads as a little cloud instead.
  drawTootEffect() {
    if (!this.tootEffect) return;

    const elapsed = performance.now() - this.tootEffect.startTime;
    if (elapsed > TOOT_EFFECT_DURATION) {
      this.tootEffect = null;
      return;
    }

    const progress = elapsed / TOOT_EFFECT_DURATION;
    const { x, y, dirX, dirY } = this.tootEffect;
    // Perpendicular to the drift direction, so the three puffs scatter
    // side-to-side instead of stacking directly on top of each other.
    const perpX = -dirY;
    const perpY = dirX;
    const maxDrift = this.layout.tootEffectMaxDrift;
    const maxRadius = this.layout.tootEffectMaxRadius;

    this.ctx.save();
    const puffs = [
      { delay: 0, spread: -0.6, sizeMul: 0.8 },
      { delay: 0.12, spread: 0, sizeMul: 1 },
      { delay: 0.24, spread: 0.6, sizeMul: 0.7 },
    ];
    puffs.forEach((puff) => {
      const puffProgress = Math.max(0, Math.min(1, (progress - puff.delay) / (1 - puff.delay)));
      if (puffProgress <= 0) return;

      const drift = puffProgress * maxDrift;
      const px = x + dirX * drift + perpX * puff.spread * maxRadius;
      const py = y + dirY * drift + perpY * puff.spread * maxRadius;
      const radius = puff.sizeMul * maxRadius * (0.4 + 0.6 * puffProgress);
      // Alpha eased rather than linear, and a higher ceiling (0.9, was
      // 0.6) — the flat-linear fade read as too faint/washed-out live
      // against the floor almost immediately. A darker stroke (not just a
      // flat fill) is what actually gives each puff a defined edge instead
      // of a soft blur that can disappear into a light-colored floor tile.
      const alpha = Math.pow(1 - puffProgress, 0.6) * 0.9;

      this.ctx.fillStyle = `rgba(196, 230, 165, ${alpha})`;
      this.ctx.strokeStyle = `rgba(110, 160, 80, ${alpha})`;
      this.ctx.lineWidth = Math.max(1, 1.5 * this.layout.scale);
      this.ctx.beginPath();
      this.ctx.arc(px, py, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    });
    this.ctx.restore();
  }

  // Lazily builds (once per distinct animation frame, not per render call) a
  // red silhouette of that frame: draw the frame to a small offscreen
  // canvas, then `globalCompositeOperation = 'source-in'` recolors only the
  // pixels the sprite actually painted (its alpha shape), leaving
  // transparent pixels transparent. The result is a red cutout shaped like
  // the cat, not a rectangle — cached per frame index since there are only
  // a handful of frames and the source sprite sheet never changes.
  getCatOutlineFrame(frameIndex) {
    if (!this.catOutlineFrames) this.catOutlineFrames = [];
    if (this.catOutlineFrames[frameIndex]) return this.catOutlineFrames[frameIndex];

    const cat = this.cat;
    if (!cat.spriteSheet.complete || cat.spriteSheet.naturalWidth === 0) return null;

    const offscreen = document.createElement('canvas');
    offscreen.width = cat.frameWidth;
    offscreen.height = cat.frameHeight;
    const offCtx = offscreen.getContext('2d');
    offCtx.drawImage(
      cat.spriteSheet,
      0, frameIndex * cat.frameHeight, cat.frameWidth, cat.frameHeight,
      0, 0, cat.frameWidth, cat.frameHeight
    );
    offCtx.globalCompositeOperation = 'source-in';
    offCtx.fillStyle = COLORS.CAT_OUTLINE;
    offCtx.fillRect(0, 0, cat.frameWidth, cat.frameHeight);

    this.catOutlineFrames[frameIndex] = offscreen;
    return offscreen;
  }

  // Draws the red silhouette (see getCatOutlineFrame()) offset in a ring of
  // directions around the cat's actual draw position, called before
  // cat.draw() (see drawGameObjects()) so the real sprite paints over the
  // silhouette's interior right after — only the rim where an offset copy
  // sticks out past the un-offset sprite stays visible, producing an
  // outline that hugs the cat's actual shape instead of its bounding box.
  drawRedOutline() {
    const cat = this.cat;
    const silhouette = this.getCatOutlineFrame(cat.currentFrame);
    const width = Math.max(1, this.layout.catOutlineWidth);

    this.ctx.save();
    if (!silhouette) {
      // Sprite sheet hasn't finished loading yet — fall back to the old
      // bounding-box outline rather than drawing nothing.
      this.ctx.strokeStyle = COLORS.CAT_OUTLINE;
      this.ctx.lineWidth = width;
      this.ctx.strokeRect(cat.x, cat.y, cat.displayWidth, cat.displayHeight);
      this.ctx.restore();
      return;
    }

    // Each ring offset gets its own save/restore: the offsets themselves
    // stay in plain screen space (a circle around the cat) while the
    // silhouette drawn at each one is rotated/stretched via
    // cat.applyDirectionalTransform() — the same transform draw() applies
    // to the real sprite — so the outline still hugs a tilted cat instead
    // of drifting out of alignment with it.
    const centerX = cat.x + cat.displayWidth / 2;
    const centerY = cat.y + cat.displayHeight / 2;
    const RING_STEPS = 8;
    for (let i = 0; i < RING_STEPS; i++) {
      const angle = (i / RING_STEPS) * Math.PI * 2;
      const dx = Math.cos(angle) * width;
      const dy = Math.sin(angle) * width;
      this.ctx.save();
      this.ctx.translate(centerX + dx, centerY + dy);
      cat.applyDirectionalTransform(this.ctx);
      this.ctx.drawImage(silhouette, -cat.displayWidth / 2, -cat.displayHeight / 2, cat.displayWidth, cat.displayHeight);
      this.ctx.restore();
    }
    this.ctx.restore();
  }

  // Only reached while !gameOver (see render()) — the transient "Dummy
  // caught Mia!" pause message. Plain text over the live board is fine
  // here since gameplay is still visibly running underneath; the actual
  // game-over screen uses displayGameOverModal() instead.
  displayMessage() {
    this.ctx.fillStyle = COLORS.MESSAGE;
    this.ctx.font = `${this.layout.messageFontSize}px Arial`;
    this.ctx.textAlign = 'center';

    const messageY = this.canvas.height / 2 - this.layout.messageYOffset;
    this.ctx.fillText(this.message, this.canvas.width / 2, messageY);
  }

  // Replaces the old plain-text end screen with a proper modal: a dimming
  // scrim over the whole board (so the card reads clearly regardless of
  // what's drawn underneath — the previous plain text sometimes wasn't
  // legible depending on the board state behind it), a gradient card
  // (gold for a win, teal/blue for a loss — see COLORS.MODAL), a big bold
  // "You Win!"/"You Lose!" headline with an outline stroke so it pops
  // against either gradient, the narration message as a subtitle, and a
  // rounded "Play Again" button. this.gameOverIsWin (set by endGame(), see
  // Character selection & Mouse-controlled mode in CLAUDE.md) decides which
  // headline/palette to use — the underlying trigger (cat caught mouse /
  // mouse escaped) is the same regardless of who's playing.
  displayGameOverModal() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const {
      scale, modalWidth, modalHeight, modalRadius,
      modalTitleFontSize, modalSubtitleFontSize,
      modalButtonWidth, modalButtonHeight, modalButtonRadius, modalButtonFontSize,
    } = this.layout;

    ctx.save();
    ctx.fillStyle = COLORS.MODAL.SCRIM;
    ctx.fillRect(0, 0, width, height);

    // Pop-in animation: scales the card up from slightly smaller while
    // fading in over MODAL_POP_IN_DURATION — same performance.now()-diff
    // pattern as drawShockwave(). The click hit-area below intentionally
    // uses the *final* (unscaled) button position throughout, rather than
    // tracking this animation — a purely cosmetic quarter-second effect
    // isn't worth hit-testing against a live transform.
    const elapsed = performance.now() - this.gameOverStartTime;
    const progress = Math.min(1, elapsed / MODAL_POP_IN_DURATION);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const popScale = 0.85 + 0.15 * eased;

    const centerX = width / 2;
    const centerY = height / 2;

    ctx.globalAlpha = eased;
    ctx.translate(centerX, centerY);
    ctx.scale(popScale, popScale);
    ctx.translate(-centerX, -centerY);

    const modalX = centerX - modalWidth / 2;
    const modalY = centerY - modalHeight / 2;

    const gradient = ctx.createLinearGradient(modalX, modalY, modalX, modalY + modalHeight);
    if (this.gameOverIsWin) {
      gradient.addColorStop(0, COLORS.MODAL.WIN_GRADIENT_START);
      gradient.addColorStop(1, COLORS.MODAL.WIN_GRADIENT_END);
    } else {
      gradient.addColorStop(0, COLORS.MODAL.LOSE_GRADIENT_START);
      gradient.addColorStop(1, COLORS.MODAL.LOSE_GRADIENT_END);
    }

    drawRoundedRect(ctx, modalX, modalY, modalWidth, modalHeight, modalRadius);
    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 24 * scale;
    ctx.shadowOffsetY = 8 * scale;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = Math.max(2, 4 * scale);
    ctx.strokeStyle = COLORS.MODAL.BORDER;
    ctx.stroke();

    ctx.textAlign = 'center';
    const title = this.gameOverIsWin ? 'You Win!' : 'You Lose!';
    const titleY = centerY - modalHeight * 0.12;
    // 'Impact'/'Arial Black' aren't available on every OS — the bold
    // sans-serif fallback plus the outline stroke below keep it reading as
    // "big playful headline" either way, without loading an external font.
    ctx.font = `900 ${modalTitleFontSize}px Impact, 'Arial Black', sans-serif`;
    ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.strokeStyle = COLORS.MODAL.TITLE_STROKE;
    ctx.strokeText(title, centerX, titleY);
    ctx.fillStyle = COLORS.MODAL.TITLE_FILL;
    ctx.fillText(title, centerX, titleY);

    ctx.font = `bold ${modalSubtitleFontSize}px Arial`;
    ctx.fillStyle = COLORS.MODAL.SUBTITLE;
    ctx.fillText(this.message, centerX, centerY + modalHeight * 0.06);

    const buttonX = centerX - modalButtonWidth / 2;
    const buttonY = centerY + modalHeight * 0.22;
    drawRoundedRect(ctx, buttonX, buttonY, modalButtonWidth, modalButtonHeight, modalButtonRadius);
    ctx.shadowColor = COLORS.MODAL.BUTTON_SHADOW;
    ctx.shadowBlur = 10 * scale;
    ctx.shadowOffsetY = 4 * scale;
    ctx.fillStyle = COLORS.MODAL.BUTTON_BACKGROUND;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.font = `bold ${modalButtonFontSize}px Arial`;
    ctx.fillStyle = COLORS.MODAL.BUTTON_TEXT;
    ctx.fillText('Play Again', centerX, buttonY + modalButtonHeight / 2 + modalButtonFontSize * 0.35);

    ctx.restore();

    this.playAgainButtonArea = { x: buttonX, y: buttonY, width: modalButtonWidth, height: modalButtonHeight };
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
    // Bottom-wall modules are rotated 180° (top wall stays unrotated) so
    // cabinet's single remaining trim band (see MODULE_SPECS.cabinet above)
    // ends up facing the room on both walls instead of facing the wall on
    // one of them — sink/stove never appear on the bottom wall today (see
    // BOTTOM_WALL_ORDER), so this doesn't affect their orientation.
    const makeModule = (type, x, isTop) => {
      const spec = MODULE_SPECS[type];
      const height = spec.height * moduleScale;
      const y = isTop ? wallBandThickness : this.canvas.height - wallBandThickness - height;
      return new Furniture(x, y, type, spec.sprite, isTop ? 0 : 180, spec.width, spec.height, moduleScale, spec.cropX, spec.cropY);
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

    // Exposed for resetGameObjects()'s resolveClearSpawn() — the same
    // interior bounds the dining set below searches within, reused so a
    // fallback mouse spawn is guaranteed to fit the same way the dining set
    // does.
    this.playableArea = { x: playableX, y: playableY, width: playableMaxWidth, height: playableMaxHeight };

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
