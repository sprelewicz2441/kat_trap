import CharacterSelectScreen from './CharacterSelectScreen.js';
import { isTouch } from '../../utils/scale.js?v=1';
import { drawRoundedRect } from '../../utils/canvasShapes.js';
import { kathrynQuickLogin } from '../../utils/api.js';
import { openLoginModal } from '../../utils/loginModal.js';

// Hidden for now per explicit direction - only the quick-login button
// ("Play Now") is shown so Kathryn has one obvious thing to press. The
// Login modal/flow itself is untouched and still fully wired (see
// loginModal.js) - flip this back to true to bring the button back,
// nothing else needs to change.
const SHOW_LOGIN_BUTTON = false;

// Short deliberately - a real cold-start on kpground-api's free-tier
// Render instance (~50s worst case per Render's own dashboard warning)
// will usually still miss this window, but waiting long enough to
// reliably survive one made "Connecting..." feel broken on every normal,
// already-warm login too. A backend outage should never be fatal to the
// front end (see the "shouldn't be fatal" note in kpground-api's own
// CLAUDE.md history): on timeout or any other failure, play proceeds
// without a token, and GameScreen retries the login in the background and
// syncs any queued round results once it succeeds.
const QUICK_LOGIN_TIMEOUT_MS = 5000;

// One full spin per this many ms - drives drawConnectingIndicator()'s
// rotation. Purely cosmetic, tuned by eye.
const SPINNER_PERIOD_MS = 900;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out.')), ms)),
  ]);
}

export default class SetupScreen {
  constructor(screenManager, canvas) {
    this.screenManager = screenManager;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.backgroundImage = new Image();
    this.backgroundImage.src = './assets/start_screen.jpg';
    // Replaces the old single startButtonArea - the background image's
    // own baked-in "Start Game" art is no longer the functional button
    // (see the two drawRoundedRect pills in render(), drawn directly over
    // that area); auth now has to happen before character select, since
    // every economy endpoint needs a logged-in user.
    this.kathrynButtonArea = null;
    this.loginButtonArea = null;
    // Set while kathrynQuickLogin()'s request is in flight, so a second
    // click can't fire a duplicate request before the first resolves.
    // Drives the "Connecting..." message in render() - there's no
    // persistent error state anymore, since a failed/timed-out login just
    // proceeds offline instead of stranding the player here (see
    // QUICK_LOGIN_TIMEOUT_MS's comment).
    this.loggingIn = false;
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

    // animateBackground()'s rAF loop calls render() every frame starting
    // immediately in init(), before backgroundImage.onload has
    // necessarily fired - backgroundImage.width/height are 0 until then,
    // which cascades into NaN image/button dimensions. drawImage()
    // silently no-ops on non-finite args (so the original single-button
    // version never visibly broke here), but createLinearGradient()
    // throws on them - drawAuthButton() surfaced this on the very first
    // frame or two of a fresh load. Just skip the image/buttons for
    // those frames; the animated gradient alone still fills the canvas.
    if (!this.backgroundImage.complete || this.backgroundImage.naturalWidth === 0) {
      return;
    }

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

    // Same overall area the old single "Start Game" hit-box used (the
    // background image's own baked-in button art lives here), drawn over
    // directly since auth has to happen before character select.
    const buttonX = imgX + imgWidth * 0.23;
    const buttonY = imgY + imgHeight * 0.42;
    const buttonWidth = imgWidth * 0.5;
    const buttonHeight = imgHeight * 0.11;

    if (SHOW_LOGIN_BUTTON) {
      // Split into two side-by-side pills.
      const buttonGap = buttonWidth * 0.06;
      const halfWidth = (buttonWidth - buttonGap) / 2;
      this.kathrynButtonArea = { x: buttonX, y: buttonY, width: halfWidth, height: buttonHeight };
      this.loginButtonArea = {
        x: buttonX + halfWidth + buttonGap,
        y: buttonY,
        width: halfWidth,
        height: buttonHeight,
      };
    } else {
      // One pill, full width - same footprint the original single
      // "Start Game" button used.
      this.kathrynButtonArea = { x: buttonX, y: buttonY, width: buttonWidth, height: buttonHeight };
      this.loginButtonArea = null;
    }

    // Gold/orange - matches manifest.json's theme-color and
    // CharacterSelectScreen's cat-gold theme.
    this.drawAuthButton(this.kathrynButtonArea, 'Play Now', ['#ffb238', '#fb8c00']);
    if (SHOW_LOGIN_BUTTON) {
      this.drawAuthButton(this.loginButtonArea, 'Login', ['#8a2be2', '#6a1fc2']);
    }

    if (this.loggingIn) {
      this.drawConnectingIndicator(
        buttonX + buttonWidth / 2,
        buttonY + buttonHeight + imgHeight * 0.05,
        Math.round(imgHeight * 0.035)
      );
    }
  }

