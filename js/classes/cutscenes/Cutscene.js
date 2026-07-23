import { getUIScale } from '../../utils/scale.js';

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
  }

  init(nextCallback) {
    this.nextCallback = nextCallback;

    if (this.soundCallback) {
      this.soundCallback();
    }

    // Center the animation
    this.characterAnimation.x = this.ctx.canvas.width / 2 - this.frameWidth / 2;
    this.characterAnimation.y = this.ctx.canvas.height / 2 - this.frameHeight / 2;

    this.addEventListeners();
  }

  addEventListeners() {
    this.canvasClickHandler = this.handleNextClick.bind(this);
    this.ctx.canvas.addEventListener('click', this.canvasClickHandler);
  }

  handleNextClick(event) {
    const { offsetX, offsetY } = event;

    // Define "Next" button position
    const buttonWidth = 150 * this.scale;
    const buttonHeight = 50 * this.scale;
    const buttonX = this.ctx.canvas.width / 2 - buttonWidth / 2;
    const buttonY = this.ctx.canvas.height / 2 + 100 * this.scale;

    if (
      offsetX >= buttonX &&
      offsetX <= buttonX + buttonWidth &&
      offsetY >= buttonY &&
      offsetY <= buttonY + buttonHeight
    ) {
      this.cleanup();
      if (this.nextCallback) this.nextCallback();
    }
  }

  cleanup() {
    this.ctx.canvas.removeEventListener('click', this.canvasClickHandler);
  }

  render() {
    // Draw a red-bordered modal background
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    //this.ctx.strokeStyle = 'red'; // Red border for debug visibility
    //this.ctx.lineWidth = 5;
    const modalMargin = 50 * this.scale;
    const modalX = modalMargin;
    const modalY = modalMargin;
    const modalWidth = this.ctx.canvas.width - modalMargin * 2;
    const modalHeight = this.ctx.canvas.height - modalMargin * 2;

    this.ctx.fillRect(modalX, modalY, modalWidth, modalHeight);
    //this.ctx.strokeRect(modalX, modalY, modalWidth, modalHeight);

    // Draw the character animation
    if (this.characterAnimation) {
      this.characterAnimation.update(); // Update animation frame
      this.characterAnimation.draw(this.ctx);
    }

    // Draw the text — clamped to a minimum so it stays legible even at a
    // small canvas scale, rather than shrinking indefinitely.
    const textFontSize = Math.max(14, 32 * this.scale);
    const buttonFontSize = Math.max(12, 24 * this.scale);
    this.ctx.fillStyle = 'navy';
    this.ctx.font = `${textFontSize}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText(this.text, this.ctx.canvas.width / 2, this.ctx.canvas.height / 2 + 50 * this.scale);

    // Draw the "Next" button
    const buttonWidth = 150 * this.scale;
    const buttonHeight = 50 * this.scale;
    const buttonX = this.ctx.canvas.width / 2 - buttonWidth / 2;
    const buttonY = this.ctx.canvas.height / 2 + 100 * this.scale;
    this.ctx.fillStyle = 'blue';
    this.ctx.fillRect(buttonX, buttonY, buttonWidth, buttonHeight);

    this.ctx.fillStyle = 'white';
    this.ctx.font = `${buttonFontSize}px Arial`;
    this.ctx.fillText('Next', this.ctx.canvas.width / 2, buttonY + buttonHeight * 0.66);

    this.ctx.restore();
  }
}
