export default class Cutscene {
  constructor(ctx, characterAnimation, text) {
    this.ctx = ctx;
    this.characterAnimation = characterAnimation; // Sprite animation object
    this.text = text; // Cutscene text to display
    this.frameWidth = this.characterAnimation?.frameWidth || 100;
    this.frameHeight = this.characterAnimation?.frameHeight || 100;

    this.nextCallback = null; // Callback for when "Next" is clicked
    this.elapsedTime = 0; // Timer for cutscene

    this.soundPlayed = false; // Prevent duplicate sounds
    console.log('Cutscene initialized'); // Debug log
  }

  init(nextCallback) {
    this.nextCallback = nextCallback;

    // Center the animation
    this.characterAnimation.x = this.ctx.canvas.width / 2 - this.frameWidth / 2;
    this.characterAnimation.y = this.ctx.canvas.height / 2 - this.frameHeight / 2;

    console.log('Cutscene init called');
    this.addEventListeners();
  }

  addEventListeners() {
    this.canvasClickHandler = this.handleNextClick.bind(this);
    this.ctx.canvas.addEventListener('click', this.canvasClickHandler);
  }

  handleNextClick(event) {
    console.log('Next button clicked'); // Debug log
    const { offsetX, offsetY } = event;

    // Define "Next" button position
    const buttonX = this.ctx.canvas.width / 2 - 75;
    const buttonY = this.ctx.canvas.height / 2 + 100;
    const buttonWidth = 150;
    const buttonHeight = 50;

    if (
      offsetX >= buttonX &&
      offsetX <= buttonX + buttonWidth &&
      offsetY >= buttonY &&
      offsetY <= buttonY + buttonHeight
    ) {
      console.log('Next cutscene triggered'); // Debug log
      this.cleanup();
      if (this.nextCallback) this.nextCallback();
    }
  }

  cleanup() {
    this.ctx.canvas.removeEventListener('click', this.canvasClickHandler);
  }

  render() {
    console.log('Rendering Cutscene'); // Debug log

    // Draw a red-bordered modal background
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    //this.ctx.strokeStyle = 'red'; // Red border for debug visibility
    //this.ctx.lineWidth = 5;
    const modalX = 50;
    const modalY = 50;
    const modalWidth = this.ctx.canvas.width - 100;
    const modalHeight = this.ctx.canvas.height - 100;

    this.ctx.fillRect(modalX, modalY, modalWidth, modalHeight);
    //this.ctx.strokeRect(modalX, modalY, modalWidth, modalHeight);

    // Draw the character animation
    if (this.characterAnimation) {
      this.characterAnimation.update(); // Update animation frame
      this.characterAnimation.draw(this.ctx);
    } else {
      console.log('No character animation found'); // Debugging placeholder
    }

    // Draw the text
    this.ctx.fillStyle = 'navy';
    this.ctx.font = '32px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(this.text, this.ctx.canvas.width / 2, this.ctx.canvas.height / 2 + 50);

    // Draw the "Next" button
    this.ctx.fillStyle = 'blue';
    this.ctx.fillRect(
      this.ctx.canvas.width / 2 - 75,
      this.ctx.canvas.height / 2 + 100,
      150,
      50
    );

    this.ctx.fillStyle = 'white';
    this.ctx.font = '24px Arial';
    this.ctx.fillText('Next', this.ctx.canvas.width / 2, this.ctx.canvas.height / 2 + 133);

    this.ctx.restore();
  }
}
