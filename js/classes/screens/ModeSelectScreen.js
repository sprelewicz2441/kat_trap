import CharacterSelectScreen from './CharacterSelectScreen.js?v=2';
import { getUIScale } from '../../utils/scale.js?v=1';
import { drawRoundedRect } from '../../utils/canvasShapes.js';

// First screen after "Play Now": pick Classic (the original cat/mouse/dog
// chase) or Adventures (boss battles, see BossBattleScreen.js). Sized and
// styled like CharacterSelectScreen - same backdrop, same uiScale-driven
// card layout - so the two read as one flow.
const BASE_CARD_WIDTH = 330;
const BASE_CARD_HEIGHT = 250;
const BASE_CARD_GAP = 40;
const BASE_CARD_RADIUS = 26;
const BASE_TITLE_FONT_SIZE = 42;
const BASE_NAME_FONT_SIZE = 36;
const BASE_SUBLABEL_FONT_SIZE = 20;
const BASE_ICON_FONT_SIZE = 78;
const BASE_TITLE_GAP = 50;

const MODES = [
  { mode: 'classic', icon: '🐭', name: 'Classic', subtitle: 'Chase, escape, rescue', theme: { start: '#ffd54f', end: '#fb8c00', glow: 'rgba(251, 140, 0, 0.6)' } },
  { mode: 'adventure', icon: '⚔️', name: 'Adventures', subtitle: 'Boss battle!', theme: { start: '#ff7a7a', end: '#a3123a', glow: 'rgba(200, 30, 60, 0.6)' } },
];

export default class ModeSelectScreen {
  constructor(screenManager, canvas) {
    this.screenManager = screenManager;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.buttonAreas = [];
    this.hoveredIndex = -1;
    this.pressedIndex = -1;
  }

  init() {
    this.render();
    this.addEventListeners();
  }

  render() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const uiScale = getUIScale(width);

    // Same fit-to-canvas clamp CharacterSelectScreen uses, for the same reason.
    const availableWidth = width - 40 * uiScale;
    const naiveTotalWidth = (BASE_CARD_WIDTH * MODES.length + BASE_CARD_GAP * (MODES.length - 1)) * uiScale;
    const fitScale = naiveTotalWidth > availableWidth ? availableWidth / naiveTotalWidth : 1;
    const s = uiScale * fitScale;

    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#2fa8b8');
    bg.addColorStop(1, '#ffb238');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const cardWidth = BASE_CARD_WIDTH * s;
    const cardHeight = BASE_CARD_HEIGHT * s;
    const gap = BASE_CARD_GAP * s;
    const totalWidth = cardWidth * MODES.length + gap * (MODES.length - 1);
    let x = width / 2 - totalWidth / 2;
    const y = height / 2 - cardHeight / 2 + 20 * s;

    ctx.textAlign = 'center';
    ctx.font = `900 ${BASE_TITLE_FONT_SIZE * s}px Impact, 'Arial Black', sans-serif`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 8 * s;
    ctx.shadowOffsetY = 2 * s;
    ctx.lineWidth = Math.max(2, 4 * s);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    const titleY = y - BASE_TITLE_GAP * s;
    ctx.strokeText('Choose Your Game', width / 2, titleY);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Choose Your Game', width / 2, titleY);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    this.buttonAreas = MODES.map((option, index) => {
      // Hit box stays at the resting position; only the drawing lifts.
      const area = { x, y, width: cardWidth, height: cardHeight, option, index };
      x += cardWidth + gap;

      const isHovered = index === this.hoveredIndex;
      const isPressed = index === this.pressedIndex;
      const drawY = area.y + (isPressed ? 2 * s : isHovered ? -4 * s : 0);
      const { theme } = option;

      ctx.save();
      const grad = ctx.createLinearGradient(area.x, drawY, area.x, drawY + cardHeight);
      grad.addColorStop(0, theme.start);
      grad.addColorStop(1, theme.end);
      drawRoundedRect(ctx, area.x, drawY, cardWidth, cardHeight, BASE_CARD_RADIUS * s);
      ctx.fillStyle = grad;
      ctx.shadowColor = isHovered ? theme.glow : 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = (isHovered ? 22 : 12) * s;
      ctx.shadowOffsetY = (isPressed ? 2 : 6) * s;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineWidth = Math.max(1, 2 * s);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.stroke();

      const cx = area.x + cardWidth / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${BASE_ICON_FONT_SIZE * s}px Arial, sans-serif`;
      ctx.fillText(option.icon, cx, drawY + cardHeight * 0.3);

      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 5 * s;
      ctx.shadowOffsetY = 1 * s;
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${BASE_NAME_FONT_SIZE * s}px Arial`;
      ctx.fillText(option.name, cx, drawY + cardHeight * 0.64);
      ctx.font = `bold ${BASE_SUBLABEL_FONT_SIZE * s}px Arial`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fillText(option.subtitle, cx, drawY + cardHeight * 0.83);
      ctx.restore();

      return area;
    });
  }

  findHit(offsetX, offsetY) {
    return this.buttonAreas.find((a) =>
      offsetX >= a.x && offsetX <= a.x + a.width && offsetY >= a.y && offsetY <= a.y + a.height
    );
  }

  addEventListeners() {
    this.clickHandler = (event) => {
      const hit = this.findHit(event.offsetX, event.offsetY);
      if (!hit) return;
      this.canvas.style.cursor = 'default';
      this.screenManager.setScreen(
        new CharacterSelectScreen(this.screenManager, this.canvas, false, hit.option.mode)
      );
    };
    this.canvas.addEventListener('click', this.clickHandler);

    this.moveHandler = (event) => {
      const hit = this.findHit(event.offsetX, event.offsetY);
      this.canvas.style.cursor = hit ? 'pointer' : 'default';
      const next = hit ? hit.index : -1;
      if (next !== this.hoveredIndex) {
        this.hoveredIndex = next;
        this.render();
      }
    };
    this.canvas.addEventListener('mousemove', this.moveHandler);

    this.downHandler = (event) => {
      const hit = this.findHit(event.offsetX, event.offsetY);
      if (hit) {
        this.pressedIndex = hit.index;
        this.render();
      }
    };
    this.canvas.addEventListener('mousedown', this.downHandler);

    this.upHandler = () => {
      if (this.pressedIndex !== -1) {
        this.pressedIndex = -1;
        this.render();
      }
    };
    this.canvas.addEventListener('mouseup', this.upHandler);

    this.leaveHandler = () => {
      this.hoveredIndex = -1;
      this.pressedIndex = -1;
      this.canvas.style.cursor = 'default';
      this.render();
    };
    this.canvas.addEventListener('mouseleave', this.leaveHandler);
  }

  cleanup() {
    this.canvas.removeEventListener('click', this.clickHandler);
    this.canvas.removeEventListener('mousemove', this.moveHandler);
    this.canvas.removeEventListener('mousedown', this.downHandler);
    this.canvas.removeEventListener('mouseup', this.upHandler);
    this.canvas.removeEventListener('mouseleave', this.leaveHandler);
  }
}
