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
- `Dog.js` — moves randomly on a timer (`moveInterval`), respects an obstacle list (currently the `furniture` array, still named `boundaries`/`this.boundaries` internally, a naming leftover from before furniture existed) and `escapes` when deciding valid moves, barks on a random interval, and exposes `isColliding(entity)`.
- `Mouse.js` — moves with pseudo-random velocity, bounces off canvas walls, fires a `wallHitCallback` on bounce. Intentionally **not** blocked by furniture (mouse has no pathfinding, so a real collision would risk it getting stuck against furniture corners); instead `GameScreen.render()` draws the mouse *before* furniture so furniture visually paints over it wherever they overlap, giving the effect of the mouse ducking under furniture while passing through unobstructed.
- `Escape.js` — a static rectangle ("mouse hole"); `isMouseInside()` for collision.
- `Furniture.js` — kitchen/dining obstacle (fridge, stove, sink, counter, dining table, chair). Takes `(x, y, type, spriteSrc, rotation = 0, spriteWidth = 32, spriteHeight = 64, scale = 1.5)`. The default size/scale match the kitchen-appliance sprites; table/chair sprites come from a different pack with different native sizes, so their call sites pass explicit overrides rather than relying on the defaults — this is intentionally per-instance, not a global constant, because the assets aren't all one native size. Rotation (0/90/180/270) swaps width/height and is applied via canvas transform in `draw()`, which draws the sprite at its native (unrotated) size centered on the same pivot the rotation uses, so the rendered sprite lines up with the rotated collision box at every rotation value. Draws a type-colored placeholder rect while the sprite loads. `isWallItem` is computed in the constructor but never read anywhere — dead property.
- `InputHandler.js` — tracks currently-held keys via `window` keydown/keyup listeners, exposes `getDirection()`; also dispatches custom `'toot'` (spacebar), `'punch'` (`p`), and `'meow'` (`m`) events for `GameScreen` to react to.

**Cutscenes** (`js/classes/cutscenes/`):
- `Cutscene.js` / `CutsceneManager.js` — sequenced intro scenes shown before gameplay starts, triggered from `GameScreen.startCutscenes()`.

**Utilities** (`js/utils/`):
- `collision.js` — exports `aabbOverlap(ax, ay, aWidth, aHeight, bx, by, bWidth, bHeight)`, the single shared axis-aligned bounding box overlap test. Used by `Escape.isMouseInside`, `Dog.isColliding`, `Furniture.isColliding`, and `GameScreen.checkCollision`. Takes raw coordinates rather than entity objects so each caller stays explicit about which field it's using per side (e.g. `Dog` uses its own `frameWidth`/`frameHeight` for itself but `entity.size` for whatever it's checking against) — don't refactor it to accept entities and guess the right field, since the same object (e.g. `Dog`) legitimately uses different box dimensions depending on which side of the check it's on.

## Floor background (`GameScreen.drawFloor`)
`render()` fills the whole canvas with a repeating `assets/floor_tile.png` pattern (`ctx.createPattern(..., 'repeat')`, cached on `this.floorPattern` after the image loads) before drawing anything else, replacing the old plain-white background. The tile is a 32x32 crop from the same AI-generated kitchen reference image used to guide the furniture layout (see below) — cropped from a seamless part of its floor grid, verified to tile with no visible seams before committing. `COLORS.FLOOR_FALLBACK` is a solid color shown for the one frame or so before the image finishes loading.

## Kitchen furniture (`GameScreen.generateKitchenFurniture`)
Procedurally lays out `Furniture` instances each game reset as a deliberate layout (not the earlier random-scatter version), in two passes:
1. **Counter/appliance run**, an L-shape built from two straight walls meeting at the **bottom-right corner** of the canvas: the bottom wall carries fridge + stove nearest the corner then 3 counters extending left; the right wall carries the sink nearest the corner (so it sits right by the stove, "work triangle" style) then 2 counters extending up. Every piece is placed edge-to-edge (`FURNITURE_WIDTH`/`FURNITURE_HEIGHT` apart, no gap) so the run reads as one connected counter line, not scattered furniture. The corner is fixed at bottom-right specifically to stay clear of the mouse (100,100) and dog (200,200) spawn points, which sit in the top-left — there's no randomized-corner variant yet.
2. **Dining table + 2 chairs**, placed as one connected unit (chair above, chair below, both centered on the table) somewhere in the open interior via the existing `overlaps`/`blocksSpawn` random-placement search, treating the table+chairs as a single combined bounding box.

There is currently no true mitred corner-cap sprite where the two counter-run walls meet — Reakain's sheet has corner tiles, but they turned out to be drawn with bleed into neighboring tiles for a multi-tile assembly system rather than a clean standalone crop, so the corner is just two straight runs touching at 90°, not a seamless joint. Revisit if it's worth chasing.

