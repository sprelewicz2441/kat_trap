# KatTrap

## What this is
A browser-based canvas game built in vanilla JavaScript (ES modules, no framework, no build step). You control a cat chasing a mouse around an arena, while a dog wanders randomly and catches the cat if they collide. The mouse can escape through one of several "mouse holes." Styled with Tailwind (via CDN) on top of a single `<canvas>` element.

Open `index.html` directly in a browser (or serve the folder statically) to run it — there is currently no build/bundle step.

## Architecture

**Entry point:** `js/main.js`
- Grabs the canvas, sizes it responsively (`resizeCanvas`), creates a `ScreenManager`, and starts on `SetupScreen`.
- Runs a single `requestAnimationFrame` game loop that calls `screenManager.update()` then `.render()` each frame.

**Screens** (`js/classes/screens/`) — a simple state-machine pattern:
- `ScreenManager.js` — holds `currentScreen`, forwards `update`/`render` to whichever screen is active. Screens are swapped via `setScreen()`, which calls the new screen's `init()`.
- `SetupScreen.js` — animated title/start screen. Draws a background image over an animated gradient, defines a clickable "Start Game" hit-box (`startButtonArea`) computed as a percentage of the background image's position, and transitions to `GameScreen` on click.
- `GameScreen.js` (**~440 lines — the largest file by far, and the one most likely to need review before extending**) — owns the actual gameplay: creating the cat/mouse/dog/escapes/boundaries, the input-driven cat movement, dog-vs-cat and cat-vs-mouse collision checks, sound playback, win/lose messaging, and a "play again" button. Also kicks off cutscenes at the start via `CutsceneManager`.

**Entities** (`js/classes/`) — each is a small, mostly self-contained class with `update()`/`draw(ctx)`:
- `Cat.js` — player-controlled; `move(direction)` is called from `GameScreen` based on `InputHandler` state. Handles its own sprite-sheet animation.
- `Dog.js` — moves randomly on a timer (`moveInterval`), respects `boundaries` and `escapes` when deciding valid moves, barks on a random interval, and exposes `isColliding(entity)`.
- `Mouse.js` — moves with pseudo-random velocity, bounces off canvas walls, fires a `wallHitCallback` on bounce.
- `Escape.js` — a static rectangle ("mouse hole"); `isMouseInside()` for collision.
- `Boundary.js` — a static obstacle rectangle; `isColliding(entity)` for collision. Note: collision math duplicates the logic in `Escape.isMouseInside` and `Dog.isColliding` — same AABB check written three times.
- `InputHandler.js` — tracks currently-held keys, exposes `getDirection()`; also dispatches a custom `'toot'` event on spacebar.

**Cutscenes** (`js/classes/cutscenes/`):
- `Cutscene.js` / `CutsceneManager.js` — sequenced intro scenes shown before gameplay starts, triggered from `GameScreen.startCutscenes()`.

## Conventions actually in use
- ES modules throughout (`import`/`export default`), one class per file.
- Constants (colors, fonts, sizes, sound keys, messages) are hoisted to the top of `GameScreen.js` in `UPPER_SNAKE_CASE` objects — follow this pattern rather than inlining magic numbers/strings if you add to that file.
- Sprite sheets are single `Image` objects sliced via `drawImage` source-rect math (`frameWidth`/`frameHeight`/`currentFrame`); animation speed is throttled with a manual `frameCounter` vs `frameSpeed`, not `setInterval`.
- Collision detection is hand-rolled AABB (axis-aligned bounding box) checks — no physics library.

## Known rough edges (worth knowing before you extend this)
- **No tests at all.** Zero test coverage currently exists for any collision, movement, or game-state logic.
- **No README.**
- `GameScreen.js` mixes rendering, game state, input-response, and collision logic in one class — a good refactor candidate if it grows further.
- Leftover `console.log` debug statements in `GameScreen.js` constructor.
- AABB collision logic is duplicated across `Boundary`, `Escape`, and `Dog` instead of being shared/extracted.
- `styles.css` exists but is currently empty — all styling is Tailwind utility classes in `index.html`.

## When working in this repo
- Prefer matching the existing per-class, no-framework style — don't introduce a build tool or framework without discussing it first.
- If you touch collision code, consider whether it's worth extracting the shared AABB check rather than adding a fourth copy.
- There's no test runner configured yet — if you add tests, that's a setup decision to make explicitly (e.g. Vitest/Jest), not assume one is already there.