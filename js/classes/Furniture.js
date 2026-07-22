export default class Furniture {
  constructor(x, y, type, spriteSrc, rotation = 0) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.rotation = rotation; // 0, 90, 180, 270 degrees
    
    // Original sprite size 12x24, scale 3x
    this.spriteWidth = 12;
    this.spriteHeight = 24;
    this.scale = 3;
    
    // Actual dimensions depend on rotation
    if (rotation === 90 || rotation === 270) {
      this.width = this.spriteHeight * this.scale;
      this.height = this.spriteWidth * this.scale;
    } else {
      this.width = this.spriteWidth * this.scale;
      this.height = this.spriteHeight * this.scale;
    }
    
    // Load sprite
    this.sprite = new Image();
    this.sprite.src = spriteSrc;
    
    // Placement type
    this.isWallItem = ['fridge', 'stove', 'sink', 'counter'].includes(type);
  }

  draw(ctx) {
    ctx.save();

    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;

    // Apply rotation
    if (this.rotation !== 0) {
      ctx.translate(centerX, centerY);
      ctx.rotate((this.rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
    }

    // Draw the sprite at its native (unrotated) size, centered on the same
    // pivot the rotation transform uses, so the rendered sprite lines up
    // with the rotated collision box (this.width/this.height).
    const drawWidth = this.spriteWidth * this.scale;
    const drawHeight = this.spriteHeight * this.scale;
    const drawX = centerX - drawWidth / 2;
    const drawY = centerY - drawHeight / 2;

    // Draw sprite if loaded, otherwise draw placeholder
    if (this.sprite.complete) {
      ctx.drawImage(
        this.sprite,
        drawX, drawY,
        drawWidth, drawHeight
      );
    } else {
      // Placeholder while loading
      ctx.fillStyle = this.getPlaceholderColor();
      ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
      ctx.strokeStyle = 'black';
      ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);
    }

    ctx.restore();
  }

  getPlaceholderColor() {
    const colors = {
      fridge: '#E0E0E0',
      stove: '#505050',
      sink: '#87CEEB',
      table: '#8B4513',
      island: '#D2691E',
      counter: '#A0A0A0'
    };
    return colors[this.type] || '#CCCCCC';
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