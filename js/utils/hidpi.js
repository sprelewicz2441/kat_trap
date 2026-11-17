// High-DPI ("Retina") rendering for the main game canvas.
//
// Every screen in this game reads canvas.width/height as its LOGICAL size (CSS
// px) - layout, scale.js, hit-testing against event.offsetX/Y - so the backing
// store used to be exactly CSS size, and on a 2x/3x display the browser
// upscaled the whole board, softening all art and text.
//
// Rather than touching every reader, enableHiDPI() shadows the canvas
// instance's own width/height properties: reads still return the logical size,
// writes size the real backing store at logical x devicePixelRatio, pin the
// CSS size to the logical size, and pre-scale the 2D context so everything
// keeps drawing in logical units. Setting the backing size resets context
// state, so the scale is re-applied on every write (resizeCanvas() is the only
// writer). Nothing in the game calls setTransform()/resetTransform() on the
// main context - if something ever does, it must re-apply getPixelRatio().
//
// Ratio is capped at MAX_PIXEL_RATIO: a 3x phone would otherwise push 9x the
// pixels per frame for little visible gain.

const MAX_PIXEL_RATIO = 2;
let currentRatio = 1;

export function getPixelRatio() {
  return currentRatio;
}

export function enableHiDPI(canvas) {
  const proto = HTMLCanvasElement.prototype;
  const wDesc = Object.getOwnPropertyDescriptor(proto, 'width');
  const hDesc = Object.getOwnPropertyDescriptor(proto, 'height');
  const ctx = canvas.getContext('2d');
  let logicalW = wDesc.get.call(canvas);
  let logicalH = hDesc.get.call(canvas);

  const apply = () => {
    currentRatio = Math.min(MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1));
    wDesc.set.call(canvas, Math.round(logicalW * currentRatio));
    hDesc.set.call(canvas, Math.round(logicalH * currentRatio));
    canvas.style.width = `${logicalW}px`;
    canvas.style.height = `${logicalH}px`;
    ctx.setTransform(currentRatio, 0, 0, currentRatio, 0, 0);
  };

  // Math.floor mirrors the old behavior: assigning a fractional value to a
  // canvas's width attribute truncated it, and callers read that int back.
  Object.defineProperty(canvas, 'width', {
    configurable: true,
    get: () => logicalW,
    set: (v) => {
      logicalW = Math.max(0, Math.floor(v));
      apply();
    },
  });
  Object.defineProperty(canvas, 'height', {
    configurable: true,
    get: () => logicalH,
    set: (v) => {
      logicalH = Math.max(0, Math.floor(v));
      apply();
    },
  });
  apply();
}
