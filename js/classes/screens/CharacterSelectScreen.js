import GameScreen from './GameScreen.js?v=23';
import { CHARACTER_NAMES } from '../../utils/characterNames.js';
import { getUIScale } from '../../utils/scale.js?v=1';
import {
  drawCatEarCard, drawCatEarInner,
  drawMouseEarCard, drawMouseEarInner,
  drawDogEarCard, drawDogEarInner,
} from '../../utils/canvasShapes.js';
import { getSpriteSrc, PORTRAITS } from '../../utils/outfits.js';

// Per-entity ear shape, keyed the same way THEMES/PORTRAITS below are —
// cat keeps its original pointed ears (the shape this screen was built
// around), mouse gets big round Mickey-style ears, dog gets floppy
// outward-leaning ones, so each card reads as its own animal at a glance
// instead of all three wearing a cat's ears.
const EAR_SHAPES = {
  cat: { card: drawCatEarCard, inner: drawCatEarInner },
  mouse: { card: drawMouseEarCard, inner: drawMouseEarInner },
  dog: { card: drawDogEarCard, inner: drawDogEarInner },
};

// Sized like the rest of the game's UI chrome (play-again button, cutscene
// modal) — see getUIScale() in js/utils/scale.js — so this screen scales the
// same way on mobile as everything else, rather than inventing its own
// device check.
const BASE_CARD_WIDTH = 240;
const BASE_CARD_HEIGHT = 260;
const BASE_CARD_GAP = 30;
const BASE_CARD_RADIUS = 22;
const BASE_PORTRAIT_SIZE = 80;
const BASE_TITLE_FONT_SIZE = 42;
const BASE_NAME_FONT_SIZE = 24;
const BASE_SUBLABEL_FONT_SIZE = 20;
// Gap between the title's baseline and the cards' top edge — everything
// here scales with uiScale like the rest of this screen (see below), so
// this stays proportionally the same gap at any canvas size rather than a
// fixed pixel distance that would look too tight or too loose off the
// reference size. Bigger than it needs to be for the title text alone
// (which would fit in ~46) specifically to clear the cat-ear cards' ears,
// which poke up above the cards' own top edge — see drawCatEarCard() in
// canvasShapes.js.
const BASE_TITLE_GAP = 70;

const OPTIONS = [
  { entity: 'cat', name: CHARACTER_NAMES.CAT, role: 'Cat', enabled: true, subtitle: 'Chase the mouse' },
  { entity: 'mouse', name: CHARACTER_NAMES.MOUSE, role: 'Mouse', enabled: true, subtitle: 'Escape the cat' },
  { entity: 'dog', name: CHARACTER_NAMES.DOG, role: 'Dog', enabled: true, subtitle: 'Save the mouse' },
];

// Full saturated gradient per character, filling the whole card — a cream/
// parchment fill (matching Cutscene's modal) was tried here so the two
// screens shared one card language, but confirmed live that made the
// *cards* look like the cutscenes rather than the *backdrop*, which was
// the actual ask; cream cards also crowded out the backdrop's own teal-to-
// gold visually. Reverted to a bold per-character fill, keeping the
// backdrop (see render() below) as the shared element with Cutscene
// instead. Dog is blue rather than the amber/brown this had before —
// confirmed live that orange and brown/amber read as too close to tell
// apart at a glance; a completely different hue family sidesteps that
// regardless of exactly which warm tone dog would otherwise get.
const THEMES = {
  cat: { start: '#ffd54f', end: '#fb8c00', glow: 'rgba(251, 140, 0, 0.6)' },
  mouse: { start: '#d9a6e0', end: '#9c4bc4', glow: 'rgba(156, 75, 196, 0.6)' },
  dog: { start: '#7ec8e3', end: '#1f7fc4', glow: 'rgba(31, 127, 196, 0.6)' },
};
const DISABLED_THEME = { start: '#6b7280', end: '#3f4653', glow: 'rgba(0, 0, 0, 0)' };

// PORTRAITS (crop rect only, no src) is imported from outfits.js - shared
// with storeModal.js's own dressing-room pedestal preview so the two
// "here's what this character looks like" spots can't drift into
// different crops. This screen always shows each character's *default*
// look (getSpriteSrc(entity) with no equippedOutfit) - there's no equip
// state to read here, and wouldn't be meaningful pre-login anyway.

