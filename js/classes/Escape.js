import { aabbOverlap } from '../utils/collision.js';

// Maps which wall an escape sits on to a rotation, so the arch's opening
// (flat edge) always faces into the room instead of always facing "down"
// regardless of wall. The base shape (rotation 0) is a dome on top with a
// flat bottom edge, i.e. its opening faces down — correct as-is for the top
// wall; the others rotate that same shape to match.
const WALL_ROTATIONS = { top: 0, bottom: 180, left: 270, right: 90 };

export default class Escape {
  constructor(x, y, width, height, wall = 'top') {
    this.x = x;
    this.y = y;
    this.width = width; // Small escape size
    this.height = height;
    this.wall = wall;
  }

  // Drawn as a small rounded-arch cutout — the classic cartoon mouse-hole
  // silhouette — rather than a flat square, so it reads as a hole in the
  // wall band (see GameScreen.drawWalls()) instead of a floating dark tile.
  draw(ctx) {
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;
    const archRadius = Math.min(this.width / 2, this.height);
    const topY = this.y;
    const bottomY = this.y + this.height;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(((WALL_ROTATIONS[this.wall] || 0) * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);

    ctx.beginPath();
    ctx.moveTo(this.x, bottomY);
    ctx.lineTo(this.x, topY + archRadius);
    ctx.arc(centerX, topY + archRadius, archRadius, Math.PI, Math.PI * 2);
    ctx.lineTo(this.x + this.width, bottomY);
    ctx.closePath();

    const gradient = ctx.createRadialGradient(
      centerX, topY + archRadius, archRadius * 0.15,
      centerX, topY + archRadius, archRadius * 1.4
    );
    gradient.addColorStop(0, '#000000');
    gradient.addColorStop(1, '#2b1d12');
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.stroke();
    ctx.restore();
  }

  isMouseInside(mouse) {
    return aabbOverlap(
      mouse.x, mouse.y, mouse.size, mouse.size,
      this.x, this.y, this.width, this.height
    );
  }
}
