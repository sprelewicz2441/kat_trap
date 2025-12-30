export default class ScreenManager {
  constructor(ctx) {
    this.ctx = ctx; 
    this.currentScreen = null;
  }

  setScreen(screen) {
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
