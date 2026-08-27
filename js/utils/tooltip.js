import { drawRoundedRect } from './canvasShapes.js';

// Greedy word-wrap: packs words onto a line until the next one would
// exceed maxWidth, then starts a new line - assumes ctx.font is already
// set to the font the wrapped text will actually be drawn in, since
// measureText() depends on it.
export function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  });
  if (currentLine) lines.push(currentLine);
  return lines;
}

// Small popover explaining whatever's hovered - a bold label line plus a
// word-wrapped description, a dark rounded-box chrome. Pure/stateless and
// decoupled from any particular screen class (no `this`, no layout object)
// so any hoverable canvas element - a HUD stat chip, the store button, a
// future one - can share this one implementation instead of each hand-
// rolling its own popover.
//
// `area` is the hovered element's own hit rect plus the two text fields:
// { x, y, width, height, centerX, label, description }. `options` controls
// appearance/placement:
//   - placement: 'below' (default, room underneath - HUD stat chips) or
//     'above' (for anything living near the bottom of its canvas, where
//     'below' would run the tooltip off the edge).
//   - fontSize/padding: base sizes: the description renders at 0.82x
//     fontSize.
//   - maxWidth: wrap threshold for the description, itself clamped against
//     canvasWidth * 0.7 so a long description can't overflow a narrow
//     canvas regardless of what maxWidth the caller passed.
//   - canvasWidth/canvasHeight: used only for that clamp and for keeping
//     the box on-screen horizontally - this module never touches the
//     canvas element itself.
export function drawTooltip(ctx, area, options = {}) {
  const {
    placement = 'below',
    fontSize = 21,
    padding = 14,
    maxWidth = 260,
    canvasWidth = Infinity,
  } = options;

  const titleFontSize = fontSize;
  const descFontSize = fontSize * 0.82;
  const effectiveMaxWidth = Math.min(maxWidth, canvasWidth * 0.7);

  ctx.save();
  ctx.font = `bold ${Math.round(titleFontSize)}px Arial, sans-serif`;
  const titleWidth = ctx.measureText(area.label).width;

  ctx.font = `${Math.round(descFontSize)}px Arial, sans-serif`;
  const descLines = wrapText(ctx, area.description, effectiveMaxWidth);
  const descWidth = Math.max(...descLines.map((line) => ctx.measureText(line).width));

  const lineHeight = descFontSize * 1.25;
  const boxWidth = Math.max(titleWidth, descWidth) + padding * 2;
  const boxHeight = titleFontSize + padding * 0.5 + descLines.length * lineHeight + padding * 1.5;
  const boxY = placement === 'above' ? area.y - boxHeight - 8 : area.y + area.height + 8;
  const boxX = Math.max(8, Math.min(area.centerX - boxWidth / 2, canvasWidth - boxWidth - 8));

  drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 10);
  ctx.fillStyle = 'rgba(15, 8, 22, 0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${Math.round(titleFontSize)}px Arial, sans-serif`;
  ctx.fillStyle = '#ffd54f';
  ctx.fillText(area.label, boxX + boxWidth / 2, boxY + padding * 0.9);

  ctx.font = `${Math.round(descFontSize)}px Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  const descStartY = boxY + padding * 0.9 + titleFontSize + padding * 0.5;
  descLines.forEach((line, i) => {
    ctx.fillText(line, boxX + boxWidth / 2, descStartY + i * lineHeight);
  });
  ctx.restore();
}
