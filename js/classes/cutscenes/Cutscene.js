import { getUIScale } from '../../utils/scale.js?v=1';
import { drawRoundedRect } from '../../utils/canvasShapes.js';
import { playModalPopSound } from '../../utils/audio.js?v=3';

const POP_IN_DURATION = 250; // ms — same ease-out-cubic pop as GameScreen's game-over modal

// How much of the modal's own available vertical space (the band between
// the card's top edge and where the text starts, see render()) the
// character sprite should fill. Deliberately not a fraction of
// GameScreen's in-game characterScale — that scale is tuned so a cat
// looks right sitting next to furniture on the board, not filling this
// card, and reusing it here left the sprite under 10% of the modal's
// height on both desktop and mobile (flagged live as "should be much
// bigger... scaled for the cutscene modal['s] size... not the in-game
// size"). This ratio is applied against modalHeight instead, which
// already varies correctly by device via getUIScale() (this.scale) the
// same way every other size in this file does, so desktop/mobile don't
// need their own separate multiplier the way getCharacterScale() has.
const CUTSCENE_CHARACTER_FILL_RATIO = 0.9;

export default class Cutscene {
  constructor(ctx, characterAnimation, text, soundCallback) {
    this.ctx = ctx;
    this.characterAnimation = characterAnimation; // Sprite animation object
    this.text = text; // Cutscene text to display
    this.soundCallback = soundCallback;
    // displayWidth/displayHeight (Cat/Dog/Mouse) give the character's real
    // on-screen size, which already accounts for their own scale factor —
    // falling back to frameWidth/frameHeight covers any animation object
    // that doesn't expose those getters.
    this.frameWidth = this.characterAnimation?.displayWidth ?? this.characterAnimation?.frameWidth ?? 100;
    this.frameHeight = this.characterAnimation?.displayHeight ?? this.characterAnimation?.frameHeight ?? 100;

    this.nextCallback = null; // Callback for when "Next" is clicked
    this.elapsedTime = 0; // Timer for cutscene

    this.soundPlayed = false; // Prevent duplicate sounds

    // Modal/text/button sizes below were tuned against a ~1280px-wide
    // desktop canvas, same reference point as GameScreen's layout — without
    // this, the modal text overflowed its own box on a small mobile canvas
    // (confirmed live). This is UI chrome (button/message/modal), not an
    // in-game asset, so it uses getUIScale rather than getScale — see
    // js/utils/scale.js.
    this.scale = getUIScale(this.ctx.canvas.width);
    this.startTime = 0; // Set in init() — drives the pop-in animation below
  }

  init(nextCallback) {
    this.nextCallback = nextCallback;
    this.startTime = performance.now();

    // The generic pop-in "pfff" (see audio.js) — separate from
    // soundCallback below, which plays a per-character themed sound
    // (e.g. a meow), not a UI pop. Both fire; they're not alternatives.
    playModalPopSound();

    if (this.soundCallback) {
      this.soundCallback();
    }

    // Position/size is recomputed every frame in render() instead (it
    // depends on modal geometry, not just a one-time canvas size), so
    // there's nothing to set here beyond the listener.
    this.addEventListeners();
  }

  addEventListeners() {
    this.canvasClickHandler = this.handleNextClick.bind(this);
    this.ctx.canvas.addEventListener('click', this.canvasClickHandler);
  }

  // Shared by render() and handleNextClick() so the drawn button and its
  // click hit box can never drift apart — previously these were two
  // separate copies of the same four numbers.
  getButtonRect() {
    const width = 160 * this.scale;
    const height = 54 * this.scale;
    const x = this.ctx.canvas.width / 2 - width / 2;
    const y = this.ctx.canvas.height / 2 + 110 * this.scale;
    return { x, y, width, height };
  }

  handleNextClick(event) {
    const { offsetX, offsetY } = event;
    const { x, y, width, height } = this.getButtonRect();

    if (offsetX >= x && offsetX <= x + width && offsetY >= y && offsetY <= y + height) {
      this.cleanup();
      if (this.nextCallback) this.nextCallback();
    }
  }

  cleanup() {
    this.ctx.canvas.removeEventListener('click', this.canvasClickHandler);
  }

