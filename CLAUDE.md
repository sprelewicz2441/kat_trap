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
- `Furniture.js` — kitchen/dining obstacle (fridge, stove, sink, counter, islands, side table, dining set). Takes `(x, y, type, spriteSrc, rotation = 0, spriteWidth = 32, spriteHeight = 64, scale = 1.5)`. The defaults matched the old kitchen-appliance sprites; every ref1-sourced piece (see Kitchen furniture below) now passes explicit overrides since none of them share a native size. Rotation (0/90/180/270) swaps width/height and is applied via canvas transform in `draw()`, which draws the sprite at its native (unrotated) size centered on the same pivot the rotation uses, so the rendered sprite lines up with the rotated collision box at every rotation value — but in practice only the fridge ever uses a non-zero rotation now (see below for why). Draws a type-colored placeholder rect while the sprite loads. `isWallItem` is computed in the constructor but never read anywhere — dead property.
- `InputHandler.js` — tracks currently-held keys via `window` keydown/keyup listeners, exposes `getDirection()`; also dispatches custom `'toot'` (spacebar), `'punch'` (`p`), and `'meow'` (`m`) events for `GameScreen` to react to.

**Cutscenes** (`js/classes/cutscenes/`):
- `Cutscene.js` / `CutsceneManager.js` — sequenced intro scenes shown before gameplay starts, triggered from `GameScreen.startCutscenes()`.

**Utilities** (`js/utils/`):
- `collision.js` — exports `aabbOverlap(ax, ay, aWidth, aHeight, bx, by, bWidth, bHeight)`, the single shared axis-aligned bounding box overlap test. Used by `Escape.isMouseInside`, `Dog.isColliding`, `Furniture.isColliding`, and `GameScreen.checkCollision`. Takes raw coordinates rather than entity objects so each caller stays explicit about which field it's using per side (e.g. `Dog` uses its own `frameWidth`/`frameHeight` for itself but `entity.size` for whatever it's checking against) — don't refactor it to accept entities and guess the right field, since the same object (e.g. `Dog`) legitimately uses different box dimensions depending on which side of the check it's on.

## Floor background (`GameScreen.drawFloor`)
`render()` fills the whole canvas with a repeating `assets/floor_tile.png` pattern (`ctx.createPattern(..., 'repeat')`, cached on `this.floorPattern` after the image loads) before drawing anything else, replacing the old plain-white background. The tile is a 32x32 crop from the same AI-generated kitchen reference image used to guide the furniture layout (see below) — cropped from a seamless part of its floor grid, verified to tile with no visible seams before committing. `COLORS.FLOOR_FALLBACK` is a solid color shown for the one frame or so before the image finishes loading.

## Kitchen furniture (`GameScreen.generateKitchenFurniture`)
Procedurally lays out `Furniture` instances each game reset. The furniture is cut from `assets/kitchen_reference_scene.jpg`, a single full-scene AI-generated kitchen reference image (see Asset source below), rather than assembled from small tileable sprite-pack icons — that earlier approach (documented in git history, now superseded) kept reading as "scattered mismatched furniture" no matter how the layout algorithm was tuned, because pack pieces don't share a consistent camera angle/lighting with each other. Cutting pieces directly out of one single cohesive reference image guarantees they all already match.

