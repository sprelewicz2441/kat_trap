export default class Boundary {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  draw(ctx) {
    ctx.fillStyle = 'red';
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }

  isColliding(entity) {
    return (
      entity.x < this.x + this.width &&
      entity.x + entity.size > this.x &&
      entity.y < this.y + this.height &&
      entity.y + entity.size > this.y
    );
  }
}