export default class CharacterSelectScreen {
  // `isReplay` is true when this screen was reached via GameScreen's "Play
  // Again" (see restartGame()) rather than SetupScreen's "Start Game" —
  // forwarded to the next GameScreen as `skipCutscenes` (see its own
  // constructor) so a replay doesn't re-watch the intro cutscenes every
  // round.
  constructor(screenManager, canvas, isReplay = false) {
    this.screenManager = screenManager;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.isReplay = isReplay;
    this.buttonAreas = [];
    this.hoveredIndex = -1;
    this.pressedIndex = -1;

    // Loaded once per screen instance; onload triggers a re-render so a
    // portrait that hasn't finished loading yet (unlikely given how small
    // these files are, but not guaranteed) pops in rather than staying
    // blank for the rest of the screen's life.
    this.portraitImages = {};
    Object.keys(PORTRAITS).forEach((entity) => {
      const img = new Image();
      img.onload = () => this.render();
      img.src = getSpriteSrc(entity);
      this.portraitImages[entity] = img;
    });
  }

  init() {
    this.render();
    this.addEventListeners();
  }

  render() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const uiScale = getUIScale(width);

    // The 3-card row can overflow the canvas at this uiScale — confirmed
    // live specifically on touch devices, where getUIScale() applies an
    // extra 2x multiplier (tuned for a single centered button/message, not
    // a 3-wide row) against a canvas that's only modestly narrower than
    // desktop's own. Rather than just retuning BASE_CARD_WIDTH/GAP (which
    // would only fix today's numbers and could overflow again the next time
    // any of them change), clamp the whole layout proportionally so it
    // always fits — everything below reads from effectiveScale, not
    // uiScale directly, so cards/portraits/fonts/gaps all shrink together
    // rather than the row fitting horizontally while text spills its card.
    const sideMargin = 20 * uiScale;
    const availableWidth = width - sideMargin * 2;
    const naiveTotalWidth = (BASE_CARD_WIDTH * OPTIONS.length + BASE_CARD_GAP * (OPTIONS.length - 1)) * uiScale;
    const fitScale = naiveTotalWidth > availableWidth ? availableWidth / naiveTotalWidth : 1;
    const effectiveScale = uiScale * fitScale;

    ctx.clearRect(0, 0, width, height);

    // Teal-to-gold diagonal gradient sampled off assets/start_screen.jpg's
    // actual pixels (its sky teal, its "KAT TRAP!" lettering gold) — this
    // screen is the very next thing the player sees after that title
    // screen, so it picks up that screen's own candy-bright palette rather
    // than either a generic app gradient or (an earlier version of this)
    // a muted kitchen-wood brown that read as flat by comparison
    // (confirmed live: "boring colors"). Diagonal rather than a flat
    // top-to-bottom fade for a bit more of that same candy-poster energy.
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    bgGradient.addColorStop(0, '#2fa8b8');
    bgGradient.addColorStop(1, '#ffb238');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    const cardWidth = BASE_CARD_WIDTH * effectiveScale;
    const cardHeight = BASE_CARD_HEIGHT * effectiveScale;
    const gap = BASE_CARD_GAP * effectiveScale;
    const totalWidth = cardWidth * OPTIONS.length + gap * (OPTIONS.length - 1);
    let x = width / 2 - totalWidth / 2;
    const y = height / 2 - cardHeight / 2;

    ctx.textAlign = 'center';
    // Positioned relative to the cards' own top edge (y) rather than an
    // independent fraction of canvas height — ties the two together
    // directly so the title sits close to the cards at any canvas size,
    // instead of two separately-tuned positions that happened to look right
    // together only at one reference size and drifted apart at others.
    const titleY = y - BASE_TITLE_GAP * effectiveScale;
    // 'Impact'/'Arial Black' aren't available on every OS — the bold
    // sans-serif fallback plus the outline stroke keep it reading as a big
    // playful headline either way, same treatment as the game-over modal's
    // title (see GameScreen.displayGameOverModal()).
    ctx.font = `900 ${BASE_TITLE_FONT_SIZE * effectiveScale}px Impact, 'Arial Black', sans-serif`;
    // The backdrop is a mid-brightness teal-to-gold diagonal (see above),
    // not the near-black top this title used to sit against, so the
    // stroke alone isn't a reliable contrast guarantee everywhere the
    // title could land on it — a soft drop shadow (same idea as the card
    // subtitles further down) backs it up regardless of exactly which
    // color it's over.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 8 * effectiveScale;
    ctx.shadowOffsetY = 2 * effectiveScale;
    ctx.lineWidth = Math.max(2, 4 * effectiveScale);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.strokeText('Choose Your Character', width / 2, titleY);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Choose Your Character', width / 2, titleY);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    this.buttonAreas = OPTIONS.map((option, index) => {
      // Hit-testing always uses this original (unlifted) area — only the
      // drawing below shifts for hover/press, so a card lifting toward the
      // cursor can't push its own hit box out from under it.
      const area = { x, y, width: cardWidth, height: cardHeight, option, index };
      x += cardWidth + gap;

