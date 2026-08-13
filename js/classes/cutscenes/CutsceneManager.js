export default class CutsceneManager {
  constructor(screenManager, canvas, ctx) {
    this.screenManager = screenManager;
    this.canvas = canvas;
    this.ctx = ctx;
    this.cutscenes = []; // Queue of cutscenes
    this.currentIndex = 0; // Track the current cutscene index
    this.isPlaying = false;
    // rAF handle for whichever playCutscene() loop is currently active —
    // see playCutscene()'s own comment for why this needs to be tracked
    // and cancelled explicitly rather than just left to stop on its own.
    this.animationFrameId = null;
  }

  addCutscene(cutscene) {
    this.cutscenes.push(cutscene);
  }

  start(callback) {
    this.currentIndex = 0; // Reset to first cutscene
    this.endCallback = callback; // What to do after all cutscenes
    this.playNextCutscene();
  }

  playNextCutscene() {
    if (this.currentIndex >= this.cutscenes.length) {
      this.endCutscenes();
      return;
    }

    const currentCutscene = this.cutscenes[this.currentIndex];
    currentCutscene.init(() => this.advanceToNextCutscene());
    this.playCutscene(currentCutscene);
  }

  advanceToNextCutscene() {
    this.currentIndex++;
    this.playNextCutscene();
  }

  playCutscene(cutscene) {
    // Each cutscene used to start its own self-scheduling requestAnimationFrame
    // loop without ever stopping the *previous* cutscene's own loop — every
    // loop just kept checking the same shared this.isPlaying flag, which
    // only ever goes false once ALL cutscenes finish (see endCutscenes()),
    // not when advancing between them. That meant by the Nth cutscene, N
    // separate loops were all clearing+redrawing the canvas every single
    // frame, each drawing a *different* cutscene's card/character, in
    // whatever order the browser happened to fire their independent rAF
    // callbacks — confirmed live via an instrumented clearRect count (~3
    // clears per frame on the 3rd/dog cutscene, not 1). Invisible at the
    // old, much smaller cutscene-character size (the overlapping draws
    // mostly agreed on the shared card/background, and a tiny sprite
    // doubling was easy to miss) but reported live as the mouse "bugging
    // out" and the dog's ears looking cropped/misaligned once cutscene
    // characters got much bigger (see Cutscene.js). Cancelling the
    // previous loop's already-scheduled frame before starting a new one
    // guarantees exactly one loop is ever active.
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const animate = () => {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      cutscene.render();

      if (this.isPlaying) {
        this.animationFrameId = requestAnimationFrame(animate);
      }
    };

    this.isPlaying = true;
    animate();
  }

  endCutscenes() {
    this.isPlaying = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.endCallback) this.endCallback();
  }
}
