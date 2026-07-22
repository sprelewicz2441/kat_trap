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
- `GameScreen.js` (**~725 lines — by far the largest file, and the one most likely to need review before extending**) — owns the actual gameplay: creating the cat/mouse/dog/escapes/furniture, the input-driven cat movement, dog-vs-cat and cat-vs-mouse collision checks, the punch/toot/meow input reactions and punch shockwave animation, procedural kitchen-furniture layout, sound playback, win/lose messaging, and a "play again" button. Also kicks off cutscenes at the start via `CutsceneManager`.

**Entities** (`js/classes/`) — each is a small, mostly self-contained class with `update()`/`draw(ctx)`:
- `Cat.js` — player-controlled; `move(direction)` is called from `GameScreen` based on `InputHandler` state. Handles its own sprite-sheet animation.
- `Dog.js` — moves randomly on a timer (`moveInterval`), respects an obstacle list (currently the `furniture` array, still named `boundaries`/`this.boundaries` internally — see below) and `escapes` when deciding valid moves, barks on a random interval, and exposes `isColliding(entity)`.
- `Mouse.js` — moves with pseudo-random velocity, bounces off canvas walls, fires a `wallHitCallback` on bounce. Currently **not** blocked by furniture (see Known rough edges).
- `Escape.js` — a static rectangle ("mouse hole"); `isMouseInside()` for collision.
- `Boundary.js` — a static obstacle rectangle; `isColliding(entity)` for collision. No longer instantiated anywhere — `GameScreen`'s random-boundary generator is commented out and furniture has taken over the obstacle role. Kept around as dead code; candidate for deletion. Note: its collision math duplicates the logic in `Escape.isMouseInside`, `Dog.isColliding`, and `Furniture.isColliding` — the same AABB check written four times now.
- `Furniture.js` — kitchen obstacle (fridge, stove, sink/counter, table). Takes `(x, y, type, spriteSrc, rotation)`; rotation (0/90/180/270) swaps width/height and is applied via canvas transform in `draw()`, which draws the sprite at its native (unrotated) size centered on the same pivot the rotation uses, so the rendered sprite lines up with the rotated collision box at every rotation value. Draws a type-colored placeholder rect while the sprite loads. `isColliding(entity)` is a fifth copy of the AABB check. `isWallItem` is computed in the constructor but never read anywhere — dead property.
- `InputHandler.js` — tracks currently-held keys via `window` keydown/keyup listeners, exposes `getDirection()`; also dispatches custom `'toot'` (spacebar), `'punch'` (`p`), and `'meow'` (`m`) events for `GameScreen` to react to.

**Cutscenes** (`js/classes/cutscenes/`):
- `Cutscene.js` / `CutsceneManager.js` — sequenced intro scenes shown before gameplay starts, triggered from `GameScreen.startCutscenes()`.

## Kitchen furniture (`GameScreen.generateKitchenFurniture`)
Procedurally lays out `Furniture` instances each game reset, in three passes:
1. Up to 2 "counter groups" of 3 counters (rendered with the sink sprite — there's no separate counter sprite yet), placed flush against one of the four walls.
2. One fridge and one stove, each placed via up to 60 random attempts on a random wall.
3. Table groups of 2, placed randomly inside the playable interior, avoiding overlap with other furniture and with the cat/mouse/dog spawn points (`blocksSpawn`).

All four walls (`top`/`bottom`/`left`/`right`) are defined in the `walls` array; each entry carries a `rotation` (0/180 for top/bottom, 270/90 for left/right, so furniture faces into the room) and a `length` (the wall's own extent — `canvas.width` for top/bottom, `canvas.height` for left/right — used to compute `maxOffset` for both the counter-group and appliance passes). `FURNITURE_SPRITES` currently only wires up `FRIDGE`, `STOVE`, `SINK`, and `TABLE`; the `tabletop_left/right/top/bottom/*_corner/wallframes/wallknife` assets added alongside this feature are unused.

## Punch mechanic
- `p` → `InputHandler` dispatches a `'punch'` custom event on `document`.
- `GameScreen` listens for `'punch'` in `init()`, plays `SOUND_KEYS.PUNCH`, and calls `handlePunch()`, which knocks the dog `PUNCH_DISTANCE` (40px) away from the cat (clamped to canvas bounds) and starts a purple `shockwave` ring centered on the cat, drawn by `drawShockwave()` for `PUNCH_SHOCKWAVE_DURATION` (200ms).
- `m` → dispatches a `'meow'` event, which just plays the meow sound (no gameplay effect).

## Conventions actually in use
- ES modules throughout (`import`/`export default`), one class per file.
- Constants (colors, fonts, sizes, sound keys, messages) are hoisted to the top of `GameScreen.js` in `UPPER_SNAKE_CASE` objects — follow this pattern rather than inlining magic numbers/strings if you add to that file.
- Sprite sheets are single `Image` objects sliced via `drawImage` source-rect math (`frameWidth`/`frameHeight`/`currentFrame`); animation speed is throttled with a manual `frameCounter` vs `frameSpeed`, not `setInterval`.
- Collision detection is hand-rolled AABB (axis-aligned bounding box) checks — no physics library.

## Known rough edges (worth knowing before you extend this)
- **No tests at all.** Zero test coverage currently exists for any collision, movement, or game-state logic.
- **No README.**
- `GameScreen.js` mixes rendering, game state, input-response, collision logic, and procedural level generation in one ~725-line class — a strong refactor candidate.
- AABB collision logic is duplicated across `Boundary`, `Escape`, `Dog`, and now `Furniture` instead of being shared/extracted.
- Mouse is explicitly not blocked by furniture (`mouseColliding` is hardcoded `false` in `updateMouse()`, with a comment noting mice can pass through) — currently a deliberate simplification, but worth confirming it's meant to stay that way long-term.
- `Boundary.js` and its `generateRandomBoundaries`/`areOverlapping` methods in `GameScreen.js` are dead/commented-out code now that furniture is the obstacle system — candidate for deletion rather than carrying both systems forward.
- `styles.css` exists but is currently empty — all styling is Tailwind utility classes in `index.html`.

## Planned work
- **Furniture asset rework.** The current `assets/kitchen_*.png`/`tabletop_*.png` sprites are placeholder-quality; plan is to replace them with more realistic art. `Furniture.js` already assumes a fixed 12x24 native sprite size (`spriteWidth`/`spriteHeight`) scaled 3x — new assets should either match that or the constructor's sizing will need to change alongside them.
- **Mobile responsiveness.** Not addressed yet. Canvas sizing (`resizeCanvas` in `js/main.js`) and all movement/collision math currently assume keyboard input (`InputHandler` only listens for arrow keys, space, `p`, `m`) — touch input and layout would both need work.

## When working in this repo
- Prefer matching the existing per-class, no-framework style — don't introduce a build tool or framework without discussing it first.
- If you touch collision code, consider whether it's worth extracting the shared AABB check rather than adding a sixth copy.
- `GameScreen.cleanup()` centralizes teardown of document/canvas listeners and the `InputHandler` — call it (or extend it) rather than adding new listeners without a matching removal path.
- There's no test runner configured yet — if you add tests, that's a setup decision to make explicitly (e.g. Vitest/Jest), not assume one is already there.