**Asset sources:**
- **Fridge/stove/sink/counter** — cropped and composited from Reakain's ["Kitchen Assets"](https://reakain.itch.io/kitchen-assets) pack (itch.io, name-your-own-price; license permits free/commercial use and modification, no redistribution/resale, no NFT/AI-training use, credit appreciated not required). Full source sheet kept at `assets/kitchen_v1_source_sheet.png` (32x32-tile grid) for future re-slicing — the pack also has a toaster, microwave, trash bin, and waffle iron not wired in yet.
- **Dining table/chairs** — cropped from sierrassets' ["Pixel Art Furniture Pack"](https://sierrassets.itch.io/pixel-art-furniture-pack) (itch.io, name-your-own-price; commercial/non-commercial use permitted, no resale even modified). Chosen over Reakain's own pack because Reakain's kitchen set has no dining table at all. Note this pack draws furniture at a 3/4 angle (chair back+seat+legs all visible at once) rather than Reakain's flatter top-down counters — a deliberate, accepted trade-off, not an oversight, since genuinely flat top-down chairs are rare (a chair viewed from directly above reads as a small square).
- The `tabletop_*`/`*_corner`/`wallframes`/`wallknife` assets from the very first WIP commit are **not a dining table** — closer inspection shows they're a pool table (green felt top, wood rail) plus a wall knife/dart rack and framed art. Still unused; don't reach for these for kitchen/dining furniture.

`Furniture.js`'s defaults (32x64 native, 1.5x scale → 48x96 rendered) apply to the appliance/counter sprites; the dining table (34x19 native, 2x scale) and chairs (16x24 native, 2x scale) pass their own explicit sizes since they're a different native resolution. `FURNITURE_SPRITES` wires up `FRIDGE`, `STOVE`, `SINK`, `COUNTER`, `DINING_TABLE`, `CHAIR_RED`, `CHAIR_ORANGE`.

**Known gap surfaced while building this:** furniture (like everything else in `GameScreen`) computes its position once from `canvas.width`/`canvas.height` at generation time and never re-lays-out if the canvas resizes afterward (e.g. a browser window resize mid-game) — positions go stale and can end up rendering partially off-canvas. This isn't new to furniture specifically; cat/mouse/dog spawn points have the same assumption. Rolled into the existing mobile-responsiveness item below rather than tracked separately.

## Punch mechanic
- `p` → `InputHandler` dispatches a `'punch'` custom event on `document`.
- `GameScreen` listens for `'punch'` in `init()`, plays `SOUND_KEYS.PUNCH`, and calls `handlePunch()`, which knocks the dog `PUNCH_DISTANCE` (40px) away from the cat (clamped to canvas bounds) and starts a purple `shockwave` ring centered on the cat, drawn by `drawShockwave()` for `PUNCH_SHOCKWAVE_DURATION` (200ms).
- `m` → dispatches a `'meow'` event, which just plays the meow sound (no gameplay effect).

## Conventions actually in use
- ES modules throughout (`import`/`export default`), one class per file.
- Constants (colors, fonts, sizes, sound keys, messages) are hoisted to the top of `GameScreen.js` in `UPPER_SNAKE_CASE` objects — follow this pattern rather than inlining magic numbers/strings if you add to that file.
- Sprite sheets are single `Image` objects sliced via `drawImage` source-rect math (`frameWidth`/`frameHeight`/`currentFrame`); animation speed is throttled with a manual `frameCounter` vs `frameSpeed`, not `setInterval`.
- Collision detection is hand-rolled AABB (axis-aligned bounding box) checks via the shared `aabbOverlap` helper — no physics library.

## Known rough edges (worth knowing before you extend this)
- **No tests at all.** Zero test coverage currently exists for any collision, movement, or game-state logic.
- **No README.**
- `GameScreen.js` mixes rendering, game state, input-response, collision logic, and procedural level generation in one ~725-line class — a strong refactor candidate.
- `styles.css` exists but is currently empty — all styling is Tailwind utility classes in `index.html`.

## Planned work
- **Furniture asset rework — mostly done for the kitchen.** Fridge/stove/sink/counter/dining-table/chairs all use real art now (see Kitchen furniture section above), arranged as a connected L-shaped counter run plus a table+chairs unit instead of scattered random placement. Remaining: a true corner-cap sprite for the counter run (currently just two runs touching at 90°), randomizing which corner the L anchors to (currently fixed bottom-right), and more chair color variety (only red/orange extracted so far, though the source pack has more). Future rooms (living room, bathroom, etc. for later stages) will need a matching-style pack sourced the same way — kitchen-only packs won't carry over, so look for multi-room interior packs when that comes up.
- **Mobile responsiveness.** Not addressed yet. Canvas sizing (`resizeCanvas` in `js/main.js`) and all movement/collision math currently assume keyboard input (`InputHandler` only listens for arrow keys, space, `p`, `m`) — touch input and layout would both need work. This should also cover making entity/furniture positions re-derive from canvas size on resize instead of going stale (see the "known gap" note in the Kitchen furniture section) — right now nothing in `GameScreen` re-lays-out after a resize.

## When working in this repo
- Prefer matching the existing per-class, no-framework style — don't introduce a build tool or framework without discussing it first.
- If you touch collision code, use `aabbOverlap` from `js/utils/collision.js` rather than reimplementing the check inline.
- `GameScreen.cleanup()` centralizes teardown of document/canvas listeners and the `InputHandler` — call it (or extend it) rather than adding new listeners without a matching removal path.
- There's no test runner configured yet — if you add tests, that's a setup decision to make explicitly (e.g. Vitest/Jest), not assume one is already there.