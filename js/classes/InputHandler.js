export default class InputHandler {
  constructor() {
    this.keys = {};

    window.addEventListener('keydown', (e) => {
      this.keys[e.key] = true;

      if (e.key === ' ') {
        document.dispatchEvent(new Event('toot'));
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