  // Cutscene characters are static portraits — only the walk-cycle frame
  // should ever advance here, never real movement/AI. Cat.update() and
  // Dog.update() are already safe to call with no arguments (Cat's is
  // animation-only by definition; Dog's bails to animation-only when its
  // timestamp param is undefined), but Mouse.update() has no such guard —
  // it unconditionally moves this.x/this.y and bounces off *canvas* edges
  // every call. That went unnoticed while this.x/this.y were only set
  // once (in the old init()), but render() now overwrites them every
  // frame to a small, pre-scale-transform local origin (see below) that's
  // wildly outside Mouse's real canvasWidth/canvasHeight bounds — Mouse.
  // update() read that as "past the wall" and bounced every single frame,
  // flipping direction/frame constantly (reported live as the mouse
  // "bugging out"). Calling each class's own frame-advance method
  // directly — duck-typed since Cat/Mouse name it updateAnimations() and
  // Dog names it updateAnimation() — sidesteps this for good, for all
  // three, rather than relying on each class's update() happening to be
  // safe when called with no timestamp/movement context.
  advanceAnimationOnly() {
    const anim = this.characterAnimation;
    if (typeof anim.updateAnimations === 'function') anim.updateAnimations();
    else if (typeof anim.updateAnimation === 'function') anim.updateAnimation();
  }

