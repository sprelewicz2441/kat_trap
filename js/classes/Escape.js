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
    return (
      mouse.x < this.x + this.width &&
      mouse.x + mouse.size > this.x &&
      mouse.y < this.y + this.height &&
      mouse.y + mouse.size > this.y
    );
  }
}
