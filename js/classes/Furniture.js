import { aabbOverlap } from '../utils/collision.js';

export default class Furniture {
  constructor(x, y, type, spriteSrc, rotation = 0) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.rotation = rotation; // 0, 90, 180, 270 degrees
    
    // Sprite native size 32x64 (Reakain "Kitchen Assets" pack), scaled to
    // keep the same 36x72 in-game footprint the old 12x24@3x sprites had.
    this.spriteWidth = 32;
    this.spriteHeight = 64;
    this.scale = 1.125;
    
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
    return aabbOverlap(
      entity.x, entity.y, entity.size, entity.size,
      this.x, this.y, this.width, this.height
    );
  }
}