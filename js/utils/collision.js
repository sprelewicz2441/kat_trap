// Axis-aligned bounding box overlap test, shared by every collision check
// in the game (Escape, Dog, Furniture, GameScreen). Each side is passed as
// its own x/y/width/height so callers stay in control of which box (size vs
// width/height, frameWidth/frameHeight, etc.) each entity contributes.
export function aabbOverlap(ax, ay, aWidth, aHeight, bx, by, bWidth, bHeight) {
  return (
    ax < bx + bWidth &&
    ax + aWidth > bx &&
    ay < by + bHeight &&
    ay + aHeight > by
  );
}

// How much smaller than a character's full display box the "catch" hitbox
// used for win/lose collision checks should be, centered on the sprite.
// Every character's alpha content already fills ~80-90% of its own sprite
// frame (measured directly off cat_v2.png/dog_v2.png's alpha channel), so
// that's mostly real content, not transparent padding — but it's dominated
// by thin protrusions (ear tips, whisker tips, a tail) well outside the
// character's actual solid head/body. A full-frame AABB overlaps as soon as
// those thin tips touch, which read live as "you can catch other characters
// from pretty far away" even after an earlier pass already swapped the
// oversized `size` field for the tighter `displayWidth`/`displayHeight` (see
// GameScreen.checkCollision()'s own history). 0.6 trims the outer ~20% off
// each side — enough to land just inside those protrusions without cutting
// into the solid core, confirmed against the measured content bboxes above.
// Shared by checkCollision() (cat catches mouse) and Dog.isColliding() (dog
// pauses cat) — the two "catches from far away" complaints — deliberately
// NOT used for furniture collision, wall clamps, or the AI's line-of-sight
// lane, none of which had that complaint.
export const CATCH_HITBOX_SCALE = 0.6;

export function insetBox(x, y, width, height, scale = CATCH_HITBOX_SCALE) {
  const w = width * scale;
  const h = height * scale;
  return { x: x + (width - w) / 2, y: y + (height - h) / 2, width: w, height: h };
}
