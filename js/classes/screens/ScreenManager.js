export default class ScreenManager {
  constructor(ctx) {
    this.ctx = ctx; 
    this.currentScreen = null;
  }

  setScreen(screen) {
    // Tear down the outgoing screen's own listeners/loops (if it has a
    // cleanup()) before swapping — screens have historically only cleaned
    // up manually right before calling setScreen(), which is easy to miss
    // (see SetupScreen's rAF loop / mousemove listener, which previously
    // had no way to be cancelled at all).
    if (this.currentScreen && typeof this.currentScreen.cleanup === 'function') {
      this.currentScreen.cleanup();
    }
    this.currentScreen = screen;
    this.currentScreen.init();
  }

  update(timestamp) {
    if (this.currentScreen && this.currentScreen.update) {
      this.currentScreen.update(timestamp);
    }
  }

  render() {
    if (this.currentScreen && this.currentScreen.render) {
      this.currentScreen.render(this.ctx); // Pass `ctx` to the current screen
    }
  }
}
