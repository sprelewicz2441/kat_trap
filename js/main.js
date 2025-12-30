import ScreenManager from './classes/screens/ScreenManager.js';
import SetupScreen from './classes/screens/SetupScreen.js';

const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d'); 
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const screenManager = new ScreenManager(ctx);
const setupScreen = new SetupScreen(screenManager, gameCanvas, ctx);

// Start with the setup screen
screenManager.setScreen(setupScreen);

function resizeCanvas() {
  const maxCanvasWidth = Math.min(window.innerWidth * 0.9, 1280);
  const maxCanvasHeight = Math.min(window.innerHeight * 0.95, 960);
  let canvasWidth = maxCanvasWidth;
  let canvasHeight = canvasWidth * (3 / 4);
  if (canvasHeight > maxCanvasHeight) {
    canvasHeight = maxCanvasHeight;
    canvasWidth = canvasHeight * (4 / 3);
  }
  gameCanvas.width = canvasWidth;
  gameCanvas.height = canvasHeight;
}

function gameLoop(timestamp) {
  screenManager.update(timestamp);
  screenManager.render();
  requestAnimationFrame(gameLoop);
}

gameLoop();
