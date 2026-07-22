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
