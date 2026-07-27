import CharacterSelectScreen from './CharacterSelectScreen.js';

export default class SetupScreen {
  constructor(screenManager, canvas) {
    this.screenManager = screenManager;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.backgroundImage = new Image();
    this.backgroundImage.src = './assets/start_screen.jpg'; 
    this.startButtonArea = null;
    this.animationOffset = 0;
    // Lets animateBackground()'s self-perpetuating rAF loop stop once this
    // screen is no longer active (see cleanup()) — previously nothing ever
    // set this, so the loop (and a stray mousemove listener) ran forever.
    this.running = true;
  }

  init() {
    this.backgroundImage.onload = () => {
      this.render();
    };
    this.addEventListeners();
    this.animateBackground(); // Start background animation
  }

  render() {
    // Clear the canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw animated background
    this.drawAnimatedBackground();

    // Calculate image dimensions to maintain aspect ratio
    const aspectRatio = this.backgroundImage.width / this.backgroundImage.height;
    let imgWidth = this.canvas.width * 1.0;
    let imgHeight = imgWidth / aspectRatio;

    if (imgHeight > this.canvas.height * 1.0) {
      imgHeight = this.canvas.height * 1.0;
      imgWidth = imgHeight * aspectRatio;
    }

    const imgX = (this.canvas.width - imgWidth) / 2; // Center horizontally
    const imgY = (this.canvas.height - imgHeight) / 2; // Center vertically

    // Draw the image
    this.ctx.drawImage(this.backgroundImage, imgX, imgY, imgWidth, imgHeight);

    // Define the clickable area for the "Start Game" button
    const buttonX = imgX + imgWidth * 0.23; // Adjust as per the button position in the image
    const buttonY = imgY + imgHeight * 0.42; // Adjust as per the button position in the image
    const buttonWidth = imgWidth * 0.5;
    const buttonHeight = imgHeight * 0.11;

    this.startButtonArea = { x: buttonX, y: buttonY, width: buttonWidth, height: buttonHeight };

    // Draw a transparent rectangle over the clickable area for testing
    //this.ctx.strokeStyle = 'red';
    //this.ctx.strokeRect(buttonX, buttonY, buttonWidth, buttonHeight);
    
  }

  drawAnimatedBackground() {
    const waveHeight = 500; // Height of the wave effect
    const gradientHeight = this.canvas.height + waveHeight; // Extend the gradient for smooth looping

    // Create a gradient in the blue/green space
    const gradient = this.ctx.createLinearGradient(0, this.animationOffset, 0, gradientHeight + this.animationOffset);
    gradient.addColorStop(0, '#0077be'); // Ocean blue
    gradient.addColorStop(0.5, '#00d1b2'); // Aqua green
    gradient.addColorStop(1, '#29b6f6'); // Sky blue

    // Fill the canvas with the gradient
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Add a wave-like distortion to the gradient
    const waveAmplitude = 100; // Wave amplitude
    const waveFrequency = .3; // Frequency of the wave
    this.ctx.globalCompositeOperation = 'source-over';

    for (let y = 0; y < this.canvas.height; y += waveHeight) {
      const offset = waveAmplitude * Math.sin((y + this.animationOffset) * waveFrequency);
      this.ctx.drawImage(
        this.canvas,
        0,
        y,
        this.canvas.width,
        waveHeight,
        offset,
        y,
        this.canvas.width,
        waveHeight
      );
    }

    // Increment the animation offset for looping
    this.animationOffset = (this.animationOffset + 2) % gradientHeight; // Smoothly loop
  }

  animateBackground() {
    if (!this.running) return;

    // Continuously animate the background
    this.render(); // Re-render with the animated background
    requestAnimationFrame(() => this.animateBackground());
  }

  addEventListeners() {
    this.startClickHandler = (event) => {
        const { offsetX, offsetY } = event;

        // Check if the click is inside the "Start Game" button area
        if (
            offsetX >= this.startButtonArea.x &&
            offsetX <= this.startButtonArea.x + this.startButtonArea.width &&
            offsetY >= this.startButtonArea.y &&
            offsetY <= this.startButtonArea.y + this.startButtonArea.height
        ) {
            // Stop the animation loop and remove listeners before transitioning
            this.cleanup();

            // Transition to character selection before gameplay starts
            this.screenManager.setScreen(new CharacterSelectScreen(this.screenManager, this.canvas));
        }
    };

    // Add the event listener
    this.canvas.addEventListener('click', this.startClickHandler);

    // Named (not anonymous) so cleanup() can actually remove it.
    this.moveHandler = (event) => {
      const { offsetX, offsetY } = event;

      if (
        offsetX >= this.startButtonArea.x &&
        offsetX <= this.startButtonArea.x + this.startButtonArea.width &&
        offsetY >= this.startButtonArea.y &&
        offsetY <= this.startButtonArea.y + this.startButtonArea.height
      ) {
        this.canvas.style.cursor = 'pointer'; // Change cursor to hand
      } else {
        this.canvas.style.cursor = 'default'; // Reset cursor to default
      }
    };
    this.canvas.addEventListener('mousemove', this.moveHandler);
  }

  // Stops animateBackground()'s rAF loop and removes both listeners —
  // called both from the Start click (before transitioning) and
  // automatically by ScreenManager.setScreen() on any screen swap.
  cleanup() {
    this.running = false;
    this.canvas.removeEventListener('click', this.startClickHandler);
    this.canvas.removeEventListener('mousemove', this.moveHandler);
  }
}