  render() {
    const ctx = this.ctx;
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;

    // Full-canvas backdrop — same teal-to-gold diagonal as
    // CharacterSelectScreen (see the comment there — sampled off
    // assets/start_screen.jpg's own sky/lettering colors), not the flatter
    // blue/teal family this used to share with SetupScreen, and not the
    // muted kitchen-wood brown this briefly used either (both read as flat
    // next to the title screen's own candy-bright palette). Cutscenes sit
    // directly between character select and gameplay, so keeping this in
    // step with select keeps that stretch of the flow reading as one
    // sequence. Previously this was left uncleared, showing the canvas
    // element's own white CSS background — which the modal's own
    // near-white fill (rgba(255,255,255,0.9)) barely stood out against.
    const bgGradient = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
    bgGradient.addColorStop(0, '#2fa8b8');
    bgGradient.addColorStop(1, '#ffb238');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.save();

    // Pop-in animation: same ease-out-cubic scale+fade as
    // GameScreen.displayGameOverModal(), keyed off this.startTime (set in
    // init(), i.e. when this cutscene actually became active) — so the card
    // (and the character sprite drawn on top of it, since both sit inside
    // this transform) eases in each time "Next" advances to a new
    // cutscene, rather than snapping straight to its final state.
    const elapsed = performance.now() - this.startTime;
    const progress = Math.min(1, elapsed / POP_IN_DURATION);
    const eased = 1 - Math.pow(1 - progress, 3);
    const popScale = 0.92 + 0.08 * eased;

    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    ctx.globalAlpha = eased;
    ctx.translate(centerX, centerY);
    ctx.scale(popScale, popScale);
    ctx.translate(-centerX, -centerY);

    const modalMargin = 50 * this.scale;
    const modalX = modalMargin;
    const modalY = modalMargin;
    const modalWidth = canvasWidth - modalMargin * 2;
    const modalHeight = canvasHeight - modalMargin * 2;
    const modalRadius = 28 * this.scale;

    const cardGradient = ctx.createLinearGradient(modalX, modalY, modalX, modalY + modalHeight);
    cardGradient.addColorStop(0, '#fff8ee');
    cardGradient.addColorStop(1, '#ffe9c7');

    drawRoundedRect(ctx, modalX, modalY, modalWidth, modalHeight, modalRadius);
    ctx.fillStyle = cardGradient;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 24 * this.scale;
    ctx.shadowOffsetY = 8 * this.scale;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = Math.max(2, 4 * this.scale);
    // Same purple accent used elsewhere in the game's chrome (action
    // buttons, settings menu, punch shockwave) — ties the cutscene card
    // back into the rest of the UI instead of introducing a new accent.
    ctx.strokeStyle = 'rgba(138, 43, 226, 0.55)';
    ctx.stroke();

    // Draw the character animation — sized to fill the modal's own
    // available vertical space (see CUTSCENE_CHARACTER_FILL_RATIO above),
    // not GameScreen's in-game characterScale.
    if (this.characterAnimation) {
      this.advanceAnimationOnly();

      const topPadding = 20 * this.scale;
      // Text starts at centerY + 55*scale (see below) — this leaves a
      // small gap above it rather than the character's feet touching the
      // first line.
      const bottomBoundary = centerY - 5 * this.scale;
      const availableTop = modalY + topPadding;
      const availableHeight = Math.max(0, bottomBoundary - availableTop);

      const nativeWidth = this.frameWidth;
      const nativeHeight = this.frameHeight;
      let targetHeight = availableHeight * CUTSCENE_CHARACTER_FILL_RATIO;
      let targetWidth = targetHeight * (nativeWidth / nativeHeight);

      // Clamp to the card's own width too — modalWidth is normally
      // generous enough (this card is landscape) that height is the only
      // binding constraint, but this guards against an unusually wide
      // sprite or a narrow modal without needing a per-character special
      // case.
      const maxWidth = modalWidth - 80 * this.scale;
      if (targetWidth > maxWidth) {
        targetWidth = maxWidth;
        targetHeight = targetWidth * (nativeHeight / nativeWidth);
      }

      const spriteScale = targetHeight / nativeHeight;
      const characterCenterY = availableTop + availableHeight / 2;

      // Cat/Dog/Mouse's own draw() methods all paint a (this.x, this.y)-
      // anchored rect sized to their own displayWidth/displayHeight
      // equivalent (Cat centers internally via its own translate, Dog/
      // Mouse use plain top-left — same rect either way, see
      // this.frameWidth/frameHeight's own comment in the constructor).
      // Translating+scaling the canvas first, then drawing at a local,
      // pre-scale origin, gets the target on-screen size/position for
      // free without needing any per-class special-casing here.
      ctx.save();
      ctx.translate(centerX, characterCenterY);
      ctx.scale(spriteScale, spriteScale);
      this.characterAnimation.x = -nativeWidth / 2;
      this.characterAnimation.y = -nativeHeight / 2;
      this.characterAnimation.draw(this.ctx);
      ctx.restore();
    }

    // Draw the text — clamped to a minimum so it stays legible even at a
    // small canvas scale, rather than shrinking indefinitely. That minimum
    // is exactly what let it overflow the card at small scales/long text
    // (confirmed live: "Say hello to Dummy, the dumb dog!" touched both
    // edges of the card on a narrow canvas) — the fixed floor has no idea
    // how wide the actual sentence is. Measuring the real text width and
    // shrinking further when it doesn't fit (down to an absolute floor, so
    // it degrades to "small but there" rather than vanishing) fixes that
    // without giving up the normal-case minimum.
    let textFontSize = Math.max(16, 32 * this.scale);
    ctx.font = `bold ${textFontSize}px Arial`;
    const availableTextWidth = modalWidth - 40 * this.scale;
    const measuredWidth = ctx.measureText(this.text).width;
    if (measuredWidth > availableTextWidth) {
      textFontSize = Math.max(10, textFontSize * (availableTextWidth / measuredWidth));
      ctx.font = `bold ${textFontSize}px Arial`;
    }
    ctx.fillStyle = '#2b1d3d';
    ctx.textAlign = 'center';
    ctx.fillText(this.text, centerX, centerY + 55 * this.scale);

    // Draw the "Next" button — rounded pill, matching the purple accent
    // rather than the old flat blue rect.
    const button = this.getButtonRect();
    const buttonGradient = ctx.createLinearGradient(button.x, button.y, button.x, button.y + button.height);
    buttonGradient.addColorStop(0, '#9c6fd6');
    buttonGradient.addColorStop(1, '#6a1fc2');
    drawRoundedRect(ctx, button.x, button.y, button.width, button.height, button.height / 2);
    ctx.fillStyle = buttonGradient;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 10 * this.scale;
    ctx.shadowOffsetY = 4 * this.scale;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    const buttonFontSize = Math.max(14, 22 * this.scale);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${buttonFontSize}px Arial`;
    ctx.fillText('Next', centerX, button.y + button.height / 2 + buttonFontSize * 0.35);

    ctx.restore();
  }
}