  // Spinning arc + "Connecting..." label, drawn as one centered group (see
  // Lessons re: not guessing a fixed-fraction split for side-by-side
  // content - the spinner's own width has to be measured against the
  // text's, not assumed). animateBackground()'s rAF loop already calls
  // render() every frame regardless of loggingIn, so this repaints on its
  // own with no separate timer - the rotation angle is just derived from
  // the current clock time via SPINNER_PERIOD_MS.
  drawConnectingIndicator(centerX, centerY, fontSize) {
    const text = 'Connecting...';

    this.ctx.save();
    this.ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    const textWidth = this.ctx.measureText(text).width;

    const spinnerRadius = fontSize * 0.4;
    const gap = fontSize * 0.35;
    const groupWidth = spinnerRadius * 2 + gap + textWidth;
    const spinnerCenterX = centerX - groupWidth / 2 + spinnerRadius;

    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    this.ctx.shadowBlur = 4;

    const angle = ((performance.now() % SPINNER_PERIOD_MS) / SPINNER_PERIOD_MS) * Math.PI * 2;
    this.ctx.beginPath();
    this.ctx.arc(spinnerCenterX, centerY, spinnerRadius, angle, angle + Math.PI * 1.5);
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = Math.max(2, fontSize * 0.14);
    this.ctx.lineCap = 'round';
    this.ctx.stroke();

    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillText(text, spinnerCenterX + spinnerRadius + gap, centerY);
    this.ctx.restore();
  }

  // Pill-shaped gradient button with white, drop-shadowed text - same
  // "white text over a saturated gradient" convention CharacterSelectScreen
  // uses for its own cards, for the same reason: legible across the whole
  // gradient's range without needing per-button contrast tuning.
  drawAuthButton(area, label, [colorFrom, colorTo]) {
    const radius = area.height / 2;
    const gradient = this.ctx.createLinearGradient(area.x, area.y, area.x, area.y + area.height);
    gradient.addColorStop(0, colorFrom);
    gradient.addColorStop(1, colorTo);

    this.ctx.save();
    drawRoundedRect(this.ctx, area.x, area.y, area.width, area.height, radius);
    this.ctx.fillStyle = gradient;
    this.ctx.fill();

    this.ctx.font = `bold ${Math.round(area.height * 0.42)}px Arial, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    this.ctx.shadowBlur = 4;
    this.ctx.shadowOffsetY = 2;
    this.ctx.fillText(label, area.x + area.width / 2, area.y + area.height / 2 + 1);
    this.ctx.restore();
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

  isInsideArea(area, x, y) {
    return area && x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
  }

  // Requesting fullscreen has to happen synchronously inside the click
  // handler (a user-gesture requirement) - deliberately not deferred
  // until after the async login call resolves, since that could lose the
  // gesture in some browsers. Login succeeding or failing doesn't change
  // whether fullscreen was worth requesting.
  requestFullscreenIfTouch() {
    if (isTouch() && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  // Shared by both auth paths once a token actually exists - stops the
  // animation loop/listeners and hands off to character select, exactly
  // what the old single Start Game button did on click.
  proceedToCharacterSelect() {
    this.cleanup();
    this.screenManager.setScreen(new CharacterSelectScreen(this.screenManager, this.canvas));
  }

  addEventListeners() {
    this.startClickHandler = (event) => {
      const { offsetX, offsetY } = event;

      if (this.isInsideArea(this.kathrynButtonArea, offsetX, offsetY)) {
        if (this.loggingIn) return;
        this.requestFullscreenIfTouch();
        this.loggingIn = true;
        withTimeout(kathrynQuickLogin(), QUICK_LOGIN_TIMEOUT_MS)
          .then(() => this.proceedToCharacterSelect())
          .catch((err) => {
            // Unreachable (or too slow) shouldn't block play - every other
            // economy touchpoint already degrades to "no economy UI" when
            // logged out, this follows the same rule rather than
            // stranding the player on the title screen. See
            // QUICK_LOGIN_TIMEOUT_MS's own comment for the retry/sync story.
            console.warn('Kathryn quick-login unavailable, continuing offline:', err.message);
            this.loggingIn = false;
            this.proceedToCharacterSelect();
          });
      } else if (this.isInsideArea(this.loginButtonArea, offsetX, offsetY)) {
        this.requestFullscreenIfTouch();
        openLoginModal(() => this.proceedToCharacterSelect());
      }
    };

    // Add the event listener
    this.canvas.addEventListener('click', this.startClickHandler);

    // Named (not anonymous) so cleanup() can actually remove it.
    this.moveHandler = (event) => {
      const { offsetX, offsetY } = event;
      const overButton =
        this.isInsideArea(this.kathrynButtonArea, offsetX, offsetY) ||
        this.isInsideArea(this.loginButtonArea, offsetX, offsetY);
      this.canvas.style.cursor = overButton ? 'pointer' : 'default';
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
