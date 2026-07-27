// Builds a rounded-rect path without filling/stroking it, so callers can set
// fillStyle/strokeStyle/shadow independently. Shared by GameScreen's
// game-over modal/button, CharacterSelectScreen's character cards, and
// Cutscene's modal/button — extracted here once a third caller needed the
// exact same path-builder, rather than drifting into three near-identical
// copies.
export function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}
