import { drawRoundedRect } from './canvasShapes.js';
import { drawTooltip } from './tooltip.js?v=1';
import { isTouch } from './scale.js?v=1';

// A single, self-contained "coin medallion on a backing panel" button -
// pulled out of GameScreen's own drawStoreButton() (which had grown into a
// ~170-line method mixing panel geometry, coin rendering, hover animation,
// tooltip wiring, and click hit-testing all inline) so the same mechanics
// can be reused for any future sibling in the board's bottom-center action
// row without copy-pasting that method. Deep Plum panel + gold coin is a
// fixed look for now (this is the first and only instance) rather than a
// speculative theming API - a second button that needs a different look is
// a real follow-up, not something to guess a config shape for today.
//
// Owns its own geometry and hover state so a caller only needs three calls
// per frame: layout() before drawing (recomputes the hit box for the
// current canvas size), draw(ctx), and containsPoint()/updateHover() for
// input handling - the same "one shared position, multiple consumers"
// pattern this codebase already uses elsewhere (e.g. Cutscene's own
// getButtonRect()) so the drawn button and its hit box can never drift.
//
// Hover tracking (and therefore the tooltip + wiggle animation) is gated
// behind !isTouch() internally, not left to the caller to remember - a
// touch tap fires one synthetic mousemove as part of the browser's click-
// compatibility shim, which would otherwise latch the hover state on
// permanently (no further mousemove ever follows on a touchscreen). See
// updateHover() below.
const PANEL_FILL = 'rgba(58, 24, 74, 0.78)';
const PANEL_STROKE = 'rgba(255, 255, 255, 0.22)';
const COIN_GRADIENT_STOPS = [
  [0, '#fff3b0'],
  [0.55, '#f0b429'],
  [1, '#9c6510'],
];
const COIN_STROKE = 'rgba(40, 30, 10, 0.35)';
const MILLED_EDGE_STROKE = 'rgba(255, 255, 255, 0.45)';
const BEZEL_STROKE = 'rgba(255, 255, 255, 0.55)';
const LABEL_COLOR = '#ffffff';

// Hard ceiling on how much of the board width this button (panel + label)
// is ever allowed to occupy, independent of device/canvas size or how long
// the label text is - the real fix for "the panel grows to fit whatever
// text it's given" quietly becoming enormous on a narrow canvas. If the
// label doesn't fit within this cap at the requested font size, the font
// shrinks to fit rather than the panel growing past it.
const MAX_PANEL_WIDTH_FRACTION = 0.5;

export default class CoinBadgeButton {
  constructor({ icon, label, tooltipDescription }) {
    this.icon = icon;
    this.label = label;
    this.tooltipDescription = tooltipDescription;
    this.hovered = false;
    this.area = null; // last-computed hit box; null until layout() has run once
    this._geometry = null; // internal draw-time geometry, derived in layout()
  }

  // Recomputes this frame's geometry from the live canvas size and the
  // caller's sizing knobs - called once per frame before draw(), so
  // draw()/containsPoint() always agree with each other and with the
  // physical size the caller intended this frame.
  //   canvasWidth/canvasHeight - the live canvas size.
  //   edgeMargin - clearance from the bottom edge (wall thickness + gap),
  //     matching however the caller wants this row positioned.
  //   size - coin diameter.
  //   iconFontSize/labelFontSize - base font sizes before any shrink-to-fit.
  layout({ canvasWidth, canvasHeight, edgeMargin, size, iconFontSize, labelFontSize }) {
    const radius = size / 2;
    const centerX = canvasWidth / 2;

    const panelPaddingX = size * 0.35;
    const panelPaddingTop = size * 0.18;
    const panelPaddingBottom = size * 0.16;
    const labelGap = labelFontSize * 0.5;

    // Shrink-to-fit: measure the label at its requested size, and only if
    // that (plus the coin's own minimum width) would blow past the hard
    // cap does the font size actually shrink - the common case (a short
    // label, a normal-sized canvas) never pays for this at all.
    const measureCtx = CoinBadgeButton._measureCtx;
    const maxPanelWidth = canvasWidth * MAX_PANEL_WIDTH_FRACTION;
    const minPanelWidth = size + panelPaddingX * 2;
    let effectiveLabelFontSize = labelFontSize;
    measureCtx.font = `bold ${Math.round(effectiveLabelFontSize)}px Arial, sans-serif`;
    let labelTextWidth = measureCtx.measureText(this.label).width;
    const desiredPanelWidth = Math.max(minPanelWidth, labelTextWidth + panelPaddingX * 2);
    if (desiredPanelWidth > maxPanelWidth && maxPanelWidth > minPanelWidth) {
      const allowedTextWidth = maxPanelWidth - panelPaddingX * 2;
      effectiveLabelFontSize *= allowedTextWidth / labelTextWidth;
      measureCtx.font = `bold ${Math.round(effectiveLabelFontSize)}px Arial, sans-serif`;
      labelTextWidth = measureCtx.measureText(this.label).width;
    }

    const labelHeight = effectiveLabelFontSize * 1.4;
    const panelWidth = Math.min(
      Math.max(minPanelWidth, labelTextWidth + panelPaddingX * 2),
      Math.max(maxPanelWidth, minPanelWidth)
    );
    const panelHeight = panelPaddingTop + size + labelGap + labelHeight + panelPaddingBottom;
    const panelX = centerX - panelWidth / 2;
    const panelBottomY = canvasHeight - edgeMargin;
    const panelTopY = panelBottomY - panelHeight;
    const panelRadius = Math.min(panelWidth, panelHeight) * 0.28;
    const centerY = panelTopY + panelPaddingTop + radius;

    this._geometry = {
      radius,
      centerX,
      centerY,
      panelX,
      panelTopY,
      panelBottomY,
      panelWidth,
      panelHeight,
      panelRadius,
      panelPaddingBottom,
      labelHeight,
      iconFontSize,
      labelFontSize: effectiveLabelFontSize,
    };

    this.area = {
      x: panelX,
      y: panelTopY,
      width: panelWidth,
      height: panelHeight,
      centerX,
      label: this.label,
      description: this.tooltipDescription,
    };
    return this.area;
  }