      const isHovered = option.enabled && index === this.hoveredIndex;
      const isPressed = option.enabled && index === this.pressedIndex;
      const theme = option.enabled ? THEMES[option.entity] : DISABLED_THEME;

      // Hover lifts the card slightly toward the cursor; press settles it
      // back down a touch further than rest — the same "raised until you
      // push it" feel the touch action buttons already have (see
      // .action-btn:active in styles.css), translated to canvas since
      // these are drawn shapes, not real DOM buttons.
      const liftY = isPressed ? 2 * effectiveScale : isHovered ? -4 * effectiveScale : 0;
      const drawY = area.y + liftY;

      ctx.save();
      const cardGradient = ctx.createLinearGradient(area.x, drawY, area.x, drawY + cardHeight);
      cardGradient.addColorStop(0, theme.start);
      cardGradient.addColorStop(1, theme.end);

      // Animal-ear card (see EAR_SHAPES above / canvasShapes.js), not a
      // generic rounded rect — the one deliberate visual risk on this
      // screen, and a callback to each character's own animal rather than
      // to a specific mechanic. Portrait/name/subtitle positions below are
      // unchanged from before this shape existed — the ears sit above the
      // card's normal top edge, not inside it, regardless of which shape.
      const earShapes = EAR_SHAPES[option.entity];
      earShapes.card(ctx, area.x, drawY, cardWidth, cardHeight, BASE_CARD_RADIUS * effectiveScale);
      ctx.fillStyle = cardGradient;
      ctx.shadowColor = isHovered ? theme.glow : 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = (isHovered ? 22 : 12) * effectiveScale;
      ctx.shadowOffsetY = (isPressed ? 2 : 6) * effectiveScale;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineWidth = Math.max(1, 2 * effectiveScale);
      ctx.strokeStyle = option.enabled ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.15)';
      ctx.stroke();

      // Two-tone inner ears — a shared pale pink across all three cards'
      // own ear shapes (the classic cartoon "pink inner ear," same idea
      // regardless of the outer ear's shape or color), filled after the
      // card body so it sits on top. This is the concrete "more animal-
      // like" detail: real ears are two-toned, and a flat single-color ear
      // reads as more of a generic tab than an actual ear (confirmed live
      // for the cat's own ears, before mouse/dog had their own shapes).
      earShapes.inner(ctx, area.x, drawY, cardWidth, cardHeight);
      ctx.fillStyle = option.enabled ? '#ffd7d0' : 'rgba(0, 0, 0, 0.1)';
      ctx.fill();

      const portrait = PORTRAITS[option.entity];
      const img = this.portraitImages[option.entity];
      const boxSize = BASE_PORTRAIT_SIZE * effectiveScale;
      const boxCenterX = area.x + cardWidth / 2;
      const boxCenterY = drawY + cardHeight * 0.32;
      if (img.complete && img.naturalWidth > 0) {
        // Fit within boxSize preserving aspect ratio — the three sprites
        // have very different native proportions (a tall cat portrait vs a
        // roughly square mouse frame vs a wide dog frame), so a fixed
        // width/height would stretch two of the three.
        const drawScale = Math.min(boxSize / portrait.sw, boxSize / portrait.sh);
        const dw = portrait.sw * drawScale;
        const dh = portrait.sh * drawScale;
        ctx.globalAlpha = option.enabled ? 1 : 0.5;
        ctx.drawImage(
          img,
          portrait.sx, portrait.sy, portrait.sw, portrait.sh,
          boxCenterX - dw / 2, boxCenterY - dh / 2, dw, dh
        );
        ctx.globalAlpha = 1;
      }

      ctx.textAlign = 'center';
      // A flat gradient card has no single contrast guarantee for text sitting
      // on top of it — the theme gradients range from a light top stop to a
      // darker bottom stop, and white text with no shadow read fine against
      // the dark end but washed out wherever it landed on the lighter part
      // (confirmed live: the subtitle in particular was hard to read). A
      // soft dark drop shadow, same idea as the title's outline stroke
      // above, keeps both lines legible regardless of exactly where they
      // land on the gradient.
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 5 * effectiveScale;
      ctx.shadowOffsetY = 1 * effectiveScale;

      ctx.fillStyle = option.enabled ? '#ffffff' : 'rgba(255, 255, 255, 0.6)';
      ctx.font = `bold ${BASE_NAME_FONT_SIZE * effectiveScale}px Arial`;
      ctx.fillText(`${option.name} — ${option.role}`, boxCenterX, drawY + cardHeight * 0.68);

      ctx.font = `bold ${BASE_SUBLABEL_FONT_SIZE * effectiveScale}px Arial`;
      ctx.fillStyle = option.enabled ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.45)';
      ctx.fillText(option.subtitle, boxCenterX, drawY + cardHeight * 0.85);

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      ctx.restore();

      return area;
    });
  }

  findHit(offsetX, offsetY) {
    return this.buttonAreas.find(area =>
      offsetX >= area.x && offsetX <= area.x + area.width &&
      offsetY >= area.y && offsetY <= area.y + area.height
    );
  }

  addEventListeners() {
    this.clickHandler = (event) => {
      const hit = this.findHit(event.offsetX, event.offsetY);
      if (!hit || !hit.option.enabled) return;

      this.cleanup();
      this.canvas.style.cursor = 'default';
      this.screenManager.setScreen(new GameScreen(this.screenManager, this.canvas, this.ctx, hit.option.entity, this.isReplay));
    };
    this.canvas.addEventListener('click', this.clickHandler);

    this.moveHandler = (event) => {
      const hit = this.findHit(event.offsetX, event.offsetY);
      this.canvas.style.cursor = hit && hit.option.enabled ? 'pointer' : 'default';

      const newHoveredIndex = hit && hit.option.enabled ? hit.index : -1;
      if (newHoveredIndex !== this.hoveredIndex) {
        this.hoveredIndex = newHoveredIndex;
        this.render();
      }
    };
    this.canvas.addEventListener('mousemove', this.moveHandler);

    this.downHandler = (event) => {
      const hit = this.findHit(event.offsetX, event.offsetY);
      if (hit && hit.option.enabled) {
        this.pressedIndex = hit.index;
        this.render();
      }
    };
    this.canvas.addEventListener('mousedown', this.downHandler);

    this.upHandler = () => {
      if (this.pressedIndex !== -1) {
        this.pressedIndex = -1;
        this.render();
      }
    };
    this.canvas.addEventListener('mouseup', this.upHandler);

    // Without this, moving the cursor off-canvas mid-hover (or mid-press)
    // leaves a card permanently lit/lowered until the next mousemove
    // anywhere back on the canvas re-syncs it.
    this.leaveHandler = () => {
      let changed = false;
      if (this.hoveredIndex !== -1) { this.hoveredIndex = -1; changed = true; }
      if (this.pressedIndex !== -1) { this.pressedIndex = -1; changed = true; }
      this.canvas.style.cursor = 'default';
      if (changed) this.render();
    };
    this.canvas.addEventListener('mouseleave', this.leaveHandler);
  }

  // Matches GameScreen.cleanup()'s pattern (see CLAUDE.md: new listeners
  // need a matching removal path) — a standalone method rather than only
  // removing listeners inline inside the click handler, so any future exit
  // path (a back button, a forced reset) has something to call too.
  cleanup() {
    this.canvas.removeEventListener('click', this.clickHandler);
    this.canvas.removeEventListener('mousemove', this.moveHandler);
    this.canvas.removeEventListener('mousedown', this.downHandler);
    this.canvas.removeEventListener('mouseup', this.upHandler);
    this.canvas.removeEventListener('mouseleave', this.leaveHandler);
  }
}
