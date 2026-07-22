export default class InputHandler {
  constructor() {
    this.keys = {};

    this.handleKeyDown = (e) => {
      this.keys[e.key] = true;

      if (e.key === ' ') {
        document.dispatchEvent(new Event('toot'));
      }

      if (e.key === 'p' || e.key === 'P') {
        document.dispatchEvent(new Event('punch'));
      }

      if (e.key === 'm' || e.key === 'M') {
        document.dispatchEvent(new Event('meow'));
      }
    };

    this.handleKeyUp = (e) => (this.keys[e.key] = false);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  getDirection() {
    if (this.keys['ArrowUp']) return 'up';
    if (this.keys['ArrowDown']) return 'down';
    if (this.keys['ArrowLeft']) return 'left';
    if (this.keys['ArrowRight']) return 'right';
    return null;
  }

  cleanup() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }
}
