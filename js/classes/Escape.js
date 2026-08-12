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

  // Loose "any overlap" test — used to exempt the cat/dog's wall clamp near
  // the gap this escape leaves in the wall, and (via the mouse) as the old
  // basis for the actual escape trigger. Deliberately loose there: the
  // cat/dog just need to not be blocked by the wall while passing near the
  // gap, not to have "entered" anything.
  isMouseInside(mouse) {
    return aabbOverlap(
      mouse.x, mouse.y, mouse.size, mouse.size,
      this.x, this.y, this.width, this.height
    );
  }

  // Stricter than isMouseInside() above — the actual "the mouse escaped"
  // trigger (see GameScreen.checkMouseEscaped()) requires the hole to be
  // fully covered by the mouse's own box, not just any edge-touching
  // overlap, per explicit direction ("the mouse can escape by just being
  // near a mouse hole... the mouse has to actually enter it").
  //
  // A first version of this required the *mouse's* center to fall inside
  // the hole instead — confirmed live ("the mouse can never enter the
  // mouse hole") and by direct measurement to be genuinely impossible, not
  // just strict: the hole's depth (~12px, matching the wall band's own
  // thickness) is shallower than the mouse's own half-width (~25px), and
  // the mouse can never get closer to the wall than flush against it
  // (position clamped to >= 0), so its center could never get within the
  // hole's depth even at the mathematically best possible position.
  // Containing the (small) hole within the (bigger) mouse instead — rather
  // than the mouse's center within the (smaller) hole — is the version of
  // "actually reached it" that's geometrically achievable: the mouse just
  // needs to be positioned over the hole while flush against that wall,
  // not to fit some part of itself into a gap far narrower than its own
  // sprite.
  // `margin` (see GameScreen.js's BASE_ESCAPE_HITBOX_MARGIN) expands the
  // mouse's own box for this check only — not the visual hole, and not
  // isMouseInside() above. Reported live as still too tight with margin=0:
  // the containment direction here means a *bigger* hole would actually
  // narrow this window (harder for a fixed-size mouse to fully cover a
  // bigger hole), so easing the hit-test couldn't be done by resizing the
  // hole itself — a separate, explicit tolerance was the fix.
  hasMouseEntered(mouse, margin = 0) {
    return (
      mouse.x - margin <= this.x && mouse.x + mouse.size + margin >= this.x + this.width &&
      mouse.y - margin <= this.y && mouse.y + mouse.size + margin >= this.y + this.height
    );
  }
}
