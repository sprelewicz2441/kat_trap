export default class CutsceneManager {
  constructor(screenManager, canvas, ctx) {
    this.screenManager = screenManager;
    this.canvas = canvas;
    this.ctx = ctx;
    this.cutscenes = []; // Queue of cutscenes
    this.currentIndex = 0; // Track the current cutscene index
    this.isPlaying = false;
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
    const animate = () => {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      cutscene.render();

      if (this.isPlaying) {
        requestAnimationFrame(animate);
      }
    };

    this.isPlaying = true;
    animate();
  }

  endCutscenes() {
    this.isPlaying = false;
    if (this.endCallback) this.endCallback();
  }
}
