import { aabbOverlap } from '../utils/collision.js';

export default class Escape {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width; // Small escape size
    this.height = height;
    this.color = 'black'; // Represent mouse hole
  }

  draw(ctx) {
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }

  isMouseInside(mouse) {
    return aabbOverlap(
      mouse.x, mouse.y, mouse.size, mouse.size,
      this.x, this.y, this.width, this.height
    );
  }
}
