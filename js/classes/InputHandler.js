export default class InputHandler {
  constructor() {
    this.keys = {};

    window.addEventListener('keydown', (e) => {
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
    });

    window.addEventListener('keyup', (e) => (this.keys[e.key] = false));
  }

  getDirection() {
    if (this.keys['ArrowUp']) return 'up';
    if (this.keys['ArrowDown']) return 'down';
    if (this.keys['ArrowLeft']) return 'left';
    if (this.keys['ArrowRight']) return 'right';
    return null;
  }
}