  containsPoint(x, y) {
    if (!this.area) return false;
    return (
      x >= this.area.x &&
      x <= this.area.x + this.area.width &&
      y >= this.area.y &&
      y <= this.area.y + this.area.height
    );
  }

  // Only ever tracks hover on a real pointer device - see the class-level
  // comment above for why touch must never set this.
  updateHover(x, y) {
    this.hovered = !isTouch() && this.containsPoint(x, y);
  }

  draw(ctx) {
    if (!this._geometry) return;
    const {
      radius,
      centerX,
      centerY,
      panelX,
      panelTopY,
      panelBottomY,
      panelWidth,
      panelHeight,
      panelRadius,
      panelPaddingBottom,
      labelHeight,
      iconFontSize,
      labelFontSize,
    } = this._geometry;

    ctx.save();
    drawRoundedRect(ctx, panelX, panelTopY, panelWidth, panelHeight, panelRadius);
    ctx.fillStyle = PANEL_FILL;
    ctx.fill();
    ctx.strokeStyle = PANEL_STROKE;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    if (this.hovered) {
      // A quick wiggle-and-pop rather than a continuous idle animation -
      // only runs while actually hovered, so it reads as a response to
      // attention rather than motion for its own sake.
      const wiggleAngle = Math.sin(performance.now() / 150) * (Math.PI / 24);
      ctx.translate(centerX, centerY);
      ctx.rotate(wiggleAngle);
      ctx.scale(1.08, 1.08);
      ctx.translate(-centerX, -centerY);
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    const gradient = ctx.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
    COIN_GRADIENT_STOPS.forEach(([stop, color]) => gradient.addColorStop(stop, color));
    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = COIN_STROKE;
    ctx.lineWidth = Math.max(1.5, radius * 0.05);
    ctx.stroke();

    // Milled coin edge - a ring of short radial ticks just inside the rim,
    // one continuous path/stroke rather than a per-tick draw call.
    const tickCount = 28;
    ctx.beginPath();
    for (let i = 0; i < tickCount; i++) {
      const angle = (i / tickCount) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(centerX + cos * radius * 0.88, centerY + sin * radius * 0.88);
      ctx.lineTo(centerX + cos * radius * 0.97, centerY + sin * radius * 0.97);
    }
    ctx.strokeStyle = MILLED_EDGE_STROKE;
    ctx.lineWidth = Math.max(1, radius * 0.036);
    ctx.stroke();

    // Embossed inner bezel ring - the "coin face" boundary the icon sits
    // inside of.
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.78, 0, Math.PI * 2);
    ctx.strokeStyle = BEZEL_STROKE;
    ctx.lineWidth = Math.max(1, radius * 0.04);
    ctx.stroke();

    ctx.font = `${Math.round(iconFontSize)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.icon, centerX, centerY + 1);
    ctx.restore();

    // Caption sits directly on the panel - the panel already supplies the
    // contrast a floating label would otherwise need on its own.
    ctx.save();
    ctx.font = `bold ${Math.round(labelFontSize)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(this.label, centerX, panelBottomY - panelPaddingBottom - labelHeight / 2);
    ctx.restore();

    if (this.hovered && this.area) {
      drawTooltip(ctx, this.area, { placement: 'above', canvasWidth: ctx.canvas.width });
    }
  }
}

// A detached, never-rendered canvas used purely for measureText() calls
// during layout() - creating a fresh <canvas> per layout() call (or reusing
// the real one mid-frame, which would stomp whatever font the caller had
// already set) would both work but this avoids either concern.
CoinBadgeButton._measureCtx = document.createElement('canvas').getContext('2d');