**Why nothing gets rotated (important if you touch this code):** every `REF1_PIECES` entry is a crop with baked-in lighting and shadow from one fixed overhead camera angle. Rotating a crop (like the old code did, via `Furniture`'s `rotation` param) makes the shadows point the wrong way and looks visibly broken — this was a real bug found and fixed. So each piece is placed at **rotation 0 only**, and is cropped directly from whichever part of the reference scene it needs to represent: pieces for the top wall come from the reference's top wall, the bottom-wall piece comes from the reference's bottom wall (both already face the right way in the source image), and everything else is a freestanding item (island stoves, a side table, the dining set) with no wall orientation to worry about. `FRIDGE` is the one exception — it's still the old flat Reakain sprite (see below), which genuinely was designed to rotate, so it keeps that freedom.

Layout, per reset:
1. **Top wall**: `stove` → `counter` → `sink` → `fridge`, left-to-right from the corner, each advancing the placement cursor by its own actual rendered width (they're not uniform sizes) so they end up edge-to-edge with no gaps.
2. **Bottom wall**: `stove2` (a second, different stove crop, taken from the reference's bottom wall so it's already correctly oriented there), flush against the bottom edge.
3. **Freestanding, scattered across the open interior** (not anchored to any corner): `island_stove`, `island_stove2`, `side_table`, and `dining_set` (table + two chairs cropped as one connected piece, rather than a separately-placed table and chairs — this is what makes the seating look properly arranged instead of floating chairs). Each is placed via the existing `overlaps`/`blocksSpawn` random-search, same as before.

All native crop sizes/paths live in `REF1_PIECES` / `FURNITURE_SPRITES` at the top of `GameScreen.js`, scaled by a single shared `REF1_SCALE` (0.7).

**Asset source:** all pieces except `FRIDGE` are cropped from `assets/kitchen_reference_scene.jpg`, a single AI-generated top-down kitchen scene the user sourced directly (generated via stablediffusionweb.com) and asked to have cut up for individual furniture pieces. This replaced an earlier attempt built from Reakain's "Kitchen Assets" itch.io pack + sierrassets' "Pixel Art Furniture Pack" for the dining set — both still fine, freely-licensed packs, just not what's wired in today. `FRIDGE` alone is still `kitchen_fridge.png`, cropped from Reakain's pack in that earlier pass — the reference scene has no clean fridge visual anywhere in it (every tall silver-looking appliance in it turned out to be a dish rack or plate storage on closer inspection), so this one piece is intentionally a style mismatch (flat sprite vs. photographic crop) accepted as the least-bad option. `assets/kitchen_v1_source_sheet.png` (the old Reakain sheet) is kept only for that fridge's provenance.
- The `tabletop_*`/`*_corner`/`wallframes`/`wallknife` assets from the very first WIP commit are **not a dining table** — closer inspection shows they're a pool table (green felt top, wood rail) plus a wall knife/dart rack and framed art. Still unused; don't reach for these for kitchen/dining furniture.

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
- **Furniture asset rework — kitchen redone from a reference photo, other rooms still to do.** See Kitchen furniture above for the current approach (cropping one cohesive AI-generated scene instead of assembling sprite-pack icons). Remaining for the kitchen specifically: no clean fridge crop exists in the reference scene, so `FRIDGE` is still a style-mismatched flat sprite from the earlier Reakain-based pass; only one variant each of the two stoves/island pieces has been cut, so every game looks the same (no color/style variety); and the layout is currently a fixed recipe (specific pieces always on specific walls) rather than randomized among several candidate reference crops. Future rooms (living room, bathroom, etc. for later stages) will need their own reference scene sourced and cut the same way — this kitchen-specific art won't carry over.
- **Mobile responsiveness.** Not addressed yet. Canvas sizing (`resizeCanvas` in `js/main.js`) and all movement/collision math currently assume keyboard input (`InputHandler` only listens for arrow keys, space, `p`, `m`) — touch input and layout would both need work. This should also cover making entity/furniture positions re-derive from canvas size on resize instead of going stale — furniture (like everything else in `GameScreen`) computes its position once from `canvas.width`/`canvas.height` at generation time and never re-lays-out if the canvas resizes afterward (e.g. a browser window resize mid-game); positions go stale and can end up rendering partially off-canvas. Not new to furniture specifically — cat/mouse/dog spawn points have the same assumption.

## When working in this repo
- Prefer matching the existing per-class, no-framework style — don't introduce a build tool or framework without discussing it first.
- If you touch collision code, use `aabbOverlap` from `js/utils/collision.js` rather than reimplementing the check inline.
- `GameScreen.cleanup()` centralizes teardown of document/canvas listeners and the `InputHandler` — call it (or extend it) rather than adding new listeners without a matching removal path.
- There's no test runner configured yet — if you add tests, that's a setup decision to make explicitly (e.g. Vitest/Jest), not assume one is already there.