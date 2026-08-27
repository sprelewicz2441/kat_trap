// ==============================
//  IMPORTS
// ==============================
// ?v=2 cache-busts the module itself, not just the image it loads — a
// stale cached Cat.js/Dog.js (pre-dating the imageSmoothingEnabled fix and
// the asset margin fix) would reproduce the exact sprite-sheet bleed these
// were meant to fix regardless of how the *image* URL is cache-busted,
// since ES modules are only re-fetched on a real page reload and browsers
// can heuristically cache them across plain refreshes even with no
// explicit cache headers from a bare static file server.
import Cat from '../Cat.js?v=7';
import Mouse from '../Mouse.js?v=4';
import Dog from '../Dog.js?v=9';
import InputHandler from '../InputHandler.js';
import Escape from '../Escape.js';
import CutsceneManager from '../cutscenes/CutsceneManager.js';
import Cutscene from '../cutscenes/Cutscene.js';
import Furniture from '../Furniture.js';
import CharacterSelectScreen from './CharacterSelectScreen.js';
import { aabbOverlap, insetBox } from '../../utils/collision.js';
import { getScale, getUIScale, getFurnitureScale, getCharacterScale } from '../../utils/scale.js?v=1';
import { CHARACTER_NAMES } from '../../utils/characterNames.js';
import { isMusicMuted, isSfxMuted, playWinSound, playLoseSound, playPlantKnockOverSound, playPoopSound, playCatStuckSound, playDooberSound, playCoinLandSound, startBackgroundMusic, getBackgroundMusicElement } from '../../utils/audio.js?v=5';
import {
  drawRoundedRect,
  drawCatEarCard, drawCatEarInner,
  drawMouseEarCard, drawMouseEarInner,
  drawDogEarCard, drawDogEarInner,
} from '../../utils/canvasShapes.js';
import { setActionButtonsMode } from '../../utils/touchControls.js';
import {
  isLoggedIn,
  getWallets,
  getStore,
  getEquipped,
  submitRound,
  kathrynQuickLogin,
  queuePendingRound,
  flushPendingRounds,
} from '../../utils/api.js';
import { openStoreModal } from '../../utils/storeModal.js?v=23';
import { getSpriteSrc } from '../../utils/outfits.js?v=1';

// ==============================
//  CONSTANTS
// ==============================
// Every BASE_* constant below was tuned by eye against a ~1280px-wide
// desktop canvas. computeLayout() (bottom of this section) multiplies each
// by the canvas's actual scale factor (see js/utils/scale.js) so furniture,
// walls, and UI chrome keep the same *proportion* of the board at any
// canvas size — confirmed live that without this, a single stove alone ate
// ~40% of the board height on a 350px-wide mobile canvas. this.layout
// (computed once in the constructor) is what every method below reads
// instead of a bare module-level constant — see "Mobile responsiveness" in
// CLAUDE.md.

// Thickness of the visual wall band drawn around the board perimeter (see
// drawWalls()) — purely presentational, independent of WALL_OFFSET (the
// separate value moveCat() uses to clamp how close the cat can get to the
// edge).
const BASE_WALL_BAND_THICKNESS = 16;
const BASE_ESCAPE_SIZE = 15;
// Extra tolerance for Escape.hasMouseEntered()'s hit-test only — the
// visual hole itself (BASE_ESCAPE_SIZE) stays as-is. Deliberately a
// separate constant, not a bump to BASE_ESCAPE_SIZE: hasMouseEntered()
// requires the hole to be fully *covered* by the mouse's own box, so
// making the hole bigger actually shrinks that window (a bigger hole is
// harder for a fixed-size mouse to fully cover) — the opposite of "easier
// to hit." This margin instead expands the mouse's effective box for the
// hit-test only, which does widen the window, in the intuitive direction.
// Reported live as too tight even after the "hole covered by mouse" fix
// ("if the mouse gets anywhere near the hole, it escapes" → fixed → "now
// it's a little too hard... taking a step either way to get past it goes
// too far").
const BASE_ESCAPE_HITBOX_MARGIN = 20;
const NUM_OF_ESCAPES = 6;

// Thresholds for the mouse-escape-danger indicator (the power LED in the
// viewport frame — see styles.css body::before/body[data-mouse-danger]).
// Distance from the mouse to the nearest escape hole, scaled like every
// other board distance so "close" means the same relative thing at any
// canvas size. Danger < warning, obviously — anything farther than
// the warning radius reads as "far from it" (green).
const BASE_ESCAPE_DANGER_DISTANCE = 90;
const BASE_ESCAPE_WARNING_DISTANCE = 220;

// Furniture sprite paths — the FOURTH kitchen art direction this project
// has had (see CLAUDE.md Kitchen furniture section for why the previous
// three — a photo-crop scene, the flat-cartoon PtPt pack, and individually-
// generated photorealistic objects — were each replaced). These are new
// individually-generated renders provided directly for this pass; the
// modular wall-building/gap mechanic carries forward unchanged from the
// last two rounds — only the asset source and each piece's native
// dimensions changed.
// .webp, not .png — same pixel dimensions and alpha channel as the
// original renders (converted losslessly-in-dimension, quality=90 lossy
// compression), just ~85-90% smaller on disk. width/height/cropX/cropY
// below are keyed to those pixel dimensions, which format conversion
// didn't change, so none of that math needed updating.
const FURNITURE_SPRITES = {
  // A v2 re-shoot in the newer photorealistic-with-slight-tilt style
  // (matching cart/shelf/table_v2's own angle) was tried for cabinet —
  // tested live and rejected: same "modules don't connect to each other"
  // problem the original photorealistic-object round hit (see Art direction
  // history below) — a steeper/rotated per-object camera angle doesn't
  // read as one continuous countertop run when tiled edge-to-edge, no
  // matter how consistent the material/lighting is. `assets/
  // kitchen_cabinet_v2.webp` (that rejected steep-tilt attempt) is still on
  // disk, unreferenced. The actual fix — improving photorealism *within*
  // the working flatter angle — is what the "decorated counter" variants
  // below are; once those all worked, a matching *blank* (bare, nothing on
  // it) counter in the same style/angle became the natural replacement for
  // the original `kitchen_cabinet.webp` render as the default filler,
  // deprecating it the same way — "the blank one should be the default that
  // can be repeated" — `kitchen_cabinet.webp` (the marble-slab original)
  // stays on disk, unreferenced, same precedent as every other deprecated
  // asset in this file. The `CABINET`/`cabinet` name itself is unchanged
  // (still what every wall/rotation/placement code below calls this type) —
  // only the art it points to changed, same "reskin" pattern already used
  // for TABLE above.
  CABINET: './assets/kitchen_counter_blank.webp',
  // v2: same true top-down, edge-to-edge, image-bottom-is-front re-shoot as
  // cabinet/stove/fridge — double-basin sink with faucet, dish towel, soap
  // bottle, plates soaking, faucet/detail at the frame's bottom edge. First
  // attempt at this re-shoot came back as plain opaque RGB (no alpha
  // channel at all — same failure mode the very first blender/microwave/
  // toaster batch had), held back and re-requested with explicit "true
  // transparent (alpha channel) PNG background" direction; this one
  // verified as real RGBA. `kitchen_sink.webp` (v1) stays on disk,
  // unreferenced, same precedent as every other swap this session.
  SINK: './assets/kitchen_sink_v2.webp',
  // v2: same true top-down, edge-to-edge, image-bottom-is-front re-shoot as
  // cabinet/fridge — four-burner gas cooktop with knobs at the frame's
  // bottom edge, plain countertop at the top, confirmed in the actual
  // output before wiring in. `kitchen_stove.webp` (v1) stays on disk,
  // unreferenced, same precedent as every other swap this session.
  STOVE: './assets/kitchen_stove_v2.webp',
  // v3: a French-door style render, swapped in on request ("it it more
  // refridgerator like") — v2 (a single flat door, kept on disk unreferenced
  // alongside the original v1) read correctly but generically; this one has
  // a visible center door seam and two handles, much more recognizably a
  // fridge at a glance. Same true top-down, edge-to-edge, image-bottom-is-
  // front convention as v2 — confirmed in the actual output (handles at the
  // bottom edge, plain panel at the top) before wiring in, so
  // FRIDGE_ROTATIONS didn't need to change again.
  FRIDGE: './assets/kitchen_fridge_v3.webp',
  // v2: a re-shoot with a flatter, more nearly-orthographic camera tilt,
  // matching the cart/shelf's own barely-tilted top-down angle — the
  // original kitchen_table.webp was rotated diagonally in-frame and tilted
  // steeply enough to show full chair backs/legs, noticeably more than
  // cart/shelf, flagged live ("the tables and chairs asset is tilted
  // slightly more that the cart or bakers shelf"). Points at a new file
  // rather than overwriting the original — "do not replace old one in case
  // we have to go back" — so `kitchen_table.webp` itself is still on disk,
  // just unreferenced, same as `kitchen_chair.webp`'s own precedent above.
  TABLE: './assets/kitchen_table_v2.webp',
  PLANT: './assets/kitchen_plant.webp',
  CART: './assets/kitchen_cart.webp',
  SHELF: './assets/kitchen_shelf.webp',
  // "Decorated counter" variants — a plain cabinet-shaped module with a
  // small appliance resting on top, for top/bottom-wall variety. An earlier
  // 5-image batch (blender/microwave/toaster/mail-tray/flowers) was tried
  // and fully reverted — two of the renders had no alpha channel at all, and
  // the flower vase's rounded corners fooled a naive bbox crop — see
  // MODULE_SPECS.counterBlender's own comment and CLAUDE.md's Kitchen
  // furniture section for the full story. Each entry below is a from-scratch
  // re-export, generated one at a time with explicit alpha-transparency and
  // edge-to-edge framing requirements, verified via direct pixel inspection
  // (not just eyeballing a preview) before being wired in.
  COUNTER_BLENDER: './assets/kitchen_counter_blender.webp',
  COUNTER_MICROWAVE: './assets/kitchen_counter_microwave.webp',
  COUNTER_TOASTER: './assets/kitchen_counter_toaster.webp',
  COUNTER_FLOWERS: './assets/kitchen_counter_flowers.webp',
  // Re-export of the original batch's 5th image (mail/keys/coins tray) — the
  // only one of the five that was never actually broken by the alpha/crop
  // bugs the others had; it was held back instead because the first version
  // showed a real name and street address on one envelope. This re-export
  // was generated with explicit "no visible names or addresses" direction
  // and confirmed by inspection — the envelopes are blank/face-down.
  COUNTER_MAIL: './assets/kitchen_counter_mail.webp',
};

// Each render has its own native size (not a shared grid) — dimensions
// below are each render's actual *content* size, not its file size: every
// kitchen_*.png has a few pixels of transparent padding baked in around
// the object (confirmed by scanning each file's alpha channel), which left
// a visible gap between adjacent wall modules even though buildWall()
// places their bounding boxes truly edge-to-edge. width/height here are the
// trimmed content dimensions (used for layout/collision), and cropX/cropY
// are that content's offset within the source file (used by Furniture's
// draw() to source-rect only the real content, skipping the padding) — see
// Furniture.js. Wall modules are placed edge-to-edge using each piece's own
// scaled width (see buildWall() below) rather than a fixed cell size, and
// aligned to a shared baseline (the floor line) since their heights differ
// too.
const BASE_MODULE_SCALE = 0.15;
// cabinet's OLD art (kitchen_cabinet.webp, the deprecated marble-slab
// render — see FURNITURE_SPRITES.CABINET's own comment) needed a
// double-band trim fix that the current art doesn't: that raw render had an
// identical wood ledge/trim band on BOTH its top and bottom edges
// (confirmed by sampling its pixel rows — marble content spanned y=35-474
// of 512, with a symmetric ~28px wood band above and below), which read as
// a "double-sided" shelf once rendered in-game regardless of which side
// faced the wall — fixed at the time with cropY=34 to skip the top band
// entirely. The current art (kitchen_counter_blank.webp, generated in the
// same single-sided-trim style as every decorated counter variant below)
// never had that problem, so its own crop below is a plain padding-only
// crop like the others — no special cropY hack needed. makeModule()/
// LEFT_WALL_ROTATION/RIGHT_WALL_ROTATION below still handle rotation the
// same way regardless (single trim band always ends up facing the room,
// not the wall), since that convention is unchanged by the art swap.
const MODULE_SPECS = {
  // Real content rectangle at x:5-1531, y:78-948 of the raw 1536×1024
  // export, sharp edges (0% to 93-96%+ within 1-2px at every side) —
  // verified the same per-row/column opacity-fraction way as every
  // decorated counter variant below.
  cabinet: { sprite: FURNITURE_SPRITES.CABINET, width: 1526, height: 870, cropX: 0, cropY: 0 },
  // v2 dimensions (see FURNITURE_SPRITES.SINK's own comment) — real content
  // rectangle at x:16-1237, y:287-928 of the raw 1254×1254 export, sharp
  // edges (0% to 100% opaque within 1-3px at every side), cropped exactly
  // to the opaque zone.
  sink: { sprite: FURNITURE_SPRITES.SINK, width: 1221, height: 641, cropX: 0, cropY: 0 },
  // v2 dimensions (see FURNITURE_SPRITES.STOVE's own comment) — real content
  // rectangle at x:8-1527, y:108-895 of the raw 1536×1024 export, sharp
  // edges (0% to 95%+ within 2-5px at every side), cropped just inside the
  // opaque zone.
  stove: { sprite: FURNITURE_SPRITES.STOVE, width: 1519, height: 787, cropX: 0, cropY: 0 },
  // First surviving "decorated counter" variant (see FURNITURE_SPRITES.
  // COUNTER_BLENDER's own comment for the full history of the 5-image batch
  // that didn't work and why). Unlike that earlier batch, this render's
  // content was verified via direct per-pixel opacity sampling (not just a
  // global alpha bbox, which can be fooled by soft corners or vignette
  // padding) before being wired in: the true content rectangle (x: 8-1527,
  // y: 147-862 of the raw 1536×1024 export) ramps from 0% to >90% opaque
  // within 2px at every edge — a clean, sharp rectangle, not a soft fade or
  // an isolated corner-touch — and reaches the left/right edges at every row
  // in that rectangle, which is what actually matters for flush horizontal
  // tiling. Cropped exactly to that rectangle, so cropX/cropY are 0 here
  // (the saved file *is* the content, no further trim needed).
  counterBlender: { sprite: FURNITURE_SPRITES.COUNTER_BLENDER, width: 1519, height: 715, cropX: 0, cropY: 0 },
  // Second surviving variant, same verification method as counterBlender:
  // the raw 1536×1024 export's naive alpha bbox reached nearly the full
  // canvas (a vignette effect gave the corners faint-but-nonzero alpha far
  // past the real content), but per-row/column opacity *fraction* sampling
  // found a real rectangle at x:14-1522, y:146-867, with edges ramping from
  // 0% to 95%+ within about 7-8px (a bit softer than counterBlender's ~2px
  // ramp, but still a genuine edge, not a soft background fade — confirmed
  // by restricting the column scan to the content's own y-range, since
  // scanning the full canvas height was what made the raw edges look soft
  // in the first place: most of a "low fraction" column was actually
  // legitimate transparent vignette above/below the real content, not a
  // faded edge). Cropped just inside the >95%-opaque zone.
  counterMicrowave: { sprite: FURNITURE_SPRITES.COUNTER_MICROWAVE, width: 1508, height: 721, cropX: 0, cropY: 0 },
  // Third surviving variant, same verification method again. Real content
  // rectangle at x:12-1524, y:139-873 of the raw 1536×1024 export — sharp
  // edges this time (0% to 96%+ within 1-6px at every side, closer to
  // counterBlender's tight ramp than counterMicrowave's softer one).
  // Cropped just inside the >95%-opaque zone.
  counterToaster: { sprite: FURNITURE_SPRITES.COUNTER_TOASTER, width: 1512, height: 734, cropX: 0, cropY: 0 },
  // Fourth and final variant of this round — the one allowed to repeat, up
  // to COUNTER_FLOWERS_MAX_APPEARANCES times (see below), same verification
  // method again. Real content rectangle at x:14-1522, y:137-871 of the raw
  // 1536×1024 export —
  // sharp edges (0% to 96%+ within 1px at top/left, a few px at bottom/
  // right). Cropped just inside the >95%-opaque zone.
  counterFlowers: { sprite: FURNITURE_SPRITES.COUNTER_FLOWERS, width: 1508, height: 734, cropX: 0, cropY: 0 },
  // Fifth and final variant — the mail/keys/coins tray, re-exported without
  // any visible name/address after the first version was held back (see
  // FURNITURE_SPRITES.COUNTER_MAIL's own comment). Real content rectangle at
  // x:14-1522, y:133-873 of the raw 1536×1024 export, sharp edges. Cropped
  // just inside the >95%-opaque zone.
  counterMail: { sprite: FURNITURE_SPRITES.COUNTER_MAIL, width: 1508, height: 738, cropX: 0, cropY: 0 },
};
// Which decorated counter variants (see MODULE_SPECS above) can substitute
// for a plain 'cabinet' (now the blank-tile default — see FURNITURE_SPRITES.
// CABINET) slot on the top/bottom walls, and how often — see the
// substitution logic in generateKitchenFurniture() below, which builds a
// single shuffled "offer pool" from these two constants together (one entry
// per allowed appearance) rather than running two separate mechanisms —
// simpler than the two-pass unique-vs-repeatable split this replaced, per
// explicit direction not to over-engineer a real cap for the flower vase if
// it wasn't a small change ("if the work to make the flowers 2x is too
// one-off, it can not be repeated as well" — it wasn't, so it's 2).
// COUNTER_ONE_OFF_TYPES may each appear **at most once per game** across
// both walls combined; none are guaranteed to appear at all ("they do not
// all need to be placed in the same gameboard").
const COUNTER_ONE_OFF_TYPES = ['counterBlender', 'counterMicrowave', 'counterToaster', 'counterMail'];
// The flower vase gets its own, higher cap — decor, not a specific one-off
// appliance, so a couple of repeats reads fine, but still bounded rather
// than able to fill every remaining slot the way plain cabinet (the
// uncapped, always-available default) can.
const COUNTER_FLOWERS_MAX_APPEARANCES = 2;
// The on-screen height every wall module in this section is scaled to
// match — the original cabinet render's own content height (470), preserved
// as a fixed target rather than read live off MODULE_SPECS.cabinet.height,
// specifically *because* that field no longer describes a render tuned to
// this size: the new blank-tile cabinet art (see FURNITURE_SPRITES.CABINET)
// is a much bigger native capture (870 vs. the old 470) of the same
// board-relative countertop, not a differently-proportioned object, so
// reusing it unscaled would have silently made every wall module ~1.85x
// taller than before — confirmed by comparing the two renders' native
// pixel heights before wiring anything in, not caught live by accident.
// MODULE_SCALE_MULTIPLIERS now covers cabinet itself alongside every
// decorated counter variant (all six share the same "match this height"
// convention), where the old COUNTER_DECOR_SCALE_MULTIPLIERS only covered
// the five decorated ones and left cabinet unscaled — cabinet's own art
// swap is what made that exemption stop being safe.
const CABINET_TARGET_HEIGHT = 470;
// stove's own v2 re-shoot (see FURNITURE_SPRITES.STOVE) needed the same
// treatment for the same reason — its new native content isn't proportional
// to the old, so leaving it unscaled would have grown it too. Kept as its
// own target rather than reusing CABINET_TARGET_HEIGHT: stove was never the
// same on-screen height as cabinet even before any art swaps (703 vs.
// cabinet's 470), so "preserve this module's own original size" is the
// right target per module, not one shared height for all of them.
//
// Unlike every other swap this session, height-only matching isn't safe
// here: stove v2's aspect ratio (1519×787 ≈ 1.93:1) is noticeably wider
// than v1's (981×703 ≈ 1.40:1), so scaling to match v1's *height* alone
// would make v2 render ~38% *wider* on screen than v1 ever was — confirmed
// live as a real bug, not a theoretical one: with both cabinet slots on the
// top wall substituted for decorated counters (themselves already at their
// own widest) plus this wider stove, a full top-wall row could exceed the
// canvas width even with the fridge nowhere involved, hanging the last
// module off the right edge (57 off-canvas placements out of 1000 sampled
// layouts before this fix). Using `Math.min()` of the width-preserving and
// height-preserving multipliers guarantees stove v2 never exceeds v1's
// on-screen footprint in *either* dimension — width wins out here (0.646 vs
// 0.893), so stove ends up a bit shallower front-to-back than v1 was, the
// smaller visual cost of the two options (same "front edges vary slightly
// per piece" tolerance already accepted elsewhere in this file), rather
// than risking the same overflow this fix exists to prevent.
const STOVE_TARGET_WIDTH = 981;
const STOVE_TARGET_HEIGHT = 703;
// sink's own v2 re-shoot got the same min-of-both-dimensions treatment
// proactively, before shipping, rather than waiting to catch a live
// overflow the way stove's own fix was found — sink v2's content aspect
// ratio (1221×641 ≈ 1.91:1) is, like stove's, noticeably wider than v1's
// (980×669 ≈ 1.47:1), for the same reason (a bigger, differently-proportioned
// native capture). Same reasoning as stove: width-preserving wins
// (0.803 vs. 1.044), so sink reads a bit shallower front-to-back than v1,
// trading that for the guarantee that it never grows wider on screen than
// v1 ever was.
const SINK_TARGET_WIDTH = 980;
const SINK_TARGET_HEIGHT = 669;
const MODULE_SCALE_MULTIPLIERS = {
  ...Object.fromEntries(
    ['cabinet', ...COUNTER_ONE_OFF_TYPES, 'counterFlowers'].map(type => [
      type,
      CABINET_TARGET_HEIGHT / MODULE_SPECS[type].height,
    ])
  ),
  stove: Math.min(
    STOVE_TARGET_WIDTH / MODULE_SPECS.stove.width,
    STOVE_TARGET_HEIGHT / MODULE_SPECS.stove.height
  ),
  sink: Math.min(
    SINK_TARGET_WIDTH / MODULE_SPECS.sink.width,
    SINK_TARGET_HEIGHT / MODULE_SPECS.sink.height
  ),
};
// Only 3 distinct plain wall-module renders exist (no separate plain
// "counter" render this round) — cabinet doubles as filler, same role
// COUNTER played with the PtPt pack. (The decorated counter variants above
// are visual reskins of that same filler role, not a 4th distinct module
// shape.)
// Only one sink and one stove render exist, so each appears exactly once
// (top wall only) — the bottom wall is all cabinet so the kitchen doesn't
// read as having two sinks/two stoves. Revisit once dedicated additional
// appliance renders exist (see CLAUDE.md Planned work — v2 furniture pack).
const TOP_WALL_ORDER = ['cabinet', 'stove', 'sink', 'cabinet'];
const BOTTOM_WALL_ORDER = ['cabinet', 'cabinet', 'cabinet', 'cabinet'];
// Left/right walls (new this round) reuse cabinet as filler, rotated 90/270
// via Furniture's existing rotation support so their long edge runs along
// the wall — same "cabinet doubles as filler" precedent as top/bottom.
const LEFT_WALL_ORDER = ['cabinet', 'cabinet'];
const RIGHT_WALL_ORDER = ['cabinet', 'cabinet'];
// Used instead of the two-cabinet orders above on whichever vertical wall
// ends up carrying the fridge (see generateKitchenFurniture()'s
// `fridgeWall`) — two cabinets plus the fridge doesn't fit the vertical
// band's height at any canvas size (the board's fixed ~4:3 aspect means
// that band is always shorter, proportionally, than the horizontal walls'
// available width, so this isn't a small-canvas-only problem — confirmed
// live it fails identically even on a spacious desktop canvas). One cabinet
// leaves enough room for the fridge to actually land on a side wall at all,
// rather than the fridge-placement code silently never selecting left/right
// as a candidate in practice despite "supporting" all 4 walls on paper.
const LEFT_WALL_ORDER_WITH_FRIDGE = ['cabinet'];
const RIGHT_WALL_ORDER_WITH_FRIDGE = ['cabinet'];
// These two, plus makeModule()'s isTop-dependent rotation just below, are
// no longer an arbitrary cosmetic choice ("flip if it looks wrong") now that
// cabinet only has a trim band on one edge (see MODULE_SPECS.cabinet above):
// each rotation value is specifically the one that puts cabinet's *plain*
// (cropped) edge against the wall and its trimmed edge facing the room, on
// every one of the four walls. Worked out from ctx.rotate()'s direction
// (positive = clockwise, since canvas y points down): unrotated (top wall)
// already has the plain edge — which is now the sprite's top row — facing
// up/into the wall band, so top wall needs no rotation; the other three
// walls each face the opposite way from top, so each needs whichever
// rotation sends the sprite's top row toward that wall instead of the room.
const LEFT_WALL_ROTATION = 270;
const RIGHT_WALL_ROTATION = 90;

// Trimmed content size + crop offset, same reasoning as MODULE_SPECS above.
// v3 dimensions (see FURNITURE_SPRITES.FRIDGE's own comment) — real content
// rectangle at x:41-984, y:8-1524 of the raw 1024×1536 export. Top/bottom
// edges sharp (0% to 100% opaque within 1-13px); the left edge specifically
// had a much softer ~26px ramp than every other kitchen asset cropped this
// session (likely a soft highlight/reflection along the door bleeding past
// the render's actual hard edge) — cropped conservatively at x:41, well
// inside the fully-opaque zone, rather than at the first nonzero-alpha
// pixel, to avoid carrying a faint fringe into the game.
const FRIDGE_SPEC = { width: 943, height: 1516, cropX: 0, cropY: 0 };
// v1's fridge render needed its rotations offset 180° from cabinet's own
// (see git history around this comment for the fuller explanation) because
// its front/back edges ran the opposite way from every other module's. The
// v2 render was generated with the opposite, cabinet-matching convention on
// purpose ("detail near the bottom edge of the frame... the opposite edge
// should stay plain") specifically to retire this special case — confirmed
// in the actual output (the door handle sits at the image's bottom edge,
// the top is a plain flat panel) before wiring it in, not assumed from the
// prompt alone. FRIDGE_ROTATIONS is now identical to CART_ROTATIONS/
// SHELF_ROTATIONS — kept as its own named constant rather than reusing one
// of theirs directly, so a future fridge-specific rotation need doesn't
// require un-sharing it from an unrelated piece's constant.
const FRIDGE_ROTATIONS = { top: 0, bottom: 180, left: 270, right: 90 };
// v1's native content (384×696) was close enough to its own intended
// on-screen size that fridge never needed a scale multiplier — every call
// site just multiplied FRIDGE_SPEC dimensions by plain `moduleScale`. v2's
// native content (889×1491) is a much bigger capture of the same
// board-relative appliance (same "generated bigger than before" pattern as
// cabinet's own art swap — see MODULE_SCALE_MULTIPLIERS above), so it needs
// the same kind of correction: FRIDGE_SCALE_MULTIPLIER preserves v1's
// original on-screen height (696) as a fixed target, derived once here
// rather than hardcoded, so it stays correct if FRIDGE_SPEC.height is ever
// re-measured again. Every fridge-specific call site in this file (the
// `computeLayout()` wall-height reservations and every place
// `generateKitchenFurniture()` sizes/places the fridge) multiplies by
// `moduleScale * FRIDGE_SCALE_MULTIPLIER` now, not plain `moduleScale`.
const FRIDGE_TARGET_HEIGHT = 696;
const FRIDGE_SCALE_MULTIPLIER = FRIDGE_TARGET_HEIGHT / FRIDGE_SPEC.height;
// Dining set: a single table render with all four chairs baked directly
// into the image (plus a full place-setting spread — plates, napkins,
// utensils, mugs, a flower centerpiece), replacing the previous two-piece
// table+chair placement below. That older approach (a table and one
// separate freestanding chair, placed side by side since the chair render
// only existed from one angle and stacking chair+table+chair vertically
// needed more interior height than these renders leave room for at this
// scale) is no longer wired in — the project owner reviewed this new
// all-in-one render live and asked to drop the separate chair piece
// entirely ("i really like this with the chairs, lets remove the old
// chair"), rather than keep generating a matching standalone chair for
// consistency. `assets/kitchen_chair.webp` and CHAIR_SPEC/
// CHAIR_SCALE_MULTIPLIER's old values are kept out of active code but the
// asset file itself is still in the repo (restored after an initial pass
// deleted it) in case this gets revisited. One placement slot instead of
// two also sidesteps the old DINING_GAP/setWidth two-piece layout math
// below — a single piece needs none of it.
// Trimmed content size + crop offset, same reasoning as MODULE_SPECS above.
// v2 dimensions (see FURNITURE_SPRITES.TABLE's own comment) — flatter tilt
// reads as a wider, shorter frame than the original (1397×1015 vs. the
// original 1254×1205), since less of the chairs' vertical faces show.
const TABLE_SPEC = { width: 1397, height: 1015, cropX: 6, cropY: 0 };
// The all-in-one render's native content (1254 wide, 1205 tall — chairs now
// stack top/bottom around the table instead of sitting beside it) is much
// bigger than the old two-piece version's combined footprint, especially in
// height (was 651 tall at most, now 1205 — chairs used to only add width).
// Reusing diningScale directly rendered it badly out of scale with every
// other piece of furniture on the board, confirmed live. Same category of
// fix CART_SCALE_MULTIPLIER/SHELF_SCALE_MULTIPLIER/PLANT_SCALE_MULTIPLIER
// already needed for their own oversized native renders — scale the table
// down independently rather than touching diningScale itself (which every
// wall module also depends on). Tuned by eye; expect to retune after an
// actual live look, like every other multiplier in this file.
const TABLE_SCALE_MULTIPLIER = 0.55;

// Small freestanding corner/wall decor — passable, not a collision obstacle
// (see NON_BLOCKING_FURNITURE_TYPES below). Content bbox measured the same
// way as every other kitchen_*.webp (alpha-channel scan, not assumed
// full-bleed) from a 1254×1254 native file.
const PLANT_SPEC = { width: 1008, height: 1176, cropX: 125, cropY: 19 };
// Native resolution is much higher than the table (1008 vs. the table's own
// content width), so reusing diningScale directly would render it comically
// large next to the table — same category of mistake CART_SCALE_MULTIPLIER/
// SHELF_SCALE_MULTIPLIER below already fix for those pieces, just needing an
// even smaller multiplier here given the size gap. Tuned by eye (a plant
// should read as a modest floor accent, not furniture-sized) — like every
// other multiplier in this file, expect to retune if it reads wrong once
// actually checked live.
const PLANT_SCALE_MULTIPLIER = 0.28;

// Utility cart: a second freestanding corner/wall decor piece, placed the
// same corner-preferred way as the plant — but unlike the plant, it's meant
// to be an obstacle for the dog specifically (see CAT_NON_BLOCKING_
// FURNITURE_TYPES/DOG_NON_BLOCKING_FURNITURE_TYPES below): a solid cart is
// a believable thing for the cat/mouse to duck past but for the dog to
// actually bump into. Content bbox measured the same alpha-channel-scan way
// as every other kitchen_*.webp, from a 1401x937 native file.
const CART_SPEC = { width: 1393, height: 929, cropX: 4, cropY: 4 };
// Native content width (1393) is larger than the table's (958), so reusing
// diningScale directly would render the cart bigger than the table itself —
// same category of fix PLANT_SCALE_MULTIPLIER already needed (the dining
// set's old separate chair piece needed the same fix too, back when it
// existed — see TABLE_SPEC's own comment for why it's gone now).
// First tuned to 0.45 (landing it between the old chair and the table on
// screen) purely by eye against character/furniture proportions — confirmed
// live to look right in isolation, but at that size its on-screen footprint
// was close to a full cabinet module's, which made it fail to find room on
// tighter layouts far more often than the plant (see the placement-order
// comment below): an automated sampling pass found it silently failing to
// place on a real fraction of layouts even after being given first pick of
// the 4 corners. Pulled back to 0.32 — closer to the plant's footprint than
// the table's — specifically to make it fit reliably, at some cost to the
// original "cart-sized, between chair and table" visual target.
const CART_SCALE_MULTIPLIER = 0.32;
// The raw render's slatted lower shelf and wheels sit along the image's
// *bottom* edge only (confirmed by looking at the actual file — the top
// edge is a plain rail, no shelf/wheels visible there), the same "image-
// bottom = front/detail, image-top = back" convention `cabinet` already
// uses (the *v1* fridge render needed the opposite convention — see
// FRIDGE_ROTATIONS above for why, and for why v2 no longer does). At
// rotation 0 (unrotated, correct for the top wall) that detail
// already faces down into the room. Reported live as wrong on the bottom/
// side walls ("it should rotate so the bottom shelf always faces inside
// the room") — the cart never rotated at all before this, so on every
// wall except top it was showing its plain back to the room instead.
// Exactly cabinet's own per-wall rotation values (see LEFT_WALL_ROTATION/
// RIGHT_WALL_ROTATION and makeModule()'s bottom-wall 180 above) — cart and
// cabinet share the same front/back orientation (as does fridge v2, now;
// only the original v1 fridge render didn't — see FRIDGE_ROTATIONS above).
const CART_ROTATIONS = { top: 0, bottom: 180, left: 270, right: 90 };

// Utility/baker's shelf: a third freestanding corner/wall decor piece, same
// corner-preferred/wall-fallback placement family as the plant/cart above.
// Content bbox measured the same alpha-channel-scan way as every other
// kitchen_*.webp, from a 1442×856 native file. Originally shipped as a
// normal, fully-blocking obstacle for both the cat and the dog — a loaded
// shelf stacked with dishes/baskets across two tiers didn't seem like the
// kind of slender thing either would plausibly duck under or past — but
// changed shortly after, on request, to match the cart's own passable-for-
// cat/blocking-for-dog split instead (see CAT_NON_BLOCKING_FURNITURE_TYPES
// above).
const SHELF_SPEC = { width: 1434, height: 848, cropX: 4, cropY: 4 };
// Native content width (1434) is even larger than the cart's (1393) — the
// same "reusing diningScale directly would render it huge" problem the
// cart/chair/plant each already needed their own multiplier for. Picked
// conservatively from the start this time, learning from the cart's own
// history (an initial eyeballed 0.45 read fine in isolation but was too
// close to a full wall module's footprint to place reliably, and had to be
// pulled back to 0.32 after live sampling): targets an on-screen width a
// bit larger than the cart's own final size — big enough to read as
// "utility shelf" furniture rather than small decor, small enough to keep
// placement success reasonable without needing a live sampling pass to
// discover that the hard way again.
const SHELF_SCALE_MULTIPLIER = 0.35;
// Same "image-bottom = front/detail, image-top = back" convention as
// cabinet/cart (see CART_ROTATIONS above) — the raw render's second,
// lower shelf tier (plates/towel/basket/mugs, visible through the slats)
// sits along the image's bottom edge only; the top edge is just the plain
// tabletop corner posts. Exactly cabinet/cart's own per-wall rotation
// values, not fridge's opposite (offset-by-180°) convention.
const SHELF_ROTATIONS = { top: 0, bottom: 180, left: 270, right: 90 };

const BASE_SPAWN_CLEARANCE = 60;
// How close the cat/dog can get to the board edge — independent of the
// wall band's own thickness (see BASE_WALL_BAND_THICKNESS above).
const BASE_WALL_OFFSET = 40;
// Minimum distance apart entities are allowed to spawn from each other —
// see resolveClearSpawn()'s `avoid` param. The bottom wall's 4 cabinets
// span ~78% of the board width and are centered, same as the cat's
// preferred spawn X, so the cat's "bottom-center, away from everything"
// spawn is actually covered by furniture most games — the furniture-only
// fallback search then picked any clear spot in the whole interior with no
// regard for the mouse's fixed corner spawn, occasionally landing right
// next to it and ending the round before a player could react.
const BASE_MIN_SPAWN_SEPARATION = 280;
// Mouse-controlled mode: fixed per-tick step speed for direct player input,
// independent of the autonomous mouse's speedX/speedY wander velocity (see
// Mouse.js), which stays untouched. Matches Cat's own hardcoded 10*scale
// (Cat.js) and BASE_DOG_PLAYER_SPEED below rather than its own previously-
// separate value (8) — confirmed live that piloting each character should
// feel the same regardless of which one you're controlling; only the
// *autonomous* versions of each character are meant to feel different from
// one another.
const BASE_MOUSE_PLAYER_SPEED = 10;
// Dog-controlled mode's own per-tick step speed — see Dog.js's own
// this.speed comment for why the dog needed a player-control speed
// completely separate from its autonomous-wander speed. Matches
// BASE_MOUSE_PLAYER_SPEED/Cat.js's speed exactly, not just "close," so
// piloting any of the three characters feels identical.
const BASE_DOG_PLAYER_SPEED = 10;

// ms — a duration, not a size, so this doesn't scale with canvas size.
// Went 2000 (original) → 8000 (4x, on request) → 4000 (halved again, on
// request) — net 2x the original. The stun visuals (drawStunBurst()/
// drawStunStars(), see below) need no separate tuning either way: the
// stars just keep orbiting for however long catPaused stays true.
const DOG_PAUSE_DURATION = 4000;
const DOG_COLLISION_COOLDOWN = 1000; // ms
// Dog's "Longer Cat Pause" perk (store slug 'longer-pause') - applied in
// handleDogCollision() only when controlledEntity === 'dog' (Dog's own
// wallet-gated purchase, see this.ownedPerkSlugs in init()).
const LONGER_PAUSE_PERK_MULTIPLIER = 1.5;

// Dog poop hazard — the dog can drop a pile that stuns the cat for
// POOP_STUN_DURATION on contact, same catPaused/pauseEndTime/message
// mechanism handleDogCollision() already drives for the dog-catches-cat
// pause (see handleDogPoop()/updatePoops() below), just a different trigger
// and duration. Requested as "5 seconds", independent of DOG_PAUSE_DURATION
// above rather than reusing it, since the two moments (dog physically
// catching the cat vs. the cat stepping in a hazard) are conceptually
// unrelated even though they now share the same underlying pause plumbing.
const POOP_STUN_DURATION = 5000; // ms
// How long an un-stepped-in poop pile sits on the board before vanishing on
// its own — without this, a cautious player (or an AI cat that never
// happens to wander into it) could permanently block the dog from ever
// dropping another one, since handleDogPoop() only allows one active pile
// at a time (see its own comment).
const POOP_LIFETIME_MS = 15000;
// How long the pile's own "plop" spawn-in animation takes (see drawPoop()).
const POOP_POP_IN_DURATION = 220; // ms

// Stink-line orbit (see drawStinkLines()/drawStinkLine() below) — the same
// "bold, continuously orbiting" visual language drawStunStars() already
// uses for the cat's dazed stars, applied above a poop pile so the hazard
// reads as obvious at a glance rather than needing the player to notice a
// faint static squiggle. Reused a second time by drawYuckStink() (the
// poop-stun flavor of the cat's own dazed cue), centered on the cat's head
// instead of the pile — the pile's own call runs for as long as it exists
// (not gated to catPaused the way the cat's use of it is).
const STINK_LINE_COUNT = 3;
const BASE_STINK_ORBIT_RADIUS_X = 20;
const STINK_ORBIT_RADIUS_Y_RATIO = 0.5;
const STINK_ORBIT_PERIOD = 1400; // ms per full revolution

// How long the player-controlled mouse has to go without a movement key
// held before "not pressing a key this tick" (movePlayerMouse()'s escape-
// check trigger) counts as an actual stop, rather than just the brief gap
// between two taps of the same key. Reported live as still escaping by
// "just running by" even after the fix requiring the check to run only
// while idle — a *held* key never produces idle ticks in between (the
// browser doesn't glitch a genuinely-held key's state), but *tapping* the
// same direction repeatedly does, momentarily releasing it between each
// tap, and kids mashing an arrow key is a completely normal way to play.
// Without a debounce, every one of those tap-gaps was itself a "the player
// stopped" tick, so tapping along a wall could escape the same way holding
// used to. 150ms is long enough to clear a fast tap's release gap while
// still feeling instant for an actual stop.
const MOUSE_STOP_DEBOUNCE_MS = 150;

// Mouse-controlled mode: the cat becomes an autonomous chaser (see
// updateCatAI()). When it can't see the mouse it actively searches — moving
// continuously every tick in a chosen direction (respecting bounds/
// furniture via tryMoveCat()), rather than Dog.js's leisurely once-every-
// few-seconds hop, since a cat "searching" for the mouse should read as
// purposeful movement, not a background wander. CAT_WANDER_DIRECTION_INTERVAL
// governs how often it *changes* direction while doing so — see wanderCat().
const CAT_WANDER_DIRECTION_INTERVAL = 1200; // ms between random direction changes
// Only wall-mounted pieces occlude the cat's line of sight to the mouse —
// freestanding furniture (table/chair) never blocks it. See
// catHasLineOfSightToMouse().
const WALL_FURNITURE_TYPES = ['cabinet', 'sink', 'stove', 'fridge'];
// Furniture types that don't block movement — see tryMoveCat()/tryMoveDog()
// below. Two separate lists, not one shared list, because the cart/shelf
// need to behave differently per entity: passable for the cat (and the
// mouse, which already ignores all furniture unconditionally — see
// Mouse.js) but a real obstacle for the dog. The plant stays passable for
// both, as before. This is why this needs its own opt-out list(s) rather
// than reusing WALL_FURNITURE_TYPES (that one's about line-of-sight
// occlusion, a separate concern — a freestanding table/chair already
// doesn't block sight, but does still block movement, the opposite of what
// the plant/cart/shelf need for movement). The shelf originally shipped as
// a normal fully-blocking obstacle (see Kitchen furniture point 10 in
// CLAUDE.md) — moved into this list on request shortly after, so it now
// matches the cart's own passable-for-cat/blocking-for-dog behavior rather
// than staying fully solid. 'table' joined this list on request ("make the
// table passable for the cat with a shake animation") — same cat-only
// split as cart/shelf (not added to DOG_NON_BLOCKING_FURNITURE_TYPES: the
// dog still collides with it normally), paired with a shake reaction
// (Furniture.startShake(), see updateTableBump() below) rather than the
// plant's knock-over, since a dining table shouldn't visibly tip over the
// way a small potted plant does.
const CAT_NON_BLOCKING_FURNITURE_TYPES = ['plant', 'cart', 'shelf', 'table'];
const DOG_NON_BLOCKING_FURNITURE_TYPES = ['plant'];
// Multiplier on top of the cat's normal speed while wandering blind (no
// line of sight to the mouse) — not a BASE_* pixel value since it's a ratio
// applied to the already-scaled this.cat.speed, so it stays proportionate
// at any canvas size without its own layout entry.
//
// NOTE: until a since-fixed bug, this multiplier never actually reached
// real movement — tryMoveCat() validated a position at the boosted speed
// but Cat.move() silently ignored the override and always moved by its own
// fixed this.speed. So every earlier tuning pass (1.5, then 1.15, then 1.0)
// was tuning a value that had no real effect on movement distance; the
// "too fast" feel back then came entirely from wandering moving every tick
// instead of once every 2 seconds (see CAT_WANDER_DIRECTION_INTERVAL) and,
// after later fixes, from the AI no longer stalling behind furniture and
// spotting the mouse more reliably. Now that Cat.move() actually honors the
// passed-in speed, this constant has a real, working effect for the first
// time — set below 1.0 to make wandering genuinely slower than the chase
// (a deliberate "cautious search, fast pounce" feel), 1.0 for parity, above
// 1.0 for a more urgent search. Tuned by eye — adjust if it feels off.
const CAT_WANDER_SPEED_MULTIPLIER = 0.5;

const BASE_PUNCH_DISTANCE = 40;
const PUNCH_SHOCKWAVE_DURATION = 200; // ms
const BASE_PUNCH_SHOCKWAVE_MAX_RADIUS = 60;
// Cat's "Bigger Punch Knockback" perk (store slug 'punch-knockback') -
// applied in handlePunch() only when controlledEntity === 'cat', since
// this is Cat's own wallet-gated purchase (see this.ownedPerkSlugs in
// init()); punch is also usable in Mouse mode (see handlePunch()'s own
// comment) but Poop never inherits an upgrade Mia paid for.
const PUNCH_KNOCKBACK_PERK_MULTIPLIER = 1.5;

// Toot's little wind/fart puff — purely cosmetic (unlike the shove
// distance above, nothing here affects gameplay), triggered from
// handleToot() alongside the actual dog-shove mechanic and gated behind
// the same "not playing as the dog" check for consistency with how
// handlePunch()'s shockwave already behaves. Longer-lived than the punch
// shockwave (500ms vs 200ms) since a little puff of gas drifting and
// fading reads better slower than the punch's snappy ring.
const TOOT_EFFECT_DURATION = 500; // ms — a duration, not a size, doesn't scale
const BASE_TOOT_EFFECT_MAX_DRIFT = 32; // how far the puff drifts from the cat over its lifetime
const BASE_TOOT_EFFECT_MAX_RADIUS = 18; // each puff circle's radius at full growth — bumped up from an initial 12, which read as too subtle live
// Which way the puff drifts is always opposite the cat's own facing
// direction (Cat.facingDirection) — it comes out its *back*, not wherever
// it happens to be pointed.
const TOOT_EFFECT_DIRECTIONS = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
};

// "Dummy caught Mia!" stun effect — an impact burst (adapted from
// drawShockwave()'s expanding-ring technique, but a spiky "POW" starburst
// instead of a plain ring, and warm amber/orange instead of punch's purple
// so the two moments don't read as the same effect) fired once, timed to
// the collision itself, plus a few "seeing stars" sparkles orbiting the
// cat's head for the whole DOG_PAUSE_DURATION. Replaces the old flat,
// static red silhouette outline (formerly drawRedOutline()/
// getCatOutlineFrame(), removed) with a cohesive "impact, then daze"
// language instead of one unchanging shape sitting there for the full 2
// seconds — see CLAUDE.md's Planned work history for this moment.
const DOG_COLLISION_BURST_DURATION = 400; // ms — quick, timed to the hit itself, not the whole pause
const BASE_DOG_COLLISION_BURST_MAX_RADIUS = 70;
const DOG_COLLISION_STAR_COUNT = 4;
// Orbit is an ellipse, not a circle — flattened vertically so the stars
// read as circling the head from a mostly-front view rather than a flat
// halo ring floating above it.
const BASE_DOG_COLLISION_STAR_ORBIT_RADIUS_X = 36;
const DOG_COLLISION_STAR_ORBIT_RADIUS_Y_RATIO = 0.4;
const DOG_COLLISION_STAR_ORBIT_PERIOD = 1100; // ms per full revolution
const BASE_DOG_COLLISION_STAR_SIZE = 9;

// How long the pause message takes to pop/scale in once the dog actually
// connects — same ease-out-cubic scale+fade pattern as
// displayGameOverModal()'s MODAL_POP_IN_DURATION, kept as its own constant
// since it's a different moment (this fires mid-round, over a live board,
// not at game-over).
const DOG_COLLISION_MESSAGE_POP_IN_DURATION = 250; // ms
// Still used by the transient (non-game-over) "Dummy caught Mia!" pause
// message — an overlay on the live board is fine there since gameplay is
// still visibly running/paused underneath (see displayMessage()'s own
// comment). The actual game-over screen uses the modal below instead (see
// displayGameOverModal()). Bumped from 24 on request ("more obvious") —
// paired with the bold stroke/shadow displayMessage() now draws with.
const BASE_MESSAGE_FONT_SIZE = 36;
const BASE_MESSAGE_Y_OFFSET = 80;

// Game-over modal (see displayGameOverModal()) — a proper overlay with a
// dimming scrim and a card, replacing plain text drawn directly on top of
// the live board, which was sometimes hard to read depending on what was
// underneath it. UI chrome, so sized with uiScale like the rest of this
// section rather than the in-game scale.
// Bumped up a notch across the board (was 420x280) per explicit "make it
// bigger" request — the modal is the single most important thing on
// screen at the moment it's shown, and the old size read as timid next to
// a full-canvas dimming scrim.
const BASE_MODAL_WIDTH = 480;
const BASE_MODAL_HEIGHT = 320;
const BASE_MODAL_RADIUS = 26;
const BASE_MODAL_TITLE_FONT_SIZE = 58;
const BASE_MODAL_SUBTITLE_FONT_SIZE = 25;
const BASE_MODAL_BUTTON_WIDTH = 220;
const BASE_MODAL_BUTTON_HEIGHT = 66;
const BASE_MODAL_BUTTON_RADIUS = 18;
const BASE_MODAL_BUTTON_FONT_SIZE = 26;
// Extra room the modal grows by to fit the "here's what you earned"
// rewards section (see endGame()'s roundRewardBreakdown, displayGameOverModal()'s
// drawRewardsBreakdown()) - only added when that section will actually be
// shown (this.roundRewardBreakdown truthy, i.e. the wallet loaded
// successfully at round start). This is a fixed reservation, decided once
// synchronously in endGame() before submitRound() resolves, not
// recomputed once real numbers arrive - see roundRewardBreakdown's own
// comment for why that matters (no layout jump between the 'pending'
// placeholder and the real breakdown). Shrunk from 130 once
// drawRewardsBreakdown() moved to a single row (coins left, level-up/XP
// right) instead of stacking up to three lines - a single row needs much
// less reserved height.
const BASE_MODAL_REWARDS_EXTRA_HEIGHT = 78;
const BASE_MODAL_REWARDS_TITLE_FONT_SIZE = 24;
const BASE_MODAL_REWARDS_LINE_FONT_SIZE = 16;
// How long the modal takes to pop/scale in once the round ends — a
// duration, not a size, so this doesn't scale with canvas size (same
// reasoning as DOG_PAUSE_DURATION below).
const MODAL_POP_IN_DURATION = 250; // ms

// Absolute pixel floors for the modal's own size/text, applied on top of
// the BASE_MODAL_* * uiScale numbers above in computeLayout() — uiScale
// alone (a pure fraction of canvas *width*) tracks a normal mobile canvas
// fine, but a narrow desktop browser window can push uiScale low enough
// that the computed numbers stop being legible ("hard to read on some
// sizes" — confirmed live). Same fixed-minimum-plus-computed shape
// Cutscene.js already uses for its own pop-in text. modalWidth/modalHeight
// get the same floor treatment so the card is actually big enough to hold
// text drawn at its own floor size, not just the text alone.
const MIN_MODAL_WIDTH = 320;
const MIN_MODAL_HEIGHT = 240;
const MIN_MODAL_TITLE_FONT_SIZE = 32;
const MIN_MODAL_SUBTITLE_FONT_SIZE = 17;
const MIN_MODAL_BUTTON_WIDTH = 170;
const MIN_MODAL_BUTTON_HEIGHT = 50;
const MIN_MODAL_BUTTON_FONT_SIZE = 18;
const MIN_MODAL_REWARDS_EXTRA_HEIGHT = 60;
const MIN_MODAL_REWARDS_TITLE_FONT_SIZE = 17;
const MIN_MODAL_REWARDS_LINE_FONT_SIZE = 13;

// Frames the modal in whichever character's ears the player is actually
// controlling this round (this.controlledEntity) — same shapes and same
// "outer card silhouette plus a two-tone inner accent" convention
// CharacterSelectScreen's own EAR_SHAPES map already uses for its cards,
// echoing the pick made there rather than the modal defaulting to one
// specific animal regardless of who's playing.
const MODAL_EAR_SHAPES = {
  cat: { card: drawCatEarCard, inner: drawCatEarInner },
  mouse: { card: drawMouseEarCard, inner: drawMouseEarInner },
  dog: { card: drawDogEarCard, inner: drawDogEarInner },
};
// Same flat pale-pink inner-ear accent CharacterSelectScreen's cards use
// regardless of the card's own color — real ears are two-toned, and using
// one shared accent color keeps that read consistent between the two
// screens instead of retuning it per palette.
const MODAL_EAR_INNER_COLOR = '#ffd7d0';

const BASE_FLOOR_TILE_SIZE = 24;

// Coin/level/XP HUD (see drawHud()) - top-center, wide, live during
// gameplay only (skipped entirely when this.wallet is null, i.e. never
// logged in - see fetchWallet()). UI chrome, sized with uiScale like the
// rest of this section. Redesigned per explicit direction from the
// original narrow top-left box: centered instead of corner-anchored,
// wider so all wallet stats (coins/level/XP) read as their own
// icon+value chip across one row rather than stacked coins-then-level
// rows, each with a hover tooltip explaining the metric (see
// getHudLayout()/drawHudTooltip()).
const BASE_HUD_MARGIN = 16;
const BASE_HUD_PADDING = 14;
const BASE_HUD_WIDTH = 440;
const BASE_HUD_STAT_ROW_HEIGHT = 32;
const BASE_HUD_RADIUS = 18;
const BASE_HUD_FONT_SIZE = 19;
const BASE_HUD_XP_BAR_HEIGHT = 7;
// Hover tooltip shown over a stat chip - see drawHudTooltip(). Bumped
// 15 -> 21 (title) per explicit "too small" feedback. BASE_HUD_TOOLTIP_
// MAX_WIDTH is a wrap threshold, not a fixed box size - drawHudTooltip()
// also clamps it against a fraction of the live canvas width, so the box
// actually gets *narrower* (wrapping the description onto more lines,
// same font size) on a small mobile canvas rather than either overflowing
// past the screen edge or shrinking its text to fit - that's the
// "responsive" part of the fix, not just a bigger static number.
const BASE_HUD_TOOLTIP_FONT_SIZE = 21;
const BASE_HUD_TOOLTIP_PADDING = 14;
const BASE_HUD_TOOLTIP_MAX_WIDTH = 260;

// One entry per HUD stat chip, in display order - shared by drawHud()
// (what to render) and getHudLayout()'s stat-count math, so adding a
// future wallet stat (e.g. a premium currency) is one entry here rather
// than touching the row-layout math in two places.
const HUD_STATS = [
  {
    key: 'coins',
    emoji: '\u{1FA99}', // 🪙
    label: 'Coins',
    description: 'Spend at the Store to unlock perks & outfits.',
    getText: (wallet) => `${wallet.coins}`,
  },
  {
    key: 'level',
    emoji: '⭐', // ⭐
    label: 'Level',
    description: 'Levels unlock new Store items.',
    getText: (wallet) => `Lvl ${wallet.level}`,
  },
  {
    key: 'xp',
    emoji: '✨', // ✨
    label: 'XP',
    description: 'Fill the bar to reach the next level.',
    getText: (wallet) => `${wallet.xp}${wallet.xp_to_next_level ? `/${wallet.xp_to_next_level}` : ''}`,
  },
];

// Store button - a floating circular "FAB" pinned to the canvas's top-right
// corner, deliberately independent of the HUD box's own position/width (see
// drawStoreButton()) rather than tucked just below it. storeButtonMargin is
// the gap beyond the wall band, not from the raw canvas edge - drawStoreButton()
// adds this.layout.wallBandThickness on top of it so the button always
// clears the wall regardless of world scale.
const BASE_STORE_BUTTON_SIZE = 56;
const BASE_STORE_BUTTON_MARGIN = 22;
const BASE_STORE_BUTTON_ICON_SIZE = 26;
const BASE_STORE_BUTTON_LABEL_FONT_SIZE = 12;

// Rough approximations of the cat/mouse/dog's on-screen size, used only to
// keep the freestanding dining set and furniture placement clear of where
// they'll spawn — generateKitchenFurniture() runs before those instances
// exist (see resetGameObjects()), so it can't ask them for their real size.
// Must stay in the same ballpark as Cat.js/Mouse.js/Dog.js's own base sizes.
const BASE_CAT_SIZE = 39;
const BASE_MOUSE_SIZE = 32;
const BASE_DOG_SIZE = 50;

// Dog poop pile footprint — a squat blob (wider than tall), sized roughly
// like the mouse-hole escapes (BASE_ESCAPE_SIZE) so it reads as a real,
// visible-at-a-glance hazard rather than a tiny speck, without being as
// large as a character.
const BASE_POOP_WIDTH = 34;
const BASE_POOP_HEIGHT = 26;

// In-gameplay "doobers" (this game's term for a collectible drop,
// borrowed from FrontierVille) — spawn on the board during a round,
// separate from the round-completion coin reward (see
// GameScreen.endGame()/kpground-api's submit_round). Collected by
// whichever character the player controls, regardless of mode -
// autonomous entities never pick these up, only the human-driven one
// (see updateDoobers()). Every number below is independently tunable per
// explicit direction - none of these are coupled to each other in code,
// so any one can change without touching the others.
const MAX_ACTIVE_DOOBERS = 1; // on the board at once
const DOOBER_CATCH_DURATION = 10000; // ms a doober stays before vanishing uncaught
const DOOBER_SPAWN_INTERVAL = 7000; // ms after one disappears before the next can appear - a real minimum gap, see updateDoobers()
const BASE_DOOBER_SIZE = 32.5; // footprint of the whole doober, not one coin
// Drop-in animation: falls from DOOBER_DROP_HEIGHT above its resting spot
// down to rest over DOOBER_DROP_DURATION, with a little bounce on landing
// (see drawDoober()'s easeOutBounce) - not just fading/popping into place.
const DOOBER_DROP_DURATION = 350; // ms
const DOOBER_DROP_HEIGHT = 60; // px above rest position it falls from
// Gentle idle bob once landed (visual only, not collision-relevant) so a
// waiting doober still reads as "alive"/collectible rather than a flat decal.
const DOOBER_BOB_AMPLITUDE = 3; // px
const DOOBER_BOB_PERIOD = 900; // ms per full cycle
// A big glowing arrow points down at every doober once it's landed,
// regardless of type - the signature "look here!" visual FrontierVille's
// own doobers use (modeled directly off a reference screenshot). Drawn
// by the shared drawDoober(), on top of whatever DOOBER_TYPES[type].draw()
// rendered, so every future doober type gets this for free. Bobs on its
// own schedule (independent of the doober's own idle bob) so it reads as
// actively beckoning rather than static.
const DOOBER_ARROW_GAP = 6; // px between the arrow's tip and the doober's top
const DOOBER_ARROW_BOB_AMPLITUDE = 5; // px
const DOOBER_ARROW_BOB_PERIOD = 700; // ms per full cycle - quicker than the doober's own bob

// Per explicit direction, the arrow is a one-time teaching cue per
// doober type, not a permanent decoration - once a player has seen a
// coin doober's arrow, later coin doobers don't need to keep pointing it
// out. Module-level (not a GameScreen instance field) so it survives
// "Play Again" (a fresh GameScreen each round) the same way audio.js's
// mute flags do - only an actual page reload resets it. spawnDoober()
// decides per-spawn whether *this* doober gets the arrow (recorded on
// the doober itself as .showArrow) rather than drawDoober() deciding
// live every frame, so the choice is made once and stays stable for
// that doober's whole lifetime.
const dooberArrowShownForType = new Set();

// "+N" flies from a collected doober's position to the HUD's coin
// readout (see getHudCoinTargetPosition()) over DOOBER_POPUP_DURATION,
// shrinking/fading in over the final stretch as if being pulled in
// rather than just stopping. The coin count itself only actually
// increments once the popup arrives (see updateDooberPopups()), not the
// instant the doober is grabbed, so the number visibly ticks up in sync
// with the flight landing rather than jumping ahead of it.
const DOOBER_POPUP_DURATION = 700; // ms
// Bumped 22 -> 38 plus a stronger outline/glow per explicit "bigger and
// readable" feedback - the original size read as a small, easy-to-miss
// flick against a busy kitchen board.
const BASE_DOOBER_POPUP_FONT_SIZE = 38;

// A quick "crash" burst at the HUD's coin readout the instant a popup's
// flight actually lands there (see updateDooberPopups()/
// spawnHudCoinImpact()) - per explicit request that coins hitting the HUD
// should feel like an impact, not just a silent number change. Same
// expanding-ring technique as drawShockwave() (punch)/drawStunBurst() (dog
// collision), recolored gold to match the coin itself, plus a few short
// radiating spark lines for a "crash" flourish those two don't have -
// distinct enough from both that this doesn't read as a recolor of an
// existing effect.
const HUD_COIN_IMPACT_DURATION = 420; // ms
const BASE_HUD_COIN_IMPACT_MAX_RADIUS = 34;
const HUD_COIN_IMPACT_SPARK_COUNT = 6;
const BASE_HUD_COIN_IMPACT_SPARK_LENGTH = 16;

// Coins are the only doober type today, but this project explicitly
// wants the system ready for other, non-coin doober types later - so
// every doober carries a `type`, and everything type-specific (what it
// looks like, what collecting it does) is isolated to one entry here
// rather than baked into spawn/expire/collision, which stay generic. A
// future type is: add an entry, add its own draw*DooberContent() method,
// done - no changes to spawnDoober()/updateDoobers()/drawDoober().
const DOOBER_COIN_VALUE = 1; // coins credited per coin-doober collected
// How big the real coin-stack image (drawCoinDooberContent()) draws
// relative to the doober's own footprint - tuned by eye against the
// source art's own internal proportions, not derived from baseRadius.
const DOOBER_COIN_IMAGE_SCALE = 1.5;
const DOOBER_TYPES = {
  coin: {
    draw: (screen, centerX, centerY, baseRadius) =>
      screen.drawCoinDooberContent(centerX, centerY, baseRadius),
    onCollect: (screen) => {
      screen.coinsCollectedThisRound += DOOBER_COIN_VALUE;
      playDooberSound();
      return DOOBER_COIN_VALUE;
    },
  },
};
// Which type spawns - a plain pool for now (only 'coin' exists), picked
// at random each spawn so adding a second type is just adding it here;
// a weighted pool is the natural next step once some types should be
// rarer than others.
const DOOBER_SPAWNABLE_TYPES = ['coin'];

// Wall clearance must cover the tallest thing placed on that wall, plus the
// wall band itself — every module's back is flush against the wall band's
// front face (see makeModule()/buildWallVertical() below), so the interior
// boundary is the wall band plus whichever piece reaches furthest into the
// room. Unlike the previous asset set (where the fridge was clearly the
// tallest single piece, so clearance was hardcoded off it), this set's
// fridge/sink/stove are all roughly the same height — so clearance is
// computed generically as the max scaled height among whatever's actually
// placed on each wall, rather than assuming any one piece is always
// tallest. This is what keeps cat/dog spawn points clear of furniture
// collision boxes (the same class of stuck-spawn bug hit twice already in
// this project's history — see CLAUDE.md).
//
// Everything here is a function of the canvas's scale factor (see
// js/utils/scale.js) rather than a bare module constant, so it can be
// recomputed against the actual canvas size — see the Mobile responsiveness
// note at the top of this section.
function computeLayout(canvasWidth) {
  const scale = getScale(canvasWidth);
  // Buttons/messages (play-again button, win/lose text) use their own
  // mobile multiplier — allowed to stay a little bigger than in-game assets
  // rather than following the same reduction. See js/utils/scale.js.
  const uiScale = getUIScale(canvasWidth);
  // Furniture only (not characters, walls, or anything else here) uses its
  // own scale — see getFurnitureScale() in js/utils/scale.js for why:
  // desktop furniture needed to be restored to roughly its pre-asset-swap
  // size independent of mobile's already-tuned sizing.
  const furnitureScale = getFurnitureScale(canvasWidth);
  const moduleScale = BASE_MODULE_SCALE * furnitureScale;
  // Character on-screen/collision size only — see getCharacterScale() in
  // js/utils/scale.js for why this is split from `scale` (which still
  // drives Cat/Dog/Mouse movement speed, unaffected by this).
  const characterScale = getCharacterScale(canvasWidth);
  const wallBandThickness = BASE_WALL_BAND_THICKNESS * scale;

  // FRIDGE_SPEC.height is folded into all four of these, not just the top
  // wall's — the fridge used to always land on the top wall, but it can now
  // land on any of the 4 walls (see generateKitchenFurniture()'s
  // `fridgeWall`), and this layout is computed before that per-reset random
  // pick happens. Every wall zone has to be deep enough to hold the fridge
  // in case it's the one that gets picked, same "not hardcoded off any one
  // piece" reasoning already applied here for the modules themselves.
  // MODULE_SCALE_MULTIPLIERS[type] (defaulting to 1 for types without one,
  // e.g. sink/stove) converts each type's raw native height into the same
  // "effective, pre-moduleScale" units FRIDGE_SPEC.height is already in —
  // cabinet's own new art (see FURNITURE_SPRITES.CABINET) is a much bigger
  // native capture than its predecessor, scaled back down at draw time via
  // this same multiplier, so this reservation math has to apply it too or
  // it reserves ~1.85x more wall depth than cabinet actually occupies on
  // screen — confirmed live as a severe bug, not a minor one: the resulting
  // over-reservation starved the interior playable area badly enough to
  // cascade into widespread furniture overlaps and off-canvas placements
  // (642 overlaps / 487 off-canvas out of 500 sampled layouts) even though
  // cabinet's own rendering and the fridge-fit width math were both already
  // correctly scaled by this point — this was the one remaining place still
  // reading MODULE_SPECS[type].height raw.
  const topWallHeight = wallBandThickness + Math.ceil(Math.max(
    ...TOP_WALL_ORDER.map(type => MODULE_SPECS[type].height * (MODULE_SCALE_MULTIPLIERS[type] || 1)),
    FRIDGE_SPEC.height * FRIDGE_SCALE_MULTIPLIER
  ) * moduleScale);
  const bottomWallHeight = wallBandThickness + Math.ceil(Math.max(
    ...BOTTOM_WALL_ORDER.map(type => MODULE_SPECS[type].height * (MODULE_SCALE_MULTIPLIERS[type] || 1)),
    FRIDGE_SPEC.height * FRIDGE_SCALE_MULTIPLIER
  ) * moduleScale);
  // Left/right wall "width" is the wall band plus the rotated depth into
  // the room — rotation swaps the axes, so a rotated module's depth is its
  // native *height* times scale (see Furniture.js), not its native width.
  const leftWallWidth = wallBandThickness + Math.ceil(Math.max(
    ...LEFT_WALL_ORDER.map(type => MODULE_SPECS[type].height * (MODULE_SCALE_MULTIPLIERS[type] || 1)),
    FRIDGE_SPEC.height * FRIDGE_SCALE_MULTIPLIER
  ) * moduleScale);
  const rightWallWidth = wallBandThickness + Math.ceil(Math.max(
    ...RIGHT_WALL_ORDER.map(type => MODULE_SPECS[type].height * (MODULE_SCALE_MULTIPLIERS[type] || 1)),
    FRIDGE_SPEC.height * FRIDGE_SCALE_MULTIPLIER
  ) * moduleScale);

  // Game-over modal geometry, floored (see MIN_MODAL_* above) and then
  // capped against the actual canvas so a floor kicking in on a tiny
  // canvas can never push the card past its edges. Canvas height isn't a
  // parameter here, but main.js's resizeCanvas() always locks it to a
  // fixed 4:3 ratio off canvasWidth, so it's safe to derive rather than
  // thread through as its own argument.
  const canvasHeightApprox = canvasWidth * (3 / 4);
  const modalWidth = Math.min(Math.max(BASE_MODAL_WIDTH * uiScale, MIN_MODAL_WIDTH), canvasWidth * 0.94);
  const modalRewardsExtraHeight = Math.max(BASE_MODAL_REWARDS_EXTRA_HEIGHT * uiScale, MIN_MODAL_REWARDS_EXTRA_HEIGHT);
  // The card can grow again on top of modalHeight to fit the rewards
  // section (see displayGameOverModal()) — reserve room for that worst
  // case up front so the floored/capped base height plus that extra can
  // never together exceed the canvas, even though whether rewards will
  // actually show isn't known yet at layout time.
  // Capped a bit short of the canvas (0.84, not 0.92) to leave headroom
  // above the card for the ears drawn poking up past its own top edge
  // (see MODAL_EAR_SHAPES/displayGameOverModal()) — they can peak roughly
  // 20% of modalHeight above modalY, the same proportion
  // CharacterSelectScreen's own cards use.
  const modalHeight = Math.min(
    Math.max(BASE_MODAL_HEIGHT * uiScale, MIN_MODAL_HEIGHT),
    canvasHeightApprox * 0.84 - modalRewardsExtraHeight
  );

  return {
    scale,
    characterScale,
    moduleScale,
    diningScale: moduleScale,
    wallBandThickness,
    escapeSize: BASE_ESCAPE_SIZE * scale,
    escapeHitboxMargin: BASE_ESCAPE_HITBOX_MARGIN * scale,
    wallOffset: BASE_WALL_OFFSET * scale,
    mousePlayerSpeed: BASE_MOUSE_PLAYER_SPEED * scale,
    dogPlayerSpeed: BASE_DOG_PLAYER_SPEED * scale,
    spawnClearance: BASE_SPAWN_CLEARANCE * scale,
    minSpawnSeparation: BASE_MIN_SPAWN_SEPARATION * scale,
    escapeDangerDistance: BASE_ESCAPE_DANGER_DISTANCE * scale,
    escapeWarningDistance: BASE_ESCAPE_WARNING_DISTANCE * scale,
    punchDistance: BASE_PUNCH_DISTANCE * scale,
    punchShockwaveMaxRadius: BASE_PUNCH_SHOCKWAVE_MAX_RADIUS * scale,
    tootEffectMaxDrift: BASE_TOOT_EFFECT_MAX_DRIFT * scale,
    tootEffectMaxRadius: BASE_TOOT_EFFECT_MAX_RADIUS * scale,
    dogCollisionBurstMaxRadius: BASE_DOG_COLLISION_BURST_MAX_RADIUS * scale,
    dogCollisionStarOrbitRadiusX: BASE_DOG_COLLISION_STAR_ORBIT_RADIUS_X * scale,
    dogCollisionStarSize: BASE_DOG_COLLISION_STAR_SIZE * scale,
    messageFontSize: BASE_MESSAGE_FONT_SIZE * uiScale,
    messageYOffset: BASE_MESSAGE_Y_OFFSET * uiScale,
    modalWidth,
    modalHeight,
    modalRewardsExtraHeight,
    modalRewardsTitleFontSize: Math.max(BASE_MODAL_REWARDS_TITLE_FONT_SIZE * uiScale, MIN_MODAL_REWARDS_TITLE_FONT_SIZE),
    modalRewardsLineFontSize: Math.max(BASE_MODAL_REWARDS_LINE_FONT_SIZE * uiScale, MIN_MODAL_REWARDS_LINE_FONT_SIZE),
    modalRadius: BASE_MODAL_RADIUS * uiScale,
    modalTitleFontSize: Math.max(BASE_MODAL_TITLE_FONT_SIZE * uiScale, MIN_MODAL_TITLE_FONT_SIZE),
    modalSubtitleFontSize: Math.max(BASE_MODAL_SUBTITLE_FONT_SIZE * uiScale, MIN_MODAL_SUBTITLE_FONT_SIZE),
    modalButtonWidth: Math.max(BASE_MODAL_BUTTON_WIDTH * uiScale, MIN_MODAL_BUTTON_WIDTH),
    modalButtonHeight: Math.max(BASE_MODAL_BUTTON_HEIGHT * uiScale, MIN_MODAL_BUTTON_HEIGHT),
    modalButtonRadius: BASE_MODAL_BUTTON_RADIUS * uiScale,
    modalButtonFontSize: Math.max(BASE_MODAL_BUTTON_FONT_SIZE * uiScale, MIN_MODAL_BUTTON_FONT_SIZE),
    floorTileSize: BASE_FLOOR_TILE_SIZE * scale,
    hudMargin: BASE_HUD_MARGIN * uiScale,
    hudPadding: BASE_HUD_PADDING * uiScale,
    hudWidth: BASE_HUD_WIDTH * uiScale,
    hudStatRowHeight: BASE_HUD_STAT_ROW_HEIGHT * uiScale,
    hudRadius: BASE_HUD_RADIUS * uiScale,
    hudFontSize: BASE_HUD_FONT_SIZE * uiScale,
    hudXpBarHeight: BASE_HUD_XP_BAR_HEIGHT * uiScale,
    hudTooltipFontSize: BASE_HUD_TOOLTIP_FONT_SIZE * uiScale,
    hudTooltipPadding: BASE_HUD_TOOLTIP_PADDING * uiScale,
    hudTooltipMaxWidth: BASE_HUD_TOOLTIP_MAX_WIDTH * uiScale,
    dooberPopupFontSize: BASE_DOOBER_POPUP_FONT_SIZE * uiScale,
    hudCoinImpactMaxRadius: BASE_HUD_COIN_IMPACT_MAX_RADIUS * uiScale,
    hudCoinImpactSparkLength: BASE_HUD_COIN_IMPACT_SPARK_LENGTH * uiScale,
    storeButtonSize: BASE_STORE_BUTTON_SIZE * uiScale,
    storeButtonMargin: BASE_STORE_BUTTON_MARGIN * uiScale,
    storeButtonIconSize: BASE_STORE_BUTTON_ICON_SIZE * uiScale,
    storeButtonLabelFontSize: BASE_STORE_BUTTON_LABEL_FONT_SIZE * uiScale,
    catSizeApprox: BASE_CAT_SIZE * characterScale,
    mouseSizeApprox: BASE_MOUSE_SIZE * characterScale,
    dogSizeApprox: BASE_DOG_SIZE * characterScale,
    poopWidth: BASE_POOP_WIDTH * scale,
    poopHeight: BASE_POOP_HEIGHT * scale,
    dooberSize: BASE_DOOBER_SIZE * scale,
    stinkOrbitRadiusX: BASE_STINK_ORBIT_RADIUS_X * scale,
    topWallHeight,
    bottomWallHeight,
    leftWallWidth,
    rightWallWidth,
  };
}

const COLORS = {
  // A warm greige band (see drawWalls()) — distinct enough from the near-
  // white floor to read as a separate surface, and from the cream/tan
  // furniture so counters/fridge/table still stand out against it.
  WALL_FILL: '#e4ddcf',
  WALL_TRIM: '#b9ae98',
  // Transient (non-game-over) pause message only — see BASE_MESSAGE_FONT_SIZE
  // above. A flat purple fillText (the very first version of this) read as
  // amateurish and hard to read live — floating text with no backdrop gets
  // lost against whatever happens to be drawn on the board behind it (a
  // light floor tile, dark furniture, a character). displayMessage() now
  // draws a small pill-shaped banner (this project's purple, matching the
  // punch shockwave/settings-menu accent) behind white text with a dark
  // stroke — the same "colored card + white outlined text" formula
  // displayGameOverModal() already uses, just as a lightweight overlay
  // banner rather than a full scrim-and-card modal.
  MESSAGE: {
    TEXT_FILL: '#ffffff',
    TEXT_STROKE: 'rgba(0, 0, 0, 0.5)',
    BANNER_GRADIENT_START: '#9b6fe0',
    BANNER_GRADIENT_END: '#5b2fa6',
    BANNER_BORDER: 'rgba(255, 255, 255, 0.85)',
  },
  // Game-over modal (see displayGameOverModal()) — intentionally playful
  // either way (this is a kids' game), not somber on a loss: a warm gold
  // gradient for a win, a bright teal/blue gradient for a loss, rather than
  // switching to dark/muted tones.
  MODAL: {
    SCRIM: 'rgba(10, 8, 20, 0.6)',
    WIN_GRADIENT_START: '#ffe082',
    WIN_GRADIENT_END: '#ff8f00',
    LOSE_GRADIENT_START: '#4fc3f7',
    LOSE_GRADIENT_END: '#5c6bc0',
    BORDER: 'rgba(255, 255, 255, 0.85)',
    TITLE_FILL: '#ffffff',
    TITLE_STROKE: 'rgba(0, 0, 0, 0.45)',
    SUBTITLE: '#2b1d3d',
    BUTTON_BACKGROUND: '#ffffff',
    BUTTON_TEXT: '#2b1d3d',
    BUTTON_SHADOW: 'rgba(0, 0, 0, 0.25)',
  },
  // A small white/off-white two-tone tile look (see drawFloor()) — plain
  // and neutral rather than matched to the kitchen_*.png furniture's warm
  // cream/tan/honey-oak palette. Two earlier versions of this floor (large
  // warm-toned tiles with marble veining, then smaller but still warm/tan
  // tiles) were both tried and rejected live for blending into the
  // furniture instead of reading as floor beneath it — white/off-white
  // reads as a distinct, neutral surface regardless of what furniture
  // palette sits on top of it.
  FLOOR_LIGHT: '#ffffff',
  FLOOR_DARK: '#f9f8f4',
  FLOOR_GROUT: '#d9d5c9',
};

const SOUND_KEYS = {
  BACKGROUND: 'background',
  WALL_HIT: 'wallHit',
  CAT_CATCH: 'catCatch',
  MOUSE_ESCAPE: 'mouseEscape',
  TOOT: 'toot',
  PUNCH: 'punch',
  DOG_BARK: 'dogBark',
  CART_BUMP: 'cartBump',
  SHELF_BUMP: 'shelfBump',
  // Dedicated "gotcha!" cue for the dog-pauses-cat moment — layered on top
  // of DOG_BARK (already played by handleDogCollision()), not a
  // replacement for it, same pattern as playWinSound()/playLoseSound()
  // layering on top of endGame()'s own event sound rather than replacing
  // it. A supplied recording, not synthesized — see loadSounds() below.
  GOTCHA: 'gotcha',
  // Table shake bump — see updateTableBump() below. A supplied recording
  // (dishware clinking/rattling, not synthesized), same as GOTCHA/
  // CART_BUMP/SHELF_BUMP.
  TABLE_SHAKE: 'tableShake',
};

const MESSAGES = {
  DOG_CAUGHT: `${CHARACTER_NAMES.DOG} caught ${CHARACTER_NAMES.CAT}!`,
  CAT_CAUGHT_MOUSE: `${CHARACTER_NAMES.CAT} caught ${CHARACTER_NAMES.MOUSE}!`,
  MOUSE_ESCAPED: `${CHARACTER_NAMES.MOUSE} escaped!`,
  CAT_STUCK_IN_POOP: `${CHARACTER_NAMES.CAT} stepped in ${CHARACTER_NAMES.DOG}'s poop!`,
};

// ==============================
//  GAME SCREEN CLASS
// ==============================
export default class GameScreen {
  constructor(screenManager, canvas, ctx, controlledEntity = 'cat', skipCutscenes = false) {
    this.screenManager = screenManager;
    this.canvas = canvas;
    this.ctx = ctx;
    // 'cat' (default, original behavior), 'mouse', or 'dog' — which entity
    // reads player input; the other two run autonomously (the cat via AI
    // chase-or-wander, the other via its own passive behavior). See
    // moveCat()/updateCatAI(), updateMouse()/movePlayerMouse(), and
    // updateDog()/movePlayerDog() for where this branches.
    this.controlledEntity = controlledEntity;
    // True when this GameScreen was reached via "Play Again" (see
    // restartGame()/CharacterSelectScreen's own `isReplay`) — skips the
    // intro cutscenes in init() below, since re-watching "meet the
    // characters" every round (now that Play Again routes back through
    // character select) got old fast. Kept as its own GameScreen-level flag
    // rather than reusing CharacterSelectScreen's `isReplay` name directly,
    // since what it actually controls here is specifically the cutscenes,
    // not "is this a replay" in some broader sense.
    this.skipCutscenes = skipCutscenes;

    // Canvas size is fixed for the lifetime of a GameScreen (live-resize
    // mid-game is a known separate gap — see CLAUDE.md), so this is
    // computed once here rather than per-frame.
    this.layout = computeLayout(this.canvas.width);

    this.cat = null;
    this.mouse = null;
    this.dog = null;
    this.escapes = [];
    this.furniture = [];
    this.wallGap = null;
    // Active dog poop piles — see handleDogPoop()/updatePoops() below. In
    // practice never more than one at a time (handleDogPoop() no-ops while
    // one's already out there), but kept as an array rather than a single
    // nullable field so a future loosening of that one-at-a-time rule
    // wouldn't need a shape change here too.
    this.poops = [];

    // In-gameplay doobers (see updateDoobers()/spawnDoober() below) - kept
    // as an array even though MAX_ACTIVE_DOOBERS is 1 today, same reasoning
    // as this.poops above (a future change to that constant needs no shape
    // change here). lastDooberSpawnTime starts at 0 so the very first
    // update() tick's timestamp already exceeds DOOBER_SPAWN_INTERVAL,
    // spawning one immediately rather than making the player wait.
    this.doobers = [];
    this.coinsCollectedThisRound = 0;
    this.lastDooberSpawnTime = 0;
    // The 'coin' doober type's art (see drawCoinDooberContent()) - one
    // shared Image loaded once per GameScreen instance and reused for
    // every coin doober drawn, rather than a new Image() per spawn.
    this.dooberCoinImage = new Image();
    this.dooberCoinImage.src = './assets/doober_coin.png?v=1';
    // "+N" popups flying from a just-collected doober to the HUD (see
    // spawnDooberCollectPopup()/updateDooberPopups() below).
    this.dooberPopups = [];
    // "Crash" bursts fired the instant a popup above actually lands on the
    // HUD's coin readout (see spawnHudCoinImpact()) - kept as its own list
    // (not folded into dooberPopups) since an impact outlives the popup
    // that triggered it by HUD_COIN_IMPACT_DURATION.
    this.hudCoinImpacts = [];

    // Hit boxes for each HUD stat chip (rebuilt every drawHud() call) and
    // which one, if any, the mouse is currently over - see
    // handleMouseMove()/drawHudTooltip(). null/[] until the wallet loads
    // and drawHud() actually draws something to hover over.
    this.hudStatAreas = [];
    this.hoveredHudStatIndex = null;

    this.running = false;
    this.catPaused = false;
    this.pauseEndTime = 0;
    this.dogCollisionCooldown = 0;
    // performance.now() timestamp from whichever trigger last stunned the
    // cat — handleDogCollision() (the dog physically catching it) or
    // updatePoops() (stepping in a poop pile) — drives both the pause
    // message's pop-in (displayMessage()) and the stun burst/stars' timing
    // (drawStunBurst()/drawStunStars()), the same performance.now()-diff
    // pattern this.gameOverStartTime/this.shockwave already use elsewhere in
    // this file. Named for what it drives (the cat's stun), not either one
    // trigger, since both share this same field and the visuals it drives.
    this.catStunStartTime = 0;
    // Which trigger last stunned the cat — 'dog' (handleDogCollision()) or
    // 'poop' (updatePoops()) — read by drawStunBurst()/drawStunStars() to
    // pick which flavor of stun visual to draw (the amber POW burst/yellow
    // stars for a dog catch, vs. a brown splat/stink squiggles for a poop
    // pile), so the two causes read as visually distinct rather than the
    // same effect regardless of what actually happened. Meaningless while
    // catPaused is false, same as catStunStartTime above.
    this.catStunSource = null;
    this.gameOver = false;
    this.message = '';
    this.shockwave = null;
    this.tootEffect = null;
    // Whether the just-ended round was a win *for the player controlling
    // this.controlledEntity* — set by endGame(), read by
    // displayGameOverModal() to pick "You Win!"/"You Lose!" and the
    // gold-vs-teal color scheme. Meaningless while gameOver is false.
    this.gameOverIsWin = false;
    // performance.now() timestamp from endGame() — drives the modal's
    // pop-in animation (same performance.now()-diff pattern as
    // drawShockwave()'s this.shockwave.startTime).
    this.gameOverStartTime = 0;
    // True once the mouse has reached an escape hole (see
    // checkMouseEscaped()) — it then disappears rather than staying visible
    // sitting at/in the hole for the rest of the (now-ended) round. Applies
    // regardless of controlledEntity — the mouse escaping ends the round the
    // same way whether it was player- or AI-driven.
    this.mouseEscaped = false;
    // performance.now() timestamp of the last tick movePlayerMouse() saw a
    // movement key actually held — see MOUSE_STOP_DEBOUNCE_MS's own comment
    // for why the "has the player stopped" check needs this instead of
    // just reading whether a key happens to be held on this exact tick.
    this.mouseLastMovedAt = 0;
    // Edge-detection state for updatePlantBump() below — true whenever the
    // cat/dog was overlapping the plant as of last tick, so a bump only
    // (re)starts the knock-over on the tick contact begins, not every tick
    // of a continuous touch (which would restart the animation/sound every
    // single frame and read as a rapid buzz rather than one clean bump).
    this.plantWasHit = false;
    // Edge-detection state for updateShelfBump() below — same reasoning as
    // plantWasHit above (both the shake and the fire-and-forget sound are
    // one-shot per bump, not the continuously-driven play/pause/
    // currentTime model updateCartBump() uses for its own sound), just
    // for the shelf's own hit zone.
    this.shelfWasHit = false;
    // Edge-detection state for updateTableBump() below — same reasoning
    // as shelfWasHit above, just for the table's own hit zone.
    this.tableWasHit = false;
    // Edge-detection state for updateCartBump() below, but *only* for its
    // shake reaction — the cart's own bump sound already has its own
    // continuously-driven play/pause/currentTime model (see that method's
    // comment) that doesn't need edge-detection, but the shake should
    // still be a single fresh wobble per approach, not restart every tick
    // of continuous contact, so it needs this same pattern independently.
    this.cartWasHit = false;
    // True whenever tryMoveCat() actually moved the cat on the current
    // tick (reset to false at the top of update(), set from within
    // tryMoveCat() itself) — read by updateCartBump() below to decide
    // whether the cart-bump sound should be advancing this tick, per
    // explicit direction ("only advance sound if the cat is moving while
    // inside the hit zone"). Not the same thing as "a direction key is
    // held" — a cat pressed into a wall/furniture with nowhere to go isn't
    // actually moving even though input is held, and the AI-driven cat
    // (Mouse/Dog mode) has no "key held" concept at all, only tryMoveCat()'s
    // own return value.
    this.catMovedThisTick = false;
    // this.running's value at the moment the *first* pausing overlay
    // (settings menu or store modal - see pauseForOverlay()/
    // resumeForOverlay() below) opened, restored once every pausing
    // overlay has closed again, so closing one can never resume something
    // that was already stopped for another reason (cutscenes, game over)
    // just because an overlay also happened to be open at the time.
    this.wasRunningBeforeOverlay = null;
    // How many pausing overlays are currently open - a counter rather
    // than a boolean so two overlapping overlays (e.g. Escape closing the
    // store while the settings menu also happens to be open) can't let
    // the first one's close prematurely resume gameplay out from under
    // the second, still-open one.
    this.pausingOverlayCount = 0;

    this.sounds = this.loadSounds();
    this.playAgainButtonArea = null;
    // The controlled character's own wallet (coins/level/xp/xp_to_next_level)
    // - fetched once in init() if logged in, refreshed from submitRound()'s
    // and purchaseItem()'s own responses afterward rather than re-fetched.
    // Stays null (HUD/store button both skip drawing entirely) if never
    // logged in - see fetchWallet().
    this.wallet = null;
    // Snapshot of this.wallet's coins/xp/level the moment it first loads
    // (see init()'s getWallets().then()) - endGame()'s reward breakdown
    // diffs against this. this.roundRewardBreakdown itself (see endGame())
    // is what displayGameOverModal() actually reads to draw the "here's
    // everything you earned" section; null means "don't show that section
    // at all" (never logged in, or the round hasn't ended yet).
    this.walletAtRoundStart = null;
    this.roundRewardBreakdown = null;
    this.storeButtonArea = null;
    // Perk slugs the *controlled* character's wallet owns (see init()'s
    // getStore() fetch) - stays empty (every perk check below just no-ops)
    // if never logged in or the fetch fails, same degrade-gracefully shape
    // as this.wallet. Perks only ever apply to the character whose wallet
    // paid for them - see PUNCH_KNOCKBACK_PERK_MULTIPLIER's own comment.
    this.ownedPerkSlugs = new Set();
    // Equipped 'outfit'-slot cosmetic per character (cat/mouse/dog), keyed
    // by character regardless of controlledEntity - a purchased look is
    // worn by that character whenever it's on screen, not just when it's
    // the one being played. Populated by init()'s getEquipped() fetches
    // (one per character) and re-applied by resetGameObjects() every time
    // it (re)constructs an entity - resetGameObjects() runs a second time
    // once cutscenes finish (see its own comment), which would otherwise
    // silently discard a sprite swap already applied to the *first*
    // Cat/Mouse/Dog instance the moment that fetch resolved before then.
    this.equippedOutfits = {};
    this.cutsceneManager = new CutsceneManager(screenManager, canvas, ctx);

    this.floorPattern = null;
  }

  init() {
    // Reveals the touch D-pad/action buttons (see styles.css) — only
    // during actual gameplay, not the setup screen.
    document.body.classList.add('in-game');
    // Dog mode shows just the poop button (punch's icon repurposed) rather
    // than the full punch/toot/meow set Cat/Mouse mode keeps — see
    // setActionButtonsMode()'s own comment. Called here (once per round,
    // covering both a fresh game and "Play Again") since these buttons'
    // DOM elements are set up once for the page's lifetime, not recreated
    // per GameScreen instance, so nothing else keeps them in sync with
    // whichever character this round is actually controlling.
    setActionButtonsMode(this.controlledEntity);

    this.resetGameObjects();

    // Starting the background track itself no longer happens here — see
    // startGame()/the skipCutscenes branch below for where actual gameplay
    // begins, per explicit direction ("Dont start it until in game
    // though"). This block just wires up the mute-toggle listener so it's
    // ready the instant the track *does* start (or immediately, if the
    // player opens settings during the cutscenes themselves).
    //
    // Lets the settings menu's Music toggle affect a track that's already
    // looping, not just future playSound() calls — see js/utils/audio.js.
    // SFX doesn't need an equivalent listener: playSound() (below) checks
    // isSfxMuted() at play-time, and one-shot sounds have nothing already
    // playing to react to.
    this.musicMuteChangeHandler = (e) => {
      const background = this.sounds[SOUND_KEYS.BACKGROUND];
      if (e.detail.muted) {
        background.pause();
      } else {
        background.play();
      }
    };
    document.addEventListener('musicmutechange', this.musicMuteChangeHandler);

    // Pauses gameplay while the settings menu (js/utils/settingsMenu.js) is
    // open - see pauseForOverlay()/resumeForOverlay() for what that
    // actually does and why (this used to be hand-rolled separately here
    // and in storeModalToggleHandler below; the two drifted once, which is
    // exactly the bug those two methods exist to make impossible to repeat
    // for a third overlay).
    this.settingsMenuToggleHandler = (e) => {
      if (e.detail.open) this.pauseForOverlay();
      else this.resumeForOverlay();
    };
    document.addEventListener('settingsmenutoggle', this.settingsMenuToggleHandler);

    // Same shared pause/resume as settingsMenuToggleHandler above, for the
    // store modal (js/utils/storeModal.js) instead - opening the store
    // mid-round shouldn't let gameplay (or the dog's bark/poop timers)
    // keep running underneath it.
    this.storeModalToggleHandler = (e) => {
      if (e.detail.open) this.pauseForOverlay();
      else this.resumeForOverlay();
    };
    document.addEventListener('storemodaltoggle', this.storeModalToggleHandler);

    // Fire-and-forget since gameplay shouldn't wait on any of this - see
    // loadEconomyData()'s own comment for what it fetches and why.
    if (isLoggedIn()) {
      // Replays anything queued from a past offline session before
      // reading the wallet, so this.wallet already reflects those rounds
      // rather than the store having to reconcile a stale snapshot later.
      // No-ops immediately if the queue's empty.
      flushPendingRounds()
        .catch(() => {})
        .finally(() => this.loadEconomyData());
    } else {
      // SetupScreen's quick-login already tried once and gave up rather
      // than block gameplay (see its own QUICK_LOGIN_TIMEOUT_MS comment) -
      // retry once more here in the background. If the API was just cold-
      // starting (kpground-api's free-tier Render instance can take 50s+
      // to wake from a spin-down) this often succeeds well after the
      // title screen already moved on. A second failure just stays
      // offline, same as today - endGame() queues this round's result
      // either way for the next successful connection to pick up.
      kathrynQuickLogin()
        .then(() => flushPendingRounds().catch(() => {}))
        .then(() => this.loadEconomyData())
        .catch((err) => console.warn('Still offline, will retry next round/session:', err.message));
    }

    // Always add the click handler
    this.clickHandler = this.handleClick.bind(this);
    this.canvas.addEventListener('click', this.clickHandler);

    // HUD stat hover tooltip (see drawHudTooltip()) - a plain mousemove
    // listener rather than per-shape DOM elements, matching this game's
    // existing convention of hand-rolled AABB hit-testing (isClickInside)
    // over the canvas's own drawn regions. Touch devices simply never fire
    // mousemove without a cursor, so this is naturally desktop-only,
    // exactly the "hover" behavior it's meant to be.
    this.mouseMoveHandler = this.handleMouseMove.bind(this);
    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);

    this.tootHandler = () => {
      this.playSound(SOUND_KEYS.TOOT);
      this.handleToot();
    };
    document.addEventListener('toot', this.tootHandler);

    this.punchHandler = () => {
      // Punch already no-ops position-wise in Dog mode (see handlePunch())
      // — shoving the dog away from the cat makes no sense when the player
      // IS the dog, so pressing 'p' there used to just play a punch sound
      // for no visible effect. Repurposed instead: in Dog mode, 'p' drops a
      // poop pile — the dog's own direct way to stall the cat (see
      // handleDogPoop()) — rather than sharing the punch sound/effect.
      if (this.controlledEntity === 'dog') {
        this.handleDogPoop();
      } else {
        this.playSound(SOUND_KEYS.PUNCH);
        this.handlePunch();
      }
    };
    document.addEventListener('punch', this.punchHandler);

    this.meowHandler = () => {
      this.playSound(SOUND_KEYS.MOUSE_ESCAPE);
    };
    document.addEventListener('meow', this.meowHandler);

    if (this.skipCutscenes) {
      // resetGameObjects() already ran once above — startCutscenes()'s own
      // startGame() callback would normally call it a second time (a fresh
      // layout after watching the cutscenes), but skipping cutscenes
      // entirely means there's no callback to do that second call, so it's
      // just skipped rather than reproduced here for no reason.
      this.running = true;
      // This branch bypasses startGame() entirely (see the comment just
      // above), so it needs its own copy of the "actual gameplay begins
      // now" background-music start — the other path's copy lives inside
      // startGame() itself.
      startBackgroundMusic();
    } else {
      this.running = false;
      this.startCutscenes();
    }
  }

  // Fetches the controlled character's wallet, that character's owned
  // perks, and every character's equipped cosmetic - shared by init()'s
  // normal logged-in-at-startup path and its background reconnect retry
  // (see the isLoggedIn()/kathrynQuickLogin() branch above), so the two
  // can't drift into fetching different things.
  loadEconomyData() {
    // Fetches the controlled character's wallet so the HUD has something
    // to show - this.wallet staying null just means drawHud()/the store
    // button skip drawing entirely.
    getWallets()
      .then((wallets) => {
        this.wallet = wallets.find((w) => w.character === this.controlledEntity) || null;
        // A snapshot of coins/xp/level as they stood the moment this
        // round started - see endGame()'s reward breakdown, which diffs
        // the post-submitRound() wallet against this rather than trying
        // to duplicate the backend's own WIN_COINS/LOSS_XP/etc reward
        // constants client-side (see kattrap/services.py's submit_round
        // in kpground-api) to guess what changed and why.
        this.walletAtRoundStart = this.wallet
          ? { coins: this.wallet.coins, xp: this.wallet.xp, level: this.wallet.level }
          : null;
      })
      .catch((err) => console.warn('Could not load wallet:', err.message));

    // Perk ownership only ever needs the *controlled* character's own
    // catalog (see this.ownedPerkSlugs's own comment) - getStore()
    // already returns every item's .owned flag, so no separate
    // endpoint is needed just for this.
    getStore(this.controlledEntity)
      .then((items) => {
        this.ownedPerkSlugs = new Set(
          items.filter((item) => item.item_type === 'perk' && item.owned).map((item) => item.slug)
        );
      })
      .catch((err) => console.warn('Could not load perks:', err.message));

    // Cosmetic equip state, one fetch per character (not just
    // controlledEntity) - the dog's own tutu, say, should show whenever
    // Dummy is on screen, regardless of who's actually being played
    // this round. applyEquippedOutfit() both updates the live sprite
    // immediately (covers the skip-cutscenes path, where
    // resetGameObjects() never runs again) and records the pick on
    // this.equippedOutfits (covers the normal path, where it does).
    ['cat', 'mouse', 'dog'].forEach((character) => {
      getEquipped(character)
        .then((equipped) => this.applyEquippedOutfit(character, equipped.outfit))
        .catch((err) => console.warn(`Could not load ${character}'s equipped outfit:`, err.message));
    });
  }

  // Records `outfitItem` (a StoreItem, or null/undefined for "no cosmetic
  // equipped, default look") as `character`'s current pick, then - if that
  // character's entity already exists - swaps its live spriteSheet.src
  // right away via getSpriteSrc() (js/utils/outfits.js), which falls back
  // to that character's default look when outfitItem is null - unequipping
  // needs the live sprite to revert just as much as equipping needs it to
  // change, so this always reassigns rather than early-returning on a
  // falsy outfitItem. Called from three places: once per character as each
  // of init()'s getEquipped() fetches resolves (covers the skipCutscenes
  // path, where resetGameObjects() never runs a second time), again from
  // inside resetGameObjects() itself every time it (re)constructs the
  // three entities (covers the normal path, where cutscenes finishing
  // calls resetGameObjects() a second time - see its own comment - which
  // would otherwise reconstruct Cat/Mouse/Dog at their plain default look
  // and silently discard whatever a fetch had already applied to the
  // now-replaced instance), and from openStore()'s onOutfitChange callback
  // whenever an equip/unequip happens while already in a round (without
  // this, the store's own DB state changed but the on-screen character
  // stayed stale until the next reload re-ran getEquipped()).
  applyEquippedOutfit(character, outfitItem) {
    this.equippedOutfits[character] = outfitItem || null;
    const entity = character === 'cat' ? this.cat : character === 'mouse' ? this.mouse : this.dog;
    if (entity) entity.spriteSheet.src = getSpriteSrc(character, outfitItem);
  }

  resetGameObjects() {
    this.furniture = this.generateKitchenFurniture();
    this.escapes = this.generateEscapes(NUM_OF_ESCAPES);
    // resetGameObjects() can run a second time within one GameScreen
    // instance (see the outgoing-dog cleanup comment just below) — clear
    // out any poop from that earlier pass rather than carrying it into the
    // new layout.
    this.poops = [];
    // Same reasoning as poops above - a second resetGameObjects() pass
    // shouldn't carry doobers spawned against the previous layout.
    // coinsCollectedThisRound/lastDooberSpawnTime deliberately aren't
    // reset here (only in the constructor) - this can legitimately run
    // again mid-round-setup, and a player shouldn't lose an already-
    // ticking spawn timer or tally to that.
    this.doobers = [];
    this.dooberPopups = [];
    this.hudCoinImpacts = [];

    if (this.inputHandler) this.inputHandler.cleanup();
    // resetGameObjects() unconditionally reassigns this.dog below — called
    // a second time by startGame() (once cutscenes finish) on top of the
    // constructor's own initial call, which used to silently orphan the
    // *first* Dog instance: nothing ever pointed at it again, so its
    // pauseBarking()/cleanup() were never reachable, but its setNextBark()
    // setTimeout chain kept firing forever regardless — completely
    // invisible to this.running, the settings-menu pause, or endGame(),
    // since all of those act on whatever this.dog *currently* is, not
    // whichever earlier instance actually still owned the live timer. This
    // was the actual cause of barks persisting through a pause or past
    // game-over: the visible/current dog's bark loop really was being
    // paused/stopped correctly, it just wasn't the one still barking.
    // Cleaning up the outgoing dog here, the same way inputHandler already
    // is on this line, closes that off at the source rather than relying
    // on every caller of resetGameObjects() to remember to do it first.
    if (this.dog) this.dog.cleanup();

    const { scale, characterScale, topWallHeight, bottomWallHeight, spawnClearance, minSpawnSeparation, catSizeApprox, mouseSizeApprox, dogSizeApprox } = this.layout;

    // The cat's bottom-center spawn was assumed safe (see CLAUDE.md history
    // of this exact bug class) back when the cat's actual size roughly
    // matched catSizeApprox/spawnClearance's tuning — but getCharacterScale()
    // later made desktop characters ~2x bigger without touching
    // spawnClearance (a board-margin value, independent of character size),
    // so the cat's now-larger box can spawn already overlapping the
    // bottom-wall furniture row, with no legal move out of it. Same
    // fallback search as the mouse/dog below. Resolved first (nothing to
    // avoid yet) so the mouse/dog below can steer clear of wherever it
    // actually ends up.
    const catSpawn = this.resolveClearSpawn(
      this.canvas.width / 2,
      this.canvas.height - bottomWallHeight - spawnClearance,
      catSizeApprox
    );
    this.cat = new Cat(
      catSpawn.x,
      catSpawn.y,
      this.canvas.width,
      this.canvas.height,
      scale,
      characterScale
    );
    // Mouse's fixed (100, 100)-style spawn scales with the board too, so it
    // doesn't end up pinned near the true corner on a small canvas. That
    // corner isn't checked against wall-mounted furniture the way the
    // freestanding dining set is (see blocksSpawn() in
    // generateKitchenFurniture()), so on some layouts a cabinet/fridge can
    // land right on top of it — resolveClearSpawn() falls back to a clear
    // spot in that case so the mouse never starts the game hidden. Also
    // kept minSpawnSeparation away from the cat's just-resolved spawn: the
    // bottom wall's cabinets span most of the board width and are centered
    // right where the cat prefers to spawn, so the cat's fallback search
    // (furniture-only, no distance check) used to be free to land right
    // next to the mouse's fixed corner — ending the round in under a
    // second, before a player could do anything.
    const mouseSpawn = this.resolveClearSpawn(
      100 * scale, 100 * scale, mouseSizeApprox,
      [{ x: catSpawn.x, y: catSpawn.y, size: catSizeApprox }],
      minSpawnSeparation
    );
    this.mouse = new Mouse(mouseSpawn.x, mouseSpawn.y, this.canvas.width, this.canvas.height, scale, characterScale);
    // Same protection for the dog's fixed corner spawn — it isn't
    // hardcoded-safe against every possible LEFT_WALL_ORDER (see CLAUDE.md's
    // Planned work: taller left-wall modules are an explicit future
    // possibility), so it gets the same fallback search as the mouse, also
    // kept clear of both the cat and mouse's now-resolved spawns.
    const dogSpawn = this.resolveClearSpawn(
      200 * scale, topWallHeight + spawnClearance, dogSizeApprox,
      [
        { x: catSpawn.x, y: catSpawn.y, size: catSizeApprox },
        { x: mouseSpawn.x, y: mouseSpawn.y, size: mouseSizeApprox },
      ],
      minSpawnSeparation
    );
    this.dog = new Dog(
                  dogSpawn.x, dogSpawn.y, this.canvas.width, this.canvas.height,
                  this.escapes, this.furniture,
                  (soundKey) => this.playSound(SOUND_KEYS.DOG_BARK),
                  scale,
                  characterScale
                );
    this.dog.setNextBark();
    // Autonomous poop-dropping only — when the player IS the dog, 'p'
    // triggers it directly instead (see the punchHandler in init(), which
    // repurposes the punch key since it already no-ops for a player-
    // controlled dog). Wiring the callback unconditionally would be
    // harmless on its own, but only actually starting the timer when it's
    // not player-controlled keeps setNextPoop()'s wall-clock schedule from
    // ever running (and needing to be paused/resumed) in a mode where it's
    // not supposed to fire at all.
    this.dog.setPoopCallback(() => this.handleDogPoop());
    if (this.controlledEntity !== 'dog') {
      // `true` — this specific call is the round's very first poop timer
      // kick-off, which gets its own short fixed delay (see Dog.js's
      // setNextPoop()); every poop after it (including resumePooping()'s
      // own calls, after the settings menu pauses/resumes it) goes back to
      // the normal random range.
      this.dog.setNextPoop(true);
    }
    // Re-applies whatever init()'s getEquipped() fetches have already
    // resolved to (a no-op for any character whose fetch hasn't resolved
    // yet, or that has nothing equipped) - see applyEquippedOutfit()'s own
    // comment for why this has to happen here too, not just once at fetch
    // time.
    ['cat', 'mouse', 'dog'].forEach((character) => this.applyEquippedOutfit(character, this.equippedOutfits[character]));

    this.inputHandler = new InputHandler();
    // wallHitCallback is sound-only — see checkMouseEscapeOnWallHit()'s own
    // comment for why the escape check itself is wired separately
    // (escapeCheckCallback, autonomous mode only) rather than living here
    // alongside the sound the way it used to.
    this.mouse.setWallHitCallback(() => {
      this.playSound(SOUND_KEYS.WALL_HIT);
    });
    this.mouse.setEscapeCheckCallback(() => this.checkMouseEscapeOnWallHit());

    // State for the cat AI's active-search wander (Mouse-controlled mode
    // only — see wanderCat()), reset each game like the dog's own cooldowns.
    this.catWander = { direction: null, lastDirectionChange: 0 };
  }

  // Returns preferredX/Y unchanged unless it's hidden under furniture (see
  // isHiddenByFurniture()) or within minSeparation of an already-resolved
  // entity spawn (see `avoid`), in which case it random-searches
  // this.playableArea (the same interior bounds generateKitchenFurniture()
  // already uses for the dining set — see its INTERIOR_MARGIN/playableX/Y
  // block) for a clear spot. Falls back to the preferred spot if the search
  // somehow can't find one (a small board with a large minSeparation could
  // legitimately have no valid spot — better to let two characters spawn
  // close than to leave one undefined). `avoid` is a list of
  // {x, y, size} spawns already committed this reset (see resetGameObjects()
  // — cat resolves first, so mouse avoids it, then dog avoids both) so a
  // later entity's fallback search can't land right on top of an earlier
  // one just because it happened to be clear of furniture.
  resolveClearSpawn(preferredX, preferredY, size, avoid = [], minSeparation = 0) {
    const isTooCloseToOthers = (x, y) => avoid.some(spot => {
      const dx = (x + size / 2) - (spot.x + spot.size / 2);
      const dy = (y + size / 2) - (spot.y + spot.size / 2);
      return Math.hypot(dx, dy) < minSeparation;
    });

    if (!this.isHiddenByFurniture(preferredX, preferredY, size) && !isTooCloseToOthers(preferredX, preferredY)) {
      return { x: preferredX, y: preferredY };
    }

    const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = this.playableArea;
    for (let attempts = 0; attempts < 300; attempts++) {
      const x = areaX + Math.random() * Math.max(0, areaWidth - size);
      const y = areaY + Math.random() * Math.max(0, areaHeight - size);
      if (!this.isHiddenByFurniture(x, y, size) && !isTooCloseToOthers(x, y)) return { x, y };
    }

    return { x: preferredX, y: preferredY };
  }

  loadSounds() {
    return {
      // Was disabled pending a mute button (looping music with no way to
      // turn it off is worse than no music at all) — now gated by
      // isMusicMuted(), which starts muted by default (js/utils/audio.js —
      // the settings menu's Music toggle), so nothing changes for a player
      // until they explicitly unmute.
      // Swapped from christmas_tree_farm.mp3 to this track on request — that
      // file stays in sounds/, unreferenced, same deprecate-don't-delete
      // precedent used for swapped visual assets elsewhere in this project.
      // Volume (0.1) was originally tuned by ear against the old track's own
      // mastering/loudness, not this one's — may need a fresh pass if this
      // new track reads too loud/quiet once actually heard in-game.
      //
      // Unlike every other entry here, this isn't `this.loadSound(...)` —
      // it aliases the single page-lifetime Audio element from
      // js/utils/audio.js (see getBackgroundMusicElement()'s own comment)
      // rather than constructing a fresh one per GameScreen instance, which
      // is what makes the track able to keep playing seamlessly across
      // "Play Again" rounds instead of restarting each time.
      [SOUND_KEYS.BACKGROUND]: getBackgroundMusicElement(),
      [SOUND_KEYS.WALL_HIT]: this.loadSound('../../../sounds/bounce.flac'),
      [SOUND_KEYS.CAT_CATCH]: this.loadSound('../../../sounds/mouse.wav'),
      [SOUND_KEYS.MOUSE_ESCAPE]: this.loadSound('../../../sounds/meow.ogg'),
      [SOUND_KEYS.TOOT]: this.loadSound('../../../sounds/toot.wav', false),
      [SOUND_KEYS.PUNCH]: this.loadSound('../../../sounds/punch.ogg', false),
      [SOUND_KEYS.DOG_BARK]: this.loadSound('../../../sounds/dog_barking.wav', false),
      // Not a fire-and-forget one-shot like the others here — updateCartBump()
      // below drives its own play()/pause()/currentTime directly, tied to
      // how long the cat stays in the cart's hit zone while actually
      // moving, rather than letting it just run to completion once
      // triggered. `loop: false` (the loadSound() default) is still
      // correct: it should hold at its last position when the cat stops
      // moving, not restart from 0 and loop indefinitely.
      [SOUND_KEYS.CART_BUMP]: this.loadSound('../../../sounds/cart_bump.mp3'),
      // Unlike CART_BUMP above, this one is a plain fire-and-forget one-shot
      // (played via playSound(), see updateShelfBump() below) — no special
      // loop/loadSound arguments needed.
      [SOUND_KEYS.SHELF_BUMP]: this.loadSound('../../../sounds/shelf_bump.wav'),
      // A plain fire-and-forget one-shot, same as SHELF_BUMP above — played
      // once from handleDogCollision(), not driven continuously like
      // CART_BUMP. Renamed from the sound-generation tool's own default
      // export filename, same as CART_BUMP/SHELF_BUMP were.
      [SOUND_KEYS.GOTCHA]: this.loadSound('../../../sounds/gotcha.mp3'),
      // A plain fire-and-forget one-shot, same shape as SHELF_BUMP —
      // played once from updateTableBump() below, renamed from the
      // sound-generation tool's own default export filename same as
      // CART_BUMP/SHELF_BUMP/GOTCHA were.
      [SOUND_KEYS.TABLE_SHAKE]: this.loadSound('../../../sounds/table_shake.mp3'),
    };
  }

  loadSound(src, loop = false, volume = 1.0) {
    const sound = new Audio(src);
    sound.loop = loop;
    sound.volume = volume;
    return sound;
  }

  startCutscenes() {
    const { scale, characterScale } = this.layout;
    const catAnimation = new Cat(0, 0, this.canvas.width, this.canvas.height, scale, characterScale);
    const mouseAnimation = new Mouse(0, 0, this.canvas.width, this.canvas.height, scale, characterScale);
    const dogAnimation = new Dog(0, 0, this.canvas.width, this.canvas.height, [], [], undefined, scale, characterScale);
    
    // Store cutscene entities
    this.cutsceneCat = catAnimation;
    this.cutsceneMouse = mouseAnimation;
    this.cutsceneDog = dogAnimation;
    
    this.cutsceneManager.addCutscene(
      new Cutscene(this.ctx, catAnimation, 'Meet Mia, the best cat!', () => this.playSound(SOUND_KEYS.MOUSE_ESCAPE))
    );
    this.cutsceneManager.addCutscene(
      new Cutscene(this.ctx, mouseAnimation, 'This is Poop, the butt!', () => this.playSound(SOUND_KEYS.WALL_HIT))
    );
    this.cutsceneManager.addCutscene(
      new Cutscene(this.ctx, dogAnimation, 'Say hello to Dummy, the dumb dog!', () => this.playSound(SOUND_KEYS.DOG_BARK))
    );
    
    this.cutsceneManager.start(() => {
      this.startGame();
    });
  }

  startGame() {
    if (this.cutsceneDog) this.cutsceneDog.cleanup();
    this.resetGameObjects();
    this.running = true;
    // Actual gameplay begins now — this is the point background music is
    // meant to start from (see startBackgroundMusic()'s own comment in
    // js/utils/audio.js), not screen construction or the cutscenes that
    // may have just played. Safe to call every round without checking
    // "is this a replay" first: the shared track just keeps playing if
    // it's already going.
    startBackgroundMusic();
  }

  handleClick(event) {
    const { offsetX, offsetY } = event;

    // Checked before the gameOver branch below, but naturally excluded
    // from it anyway since drawHud() (see render()) never draws the store
    // button once this.gameOver is true - the game-over modal's own scrim
    // covers it regardless.
    if (this.isClickInside(offsetX, offsetY, this.storeButtonArea)) {
      this.openStore();
      return;
    }

    if (this.gameOver) {
        // Check if the click is within the "Play Again" button area
        if (this.isClickInside(offsetX, offsetY, this.playAgainButtonArea)) {
            this.restartGame();
            return;
        }

        // Prevent clicking on the message from triggering any action
        return;
    }
  }

  // Tracks which HUD stat chip (if any) the mouse is currently over, for
  // drawHud()'s hover tooltip (see drawHudTooltip()) - just a hit-test
  // against whatever this.hudStatAreas the last drawHud() call produced,
  // same isClickInside() helper the click handler already uses.
  handleMouseMove(event) {
    const { offsetX, offsetY } = event;
    const index = this.hudStatAreas.findIndex((area) => this.isClickInside(offsetX, offsetY, area));
    this.hoveredHudStatIndex = index === -1 ? null : index;
  }

  // "Play Again" now returns to character select rather than immediately
  // replaying with the same controlledEntity — per explicit direction, so
  // a player can pick a different character for the next round instead of
  // being locked into whatever they picked at the start of the session.
  // CharacterSelectScreen's own card-click handler is what constructs the
  // next GameScreen (see its own setScreen() call) — this only needs to
  // hand off to it, the same way SetupScreen's "Start Game" button does.
  // Passes `isReplay: true` so that next GameScreen skips its intro
  // cutscenes (see CharacterSelectScreen's own constructor/GameScreen's
  // `skipCutscenes`) — re-watching "meet the characters" every round once
  // Play Again started routing back through character select was flagged
  // live as unwanted, without wanting to move the cutscenes to before
  // character select instead (a bigger change, explicitly deferred).
  restartGame() {
    this.gameOver = false;
    // Deliberately does *not* touch background music — it's a shared,
    // page-lifetime singleton now (see js/utils/audio.js), not something
    // this instance owns, so there's nothing to pause/orphan here. Letting
    // it keep playing straight through this transition (rather than
    // pausing it, only to have the next GameScreen's startGame() resume
    // it) is the actual point of this round's change: "It should run
    // through even after a game over. The only thing that should start it
    // over is a refresh."
    this.cleanup();
    this.screenManager.setScreen(new CharacterSelectScreen(this.screenManager, this.canvas, true));
  }

  cleanup() {
    document.body.classList.remove('in-game');
    delete document.body.dataset.mouseDanger;
    document.removeEventListener('toot', this.tootHandler);
    document.removeEventListener('punch', this.punchHandler);
    document.removeEventListener('meow', this.meowHandler);
    document.removeEventListener('musicmutechange', this.musicMuteChangeHandler);
    document.removeEventListener('settingsmenutoggle', this.settingsMenuToggleHandler);
    document.removeEventListener('storemodaltoggle', this.storeModalToggleHandler);
    this.canvas.removeEventListener('click', this.clickHandler);
    this.canvas.removeEventListener('mousemove', this.mouseMoveHandler);
    if (this.inputHandler) this.inputHandler.cleanup();
    if (this.dog) this.dog.cleanup();
  }

  isClickInside(x, y, area) {
    return (
        area &&
        x >= area.x &&
        x <= area.x + area.width &&
        y >= area.y &&
        y <= area.y + area.height
    );
  }

  playSound(soundKey) {
    if (isSfxMuted()) return;
    const sound = this.sounds[soundKey];
    if (!sound) return;
    // try/catch rather than just a .catch() on play()'s promise: a sound
    // with no supported source loaded (e.g. SOUND_KEYS.TABLE_SHAKE for the
    // stretch it was wired up before its recording was actually supplied —
    // see loadSounds()) throws synchronously on `currentTime = 0` itself,
    // not just on play(). Kept as a general safeguard rather than removed
    // now that every sound key has a real file again — the next sound
    // wired ahead of its recording will hit the same gap.
    try {
      sound.currentTime = 0;
      sound.play().catch(() => {});
    } catch {
      // See comment above.
    }
  }

  update(timestamp) {
    if (!this.running) return;

    // Reset before this tick's movement runs — tryMoveCat() (called from
    // either moveCat() or updateCatAI() below, possibly more than once in
    // one tick if the AI's first attempt fails and it falls back to
    // wanderCat() — see catMovedThisTick's own comment) sets this back to
    // true if any of those calls actually moved the cat.
    this.catMovedThisTick = false;

    this.handleCatPause(timestamp);

    if (!this.catPaused) {
      // The cat is AI-driven (updateCatAI — chase-or-wander, see below)
      // whenever the player isn't the one controlling it directly, which is
      // now two modes (Mouse, Dog) rather than one.
      if (this.controlledEntity === 'cat') {
        this.moveCat();
      } else {
        this.updateCatAI(timestamp);
      }
    }

    this.updateMouse();
    this.updateDog(timestamp);
    this.updatePlantBump(timestamp);
    this.updateCartBump(timestamp);
    this.updateShelfBump(timestamp);
    this.updateTableBump(timestamp);
    this.updatePoops(timestamp);
    this.updateDoobers(timestamp);
    this.updateDooberPopups(timestamp);
    this.updateHudCoinImpacts(timestamp);
  }

  // Plant is passable (see NON_BLOCKING_FURNITURE_TYPES) — this is a
  // separate, read-only overlap check specifically for the "bump" reaction,
  // not tied to tryMoveCat()/tryMoveDog()'s movement-blocking collision at
  // all (closer to isHiddenByFurniture()'s read-only style). Checked every
  // tick regardless of controlledEntity — whichever of cat/dog isn't
  // player-controlled is still AI/autonomously moving and can just as
  // easily wander into the plant. Uses each entity's full display box
  // (not the cat's smaller legs-only furniture hitbox — see Cat.js) since
  // visually any part of the character brushing the plant should read as
  // a bump, not just its feet. Mouse never triggers this — it already
  // ignores all furniture (see Mouse.js).
  //
  // Edge-triggered on plantWasHit (see its own comment) rather than firing
  // on every tick of overlap — Furniture.startKnockOver() is replayable by
  // design now (each bump wobbles/re-tips the plant, not just the first
  // ever touch), so without edge-detection here, sitting on top of the
  // plant for even a few frames would restart the animation/sound every
  // tick and read as a stutter instead of one bump per approach.
  updatePlantBump(timestamp) {
    const plant = this.furniture.find(f => f.type === 'plant');
    if (!plant) return;

    const catHits = aabbOverlap(this.cat.x, this.cat.y, this.cat.displayWidth, this.cat.displayHeight, plant.x, plant.y, plant.width, plant.height);
    const dogHits = aabbOverlap(this.dog.x, this.dog.y, this.dog.displayWidth, this.dog.displayHeight, plant.x, plant.y, plant.width, plant.height);
    const isHitting = catHits || dogHits;

    if (isHitting && !this.plantWasHit) {
      plant.startKnockOver(timestamp);
      playPlantKnockOverSound();
    }
    this.plantWasHit = isHitting;
  }

  // Cart counterpart to updatePlantBump() above, but cat-only — the cart
  // blocks the dog outright (see DOG_NON_BLOCKING_FURNITURE_TYPES — cart
  // isn't in it), so the dog never gets to "pass through" it the way the
  // cat does, there's nothing to react to on that side. Uses the same
  // overlap test drawCatUnderFurnitureEffect() already runs for the
  // silhouette effect (cat's full display box, not the furniture-collision
  // legs hitbox) — kept as its own separate check here rather than folding
  // into that render-phase method, since driving audio playback belongs in
  // the update phase, matching updatePlantBump()'s own placement.
  //
  // Unlike updatePlantBump() (fire-and-forget one-shot on the tick contact
  // begins), this one directly drives SOUND_KEYS.CART_BUMP's own play()/
  // pause()/currentTime rather than letting a triggered clip just run to
  // completion — per explicit direction: "it should only play for the
  // duration of the cat being 'on' the shelf or in the hit zone... only
  // advance sound if the cat is moving while inside the hit zone." Three
  // states, not a simple edge-trigger:
  // - In the zone and moving (catMovedThisTick, set from tryMoveCat() —
  //   see its own comment) → playing, resumed from wherever it last was if
  //   it was already paused rather than restarted, so a brief stop-and-go
  //   doesn't repeatedly jump back to the start.
  // - In the zone but not moving → paused in place (not reset) — holds its
  //   current position, ready to resume the instant movement does.
  // - Out of the zone entirely → paused *and* reset to the start, so the
  //   next time the cat enters, the sound begins fresh rather than
  //   resuming mid-clip from a previous, unrelated approach.
  //
  // Also triggers Furniture.startShake() (see updateTableBump()'s own
  // comment for why a shake, not a knock-over) — but edge-triggered on
  // cartWasHit, independently of the sound's own continuous model above,
  // since the shake should be one fresh wobble per approach, not
  // restarted or held every tick the cat happens to still be moving
  // inside the zone.
  updateCartBump(timestamp) {
    const cart = this.furniture.find(f => f.type === 'cart');
    const sound = this.sounds[SOUND_KEYS.CART_BUMP];
    if (!cart || !sound) return;

    const isHitting = aabbOverlap(this.cat.x, this.cat.y, this.cat.displayWidth, this.cat.displayHeight, cart.x, cart.y, cart.width, cart.height);

    if (isHitting && this.catMovedThisTick) {
      if (sound.paused && !isSfxMuted()) sound.play();
    } else {
      if (!sound.paused) sound.pause();
      if (!isHitting) sound.currentTime = 0;
    }

    if (isHitting && !this.cartWasHit) {
      cart.startShake(timestamp);
    }
    this.cartWasHit = isHitting;
  }

  // Shelf counterpart to updatePlantBump() above, not updateCartBump() —
  // cat-only (same reasoning as the cart: the shelf blocks the dog outright,
  // see DOG_NON_BLOCKING_FURNITURE_TYPES, so there's nothing for the dog
  // side to react to), but a plain fire-and-forget one-shot per explicit
  // direction ("let's just play the full sound once on entry") rather than
  // the cart's continuously-driven play/pause/currentTime model — the cart's
  // three-state approach was tuned specifically for a longer "duration of
  // contact" feel; the shelf doesn't need that, just a single bump sound.
  // Edge-triggered on shelfWasHit (see its own comment), same pattern as
  // updatePlantBump()'s plantWasHit, so standing on the shelf for several
  // ticks plays the clip once per approach rather than restarting it (or,
  // since this uses playSound()'s own currentTime=0 reset, re-triggering
  // it) every single tick of continuous overlap. Also triggers
  // Furniture.startShake() (see updateTableBump()'s own comment for why a
  // shake, not a knock-over) — same edge-trigger as the sound, so both
  // fire together exactly once per approach.
  updateShelfBump(timestamp) {
    const shelf = this.furniture.find(f => f.type === 'shelf');
    if (!shelf) return;

    const isHitting = aabbOverlap(this.cat.x, this.cat.y, this.cat.displayWidth, this.cat.displayHeight, shelf.x, shelf.y, shelf.width, shelf.height);

    if (isHitting && !this.shelfWasHit) {
      shelf.startShake(timestamp);
      this.playSound(SOUND_KEYS.SHELF_BUMP);
    }
    this.shelfWasHit = isHitting;
  }

  // Table counterpart to updateShelfBump() above — cat-only (same
  // reasoning as cart/shelf: the table still blocks the dog outright, see
  // DOG_NON_BLOCKING_FURNITURE_TYPES, so there's nothing for the dog side
  // to react to), same edge-triggered fire-and-forget shape, including the
  // Furniture.startShake() wobble (see Furniture.js) that shelf/cart also
  // trigger now — a plain bump sound with no visual response would feel
  // disconnected from something this size sitting in the middle of the
  // room.
  updateTableBump(timestamp) {
    const table = this.furniture.find(f => f.type === 'table');
    if (!table) return;

    const isHitting = aabbOverlap(this.cat.x, this.cat.y, this.cat.displayWidth, this.cat.displayHeight, table.x, table.y, table.width, table.height);

    if (isHitting && !this.tableWasHit) {
      table.startShake(timestamp);
      this.playSound(SOUND_KEYS.TABLE_SHAKE);
    }
    this.tableWasHit = isHitting;
  }

  // Dog-controlled mode: player-driven, same per-tick movement granularity
  // as moveCat()/movePlayerMouse() (see tryMoveDog() below) rather than the
  // autonomous once-every-couple-seconds hop. Otherwise (Cat/Mouse modes,
  // where the dog has always just been a hazard) Dog.update() keeps running
  // its own autonomous wander exactly as before — this is the one place the
  // three modes genuinely diverge in *how* the dog moves. The collision-vs-
  // cat check that pauses the cat (see handleDogCollisionIfReady()) applies
  // either way, since "run the dog into the cat" is the whole point of
  // playing as the dog — it's the same rule, just now something the player
  // can aim on purpose instead of it happening by chance.
  updateDog(timestamp) {
    if (this.controlledEntity === 'dog') {
      this.movePlayerDog();
      if (this.dog.isColliding(this.cat)) {
        this.handleDogCollisionIfReady(timestamp);
      }
    } else {
      // Dog.update() runs exactly once per frame — it always moves/animates
      // regardless of catPaused, but the collision *response* is gated (see
      // handleDogCollisionIfReady()) so a still-overlapping dog/cat pair
      // doesn't re-trigger the pause every single frame.
      this.dog.update(timestamp, this.cat, () => this.handleDogCollisionIfReady(timestamp));
    }
  }

  // Guards handleDogCollision() so it only fires once per actual catch:
  // not while already paused, and not during the grace period right after
  // a pause ends (dogCollisionCooldown) — gives the dog and cat a moment to
  // separate before another collision can retrigger the pause.
  handleDogCollisionIfReady(timestamp) {
    if (this.catPaused || timestamp < this.dogCollisionCooldown) return;
    this.handleDogCollision();
  }

  handleCatPause(timestamp) {
    if (this.catPaused && timestamp >= this.pauseEndTime) {
      this.catPaused = false;
      this.message = '';
      this.dogCollisionCooldown = timestamp + DOG_COLLISION_COOLDOWN;
    }
  }

  handleToot() {
    const MOVE_DISTANCE = 10;
    // Both toot and punch (below) shove the dog away from the cat — makes
    // sense as a way to protect whoever's nearby from the autonomous dog
    // hazard, but not when the player IS the dog: it would fling their own
    // character away from the cat they're actively trying to reach. The
    // sound still plays either way (see the tootHandler in init()) since
    // there's no harm in the button making noise.
    if (!this.dog || this.controlledEntity === 'dog') return;

    // Little wind/fart puff — purely cosmetic, gated behind the same
    // "not playing as the dog" check as the shove below (and as
    // handlePunch()'s shockwave) for consistency, even though nothing
    // about it actually depends on the dog existing. Drifts out the cat's
    // *back* — opposite whichever way it's currently facing, via
    // TOOT_EFFECT_DIRECTIONS — rather than a fixed screen direction.
    const puffDirection = TOOT_EFFECT_DIRECTIONS[this.cat.facingDirection] || TOOT_EFFECT_DIRECTIONS.down;
    this.tootEffect = {
      x: this.cat.x + this.cat.displayWidth / 2,
      y: this.cat.y + this.cat.displayHeight / 2,
      dirX: puffDirection.x,
      dirY: puffDirection.y,
      startTime: performance.now(),
    };

    // Move dog directly away from the cat
    if (this.dog.x < this.cat.x) this.dog.x -= MOVE_DISTANCE;
    else this.dog.x += MOVE_DISTANCE;
    if (this.dog.y < this.cat.y) this.dog.y -= MOVE_DISTANCE;
    else this.dog.y += MOVE_DISTANCE;

    // Ensure the dog stays within bounds
    this.dog.x = Math.max(0, Math.min(this.canvas.width - this.dog.size, this.dog.x));
    this.dog.y = Math.max(0, Math.min(this.canvas.height - this.dog.size, this.dog.y));
  }

  handlePunch() {
    // See handleToot() above — same reasoning for skipping the dog-shoving
    // effect (though not the sound) when the player is controlling the dog.
    if (!this.dog || this.controlledEntity === 'dog') return;

    // Start shockwave animation
    this.shockwave = {
      x: this.cat.x + this.cat.displayWidth / 2,
      y: this.cat.y + this.cat.displayHeight / 2,
      startTime: performance.now()
    };

    // Move dog away
    const hasPunchKnockbackPerk = this.controlledEntity === 'cat' && this.ownedPerkSlugs.has('punch-knockback');
    const punchDistance = this.layout.punchDistance * (hasPunchKnockbackPerk ? PUNCH_KNOCKBACK_PERK_MULTIPLIER : 1);
    if (this.dog.x < this.cat.x) this.dog.x -= punchDistance;
    else this.dog.x += punchDistance;
    if (this.dog.y < this.cat.y) this.dog.y -= punchDistance;
    else this.dog.y += punchDistance;

    // Ensure the dog stays within bounds
    this.dog.x = Math.max(0, Math.min(this.canvas.width - this.dog.size, this.dog.x));
    this.dog.y = Math.max(0, Math.min(this.canvas.height - this.dog.size, this.dog.y));
  }

  // Drops a poop pile at the dog's current position — either the player
  // pressing 'p' in Dog mode (see the punchHandler in init(), which
  // repurposes the punch key since it already does nothing when playing as
  // the dog) or Dog.js's own random-interval autonomous timer (Cat/Mouse
  // mode, wired via setPoopCallback() in resetGameObjects()). Only one
  // active (un-stepped-in) pile is allowed on the board at a time — without
  // this, mashing 'p' or a fast autonomous roll could carpet the board with
  // piles, which reads as clutter rather than a placed hazard. See
  // updatePoops() below for how a pile is consumed/expires.
  handleDogPoop() {
    if (!this.dog || this.poops.length > 0) return;

    const { poopWidth, poopHeight } = this.layout;
    const dogCenterX = this.dog.x + this.dog.displayWidth / 2;
    const dogCenterY = this.dog.y + this.dog.displayHeight / 2;
    // Offset toward the dog's tail (the side opposite whichever way it's
    // facing), not centered directly under it — confirmed live that a
    // centered pile was fully hidden under the dog's own sprite until it
    // moved away, reading as if nothing happened. Dog.js has no up/down
    // facing art (only facingLeft — see its own comment), so "behind" is
    // always this horizontal offset. 0.55 * displayWidth puts the pile's
    // center just outside the dog's own bounding box on that side, so most
    // of it peeks out immediately rather than needing the dog to step away
    // first — the dog is still drawn on top of it (see render()'s draw
    // order), so it still reads as "behind the dog," just no longer fully
    // swallowed by it.
    const behindSign = this.dog.facingLeft ? 1 : -1;
    const poopCenterX = dogCenterX + behindSign * this.dog.displayWidth * 0.55;
    const poopCenterY = dogCenterY + this.dog.displayHeight * 0.15;

    this.poops.push({
      x: poopCenterX - poopWidth / 2,
      y: poopCenterY - poopHeight / 2,
      width: poopWidth,
      height: poopHeight,
      createdAt: performance.now(),
    });
    this.dog.startPoopAnim(performance.now());
    playPoopSound();
  }

  // Expires stale piles (see POOP_LIFETIME_MS) and checks whether the cat
  // has stepped in one — cat-only, same as the plant/cart/shelf/table bump
  // checks above, and using the same full-display-box aabbOverlap those use
  // (not checkCollision()'s tightened insetBox() — that's specifically for
  // character-vs-character catch checks, see collision.js's own comment; a
  // poop pile is a ground hazard, not a character). Stepping in a pile
  // consumes it (spliced out) rather than leaving it there to re-trigger —
  // a single-use trap, the same shape Escape's hasMouseEntered() is for the
  // mouse, not a standing puddle the cat can be re-stunned by while paused
  // on top of it. Shares this.catPaused/this.pauseEndTime/
  // this.catStunStartTime/this.message with handleDogCollision() — the dog
  // physically catching the cat — so the message banner (displayMessage())
  // applies here for free, just with its own duration/text. The stun
  // *visuals* diverge, though — drawStunBurst()/drawStunStars() branch on
  // this.catStunSource (set below) to draw a poop-flavored splat/stink-
  // squiggle pair instead of the dog-catch's amber burst/yellow stars.
  updatePoops(timestamp) {
    this.poops = this.poops.filter(poop => timestamp - poop.createdAt < POOP_LIFETIME_MS);

    if (this.catPaused || this.poops.length === 0) return;

    const cat = this.cat;
    const poopIndex = this.poops.findIndex(poop =>
      aabbOverlap(cat.x, cat.y, cat.displayWidth, cat.displayHeight, poop.x, poop.y, poop.width, poop.height)
    );
    if (poopIndex === -1) return;

    this.poops.splice(poopIndex, 1);
    this.catPaused = true;
    this.pauseEndTime = timestamp + POOP_STUN_DURATION;
    this.message = MESSAGES.CAT_STUCK_IN_POOP;
    this.catStunStartTime = timestamp;
    this.catStunSource = 'poop';
    this.cat.startYuckReaction(timestamp);
    playCatStuckSound();
  }

  // Spawns a new doober at a random clear spot in the playable area. The
  // MAX_ACTIVE_DOOBERS/DOOBER_SPAWN_INTERVAL gating is entirely the
  // caller's job (updateDoobers()) - this always spawns one when called.
  // Reuses resolveClearSpawn() (see resetGameObjects()'s own use of it
  // for character spawns) so a doober avoids landing under furniture and
  // (if MAX_ACTIVE_DOOBERS is ever raised above 1) avoids stacking on
  // top of another doober, the same guarantees character spawns already get.
  spawnDoober(timestamp) {
    const { dooberSize } = this.layout;
    const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = this.playableArea;
    const randomX = areaX + Math.random() * Math.max(0, areaWidth - dooberSize);
    const randomY = areaY + Math.random() * Math.max(0, areaHeight - dooberSize);

    const avoidExistingDoobers = this.doobers.map(d => ({ x: d.x, y: d.y, size: d.size }));
    const { x, y } = this.resolveClearSpawn(
      randomX,
      randomY,
      dooberSize,
      avoidExistingDoobers,
      dooberSize * 2
    );

    const type = DOOBER_SPAWNABLE_TYPES[Math.floor(Math.random() * DOOBER_SPAWNABLE_TYPES.length)];
    // First doober of this type this whole page session gets the arrow;
    // every later one of the same type doesn't (see dooberArrowShownForType
    // above). Decided once here, not re-checked every frame in
    // drawDoober(), so this doober's arrow visibility can't flicker.
    const showArrow = !dooberArrowShownForType.has(type);
    if (showArrow) dooberArrowShownForType.add(type);
    this.doobers.push({ x, y, size: dooberSize, createdAt: timestamp, type, showArrow });
  }

  // Expires any doober that's sat uncaught past DOOBER_CATCH_DURATION
  // (same shape as updatePoops()'s POOP_LIFETIME_MS filter), spawns a
  // replacement once the board has room and DOOBER_SPAWN_INTERVAL has
  // passed since one last actually disappeared (see spawnDoober()), and
  // checks whether the player-controlled character has walked over
  // what's left - deliberately only the controlled character, regardless
  // of mode (Cat/Mouse/Dog all wander autonomously when not
  // player-driven, and autonomous entities never collect doobers). What
  // collecting a doober actually does is dispatched through
  // DOOBER_TYPES[doober.type].onCollect rather than hardcoded here, so
  // this stays correct for any future non-coin doober type without
  // changes; onCollect() returns the amount gained so a "+N" popup can
  // fly it to the HUD (see spawnDooberCollectPopup()).
  //
  // lastDooberSpawnTime is only ever reset at an actual disappearance
  // moment (expiry below, or collection at the bottom) - not on every
  // tick the interval check happens to pass, which would let the
  // "cooldown" clock silently keep ticking (and resetting) while a
  // doober was still sitting on the board, undermining the whole point
  // of DOOBER_SPAWN_INTERVAL being a real minimum gap between doobers.
  updateDoobers(timestamp) {
    const countBeforeExpiry = this.doobers.length;
    this.doobers = this.doobers.filter(doober => timestamp - doober.createdAt < DOOBER_CATCH_DURATION);
    if (this.doobers.length < countBeforeExpiry) {
      this.lastDooberSpawnTime = timestamp;
    }

    if (this.doobers.length < MAX_ACTIVE_DOOBERS && timestamp - this.lastDooberSpawnTime >= DOOBER_SPAWN_INTERVAL) {
      this.spawnDoober(timestamp);
      this.lastDooberSpawnTime = timestamp;
    }

    if (this.doobers.length === 0) return;

    const character = this[this.controlledEntity];
    if (!character) return;

    const dooberIndex = this.doobers.findIndex(doober =>
      aabbOverlap(
        character.x,
        character.y,
        character.displayWidth,
        character.displayHeight,
        doober.x,
        doober.y,
        doober.size,
        doober.size
      )
    );
    if (dooberIndex === -1) return;

    const [doober] = this.doobers.splice(dooberIndex, 1);
    this.lastDooberSpawnTime = timestamp;
    const amount = DOOBER_TYPES[doober.type].onCollect(this);
    this.spawnDooberCollectPopup(doober, amount, timestamp);
  }

  // Starts a "+N" flying from where the doober was collected toward the
  // HUD's coin readout (see getHudCoinTargetPosition()) - see
  // updateDooberPopups() for where the actual coin-count increment
  // happens. No-ops if the HUD isn't showing (this.wallet not loaded/not
  // logged in) - nothing sensible to fly toward in that case, though the
  // doober was still collected/tallied normally either way.
  spawnDooberCollectPopup(doober, amount, timestamp) {
    if (!this.wallet) return;
    const target = this.getHudCoinTargetPosition();
    this.dooberPopups.push({
      text: `+${amount}`,
      amount,
      startX: doober.x + doober.size / 2,
      startY: doober.y + doober.size / 2,
      targetX: target.x,
      targetY: target.y,
      createdAt: timestamp,
    });
  }

  // Removes popups once their flight finishes - the moment one does, its
  // amount is applied to the locally-displayed wallet right then (not at
  // pickup), so the HUD's coin count visibly ticks up in sync with the
  // "+N" landing rather than jumping ahead of the animation.
  // kpground-api's submitRound() response (see endGame()) is still the
  // authoritative reconciliation at round end - this is just an
  // optimistic local bump for immediate feedback. Per explicit "coins
  // hitting the HUD should feel like an impact" request, landing also
  // fires a crash burst (spawnHudCoinImpact()) and a dedicated sound
  // (playCoinLandSound()) - distinct from playDooberSound()'s pickup ding,
  // since this is a different moment (the flight finishing, not the
  // doober being grabbed).
  updateDooberPopups(timestamp) {
    this.dooberPopups = this.dooberPopups.filter(popup => {
      if (timestamp - popup.createdAt < DOOBER_POPUP_DURATION) return true;
      if (this.wallet) {
        this.wallet.coins += popup.amount;
        this.spawnHudCoinImpact(popup.targetX, popup.targetY, timestamp);
        playCoinLandSound();
      }
      return false;
    });
  }

  spawnHudCoinImpact(x, y, timestamp) {
    this.hudCoinImpacts.push({ x, y, createdAt: timestamp });
  }

  updateHudCoinImpacts(timestamp) {
    this.hudCoinImpacts = this.hudCoinImpacts.filter(
      (impact) => timestamp - impact.createdAt < HUD_COIN_IMPACT_DURATION
    );
  }

  drawDooberPopups() {
    this.dooberPopups.forEach(popup => this.drawDooberPopup(popup));
  }

  // "Crash" burst where a "+N" popup just landed on the HUD - an expanding,
  // fading gold ring (same technique as drawShockwave()/drawStunBurst())
  // plus a handful of short radiating spark lines for extra "impact" punch,
  // since a plain ring alone reads closer to those two effects than a
  // distinct coin crash.
  drawHudCoinImpacts() {
    this.hudCoinImpacts.forEach((impact) => this.drawHudCoinImpact(impact));
  }

  drawHudCoinImpact(impact) {
    const ctx = this.ctx;
    const elapsed = performance.now() - impact.createdAt;
    const t = Math.min(1, elapsed / HUD_COIN_IMPACT_DURATION);
    const eased = 1 - Math.pow(1 - t, 2); // ease-out, quick expansion up front
    const alpha = 1 - t;

    const { hudCoinImpactMaxRadius, hudCoinImpactSparkLength } = this.layout;
    const radius = eased * hudCoinImpactMaxRadius;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = Math.max(1, 3 * this.layout.scale);
    ctx.beginPath();
    ctx.arc(impact.x, impact.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Sparks travel a bit further than the ring itself and shrink as they
    // go, reading as debris flung outward rather than a second ring.
    const sparkReach = radius + hudCoinImpactSparkLength * eased;
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = Math.max(1, 2 * this.layout.scale);
    for (let i = 0; i < HUD_COIN_IMPACT_SPARK_COUNT; i++) {
      const angle = (i / HUD_COIN_IMPACT_SPARK_COUNT) * Math.PI * 2;
      const innerR = radius * 0.5;
      ctx.beginPath();
      ctx.moveTo(impact.x + Math.cos(angle) * innerR, impact.y + Math.sin(angle) * innerR);
      ctx.lineTo(impact.x + Math.cos(angle) * sparkReach, impact.y + Math.sin(angle) * sparkReach);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Ease-in flight (starts slow, accelerates toward the HUD) from the
  // collection point to the coin readout, shrinking and fading over the
  // final stretch as if being pulled in rather than just stopping.
  drawDooberPopup(popup) {
    const ctx = this.ctx;
    const elapsed = performance.now() - popup.createdAt;
    const t = Math.min(1, elapsed / DOOBER_POPUP_DURATION);
    const eased = t * t * t;

    const x = popup.startX + (popup.targetX - popup.startX) * eased;
    const y = popup.startY + (popup.targetY - popup.startY) * eased;

    const shrinkStart = 0.7;
    const scale = t < shrinkStart ? 1 : 1 - 0.5 * ((t - shrinkStart) / (1 - shrinkStart));
    const fadeStart = 0.85;
    const alpha = t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / (1 - fadeStart));

    const { dooberPopupFontSize } = this.layout;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.font = `900 ${Math.round(dooberPopupFontSize)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // A soft glow behind the outline/fill, on top of the darker/thicker
    // outline below - per "bigger and readable" feedback, the old thin
    // dark stroke alone still got lost against a busy board.
    ctx.shadowColor = 'rgba(255, 213, 79, 0.9)';
    ctx.shadowBlur = dooberPopupFontSize * 0.4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = Math.max(1, dooberPopupFontSize * 0.16);
    ctx.strokeText(popup.text, 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(popup.text, 0, 0);
    ctx.restore();
  }

  moveCat() {
    const direction = this.inputHandler.getDirection();
    if (!direction) {
      this.cat.stand();
      return;
    }
    this.tryMoveCat(direction);
  }

  // Shared by player-driven movement (moveCat()) and the autonomous cat AI
  // (moveCatTowardMouse()/wanderCat(), Mouse- and Dog-controlled modes) — the
  // bounds/furniture check is identical regardless of who picked the
  // direction, only how the direction gets picked differs. `speed` defaults
  // to the cat's normal speed; wanderCat() passes its own scaled speed while
  // it can't see the mouse (see CAT_WANDER_SPEED_MULTIPLIER). Returns
  // whether the move actually happened, so wanderCat() can tell it hit a
  // wall/furniture and should pick a new direction right away.
  tryMoveCat(direction, speed = this.cat.speed) {
    const proposedPosition = { x: this.cat.x, y: this.cat.y };

    if (direction === 'up') proposedPosition.y -= speed;
    if (direction === 'down') proposedPosition.y += speed;
    if (direction === 'left') proposedPosition.x -= speed;
    if (direction === 'right') proposedPosition.x += speed;

    const isOnEscape = this.escapes.some(escape => escape.isMouseInside(this.cat));

    // Strict containment against the cat's actual display box — not the
    // old "position can dip below WALL_OFFSET by up to cat.size" formula,
    // which assumed cat.size (the oversized logical box also used for
    // catching/AI lane width) exceeded the cat's true on-screen footprint
    // enough to keep the *visible* sprite from crossing WALL_OFFSET. That
    // assumption stopped holding once DESKTOP_CHARACTER_SIZE_MULTIPLIER
    // pushed cat.size well past WALL_OFFSET itself — confirmed by direct
    // measurement (positioning the cat and walking it into each wall with
    // furniture removed) that the cat could walk flush to the raw canvas
    // edge, clipping several pixels into the wall band on every side, not
    // stopping "all the way to" the wall the way it should. Same strict
    // shape as Dog.js's own wall clamp (which measured correctly, with a
    // clean, consistent gap on all four sides) — right/bottom now account
    // for the cat's own width/height instead of only checking its raw x/y.
    const WALL_OFFSET = this.layout.wallOffset;
    const insideWalls = (
        proposedPosition.x >= WALL_OFFSET &&
        proposedPosition.x <= this.canvas.width - WALL_OFFSET - this.cat.displayWidth &&
        proposedPosition.y >= WALL_OFFSET &&
        proposedPosition.y <= this.canvas.height - WALL_OFFSET - this.cat.displayHeight
    );

    // Furniture collision uses the cat's legs/body hitbox, not the full
    // head+ears sprite (see Cat.getHitboxAt()) — a plain square built from
    // this.cat.size (like the wall-clamp above used to) would be wider than
    // even the full sprite, let alone just its solid part. Not routed
    // through Furniture.isColliding() (which assumes a square `entity.size`)
    // since this box isn't square — aabbOverlap directly, same as
    // collision.js's own comment recommends for a caller with different
    // width/height needs than the shared-entity convention provides.
    const catHitbox = this.cat.getHitboxAt(proposedPosition.x, proposedPosition.y);

    const canMove = (insideWalls || isOnEscape) && !this.furniture.some(furniture =>
      !CAT_NON_BLOCKING_FURNITURE_TYPES.includes(furniture.type) &&
      aabbOverlap(catHitbox.x, catHitbox.y, catHitbox.width, catHitbox.height, furniture.x, furniture.y, furniture.width, furniture.height)
    );
    if (canMove) {
        this.cat.move(direction, speed);
    } else {
        this.cat.stand();
    }
    // OR'd, not overwritten — a single tick can call tryMoveCat() more than
    // once (updateCatAI()'s moveCatTowardMouse() falling back to wanderCat()
    // when the direct approach is blocked — see below), and this only
    // needs to know whether *any* of them actually moved the cat.
    this.catMovedThisTick = this.catMovedThisTick || canMove;
    return canMove;
  }

  // Mouse- and Dog-controlled modes only: whenever the cat isn't the one the
  // player is driving, it needs its own behavior — chase the mouse when it
  // can see it, otherwise wander randomly. See catHasLineOfSightToMouse()
  // for the sight check. Falls back to wandering (for this tick) if the
  // direct chase move is blocked — e.g. by freestanding furniture, which
  // doesn't block sight but does block movement — so the cat routes around
  // instead of stalling in
  // place while it can still see the mouse.
  updateCatAI(timestamp) {
    if (this.catHasLineOfSightToMouse()) {
      if (!this.moveCatTowardMouse()) {
        this.wanderCat(timestamp);
      }
    } else {
      this.wanderCat(timestamp);
    }
  }

  // True only if the mouse is strictly in the cat's current facing
  // direction (cardinal — up/down/left/right, not a cone) AND no
  // wall-mounted furniture crosses the straight line between their centers.
  // Freestanding furniture (table/chair) never blocks sight. No memory of
  // last-known position — once sight is lost it's pure wander until the
  // cat's facing direction happens to line up with the mouse again. Uses
  // cat.size (the oversized logical box, not cat.displayWidth/displayHeight
  // — see checkCollision() below, which switched to the accurate display
  // box so the cat can no longer catch the mouse from noticeably outside
  // its visible sprite) deliberately for the *lane width* here — a wider
  // perception box only makes the AI notice the mouse a bit sooner, it
  // doesn't let it catch from further away, so it wasn't part of the same
  // "catches from too far away" complaint and was left as-is rather than
  // narrowed along with actual collision.
  catHasLineOfSightToMouse() {
    const cat = this.cat;
    const mouse = this.mouse;
    const direction = cat.facingDirection;

    // The half-plane the cat is facing — its own edge extended to the
    // canvas boundary, spanning the cat's cross-axis extent. The mouse has
    // to overlap this rectangle to be "in front of" the cat at all
    // (cardinal-only, not a cone), tested via the shared aabbOverlap helper.
    let laneX, laneY, laneWidth, laneHeight;
    if (direction === 'right') {
      laneX = cat.x + cat.size;
      laneY = cat.y;
      laneWidth = this.canvas.width - laneX;
      laneHeight = cat.size;
    } else if (direction === 'left') {
      laneX = 0;
      laneY = cat.y;
      laneWidth = cat.x;
      laneHeight = cat.size;
    } else if (direction === 'down') {
      laneX = cat.x;
      laneY = cat.y + cat.size;
      laneWidth = cat.size;
      laneHeight = this.canvas.height - laneY;
    } else {
      laneX = cat.x;
      laneY = 0;
      laneWidth = cat.size;
      laneHeight = cat.y;
    }

    if (!aabbOverlap(laneX, laneY, laneWidth, laneHeight, mouse.x, mouse.y, mouse.size, mouse.size)) {
      return false;
    }

    // No wall-mounted furniture piece crosses the straight line between
    // their centers — modeled as a 1px-thick segment rectangle so the
    // shared aabbOverlap helper can test it directly, rather than
    // hand-rolling the overlap arithmetic.
    const isHorizontal = direction === 'left' || direction === 'right';
    const catCenterX = cat.x + cat.size / 2;
    const catCenterY = cat.y + cat.size / 2;
    const mouseCenterX = mouse.x + mouse.size / 2;
    const mouseCenterY = mouse.y + mouse.size / 2;
    const wallFurniture = this.furniture.filter(f => WALL_FURNITURE_TYPES.includes(f.type));

    const blocked = wallFurniture.some(f => {
      if (isHorizontal) {
        const xMin = Math.min(catCenterX, mouseCenterX);
        const xMax = Math.max(catCenterX, mouseCenterX);
        return aabbOverlap(xMin, catCenterY, xMax - xMin, 1, f.x, f.y, f.width, f.height);
      }
      const yMin = Math.min(catCenterY, mouseCenterY);
      const yMax = Math.max(catCenterY, mouseCenterY);
      return aabbOverlap(catCenterX, yMin, 1, yMax - yMin, f.x, f.y, f.width, f.height);
    });

    return !blocked;
  }

  // Moves the cat one cardinal step toward the mouse's current position —
  // whichever axis has the larger gap this tick, matching the same
  // single-direction-per-tick granularity as player movement (no diagonal
  // movement introduced). Speed is unchanged/fixed for now. Uses cat.size,
  // consistent with catHasLineOfSightToMouse() above. Returns whether the
  // move actually happened, so updateCatAI() can fall back to wandering
  // (routing around) if something — e.g. freestanding furniture — blocks it.
  moveCatTowardMouse() {
    const catCenterX = this.cat.x + this.cat.size / 2;
    const catCenterY = this.cat.y + this.cat.size / 2;
    const mouseCenterX = this.mouse.x + this.mouse.size / 2;
    const mouseCenterY = this.mouse.y + this.mouse.size / 2;

    const dx = mouseCenterX - catCenterX;
    const dy = mouseCenterY - catCenterY;

    const direction = Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');

    return this.tryMoveCat(direction);
  }

  // Actively searches rather than idly wandering: moves every tick (unlike
  // Dog's once-every-couple-seconds hop) in a chosen direction, scaled by
  // CAT_WANDER_SPEED_MULTIPLIER (currently 1.0 — no boost, see its comment),
  // only re-picking that direction every CAT_WANDER_DIRECTION_INTERVAL — or
  // immediately, if the current direction just ran into a wall/furniture,
  // so it doesn't sit stuck in a corner until the timer happens to expire.
  wanderCat(timestamp) {
    const wander = this.catWander;
    const directionExpired = !wander.direction || (timestamp - wander.lastDirectionChange >= CAT_WANDER_DIRECTION_INTERVAL);

    if (directionExpired) {
      wander.direction = this.pickRandomDirection();
      wander.lastDirectionChange = timestamp;
    }

    const moved = this.tryMoveCat(wander.direction, this.cat.speed * CAT_WANDER_SPEED_MULTIPLIER);

    if (!moved) {
      wander.direction = this.pickRandomDirection();
      wander.lastDirectionChange = timestamp;
    }
  }

  pickRandomDirection() {
    const directions = ['up', 'down', 'left', 'right'];
    return directions[Math.floor(Math.random() * directions.length)];
  }

  updateMouse() {
    if (this.controlledEntity === 'mouse') {
      this.movePlayerMouse();
    } else {
      this.mouse.update();
      const mouseColliding = false; // Mouse can pass through furniture

      if (mouseColliding) {
        this.mouse.speedX *= -1;
        this.mouse.speedY *= -1;
      }
    }

    this.updateEscapeDangerIndicator();

    // Escape itself is checked from checkMouseEscapeOnWallHit() (fired by
    // the wall-hit callback below, at the moment the mouse actually
    // contacts a wall), not here — catching is still a plain continuous
    // check since it isn't tied to any particular event the way reaching a
    // hole in a specific wall is.
    if (this.checkCollision(this.cat, this.mouse)) {
      // The cat catching the mouse is a win for whoever's playing the cat,
      // a loss for whoever's playing the mouse OR the dog — the dog's whole
      // job is to stop this from happening (pause the cat, buy the mouse
      // time), so it's on the mouse's "team" for win/lose purposes even
      // though it never touches the mouse directly. Same trigger, meaning
      // depends on controlledEntity (see Character selection & Mouse-
      // controlled mode in CLAUDE.md).
      this.endGame(MESSAGES.CAT_CAUGHT_MOUSE, SOUND_KEYS.CAT_CATCH, this.controlledEntity === 'cat');
    }
  }

  // This has been through three shapes, each fixing a real problem the
  // previous one had:
  // 1. Checked every tick, unconditionally — the mouse could "escape" by
  //    loitering anywhere within hasMouseEntered()'s catch zone, reported
  //    live as "if the mouse gets anywhere near the hole, it escapes."
  // 2. Checked only at the moment of an actual wall-contact event
  //    (`mouse.wallHitCallback`, both the autonomous bounce and the
  //    player's wall-clamp), plus every subsequent tick spent still moving
  //    while already flush against that wall (so sliding along it to line
  //    up wasn't punished). This fixed (1), but the second half — checking
  //    while still *moving* — meant simply running/sliding straight past a
  //    hole along the wall, never stopping, also counted: reported live as
  //    "if I run to the top wall's non mouse hole block, and just turn
  //    straight left or right and run straight, just running by one
  //    escapes... I'd like you to have to stop at it and enter it."
  // 3. Current: for the **player-controlled** mouse specifically, this is
  //    now only ever called while the player is *not* pressing a movement
  //    key (see the `else` branch in movePlayerMouse() below) — arriving at
  //    the wall or sliding along it never escapes by itself anymore, no
  //    matter how well-aligned the pass-through is; only actually stopping
  //    there does. For the **autonomous** mouse (Cat/Dog mode), there's no
  //    equivalent "player released a key" moment to key off, and the
  //    original wall-contact-event trigger was never part of any of these
  //    complaints (the autonomous mouse bounces immediately away rather
  //    than sliding along a wall, so it never had the "running by" exploit
  //    to begin with) — so it's untouched, still wired straight to the
  //    bounce via `mouse.escapeCheckCallback` (separate from
  //    `wallHitCallback`, which is sound-only now — see
  //    resetGameObjects()).
  checkMouseEscapeOnWallHit() {
    if (this.mouseEscaped || this.gameOver) return;
    if (this.checkMouseEscaped()) {
      this.mouseEscaped = true;
      this.endGame(MESSAGES.MOUSE_ESCAPED, SOUND_KEYS.MOUSE_ESCAPE, this.controlledEntity !== 'cat');
    }
  }

  // Mouse-controlled mode only: reads arrow-key input directly, same
  // pattern as tryMoveCat(), but the mouse intentionally ignores furniture
  // collision — it ducks under furniture visually rather than being blocked
  // by it (see Mouse.js / drawMouseSilhouette() below) — so only canvas
  // bounds are checked here.
  movePlayerMouse() {
    const direction = this.inputHandler.getDirection();

    if (direction) {
      this.mouseLastMovedAt = performance.now();

      const DIRECTION_TO_FACING = { up: 'north', down: 'south', left: 'west', right: 'east' };
      this.mouse.currentDirection = DIRECTION_TO_FACING[direction];

      const speed = this.layout.mousePlayerSpeed;
      let proposedX = this.mouse.x;
      let proposedY = this.mouse.y;

      if (direction === 'up') proposedY -= speed;
      if (direction === 'down') proposedY += speed;
      if (direction === 'left') proposedX -= speed;
      if (direction === 'right') proposedX += speed;

      const clampedX = Math.max(0, Math.min(proposedX, this.canvas.width - this.mouse.size));
      const clampedY = Math.max(0, Math.min(proposedY, this.canvas.height - this.mouse.size));

      // Wall-hit sound only, not escape — see checkMouseEscapeOnWallHit()'s
      // own comment for why escape isn't checked from a fresh clamp here.
      // Matches the autonomous mouse's own wall-bounce path, which always
      // plays this on contact — otherwise player-controlled mode would
      // never play the wall-hit sound at all. Only on the tick that
      // actually causes the clamp, not every tick spent resting against a
      // wall already reached — same reasoning as the autonomous bounce,
      // which likewise only fires once per contact.
      if ((clampedX !== proposedX || clampedY !== proposedY) && this.mouse.wallHitCallback) {
        this.mouse.wallHitCallback();
      }

      this.mouse.x = clampedX;
      this.mouse.y = clampedY;

      // "Turning to enter": pressing the direction that faces *into*
      // whichever wall the mouse is currently resting flush against (not
      // the along-the-wall direction that would slide past it) also
      // counts as deliberate entry, even without releasing the key first
      // — per explicit direction ("actually stopping at the mouse hole, or
      // turning to enter it is fine"). Each wall has exactly one "into"
      // direction (up for the top wall, left for the left wall, etc.);
      // sliding parallel to a wall never matches its own "into" direction,
      // so this can't be satisfied by merely running along one.
      const atTop = clampedY === 0;
      const atBottom = clampedY === this.canvas.height - this.mouse.size;
      const atLeft = clampedX === 0;
      const atRight = clampedX === this.canvas.width - this.mouse.size;
      const enteringWall =
        (direction === 'up' && atTop) ||
        (direction === 'down' && atBottom) ||
        (direction === 'left' && atLeft) ||
        (direction === 'right' && atRight);
      if (enteringWall) this.checkMouseEscapeOnWallHit();

      this.mouse.updateAnimations();
    } else {
      if (performance.now() - this.mouseLastMovedAt >= MOUSE_STOP_DEBOUNCE_MS) {
        // No movement key held this tick, *and* it's been long enough since
        // one last was — see MOUSE_STOP_DEBOUNCE_MS's own comment for why the
        // debounce is needed (a single idle tick isn't reliably "the player
        // stopped," a tapped key produces those too). Safe to call every
        // tick this condition holds, not just the first: gated by
        // checkMouseEscapeOnWallHit()'s own mouseEscaped/gameOver guard, and
        // hasMouseEntered()'s own geometry already requires the mouse to be
        // resting at a wall for it to ever return true, so this is a correct
        // no-op whenever the mouse stopped out in the open floor instead.
        this.checkMouseEscapeOnWallHit();
      }
      // No direction held this tick — snap to a resting pose rather than
      // continuing to cycle the walk-cycle frames in place (same bug class
      // as movePlayerDog()'s own stand() fix).
      this.mouse.stand();
    }
  }

  // Dog-controlled mode only: reads arrow-key input directly, same per-tick
  // granularity and bounds/furniture rules as tryMoveCat() (the dog is a
  // solid obstacle for itself the same way the cat is — no reason for the
  // player-driven dog to suddenly ignore furniture just because the
  // autonomous dog also happens to avoid it via a different check).
  // Uses layout.dogPlayerSpeed, not this.dog.speed — that field now drives
  // only the autonomous wander (see Dog.js), tuned purely for how the dog
  // should feel as a hazard when you're not the one piloting it; player
  // control needs its own fairness-matched value instead (see
  // BASE_DOG_PLAYER_SPEED's own comment).
  tryMoveDog(direction) {
    const speed = this.layout.dogPlayerSpeed;
    let proposedX = this.dog.x;
    let proposedY = this.dog.y;

    if (direction === 'up') proposedY -= speed;
    if (direction === 'down') proposedY += speed;
    if (direction === 'left') proposedX -= speed;
    if (direction === 'right') proposedX += speed;

    const isOnEscape = this.escapes.some(escape => escape.isMouseInside(this.dog));

    // Uses the dog's actual rendered box (frameWidth/frameHeight — the same
    // dimensions Dog.draw()/Dog.isColliding() already use), not
    // this.dog.size (50*sizeScale, smaller than the sprite's real
    // 60*sizeScale width), and requires the box to stay fully inside
    // [WALL_OFFSET, canvas - WALL_OFFSET] on both axes — a strict
    // containment check, not the cat/mouse clamps' old "position can dip
    // below WALL_OFFSET by up to size" convention. That permissive
    // convention assumed size was *larger* than the entity's true on-screen
    // footprint, so the allowance would never actually push the visible
    // sprite past the canvas edge — true for the dog only if frameWidth/
    // frameHeight (60/38 * sizeScale) stayed *smaller* than WALL_OFFSET
    // (40 * scale), which it never does at any scale, so the same style of
    // "allow position - size" formula let the dog's sprite edge go
    // negative — i.e. off the left/top of the canvas — even after
    // subtracting the correct dimension instead of the wrong one (confirmed
    // live: the dog could still vanish off the left/top edge with only that
    // first fix in place). Strict containment is the only version of this
    // check that's safe regardless of how frameWidth/WALL_OFFSET compare —
    // the cat's own wall clamp (tryMoveCat() above) has since been switched
    // to this same strict style, for the same underlying reason (measured
    // to have the identical clipping problem once its own size multiplier
    // grew past WALL_OFFSET too).
    const WALL_OFFSET = this.layout.wallOffset;
    const insideWalls = (
        proposedX >= WALL_OFFSET &&
        proposedX <= this.canvas.width - WALL_OFFSET - this.dog.frameWidth &&
        proposedY >= WALL_OFFSET &&
        proposedY <= this.canvas.height - WALL_OFFSET - this.dog.frameHeight
    );

    // Same frameWidth/frameHeight box as the wall clamp just above, not
    // this.dog.size (a plain square that doesn't match frameWidth/
    // frameHeight's real 60/38 aspect ratio) — confirmed by direct
    // measurement that the square box let the dog clip ~15px into
    // furniture approached horizontally while stopping ~20px short of
    // furniture approached vertically. Not routed through
    // Furniture.isColliding() (assumes a square `entity.size`) for the same
    // reason Cat.js's own furniture check bypasses it — aabbOverlap
    // directly, matching Dog.js's own autonomous tryMove()'s identical fix.
    const canMove = (insideWalls || isOnEscape) && !this.furniture.some(furniture =>
      !DOG_NON_BLOCKING_FURNITURE_TYPES.includes(furniture.type) &&
      aabbOverlap(proposedX, proposedY, this.dog.frameWidth, this.dog.frameHeight, furniture.x, furniture.y, furniture.width, furniture.height)
    );
    if (canMove) {
      this.dog.x = proposedX;
      this.dog.y = proposedY;
      // Only left/right change facing (see Dog.js's facingLeft) — up/down
      // keep whichever way it was last actually facing, same convention
      // the autonomous dog uses.
      if (direction === 'left') this.dog.facingLeft = true;
      if (direction === 'right') this.dog.facingLeft = false;
    }
    return canMove;
  }

  movePlayerDog() {
    const direction = this.inputHandler.getDirection();
    if (!direction) {
      this.dog.stand();
      return;
    }
    const moved = this.tryMoveDog(direction);
    if (moved) {
      this.dog.updateAnimation(this.dog.playerFrameSpeed);
    } else {
      this.dog.stand();
    }
  }

  // Drives the power-LED-as-danger-meter in the viewport frame (see
  // styles.css body::before / body[data-mouse-danger]) — red when the
  // mouse is right on top of an escape hole, yellow approaching one,
  // green otherwise. Distance is to the nearest escape's center, since the
  // mouse can slip out through any of them, not just the guaranteed one.
  updateEscapeDangerIndicator() {
    const mouseCenterX = this.mouse.x + this.mouse.size / 2;
    const mouseCenterY = this.mouse.y + this.mouse.size / 2;

    const nearestDistance = Math.min(...this.escapes.map(escape => {
      const escapeCenterX = escape.x + escape.width / 2;
      const escapeCenterY = escape.y + escape.height / 2;
      return Math.hypot(mouseCenterX - escapeCenterX, mouseCenterY - escapeCenterY);
    }));

    const { escapeDangerDistance, escapeWarningDistance } = this.layout;
    let danger = 'low';
    if (nearestDistance <= escapeDangerDistance) danger = 'high';
    else if (nearestDistance <= escapeWarningDistance) danger = 'medium';

    document.body.dataset.mouseDanger = danger;
  }

  handleDogCollision() {
    this.catPaused = true;
    const hasLongerPausePerk = this.controlledEntity === 'dog' && this.ownedPerkSlugs.has('longer-pause');
    this.pauseEndTime = performance.now() + DOG_PAUSE_DURATION * (hasLongerPausePerk ? LONGER_PAUSE_PERK_MULTIPLIER : 1);
    this.message = MESSAGES.DOG_CAUGHT;
    this.catStunStartTime = performance.now();
    this.catStunSource = 'dog';
    this.playSound(SOUND_KEYS.DOG_BARK);
    // Layered on top of the bark above, not instead of it — see
    // SOUND_KEYS.GOTCHA's own comment.
    this.playSound(SOUND_KEYS.GOTCHA);

    const OFFSET = 20;
    if (this.dog.x < this.cat.x) this.dog.x -= OFFSET;
    else this.dog.x += OFFSET;
    if (this.dog.y < this.cat.y) this.dog.y -= OFFSET;
    else this.dog.y += OFFSET;
  }

  endGame(message, soundKey, isWin) {
    this.running = false;
    this.gameOver = true;
    // render() stops calling drawHud() once gameOver is true (see render()),
    // so this would otherwise be a stale hit area sitting under the modal.
    this.storeButtonArea = null;
    this.message = message;
    this.gameOverIsWin = isWin;
    this.gameOverStartTime = performance.now();
    this.playSound(soundKey);
    // A distinct win/loss cue on top of the event sound above — soundKey is
    // the same neutral event sound (a meow, a mouse squeak) regardless of
    // whether that event is good or bad news for whoever's playing (see
    // Win/lose semantics in CLAUDE.md), so it alone was never a "you won!"
    // cue. Not the same playModalPopSound() every other modal in this game
    // uses — this moment is bigger than a transitional pop (see that
    // function's own comment for why it was deliberately excluded here).
    if (isWin) {
      playWinSound();
    } else {
      playLoseSound();
    }

    // Cleanup autonomous behaviors — dog.cleanup() stops the bark schedule
    // for good (as opposed to settingsMenuToggleHandler's pauseBarking(),
    // which expects a resume later), but that alone only cancels *future*
    // scheduled barks; it doesn't touch a bark clip that's already
    // mid-playback (e.g. from a dog/cat collision moments before the round
    // ended), which — since playSound() just calls HTMLAudioElement.play()
    // and nothing ever paused it — used to keep audibly barking on top of
    // the win/lose modal. stopDogBarkSound() below handles that half.
    if (this.dog) this.dog.cleanup();
    this.stopDogBarkSound();

    // Fire-and-forget - a failed/slow submission shouldn't block or delay
    // the game-over modal the player is already looking at.
    // coinsCollectedThisRound is this round's in-gameplay doober tally
    // (see updateDoobers()), sent alongside the win/loss outcome reward
    // rather than as its own network call per doober. If never logged in
    // (the API was unreachable at both the title screen and GameScreen's
    // own background retry - see init()) or submitRound() itself fails
    // mid-flight, the result is queued via queuePendingRound() instead of
    // being lost - flushPendingRounds() (init()) replays it once a future
    // connection succeeds, same session or a later one.
    //
    // roundRewardBreakdown drives displayGameOverModal()'s "here's what you
    // earned" section (per explicit request the win/lose modal should show
    // everything the player was rewarded for the round). Set to a 'pending'
    // placeholder *synchronously* here, before submitRound() has actually
    // resolved, so the modal reserves the section's height on its very
    // first paint - filling it in once the real numbers arrive doesn't then
    // require the modal to grow/jump. Only shown at all if walletAtRoundStart
    // exists (i.e. the wallet loaded successfully at round start) - matches
    // the rest of this game's "no wallet, no HUD" convention for logged-out
    // play.
    this.roundRewardBreakdown = this.walletAtRoundStart ? { status: 'pending' } : null;

    if (isLoggedIn()) {
      submitRound(this.controlledEntity, isWin ? 'win' : 'loss', this.coinsCollectedThisRound)
        .then((wallet) => {
          this.wallet = wallet;
          if (this.walletAtRoundStart) {
            // Diffed against the snapshot taken when the wallet first
            // loaded, rather than duplicating the backend's own reward
            // constants (WIN_COINS/LOSS_XP/etc - see kpground-api's
            // kattrap/services.py submit_round()) client-side to guess at
            // them - this way the breakdown can never drift out of sync
            // with whatever the backend actually awarded.
            const start = this.walletAtRoundStart;
            const totalCoinsGained = wallet.coins - start.coins;
            const dooberCoins = this.coinsCollectedThisRound;
            const leveledUp = wallet.level > start.level;
            this.roundRewardBreakdown = {
              status: 'ready',
              totalCoinsGained,
              dooberCoins,
              // Whatever's left after doobers is the flat win/loss round
              // reward - never negative in practice (dooberCoins can't
              // exceed what was actually collected this round), but
              // clamped defensively since this is arithmetic on live
              // network data, not a value this code controls end-to-end.
              baseCoinsGained: Math.max(0, totalCoinsGained - dooberCoins),
              leveledUp,
              newLevel: wallet.level,
              // XP gained is only meaningful to show as a plain delta when
              // no level-up happened this round - add_xp()'s own carry/reset
              // behavior across a level boundary isn't duplicated
              // client-side, so a raw wallet.xp - start.xp diff would be
              // wrong (and misleading) whenever a level-up occurred.
              xpGained: leveledUp ? null : wallet.xp - start.xp,
            };
          }
        })
        .catch((err) => {
          console.warn('Round submission failed, queuing for retry:', err.message);
          queuePendingRound(this.controlledEntity, isWin ? 'win' : 'loss', this.coinsCollectedThisRound);
          if (this.roundRewardBreakdown) this.roundRewardBreakdown = { status: 'error' };
        });
    } else {
      queuePendingRound(this.controlledEntity, isWin ? 'win' : 'loss', this.coinsCollectedThisRound);
    }
  }

  // Shared by every pausing overlay (settings menu, store modal - see
  // their toggle handlers in init()) rather than each hand-rolling its own
  // running/bark/poop pause logic. This exists because that duplication
  // already caused a real bug once: storeModalToggleHandler was originally
  // written as a partial copy of settingsMenuToggleHandler that paused
  // this.running but forgot the dog's bark/poop timers entirely (reported
  // live as "a stray dog bark" with the store open), since those two
  // handlers had no shared code to keep them in sync. Routing both (and
  // any future overlay) through these two methods instead means there is
  // exactly one place bark/poop pausing lives, so a third overlay gets it
  // automatically just by calling these rather than needing to remember
  // and re-copy the bark-specific bits by hand again.
  //
  // A counter, not a boolean, so two overlays open at once (however
  // unlikely today) can't let the first one's close resume gameplay out
  // from under the second, still-open one - only the transition into/out
  // of "zero overlays open" actually touches this.running.
  pauseForOverlay() {
    if (this.pausingOverlayCount === 0) {
      this.wasRunningBeforeOverlay = this.running;
      this.running = false;
      // this.running gates the game loop's own update() (see update()'s
      // early return), but the dog's bark/poop timers are scheduled via
      // plain setTimeout chains that run on real wall-clock time
      // regardless of this.running, so without this they'd keep firing
      // audibly over a paused board.
      if (this.dog) {
        this.dog.pauseBarking();
        this.dog.pausePooping();
      }
      // Cuts off a bark that's already mid-playback at the moment the
      // overlay opens, the same way endGame() does at round end -
      // pauseBarking() above only stops *future* barks from being
      // scheduled.
      this.stopDogBarkSound();
    }
    this.pausingOverlayCount++;
  }

  resumeForOverlay() {
    this.pausingOverlayCount = Math.max(0, this.pausingOverlayCount - 1);
    if (this.pausingOverlayCount > 0) return;
    if (this.wasRunningBeforeOverlay === null) return;
    this.running = this.wasRunningBeforeOverlay;
    this.wasRunningBeforeOverlay = null;
    // Only resume barking/pooping if play is actually resuming - if every
    // overlay closed after the round had already ended, this.running
    // restores to false (game over) and the dog should stay silent.
    // resumePooping() is also skipped in Dog mode - the autonomous timer
    // was never started there in the first place (see resetGameObjects()),
    // and resuming it unconditionally here would start it for the first
    // time in a mode where poop is meant to be player-triggered only.
    if (this.running && this.dog) {
      this.dog.resumeBarking();
      if (this.controlledEntity !== 'dog') this.dog.resumePooping();
    }
  }

  // Immediately silences a dog bark that's already mid-playback — shared by
  // endGame() (round over) and pauseForOverlay() (an overlay opened
  // mid-round) since both need to cut off a currently-playing clip, not
  // just stop future ones from being scheduled (that part is Dog.js's own
  // job, via cleanup()/pauseBarking()).
  stopDogBarkSound() {
    const dogBarkSound = this.sounds[SOUND_KEYS.DOG_BARK];
    if (dogBarkSound) {
      dogBarkSound.pause();
      dogBarkSound.currentTime = 0;
    }
  }

  // Uses cat.displayWidth/displayHeight (the cat's actual visible sprite
  // box), not cat.size (the oversized logical box also used for wall
  // clamping/AI lane width) — confirmed live and by direct measurement that
  // cat.size let the cat "catch" the mouse from noticeably outside its
  // visible sprite. That fix alone still wasn't tight enough — reported
  // live again as "you can catch other characters from pretty far away" —
  // since a full display box still reaches past the cat's actual solid
  // body out to its ear/whisker tips. insetBox() (see collision.js) shrinks
  // both boxes to their central CATCH_HITBOX_SCALE, so contact now has to
  // happen closer to where the characters actually look like they're
  // touching, not just where their outermost protrusions overlap.
  checkCollision(cat, mouse) {
    const catBox = insetBox(cat.x, cat.y, cat.displayWidth, cat.displayHeight);
    const mouseBox = insetBox(mouse.x, mouse.y, mouse.size, mouse.size);
    return aabbOverlap(
      catBox.x, catBox.y, catBox.width, catBox.height,
      mouseBox.x, mouseBox.y, mouseBox.width, mouseBox.height
    );
  }

  // Escape.hasMouseEntered() (stricter than the isMouseInside() also used
  // to exempt the cat/dog's wall clamp near the wall gap — see Escape.js)
  // requires the hole to be fully covered by the mouse's own box, not just
  // any edge-touching overlap — per explicit direction ("the mouse can
  // escape by just being near a mouse hole... can it be that the mouse has
  // to actually enter it?"). `layout.escapeHitboxMargin` widens that check
  // a bit further — see BASE_ESCAPE_HITBOX_MARGIN's own comment for why
  // that's a separate constant from the hole's own visual size.
  checkMouseEscaped() {
    return this.escapes.some(escape => escape.hasMouseEntered(this.mouse, this.layout.escapeHitboxMargin));
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawFloor();
    this.drawWalls();
    this.escapes.forEach(escape => escape.draw(this.ctx));
    if (this.controlledEntity === 'mouse' && this.ownedPerkSlugs.has('hole-radar')) {
      this.drawEscapeRadar();
    }
    // A floor-level hazard, same as the escapes above — drawn before the
    // mouse/furniture/characters so anything walking over it draws on top,
    // the same convention every other ground-level thing in this sequence
    // already follows.
    this.drawPoops();
    // Same ground-level-before-characters convention as escapes/poops
    // above - a doober should visually sit under whoever walks over it,
    // not on top.
    this.drawDoobers();
    // Mouse draws before furniture so it visually ducks under furniture
    // it's overlapping, even though it isn't blocked by it (see updateMouse).
    // Skipped once it's escaped (see checkMouseEscaped()) so it doesn't
    // stay visibly sitting at the hole for the rest of the ended round.
    if (this.mouse && !this.mouseEscaped) this.mouse.draw(this.ctx);
    this.furniture.forEach(furniture => furniture.draw(this.ctx));
    this.drawMouseSilhouette();
    this.drawGameObjects();
    this.drawShockwave();

    if (this.gameOver) {
      this.displayGameOverModal();
    } else {
      // Only live during active play - the game-over modal's own scrim
      // covers this area anyway, and storeButtonArea is nulled out below
      // so a click can't land on where the button used to be.
      this.drawHud();
      this.drawStoreButton();
      // Drawn after the HUD so a flying "+N" visibly lands on top of the
      // coin readout at the end of its flight, not underneath it. The
      // crash burst draws last of the three so it's never covered by a
      // still-in-flight popup that happens to land the same frame.
      this.drawDooberPopups();
      this.drawHudCoinImpacts();
      if (this.message) this.displayMessage();
    }
  }

  // Opens the store modal (js/utils/storeModal.js) for whichever
  // character this round is played as - purchases spend/gate against
  // that character's own wallet only (see kpground-api's per-character
  // economy design). Passes this.wallet as the modal's starting state and
  // a callback so a purchase's returned wallet flows straight back into
  // the HUD without a redundant re-fetch.
  openStore() {
    if (!this.wallet) return;
    openStoreModal(
      this.controlledEntity,
      this.wallet,
      (updatedWallet) => {
        this.wallet = updatedWallet;
      },
      (character, outfitItem) => this.applyEquippedOutfit(character, outfitItem)
    );
  }

  // Shared geometry for the HUD box (top-center, wide) and its
  // three-stat row (see HUD_STATS) - used by drawHud() itself,
  // getHudCoinTargetPosition() (the doober popup's flight target), and
  // handleMouseMove()'s hover hit-test, so all three agree on where the
  // HUD actually sits without recomputing (and risking drift on) the
  // same math three separate times. Geometry only - doesn't need
  // this.wallet, unlike drawHud() itself.
  getHudLayout() {
    const { hudMargin, hudPadding, hudWidth, hudStatRowHeight } = this.layout;
    const x = (this.canvas.width - hudWidth) / 2;
    const y = hudMargin;
    const innerWidth = hudWidth - hudPadding * 2;
    const statWidth = innerWidth / HUD_STATS.length;
    const statRowY = y + hudPadding + hudStatRowHeight / 2;
    return { x, y, hudWidth, hudPadding, hudStatRowHeight, innerWidth, statWidth, statRowY };
  }

  // Where the coin stat is actually drawn (see drawHud()) - shared with
  // spawnDooberCollectPopup()'s flight target so the two can never drift
  // apart, same "one shared position, two consumers" pattern
  // Cutscene.js's getButtonRect() uses for its own drawn button vs.
  // click hit box. Coins is always HUD_STATS[0].
  getHudCoinTargetPosition() {
    const { x, hudPadding, statWidth, statRowY } = this.getHudLayout();
    return { x: x + hudPadding + statWidth * 0.5, y: statRowY };
  }

  // Coin/level/XP HUD, top-center - skipped entirely if this.wallet
  // hasn't loaded yet (still fetching, or never logged in). Same "dark
  // translucent rounded box, white text" chrome language as
  // displayMessage()'s pill banner. Redesigned per explicit direction:
  // wider, centered (not corner-anchored), and every wallet stat gets its
  // own emoji+value chip in one row (see HUD_STATS) with a hover tooltip
  // (drawHudTooltip()) rather than coins/level being drawn as two
  // differently-styled stacked rows.
  drawHud() {
    if (!this.wallet) {
      this.storeButtonArea = null;
      this.hudStatAreas = [];
      return;
    }

    const { hudPadding, hudWidth, hudStatRowHeight, hudRadius, hudFontSize, hudXpBarHeight } = this.layout;
    const { x, y, statWidth, statRowY } = this.getHudLayout();
    const height = hudPadding * 2.5 + hudStatRowHeight + hudXpBarHeight;

    this.ctx.save();
    drawRoundedRect(this.ctx, x, y, hudWidth, height, hudRadius);
    this.ctx.fillStyle = 'rgba(20, 10, 30, 0.6)';
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    this.ctx.font = `bold ${Math.round(hudFontSize)}px Arial, sans-serif`;
    this.ctx.textBaseline = 'middle';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#ffffff';

    // Divider lines between chips - purely visual, not part of the hit
    // boxes below (those stay the full chip width so a hover doesn't
    // require pixel-precise aim right up to a 1px line).
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    for (let i = 1; i < HUD_STATS.length; i++) {
      const dividerX = x + hudPadding + statWidth * i;
      this.ctx.beginPath();
      this.ctx.moveTo(dividerX, y + hudPadding * 0.5);
      this.ctx.lineTo(dividerX, y + hudPadding * 0.5 + hudStatRowHeight);
      this.ctx.stroke();
    }
    this.ctx.fillStyle = '#ffffff';

    // Rebuilt fresh every frame - cheap, and means a wallet stat changing
    // (coins ticking up, a level-up) never leaves a stale hit box behind.
    this.hudStatAreas = HUD_STATS.map((stat, i) => {
      const centerX = x + hudPadding + statWidth * (i + 0.5);
      // Coins gets a small crop of the real doober_coin.png art instead of
      // an emoji, per explicit request ("the coin icon should be a smaller
      // version of the coin doober") - matches drawCoinDooberContent()'s
      // own image once loaded; falls back to the emoji for one frame if
      // somehow drawn before the image has decoded.
      if (stat.key === 'coins' && this.dooberCoinImage.naturalWidth) {
        this.drawHudCoinStatText(centerX, statRowY, stat.getText(this.wallet));
      } else {
        this.ctx.fillText(`${stat.emoji} ${stat.getText(this.wallet)}`, centerX, statRowY);
      }
      return {
        x: x + hudPadding + statWidth * i,
        y,
        width: statWidth,
        height: hudPadding + hudStatRowHeight,
        centerX,
        label: stat.label,
        description: stat.description,
      };
    });

    // Full-width XP progress bar under the stat row - xp_to_next_level
    // comes from the backend (see kpground-api's CharacterWalletSerializer)
    // rather than duplicating the XP_PER_LEVEL curve here.
    const barX = x + hudPadding;
    const barY = y + hudPadding * 1.5 + hudStatRowHeight;
    const barWidth = hudWidth - hudPadding * 2;
    const xpFraction = this.wallet.xp_to_next_level
      ? Math.min(1, this.wallet.xp / this.wallet.xp_to_next_level)
      : 0;

    drawRoundedRect(this.ctx, barX, barY, barWidth, hudXpBarHeight, hudXpBarHeight / 2);
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    this.ctx.fill();
    if (xpFraction > 0) {
      drawRoundedRect(this.ctx, barX, barY, barWidth * xpFraction, hudXpBarHeight, hudXpBarHeight / 2);
      this.ctx.fillStyle = '#ffb238';
      this.ctx.fill();
    }
    this.ctx.restore();

    // Hover tooltip, drawn last so it sits on top of the HUD it's
    // explaining - see handleMouseMove() for how hoveredHudStatIndex gets
    // set. The store button (see drawStoreButton()) lives outside the HUD
    // box now and draws itself separately.
    if (this.hoveredHudStatIndex !== null && this.hudStatAreas[this.hoveredHudStatIndex]) {
      this.drawHudTooltip(this.hudStatAreas[this.hoveredHudStatIndex]);
    }
  }

  // Store button - a floating circular button pinned to the canvas's
  // top-right corner, moved out from under the HUD box per explicit
  // direction (was: a text pill centered just below it) and given a
  // shopping-cart icon instead of a text label. A small "Store" caption
  // still draws underneath, though, since an icon-only button loses
  // discoverability for a first-time player. Gated on this.wallet exactly
  // like the old in-HUD button was - no login means no economy UI at all.
  // Deliberately static (no idle animation) - an earlier version bobbed
  // up and down and that was flagged as unwanted.
  drawStoreButton() {
    if (!this.wallet) {
      this.storeButtonArea = null;
      return;
    }

    const { storeButtonSize, storeButtonMargin, storeButtonIconSize, storeButtonLabelFontSize, wallBandThickness } =
      this.layout;
    // wallBandThickness pushes the button clear of the wall band drawn by
    // drawWalls() - the flat uiScale-only margin alone left it sitting
    // right on top of the wall on some canvas sizes.
    const edgeMargin = wallBandThickness + storeButtonMargin;
    const centerX = this.canvas.width - edgeMargin - storeButtonSize / 2;
    const centerY = edgeMargin + storeButtonSize / 2;

    this.storeButtonArea = {
      x: centerX - storeButtonSize / 2,
      y: centerY - storeButtonSize / 2,
      width: storeButtonSize,
      height: storeButtonSize,
    };

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, storeButtonSize / 2, 0, Math.PI * 2);
    // A radial gradient with its hot spot offset toward the upper-left
    // fakes a single light source hitting a glossy surface - a plain
    // top-to-bottom linear gradient (the old fill) reads flat/matte by
    // comparison.
    const gradient = this.ctx.createRadialGradient(
      centerX - storeButtonSize * 0.22,
      centerY - storeButtonSize * 0.28,
      storeButtonSize * 0.05,
      centerX,
      centerY,
      storeButtonSize * 0.75
    );
    gradient.addColorStop(0, '#fff6d8');
    gradient.addColorStop(0.35, '#ffcf5c');
    gradient.addColorStop(1, '#d97e1a');
    this.ctx.fillStyle = gradient;
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    this.ctx.shadowBlur = 6;
    this.ctx.shadowOffsetY = 2;
    this.ctx.fill();
    this.ctx.shadowColor = 'transparent';
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetY = 0;
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // A small soft-white ellipse near the top edge, clipped to the circle,
    // is the actual "specular glint" that sells the shine - the radial
    // gradient alone still reads as a plain painted sphere without it.
    this.ctx.save();
    this.ctx.clip();
    this.ctx.beginPath();
    this.ctx.ellipse(
      centerX - storeButtonSize * 0.1,
      centerY - storeButtonSize * 0.3,
      storeButtonSize * 0.3,
      storeButtonSize * 0.16,
      -0.4,
      0,
      Math.PI * 2
    );
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    this.ctx.fill();
    this.ctx.restore();

    this.ctx.font = `${Math.round(storeButtonIconSize)}px Arial, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('\u{1F6D2}', centerX, centerY + 1); // 🛒
    this.ctx.restore();

    this.ctx.save();
    this.ctx.font = `bold ${Math.round(storeButtonLabelFontSize)}px Arial, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    this.ctx.shadowBlur = 3;
    this.ctx.fillText('Store', centerX, this.storeButtonArea.y + storeButtonSize + 4);
    this.ctx.restore();
  }

  // Draws a coin icon (a small crop of the real doober_coin.png art) plus
  // a value, centered together as one unit under `centerX` - can't just
  // fillText() an emoji next to it, since the icon and text need
  // independent draw calls (drawImage vs fillText) but still have to land
  // centered as a pair. Reused by both drawHud() (the HUD's coins chip)
  // and drawRewardsBreakdown() (the modal's "+N Coins" row) - fontSize
  // defaults to the HUD's own size but each caller passes whatever size
  // its own ctx.font is currently set to, so the icon scales with the text
  // it's sitting next to rather than always matching the HUD specifically.
  // ctx.font/textBaseline are assumed already set by the caller.
  drawHudCoinStatText(centerX, y, text, fontSize = this.layout.hudFontSize) {
    const ctx = this.ctx;
    const image = this.dooberCoinImage;
    const { iconWidth, gap, totalWidth } = this.measureHudCoinStatBlock(text, fontSize);
    const iconHeight = iconWidth * (image.naturalHeight / image.naturalWidth);
    const startX = centerX - totalWidth / 2;

    ctx.drawImage(image, startX, y - iconHeight / 2, iconWidth, iconHeight);

    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    ctx.fillText(text, startX + iconWidth + gap, y);
    ctx.textAlign = prevAlign;
  }

  // Geometry drawHudCoinStatText() draws to - split out so a caller that
  // needs to lay this icon+text block out relative to *other* content
  // (drawRewardsBreakdown()'s one-row layout, which needs to know how wide
  // this block will actually be before it can center a second block next
  // to it) can measure it without duplicating the icon/gap sizing ratios
  // and risking the two drifting apart. Assumes ctx.font is already set to
  // whatever it'll actually be drawn in, same as drawHudCoinStatText().
  measureHudCoinStatBlock(text, fontSize) {
    const iconWidth = fontSize * 1.3;
    const gap = fontSize * 0.25;
    const textWidth = this.ctx.measureText(text).width;
    return { iconWidth, gap, textWidth, totalWidth: iconWidth + gap + textWidth };
  }

  // Small popover under a hovered HUD stat chip explaining what the
  // metric is - a bold label line plus a word-wrapped description, same
  // dark rounded-box chrome as the HUD itself. The description wraps
  // (see wrapText()) against a max width that's itself clamped to a
  // fraction of the live canvas width, rather than either a single
  // unbroken line (which could overflow a narrow canvas) or a fixed pixel
  // width (which wouldn't actually shrink on a small screen) - that's what
  // makes this "responsive" rather than just bigger.
  drawHudTooltip(area) {
    const ctx = this.ctx;
    const { hudTooltipFontSize, hudTooltipPadding, hudTooltipMaxWidth } = this.layout;
    const titleFontSize = hudTooltipFontSize;
    const descFontSize = hudTooltipFontSize * 0.82;
    const maxWidth = Math.min(hudTooltipMaxWidth, this.canvas.width * 0.7);

    ctx.save();
    ctx.font = `bold ${Math.round(titleFontSize)}px Arial, sans-serif`;
    const titleWidth = ctx.measureText(area.label).width;

    ctx.font = `${Math.round(descFontSize)}px Arial, sans-serif`;
    const descLines = this.wrapText(ctx, area.description, maxWidth);
    const descWidth = Math.max(...descLines.map((line) => ctx.measureText(line).width));

    const lineHeight = descFontSize * 1.25;
    const boxWidth = Math.max(titleWidth, descWidth) + hudTooltipPadding * 2;
    const boxHeight =
      titleFontSize + hudTooltipPadding * 0.5 + descLines.length * lineHeight + hudTooltipPadding * 1.5;
    const boxY = area.y + area.height + 8;
    const boxX = Math.max(
      8,
      Math.min(area.centerX - boxWidth / 2, this.canvas.width - boxWidth - 8)
    );

    drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 10);
    ctx.fillStyle = 'rgba(15, 8, 22, 0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.round(titleFontSize)}px Arial, sans-serif`;
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(area.label, boxX + boxWidth / 2, boxY + hudTooltipPadding * 0.9);

    ctx.font = `${Math.round(descFontSize)}px Arial, sans-serif`;
    ctx.fillStyle = '#ffffff';
    const descStartY = boxY + hudTooltipPadding * 0.9 + titleFontSize + hudTooltipPadding * 0.5;
    descLines.forEach((line, i) => {
      ctx.fillText(line, boxX + boxWidth / 2, descStartY + i * lineHeight);
    });
    ctx.restore();
  }

  // Greedy word-wrap: packs words onto a line until the next one would
  // exceed maxWidth, then starts a new line - assumes ctx.font is already
  // set to the font the wrapped text will actually be drawn in, since
  // measureText() depends on it. Shared by drawHudTooltip() today; general
  // enough to reuse for any future multi-line canvas text.
  wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach((word) => {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    });
    if (currentLine) lines.push(currentLine);

    return lines;
  }

  drawFloor() {
    // A small, crisp two-tone tile pattern with grout lines, generated on
    // an offscreen canvas rather than a photographic crop — no image to
    // wait on, so it's available synchronously. Built once and cached on
    // this.floorPattern. Sized like a real modern kitchen floor tile (much
    // smaller than the counters/fridge) and kept plain/flat rather than
    // textured, so it reads as floor sitting behind the furniture instead
    // of competing with it — see COLORS.FLOOR_* above for why the tones are
    // deliberately cooler/more neutral than the furniture's warm palette.
    if (!this.floorPattern) {
      const tileSize = this.layout.floorTileSize;
      const patternCanvas = document.createElement('canvas');
      patternCanvas.width = tileSize * 2;
      patternCanvas.height = tileSize * 2;
      const patternCtx = patternCanvas.getContext('2d');

      patternCtx.fillStyle = COLORS.FLOOR_LIGHT;
      patternCtx.fillRect(0, 0, tileSize * 2, tileSize * 2);
      patternCtx.fillStyle = COLORS.FLOOR_DARK;
      patternCtx.fillRect(tileSize, 0, tileSize, tileSize);
      patternCtx.fillRect(0, tileSize, tileSize, tileSize);

      // Grout lines between every tile, including the seam where this 2x2
      // block repeats, so the repeat doesn't read as a doubled-up tile.
      // Clamped to at least 1px so it doesn't vanish at a small canvas scale.
      patternCtx.strokeStyle = COLORS.FLOOR_GROUT;
      patternCtx.lineWidth = Math.max(1, 2 * this.layout.scale);
      [0, tileSize, tileSize * 2].forEach(pos => {
        patternCtx.beginPath();
        patternCtx.moveTo(pos, 0);
        patternCtx.lineTo(pos, tileSize * 2);
        patternCtx.stroke();
        patternCtx.beginPath();
        patternCtx.moveTo(0, pos);
        patternCtx.lineTo(tileSize * 2, pos);
        patternCtx.stroke();
      });

      this.floorPattern = this.ctx.createPattern(patternCanvas, 'repeat');
    }
    this.ctx.fillStyle = this.floorPattern;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Shared "is this box hidden beneath furniture" test — used both to decide
  // whether to draw the under-furniture silhouette (drawMouseSilhouette())
  // and to guarantee the mouse/dog never *start* the game hidden (see
  // resolveClearSpawn()), so both share one definition of "hidden".
  isHiddenByFurniture(x, y, size) {
    return this.furniture.some(f => aabbOverlap(x, y, size, size, f.x, f.y, f.width, f.height));
  }

  // The mouse draws *under* furniture (see render() above / Mouse.js) so it
  // visually ducks beneath cabinets etc. instead of being blocked by them —
  // that leaves it fully invisible while hidden there, which matters more
  // now that Mouse-controlled mode means a player is actively steering it.
  // Draws a faint shadow-like silhouette on top of furniture whenever the
  // mouse's box overlaps any furniture box, so its position stays legible
  // without undoing the "ducking under" look. Runs in both modes — harmless
  // in Cat-controlled mode, just a rendering nicety there.
  drawMouseSilhouette() {
    if (!this.mouse || this.mouseEscaped) return;
    if (!this.isHiddenByFurniture(this.mouse.x, this.mouse.y, this.mouse.size)) return;

    const centerX = this.mouse.x + this.mouse.size / 2;
    const centerY = this.mouse.y + this.mouse.size / 2;

    this.ctx.save();
    this.ctx.globalAlpha = 0.35;
    this.ctx.fillStyle = '#000000';
    this.ctx.beginPath();
    this.ctx.ellipse(centerX, centerY, this.mouse.size / 2, this.mouse.size / 2.5, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  drawPoops() {
    this.poops.forEach(poop => this.drawPoop(poop));
  }

  // Classic cartoon poop swirl — three stacked, tapering lumps plus a
  // couple of wavy "stink lines" above, so it reads clearly as a hazard to
  // avoid at a glance rather than an ambiguous brown blob. Pops in with a
  // quick overshoot scale (see POOP_POP_IN_DURATION) so it reads as
  // "plopping down" rather than snapping straight to full size.
  drawPoop(poop) {
    const ctx = this.ctx;
    const elapsed = performance.now() - poop.createdAt;
    const popProgress = Math.min(1, elapsed / POOP_POP_IN_DURATION);
    // Back-out ease (overshoots past 1 then settles) rather than a flat
    // linear grow — same family of "landed with a bit of bounce" motion as
    // the rest of this file's pop-ins, just with an overshoot instead of
    // their ease-out-cubic settle, since a fresh drop landing reads better
    // with a little jiggle than a smooth glide-in.
    // Standard easeOutBack coefficients — c3 (the cubic term) and c1 (the
    // quadratic term) have to be *different* constants (c3 = c1 + 1), not
    // the same one, or f(0) no longer lands at 0: plugging progress=0 in
    // with a single shared constant k gives 1 - k + k = 1, i.e. the pile
    // would already be full-size at the very first frame instead of
    // actually growing in.
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const settled = popProgress - 1;
    const eased = 1 + c3 * settled * settled * settled + c1 * settled * settled;
    const popScale = popProgress >= 1 ? 1 : Math.max(0, eased);

    const centerX = poop.x + poop.width / 2;
    const bottomY = poop.y + poop.height;

    ctx.save();
    ctx.translate(centerX, bottomY);
    ctx.scale(popScale, popScale);
    ctx.translate(-centerX, -bottomY);

    const lumps = [
      { rx: poop.width * 0.5, ry: poop.height * 0.38, dy: 0 },
      { rx: poop.width * 0.36, ry: poop.height * 0.3, dy: -poop.height * 0.32 },
      { rx: poop.width * 0.22, ry: poop.height * 0.2, dy: -poop.height * 0.58 },
    ];
    ctx.fillStyle = '#6d4c28';
    ctx.strokeStyle = '#4a3218';
    ctx.lineWidth = Math.max(1, 1.5 * this.layout.scale);
    lumps.forEach(lump => {
      ctx.beginPath();
      ctx.ellipse(centerX, bottomY + lump.dy - lump.ry * 0.3, lump.rx, lump.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // Small highlight for a bit of shine/dimension.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.beginPath();
    ctx.ellipse(centerX - poop.width * 0.12, bottomY - poop.height * 0.65, poop.width * 0.08, poop.height * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Stink lines drawn outside the pop-in transform above (always full
    // scale once the pile itself has finished popping in) so they don't
    // shrink along with the plop, and only once the plop itself has
    // settled rather than wobbling mid-overshoot.
    if (popProgress >= 1) {
      this.drawStinkLines(centerX, bottomY - poop.height * 0.75, elapsed);
    }
  }

  drawDoobers() {
    this.doobers.forEach(doober => this.drawDoober(doober));
  }

  // Shared drop-in/idle-bob animation for every doober type - falls in
  // from above with a bounce landing (easeOutBounce() below, over
  // DOOBER_DROP_DURATION/DOOBER_DROP_HEIGHT) rather than fading or
  // popping straight into place, then gently idle-bobs once landed, then
  // (once landed) draws the signature glowing down-arrow above it (see
  // drawDooberArrow()). Collision always uses the doober's stored resting
  // x/y regardless of animation state - this is purely visual, same as
  // the poop pile's own pop-in never moves its hitbox. What actually gets
  // drawn at the computed center is delegated to
  // DOOBER_TYPES[doober.type].draw() - this method itself has no
  // coin-specific knowledge at all, so a future non-coin doober type gets
  // the same animation and arrow for free.
  drawDoober(doober) {
    const elapsed = performance.now() - doober.createdAt;

    const dropProgress = Math.min(1, elapsed / DOOBER_DROP_DURATION);
    const dropOffset = -DOOBER_DROP_HEIGHT * (1 - this.easeOutBounce(dropProgress));
    const bobOffset =
      dropProgress >= 1
        ? Math.sin((elapsed / DOOBER_BOB_PERIOD) * Math.PI * 2) * DOOBER_BOB_AMPLITUDE
        : 0;

    const centerX = doober.x + doober.size / 2;
    const centerY = doober.y + doober.size / 2 + dropOffset + bobOffset;
    const baseRadius = doober.size / 2;

    DOOBER_TYPES[doober.type].draw(this, centerX, centerY, baseRadius);

    // Only once landed (an arrow pointing at a doober still mid-drop
    // would be pointing at empty air) and only if this doober was the
    // one that "won" the once-per-type-per-session arrow at spawn time
    // (see spawnDoober()'s showArrow).
    if (dropProgress >= 1 && doober.showArrow) {
      this.drawDooberArrow(centerX, centerY - baseRadius, baseRadius, elapsed);
    }
  }

  // The signature down-arrow every doober gets once landed, independent
  // of its type/content - see DOOBER_ARROW_* above for why this lives in
  // the shared drawDoober() rather than in a type's own draw(). A soft
  // glow (shadowBlur) plus a bold dark outline, same "cartoon-bold, hard
  // to miss" language the reference screenshot's own arrows use. The
  // actual shape/bob math is shared with drawEscapeRadar() (the
  // "Mouse Hole Radar" perk, see below) via drawPointerArrow() - same
  // "point at a fixed spot" widget, just recolored per caller so a coin
  // callout and an escape-hole callout can't be confused for each other.
  drawDooberArrow(centerX, topY, baseRadius, elapsed) {
    this.drawPointerArrow(centerX, topY, baseRadius, elapsed, {
      glow: 'rgba(255, 214, 64, 0.85)',
      gradientStart: '#fff59d',
      gradientEnd: '#ffca28',
      stroke: '#8a5a00',
    });
  }

  // Shared "bobbing arrow pointing down at a fixed spot" shape - see
  // drawDooberArrow() above (gold, the original use) and
  // drawEscapeRadar() below (the "Mouse Hole Radar" perk's cool-blue
  // recolor of the exact same widget).
  drawPointerArrow(centerX, topY, baseRadius, elapsed, { glow, gradientStart, gradientEnd, stroke }) {
    const ctx = this.ctx;
    const bob = Math.sin((elapsed / DOOBER_ARROW_BOB_PERIOD) * Math.PI * 2) * DOOBER_ARROW_BOB_AMPLITUDE;
    const tipY = topY - DOOBER_ARROW_GAP + bob;

    const width = baseRadius * 1.1;
    const height = baseRadius * 1.3;
    const shaftHalfWidth = width * 0.28;
    const headHalfWidth = width * 0.5;
    const headBaseY = tipY - height * 0.55;
    const topEdgeY = tipY - height;

    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = baseRadius * 0.4;

    ctx.beginPath();
    ctx.moveTo(centerX - shaftHalfWidth, topEdgeY);
    ctx.lineTo(centerX + shaftHalfWidth, topEdgeY);
    ctx.lineTo(centerX + shaftHalfWidth, headBaseY);
    ctx.lineTo(centerX + headHalfWidth, headBaseY);
    ctx.lineTo(centerX, tipY);
    ctx.lineTo(centerX - headHalfWidth, headBaseY);
    ctx.lineTo(centerX - shaftHalfWidth, headBaseY);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(centerX, topEdgeY, centerX, tipY);
    gradient.addColorStop(0, gradientStart);
    gradient.addColorStop(1, gradientEnd);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, baseRadius * 0.08);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // "Mouse Hole Radar" perk (slug 'hole-radar', see this.ownedPerkSlugs in
  // init()) - highlights whichever escape is currently nearest the mouse,
  // recomputed every frame (not just once) so the highlighted hole
  // actually updates as the mouse moves around, the way a real radar
  // would. Cool blue/white rather than the doober arrow's gold, so the
  // two "look here" cues never read as the same kind of thing (one's a
  // reward, one's an escape route).
  drawEscapeRadar() {
    if (!this.mouse || this.mouseEscaped || this.escapes.length === 0) return;

    const mouseCenterX = this.mouse.x + this.mouse.size / 2;
    const mouseCenterY = this.mouse.y + this.mouse.size / 2;

    let nearest = this.escapes[0];
    let nearestDistance = Infinity;
    this.escapes.forEach((escape) => {
      const escapeCenterX = escape.x + escape.width / 2;
      const escapeCenterY = escape.y + escape.height / 2;
      const distance = Math.hypot(mouseCenterX - escapeCenterX, mouseCenterY - escapeCenterY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = escape;
      }
    });

    const centerX = nearest.x + nearest.width / 2;
    const topY = nearest.y;
    const baseRadius = Math.max(nearest.width, nearest.height) / 2;
    this.drawPointerArrow(centerX, topY, baseRadius, performance.now(), {
      glow: 'rgba(41, 182, 246, 0.85)',
      gradientStart: '#e1f5fe',
      gradientEnd: '#29b6f6',
      stroke: '#01579b',
    });
  }

  // The 'coin' doober type's content (see DOOBER_TYPES): a real generated
  // image (assets/doober_coin.png) rather than canvas-drawn shapes - per
  // explicit direction, matching this game's own established pattern of
  // using real art for anything wanting real polish/dimensionality
  // (character sprites, kitchen furniture) rather than fighting canvas
  // gradients for it. this.dooberCoinImage is loaded once in the
  // constructor; drawImage() with an unloaded image is a no-op-safe
  // pattern this file doesn't otherwise guard for (see Cat.js's own
  // sprite draw - by the time gameplay actually starts, the intro
  // cutscenes have already given small local images time to load).
  // Sized to DOOBER_COIN_IMAGE_SCALE * the doober's own footprint, not
  // 1:1 with baseRadius*2 - the source art has its own internal margin/
  // proportions that don't match the abstract circle-cluster this
  // replaced, so this is tuned by eye rather than derived.
  drawCoinDooberContent(centerX, centerY, baseRadius) {
    const image = this.dooberCoinImage;
    if (!image.naturalWidth) return;

    const drawWidth = baseRadius * 2 * DOOBER_COIN_IMAGE_SCALE;
    const drawHeight = drawWidth * (image.naturalHeight / image.naturalWidth);
    this.ctx.drawImage(image, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight);
  }

  // Standard easeOutBounce (x in [0,1] -> [0,1], overshoots into a
  // couple of small bounces before settling at 1) - drives drawDoober()'s
  // drop-in so a spawning doober reads as "dropped and bounced" rather
  // than a flat linear fall or a fade-in.
  easeOutBounce(x) {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  }

  // Small squiggly brown lines circling above a poop pile — same "bold,
  // always orbiting" visual language drawStunStars() uses for the cat's
  // dazed stars. Brown rather than the green this originally shipped with
  // (green read as more plant/toxic than "stink" — per explicit direction,
  // "squiggly brown stink lines"), matching the pile's own color family so
  // the two visually belong together. `orbitRadiusX` defaults to the
  // pile's own layout value but is overridable — drawYuckStink() below
  // reuses this exact method centered on the cat's head instead, at the
  // stars' own (larger) orbit radius, rather than duplicating the orbit
  // math for a second call site. Runs for as long as its caller keeps
  // calling it with a growing `elapsed` — the pile calls this every frame
  // it exists (not gated to catPaused the way the stun flavor is).
  drawStinkLines(centerX, orbitCenterY, elapsed, orbitRadiusX = this.layout.stinkOrbitRadiusX) {
    const { scale } = this.layout;
    const orbitRadiusY = orbitRadiusX * STINK_ORBIT_RADIUS_Y_RATIO;
    const angularSpeed = (Math.PI * 2) / STINK_ORBIT_PERIOD;

    for (let i = 0; i < STINK_LINE_COUNT; i++) {
      const phase = (i / STINK_LINE_COUNT) * Math.PI * 2;
      const angle = elapsed * angularSpeed + phase;
      const x = centerX + Math.cos(angle) * orbitRadiusX;
      const y = orbitCenterY + Math.sin(angle) * orbitRadiusY;
      // Each line's own wobble phase offset by its orbit position so the
      // three don't wave in lockstep as they circle.
      this.drawStinkLine(x, y, elapsed + i * 200, scale);
    }
  }

  // A single squiggly stink line, outlined for boldness — a dark, wider
  // stroke drawn first, then a lighter brown, narrower stroke on top, the
  // same "outlined solid shape" boldness drawStar() uses (fill + stroke)
  // rather than a single thin translucent line. A short multi-wave zigzag
  // (sampled along a sine) rather than one quadratic-curve hump, so it
  // actually reads as "squiggly" rather than a single gentle bend.
  drawStinkLine(x, y, wobblePhase, scale) {
    const ctx = this.ctx;
    const height = 20 * scale;
    const amplitude = 3.5 * scale;
    const segments = 8;
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      // Amplitude tapers slightly toward the tip so the squiggle narrows
      // as it rises, rather than staying a uniform width band.
      const wave = Math.sin(t * Math.PI * 2.4 + wobblePhase / 220) * amplitude * (1 - t * 0.25);
      points.push({ x: x + wave, y: y - t * height });
    }

    const tracePath = () => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#3d2712';
    ctx.lineWidth = Math.max(2.5, 4 * scale);
    tracePath();
    ctx.stroke();

    ctx.strokeStyle = '#9c6b3a';
    ctx.lineWidth = Math.max(1.5, 2.2 * scale);
    tracePath();
    ctx.stroke();
    ctx.restore();
  }

  drawGameObjects() {
    this.dog.draw(this.ctx);

    // Drawn here (not in render()'s own top-level sequence) specifically so
    // it lands behind the cat's own sprite — drawing it after the cat, like
    // drawShockwave(), had it visibly painting over the cat's face.
    this.drawTootEffect();

    // Behind the cat, same reasoning as the old drawRedOutline() this
    // replaces — the burst radiates from behind the sprite rather than
    // painting over it. Self-guards on this.catPaused internally, same
    // style as drawShockwave()/drawTootEffect() above.
    this.drawStunBurst();
    this.cat.draw(this.ctx);
    this.drawCatUnderFurnitureEffect();
    // In front of (and above) the cat, unlike the burst — "seeing stars"
    // orbiting the head needs to actually read against the sprite, not be
    // painted over by it.
    this.drawStunStars();
  }

  // Cat version of the mouse's "ducks under furniture" treatment (see
  // drawMouseSilhouette() above) — but the cat is only ever actually
  // walking under the small set of non-blocking furniture types (plant/
  // cart/shelf — see CAT_NON_BLOCKING_FURNITURE_TYPES), since it's still blocked
  // by, and correctly drawn on top of, every other type. Rather than moving
  // the cat's own draw() call earlier in render() (the mouse's approach),
  // this re-draws just the specific overlapping piece(s) on top of the
  // cat's already-drawn sprite — a smaller, more targeted change that
  // doesn't touch the cat's existing z-order relative to the dog or to
  // every furniture type it's actually stopped by (moving the cat's draw
  // call earlier, mouse-style, would have also changed how it layers
  // against those, which was never asked for).
  drawCatUnderFurnitureEffect() {
    let hidden = false;
    this.furniture.forEach(furniture => {
      if (!CAT_NON_BLOCKING_FURNITURE_TYPES.includes(furniture.type)) return;
      if (!aabbOverlap(this.cat.x, this.cat.y, this.cat.displayWidth, this.cat.displayHeight, furniture.x, furniture.y, furniture.width, furniture.height)) return;
      furniture.draw(this.ctx);
      hidden = true;
    });
    if (hidden) this.drawCatSilhouette();
  }

  // Cat-shaped counterpart to drawMouseSilhouette() above — same faint
  // translucent-black treatment (so the two read as the same "hidden under
  // furniture" language), but a rounded head with two pointed ears instead
  // of a plain ellipse, so the two silhouettes are distinguishable at a
  // glance rather than identical blobs (per explicit direction: "make it
  // look cat like"). Ears are drawn first, then the head ellipse on top, so
  // their bases blend into the head rather than reading as two separate
  // shapes glued to its edge.
  drawCatSilhouette() {
    const width = this.cat.displayWidth;
    const height = this.cat.displayHeight;
    const centerX = this.cat.x + width / 2;
    const centerY = this.cat.y + height / 2;
    const radiusX = width / 2;
    const radiusY = height / 2.5;

    this.ctx.save();
    this.ctx.globalAlpha = 0.35;
    this.ctx.fillStyle = '#000000';

    const earWidth = radiusX * 0.6;
    const earHeight = radiusY * 0.8;
    const earBaseY = centerY - radiusY * 0.7;
    [-1, 1].forEach(side => {
      const earBaseX = centerX + side * radiusX * 0.55;
      this.ctx.beginPath();
      this.ctx.moveTo(earBaseX - earWidth / 2, earBaseY);
      this.ctx.quadraticCurveTo(earBaseX, earBaseY - earHeight, earBaseX + earWidth / 2, earBaseY);
      this.ctx.closePath();
      this.ctx.fill();
    });

    this.ctx.beginPath();
    this.ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();
  }

  drawShockwave() {
    if (!this.shockwave) return;

    const elapsed = performance.now() - this.shockwave.startTime;

    if (elapsed > PUNCH_SHOCKWAVE_DURATION) {
      this.shockwave = null;
      return;
    }

    const progress = elapsed / PUNCH_SHOCKWAVE_DURATION;
    const radius = progress * this.layout.punchShockwaveMaxRadius;
    const alpha = 1 - progress;

    this.ctx.save();
    this.ctx.strokeStyle = `rgba(138, 43, 226, ${alpha})`;
    this.ctx.lineWidth = Math.max(1, 3 * this.layout.scale);
    this.ctx.beginPath();
    this.ctx.arc(this.shockwave.x, this.shockwave.y, radius, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  // Little wind/fart puff from handleToot() — three soft pale-green circles
  // drifting out the cat's back (opposite Cat.facingDirection, see
  // TOOT_EFFECT_DIRECTIONS) and fading out. Staggered start times (each
  // puff's own `delay`) so they don't move/fade in lockstep as one blob —
  // reads as a little cloud instead.
  drawTootEffect() {
    if (!this.tootEffect) return;

    const elapsed = performance.now() - this.tootEffect.startTime;
    if (elapsed > TOOT_EFFECT_DURATION) {
      this.tootEffect = null;
      return;
    }

    const progress = elapsed / TOOT_EFFECT_DURATION;
    const { x, y, dirX, dirY } = this.tootEffect;
    // Perpendicular to the drift direction, so the three puffs scatter
    // side-to-side instead of stacking directly on top of each other.
    const perpX = -dirY;
    const perpY = dirX;
    const maxDrift = this.layout.tootEffectMaxDrift;
    const maxRadius = this.layout.tootEffectMaxRadius;

    this.ctx.save();
    const puffs = [
      { delay: 0, spread: -0.6, sizeMul: 0.8 },
      { delay: 0.12, spread: 0, sizeMul: 1 },
      { delay: 0.24, spread: 0.6, sizeMul: 0.7 },
    ];
    puffs.forEach((puff) => {
      const puffProgress = Math.max(0, Math.min(1, (progress - puff.delay) / (1 - puff.delay)));
      if (puffProgress <= 0) return;

      const drift = puffProgress * maxDrift;
      const px = x + dirX * drift + perpX * puff.spread * maxRadius;
      const py = y + dirY * drift + perpY * puff.spread * maxRadius;
      const radius = puff.sizeMul * maxRadius * (0.4 + 0.6 * puffProgress);
      // Alpha eased rather than linear, and a higher ceiling (0.9, was
      // 0.6) — the flat-linear fade read as too faint/washed-out live
      // against the floor almost immediately. A darker stroke (not just a
      // flat fill) is what actually gives each puff a defined edge instead
      // of a soft blur that can disappear into a light-colored floor tile.
      const alpha = Math.pow(1 - puffProgress, 0.6) * 0.9;

      this.ctx.fillStyle = `rgba(196, 230, 165, ${alpha})`;
      this.ctx.strokeStyle = `rgba(110, 160, 80, ${alpha})`;
      this.ctx.lineWidth = Math.max(1, 1.5 * this.layout.scale);
      this.ctx.beginPath();
      this.ctx.arc(px, py, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    });
    this.ctx.restore();
  }

  // One-shot burst timed to the moment the cat's stun actually starts —
  // dispatches to whichever flavor matches this.catStunSource (set by
  // handleDogCollision()/updatePoops()) so the dog physically catching the
  // cat and the cat stepping in a poop pile read as distinct causes rather
  // than the same effect regardless of what happened. Self-guards
  // internally (this.catPaused) so drawGameObjects() can call it
  // unconditionally every frame, same style as drawShockwave()/
  // drawTootEffect().
  drawStunBurst() {
    if (!this.catPaused) return;
    if (this.catStunSource === 'poop') {
      this.drawYuckBurst();
      return;
    }

    // Adapts drawShockwave()'s expanding-ring/fade technique (progress →
    // eased radius, alpha = 1 - progress) but as a filled 8-point starburst
    // polygon rather than a stroked circle, and warm amber/orange rather
    // than punch's purple, so the two moments read as distinct effects
    // rather than the same ring recolored.
    const elapsed = performance.now() - this.catStunStartTime;
    if (elapsed > DOG_COLLISION_BURST_DURATION) return;

    const cat = this.cat;
    const centerX = cat.x + cat.displayWidth / 2;
    const centerY = cat.y + cat.displayHeight / 2;

    const progress = elapsed / DOG_COLLISION_BURST_DURATION;
    const eased = 1 - Math.pow(1 - progress, 2); // ease-out quad — a snappier expand than the punch ring's linear one
    const outerRadius = eased * this.layout.dogCollisionBurstMaxRadius;
    const innerRadius = outerRadius * 0.5;
    const alpha = 1 - progress;
    const SPIKES = 8;

    this.ctx.save();
    this.ctx.fillStyle = `rgba(255, 111, 0, ${alpha})`;
    this.ctx.beginPath();
    for (let i = 0; i < SPIKES * 2; i++) {
      const angle = (i / (SPIKES * 2)) * Math.PI * 2;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const px = centerX + Math.cos(angle) * radius;
      const py = centerY + Math.sin(angle) * radius;
      if (i === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();
  }

  // Poop-stun flavor of the one-shot burst above — small brown droplets
  // spraying outward and downward from the cat's feet (where it actually
  // stepped), rather than a centered starburst, so it reads as a splash/
  // splat rather than an impact. Same expanding/fading technique and
  // duration (DOG_COLLISION_BURST_DURATION) as the amber POW burst it
  // replaces, just a different shape/color/origin point.
  drawYuckBurst() {
    const elapsed = performance.now() - this.catStunStartTime;
    if (elapsed > DOG_COLLISION_BURST_DURATION) return;

    const cat = this.cat;
    const centerX = cat.x + cat.displayWidth / 2;
    const centerY = cat.y + cat.displayHeight * 0.85; // near the feet, not the sprite's center

    const progress = elapsed / DOG_COLLISION_BURST_DURATION;
    const eased = 1 - Math.pow(1 - progress, 2);
    const maxRadius = this.layout.dogCollisionBurstMaxRadius;
    const alpha = 1 - progress;
    const DROPLETS = 7;

    this.ctx.save();
    for (let i = 0; i < DROPLETS; i++) {
      const angle = (i / DROPLETS) * Math.PI * 2 + 0.4;
      // Uneven per-droplet distance — a real splash sprays unevenly rather
      // than landing every droplet on one clean ring.
      const distanceMul = 0.55 + 0.45 * ((i * 37) % 5) / 4;
      const dist = eased * maxRadius * distanceMul;
      const dropX = centerX + Math.cos(angle) * dist;
      const dropY = centerY + Math.sin(angle) * dist * 0.6; // flattened spray, not a full circle
      const dropSize = (2.5 + (i % 3)) * this.layout.scale;
      this.ctx.fillStyle = `rgba(93, 62, 26, ${alpha})`;
      this.ctx.beginPath();
      this.ctx.ellipse(dropX, dropY, dropSize, dropSize * 0.8, angle, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  // Continuous "dazed" cue for the entire pause — dispatches to whichever
  // flavor matches this.catStunSource, same reasoning as drawStunBurst()
  // above. Self-guards the same way drawStunBurst() does.
  drawStunStars() {
    if (!this.catPaused) return;
    if (this.catStunSource === 'poop') {
      this.drawYuckStink();
      return;
    }

    // "Seeing stars" — a handful of small stars circling the cat's head in
    // a flattened ellipse (so they read as orbiting a mostly-front-facing
    // head rather than floating in a flat halo), the classic cartoon
    // "stunned" cue. Continuous rather than one-shot: angle is driven
    // directly off elapsed time each frame (no stored per-star state), so
    // it just keeps circling for as long as this.catPaused stays true.
    const elapsed = performance.now() - this.catStunStartTime;

    const cat = this.cat;
    const centerX = cat.x + cat.displayWidth / 2;
    // Orbits above the head, not the sprite's own center.
    const orbitCenterY = cat.y + cat.displayHeight * 0.15;
    const orbitRadiusX = this.layout.dogCollisionStarOrbitRadiusX;
    const orbitRadiusY = orbitRadiusX * DOG_COLLISION_STAR_ORBIT_RADIUS_Y_RATIO;
    const angularSpeed = (Math.PI * 2) / DOG_COLLISION_STAR_ORBIT_PERIOD;

    for (let i = 0; i < DOG_COLLISION_STAR_COUNT; i++) {
      const phase = (i / DOG_COLLISION_STAR_COUNT) * Math.PI * 2;
      const angle = elapsed * angularSpeed + phase;
      const x = centerX + Math.cos(angle) * orbitRadiusX;
      const y = orbitCenterY + Math.sin(angle) * orbitRadiusY;
      this.drawStar(x, y, this.layout.dogCollisionStarSize);
    }
  }

  // Poop-stun flavor of the "seeing stars" cue above — reuses the exact
  // same orbiting stink-squiggle drawStinkLines() the pile itself uses
  // (see drawPoop()), just centered on the cat's head instead of the pile,
  // and at the same orbit radius the stars use (dogCollisionStarOrbitRadiusX)
  // so the "size" of the dazed effect stays consistent regardless of which
  // flavor is showing. Ties the visual directly back to what caused it —
  // the cat now reeks, rather than an unrelated dazed cue.
  drawYuckStink() {
    const elapsed = performance.now() - this.catStunStartTime;
    const cat = this.cat;
    const centerX = cat.x + cat.displayWidth / 2;
    const orbitCenterY = cat.y + cat.displayHeight * 0.15;
    this.drawStinkLines(centerX, orbitCenterY, elapsed, this.layout.dogCollisionStarOrbitRadiusX);
  }

  // Small 5-point star polygon, filled bright yellow with a dark outline —
  // shared by every star drawStunStars() places above the cat's head.
  drawStar(x, y, size) {
    const SPIKES = 5;
    const outerRadius = size;
    const innerRadius = size * 0.45;

    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.beginPath();
    for (let i = 0; i < SPIKES * 2; i++) {
      const angle = (i / (SPIKES * 2)) * Math.PI * 2 - Math.PI / 2;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (i === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }
    this.ctx.closePath();
    this.ctx.fillStyle = '#fff176';
    this.ctx.fill();
    this.ctx.lineWidth = Math.max(1, 1.5 * this.layout.scale);
    this.ctx.strokeStyle = '#5d4037';
    this.ctx.stroke();
    this.ctx.restore();
  }

  // Only reached while !gameOver (see render()) — the transient "Dummy
  // caught Mia!" pause message. An overlay drawn directly on top of the
  // live board is fine here since gameplay is still visibly running/paused
  // underneath (this isn't a modal moment the way game-over is); the
  // actual game-over screen uses displayGameOverModal() instead. Pops/
  // scales in (same ease-out-cubic pattern as displayGameOverModal(), see
  // DOG_COLLISION_MESSAGE_POP_IN_DURATION). A first pass here was just a
  // bold purple fillText with a dark stroke — still read as amateurish and
  // hard to read live, since floating text with no backdrop is at the
  // mercy of whatever's drawn on the board directly behind it. Fixed by
  // giving it a small pill-shaped banner (drawRoundedRect, this project's
  // purple) behind white text, the same "colored card + white outlined
  // text" formula displayGameOverModal() already uses — just a lightweight
  // banner sized to the text rather than a full scrim-and-card modal.
  displayMessage() {
    const ctx = this.ctx;
    const { scale, messageFontSize } = this.layout;
    const elapsed = performance.now() - this.catStunStartTime;
    const progress = Math.min(1, elapsed / DOG_COLLISION_MESSAGE_POP_IN_DURATION);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic, same as displayGameOverModal()
    const popScale = 0.4 + 0.6 * eased;

    const centerX = this.canvas.width / 2;
    const messageY = this.canvas.height / 2 - this.layout.messageYOffset;

    ctx.save();
    ctx.globalAlpha = eased;
    ctx.translate(centerX, messageY);
    ctx.scale(popScale, popScale);
    ctx.translate(-centerX, -messageY);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 'Impact'/'Arial Black' fallback stack, same reasoning as
    // displayGameOverModal()'s own headline font.
    ctx.font = `900 ${messageFontSize}px Impact, 'Arial Black', sans-serif`;

    // Banner sized to the actual text (plus padding) rather than a fixed
    // width, so it hugs "Dummy caught Mia!" tightly instead of either
    // clipping a longer message or looking sparse around a shorter one.
    // Padding is proportional to the font size (not its own BASE_* layout
    // constant) so it scales correctly at any canvas size for free.
    const textWidth = ctx.measureText(this.message).width;
    const paddingX = messageFontSize * 0.55;
    const paddingY = messageFontSize * 0.32;
    const bannerWidth = textWidth + paddingX * 2;
    const bannerHeight = messageFontSize + paddingY * 2;
    const bannerX = centerX - bannerWidth / 2;
    const bannerY = messageY - bannerHeight / 2;

    const gradient = ctx.createLinearGradient(centerX, bannerY, centerX, bannerY + bannerHeight);
    gradient.addColorStop(0, COLORS.MESSAGE.BANNER_GRADIENT_START);
    gradient.addColorStop(1, COLORS.MESSAGE.BANNER_GRADIENT_END);

    drawRoundedRect(ctx, bannerX, bannerY, bannerWidth, bannerHeight, bannerHeight / 2);
    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 10 * scale;
    ctx.shadowOffsetY = 3 * scale;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = Math.max(1.5, 2.5 * scale);
    ctx.strokeStyle = COLORS.MESSAGE.BANNER_BORDER;
    ctx.stroke();

    // A lighter stroke than the first (banner-less) attempt used — the
    // banner itself now carries most of the contrast, so a heavy black
    // outline on top of an already-bold Impact face just read muddy.
    ctx.lineWidth = Math.max(1.5, 3 * scale);
    ctx.strokeStyle = COLORS.MESSAGE.TEXT_STROKE;
    ctx.strokeText(this.message, centerX, messageY);
    ctx.fillStyle = COLORS.MESSAGE.TEXT_FILL;
    ctx.fillText(this.message, centerX, messageY);
    ctx.restore();
  }

  // Replaces the old plain-text end screen with a proper modal: a dimming
  // scrim over the whole board (so the card reads clearly regardless of
  // what's drawn underneath — the previous plain text sometimes wasn't
  // legible depending on the board state behind it), a gradient card
  // (gold for a win, teal/blue for a loss — see COLORS.MODAL), a big bold
  // "You Win!"/"You Lose!" headline with an outline stroke so it pops
  // against either gradient, the narration message as a subtitle, and a
  // rounded "Play Again" button. this.gameOverIsWin (set by endGame(), see
  // Character selection & Mouse-controlled mode in CLAUDE.md) decides which
  // headline/palette to use — the underlying trigger (cat caught mouse /
  // mouse escaped) is the same regardless of who's playing.
  displayGameOverModal() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const {
      scale, modalWidth, modalRadius,
      modalTitleFontSize, modalSubtitleFontSize,
      modalButtonWidth, modalButtonHeight, modalButtonRadius, modalButtonFontSize,
      modalRewardsExtraHeight,
    } = this.layout;
    // baseModalHeight is only used to derive title/subtitle/button offsets
    // *from the card's own top edge* (modalY, below) - not from centerY.
    // An earlier version measured them from centerY using this same
    // fraction, which looked right for the un-grown card but left a
    // growing gap of empty space above the title once modalHeight grew to
    // fit the rewards section (see roundRewardBreakdown): modalY moves up
    // as the card grows (still centered as a whole around centerY, which
    // is correct), but a centerY-relative title position doesn't move up
    // with it, so the distance from the card's actual top edge to the
    // title kept increasing with every reward-shown round. Anchoring to
    // modalY instead keeps that distance constant regardless of how tall
    // the card grows - the extra room from a taller card shows up only
    // where it's supposed to (around the rewards section), not as dead
    // space above the headline.
    const baseModalHeight = this.layout.modalHeight;
    const showRewards = !!this.roundRewardBreakdown;
    const modalHeight = baseModalHeight + (showRewards ? modalRewardsExtraHeight : 0);

    ctx.save();
    ctx.fillStyle = COLORS.MODAL.SCRIM;
    ctx.fillRect(0, 0, width, height);

    // Pop-in animation: scales the card up from slightly smaller while
    // fading in over MODAL_POP_IN_DURATION — same performance.now()-diff
    // pattern as drawShockwave(). The click hit-area below intentionally
    // uses the *final* (unscaled) button position throughout, rather than
    // tracking this animation — a purely cosmetic quarter-second effect
    // isn't worth hit-testing against a live transform.
    const elapsed = performance.now() - this.gameOverStartTime;
    const progress = Math.min(1, elapsed / MODAL_POP_IN_DURATION);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const popScale = 0.85 + 0.15 * eased;

    const centerX = width / 2;
    const centerY = height / 2;

    ctx.globalAlpha = eased;
    ctx.translate(centerX, centerY);
    ctx.scale(popScale, popScale);
    ctx.translate(-centerX, -centerY);

    const modalX = centerX - modalWidth / 2;
    // Clamped, not just centered — on an extremely small/narrow canvas
    // (well past any real device this game targets, but reachable by
    // hand-shrinking a desktop browser window) the ear-headroom cap in
    // computeLayout() can still be squeezed tighter than the ears actually
    // need, which would otherwise poke the card's ears (see
    // MODAL_EAR_SHAPES) up past the canvas's own top edge. 0.22 is a
    // deliberately generous upper bound on any of the three ear shapes'
    // actual peak height (all ~0.2*modalHeight or less — see
    // canvasShapes.js) so this holds regardless of which character's ears
    // are drawn.
    const modalY = Math.max(centerY - modalHeight / 2, modalHeight * 0.22 + 4 * scale);

    const gradient = ctx.createLinearGradient(modalX, modalY, modalX, modalY + modalHeight);
    if (this.gameOverIsWin) {
      gradient.addColorStop(0, COLORS.MODAL.WIN_GRADIENT_START);
      gradient.addColorStop(1, COLORS.MODAL.WIN_GRADIENT_END);
    } else {
      gradient.addColorStop(0, COLORS.MODAL.LOSE_GRADIENT_START);
      gradient.addColorStop(1, COLORS.MODAL.LOSE_GRADIENT_END);
    }

    // Framed in whichever character's ears the player is actually
    // controlling this round (see MODAL_EAR_SHAPES) — same "ears poking up
    // past the card's own top edge" language CharacterSelectScreen's cards
    // use, so the modal echoes the pick made there instead of just being a
    // plain rounded rect. Falls back to a plain rounded rect for any
    // unrecognized controlledEntity, though every real value has a shape.
    const earShapes = MODAL_EAR_SHAPES[this.controlledEntity];
    if (earShapes) {
      earShapes.card(ctx, modalX, modalY, modalWidth, modalHeight, modalRadius);
    } else {
      drawRoundedRect(ctx, modalX, modalY, modalWidth, modalHeight, modalRadius);
    }
    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 24 * scale;
    ctx.shadowOffsetY = 8 * scale;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = Math.max(2, 4 * scale);
    ctx.strokeStyle = COLORS.MODAL.BORDER;
    ctx.stroke();

    // Two-tone inner-ear accent, drawn after the card body/border so it
    // sits on top — same pale-pink fill CharacterSelectScreen's cards use
    // regardless of the card's own color (see MODAL_EAR_INNER_COLOR).
    if (earShapes) {
      earShapes.inner(ctx, modalX, modalY, modalWidth, modalHeight);
      ctx.fillStyle = MODAL_EAR_INNER_COLOR;
      ctx.fill();
    }

    ctx.textAlign = 'center';
    const title = this.gameOverIsWin ? 'You Win!' : 'You Lose!';
    // Offsets from modalY (the card's actual top edge, see baseModalHeight's
    // own comment above) - the same fractions the old centerY-relative
    // formulas worked out to when the card was its un-grown baseModalHeight,
    // just re-anchored so they hold at any card height.
    const titleY = modalY + baseModalHeight * 0.38;
    // 'Impact'/'Arial Black' aren't available on every OS — the bold
    // sans-serif fallback plus the outline stroke below keep it reading as
    // "big playful headline" either way, without loading an external font.
    ctx.font = `900 ${modalTitleFontSize}px Impact, 'Arial Black', sans-serif`;
    ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.strokeStyle = COLORS.MODAL.TITLE_STROKE;
    ctx.strokeText(title, centerX, titleY);
    ctx.fillStyle = COLORS.MODAL.TITLE_FILL;
    ctx.fillText(title, centerX, titleY);

    const subtitleY = modalY + baseModalHeight * 0.56;
    // Shrink further (down to MIN_MODAL_SUBTITLE_FONT_SIZE) only if the
    // message would actually overflow the card at its normal floored size
    // — same "floor plus measure-and-shrink-if-needed" pattern
    // Cutscene.js's own pop-in text uses, so a longer message (a custom
    // character name, say) can't run past the card's edges.
    let subtitleFontSize = modalSubtitleFontSize;
    ctx.font = `bold ${subtitleFontSize}px Arial`;
    const availableSubtitleWidth = modalWidth - 40 * scale;
    const measuredSubtitleWidth = ctx.measureText(this.message).width;
    if (measuredSubtitleWidth > availableSubtitleWidth) {
      subtitleFontSize = Math.max(
        MIN_MODAL_SUBTITLE_FONT_SIZE,
        subtitleFontSize * (availableSubtitleWidth / measuredSubtitleWidth)
      );
      ctx.font = `bold ${subtitleFontSize}px Arial`;
    }
    ctx.fillStyle = COLORS.MODAL.SUBTITLE;
    ctx.fillText(this.message, centerX, subtitleY);

    const buttonX = centerX - modalButtonWidth / 2;
    // Rewards showing: bottom-anchored inside the grown card, leaving the
    // rewards section the rest of the room between the subtitle and here.
    // Not showing: the same modalY-relative offset the title/subtitle use,
    // so a logged-out player's modal is still pixel-for-pixel what it
    // always was (baseModalHeight*0.72 from modalY == the old
    // centerY+baseModalHeight*0.22, when modalHeight is un-grown).
    const buttonY = showRewards
      ? modalY + modalHeight - modalRadius - modalButtonHeight
      : modalY + baseModalHeight * 0.72;

    if (showRewards) {
      this.drawRewardsBreakdown(centerX, subtitleY + modalSubtitleFontSize * 0.9, buttonY - 10 * scale, modalWidth);
    }

    drawRoundedRect(ctx, buttonX, buttonY, modalButtonWidth, modalButtonHeight, modalButtonRadius);
    ctx.shadowColor = COLORS.MODAL.BUTTON_SHADOW;
    ctx.shadowBlur = 10 * scale;
    ctx.shadowOffsetY = 4 * scale;
    ctx.fillStyle = COLORS.MODAL.BUTTON_BACKGROUND;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.font = `bold ${modalButtonFontSize}px Arial`;
    ctx.fillStyle = COLORS.MODAL.BUTTON_TEXT;
    ctx.fillText('Play Again', centerX, buttonY + modalButtonHeight / 2 + modalButtonFontSize * 0.35);

    ctx.restore();

    this.playAgainButtonArea = { x: buttonX, y: buttonY, width: modalButtonWidth, height: modalButtonHeight };
  }

  // "Here's everything you earned" section on the win/lose modal, between
  // the subtitle and the Play Again button - per explicit request the
  // modal should show the full reward breakdown, not just leave it implied
  // by the HUD's coin count having changed, and (per a later explicit
  // request) laid out as one row rather than several stacked lines: coins
  // (with the round-vs-doobers split folded into the same string as a
  // parenthetical) on the left, level-up/XP on the right. Content is
  // vertically centered within [topY, bottomY], same reserved-space
  // pattern as before even though there's now only ever one row to
  // center - keeps 'pending'/'error's single centered line and the ready
  // state's row sharing the same layout code path.
  // Each reward item gets its *own* bordered box with real margin between
  // them - per explicit "should be looking at separated boxes, like ice
  // cubes in a tray" - not one shared box with loose text inside it (what
  // an earlier version drew). Every box in this method uses the same
  // fill/stroke so they read as one family of compartments.
  drawRewardChipBox(x, y, width, height) {
    const ctx = this.ctx;
    drawRoundedRect(ctx, x, y, width, height, 10 * this.layout.scale);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = Math.max(1, 1.5 * this.layout.scale);
    ctx.stroke();
  }

  drawRewardsBreakdown(centerX, topY, bottomY, modalWidth) {
    const ctx = this.ctx;
    const { modalRewardsTitleFontSize: titleSize, modalRewardsLineFontSize: lineSize, scale } = this.layout;
    const breakdown = this.roundRewardBreakdown;
    // Inset a few px off the reserved [topY, bottomY] region itself so
    // every box below reads as floating with real margin, rather than a
    // strip snapped edge-to-edge against the space around it.
    const insetV = 6 * scale;
    const boxTop = topY + insetV;
    const boxHeight = bottomY - topY - insetV * 2;
    const rowCenterY = boxTop + boxHeight / 2;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (breakdown.status === 'pending' || breakdown.status === 'error') {
      ctx.font = `italic ${Math.round(lineSize)}px Arial`;
      const text = breakdown.status === 'pending' ? 'Tallying rewards…' : 'Rewards will show next round';
      const textWidth = ctx.measureText(text).width;
      const chipWidth = Math.min(modalWidth * 0.84, textWidth + 28 * scale);
      this.drawRewardChipBox(centerX - chipWidth / 2, boxTop, chipWidth, boxHeight);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText(text, centerX, rowCenterY);
      ctx.restore();
      return;
    }

    // One chip per item, side by side with a real gap between them - laid
    // out by measuring each chip's actual content width and centering the
    // whole group, same reasoning as the icon+text centering in
    // drawHudCoinStatText()/measureHudCoinStatBlock(): a fixed guessed
    // width/position can't account for how wide any given string actually
    // renders, and did overflow in an earlier version. Keeping coins short
    // (dropping the doobers parenthetical) whenever a second chip is also
    // showing is what keeps two variable-length chips fitting comfortably
    // side by side - the full breakdown only appears when coins is the
    // only chip on the row.
    const secondText = breakdown.leveledUp
      ? `⭐ Lvl ${breakdown.newLevel}!`
      : breakdown.xpGained
        ? `✨ +${breakdown.xpGained} XP`
        : null;
    // drawHudCoinStatText() below already draws the real doober-coin icon
    // ahead of this text - the word "Coins" would just repeat what the
    // icon already says, per the same "icon in place of the word" rule
    // the store's own wallet line/buy button follow.
    const coinsText = (!secondText && breakdown.dooberCoins > 0)
      ? `+${breakdown.totalCoinsGained} (+${breakdown.dooberCoins} doobers)`
      : `+${breakdown.totalCoinsGained}`;

    const rowFontSize = secondText ? titleSize * 0.8 : titleSize;
    const chipPaddingH = rowFontSize * 0.7;

    ctx.font = `bold ${Math.round(rowFontSize)}px Arial, sans-serif`;
    const coinsBlock = this.measureHudCoinStatBlock(coinsText, rowFontSize);
    const coinsChipWidth = coinsBlock.totalWidth + chipPaddingH * 2;

    if (secondText) {
      const secondTextWidth = ctx.measureText(secondText).width;
      const secondChipWidth = secondTextWidth + chipPaddingH * 2;
      const chipGap = 10 * scale;

      const totalWidth = coinsChipWidth + chipGap + secondChipWidth;
      const coinsChipX = centerX - totalWidth / 2;
      const secondChipX = coinsChipX + coinsChipWidth + chipGap;

      this.drawRewardChipBox(coinsChipX, boxTop, coinsChipWidth, boxHeight);
      this.drawRewardChipBox(secondChipX, boxTop, secondChipWidth, boxHeight);

      ctx.fillStyle = '#ffffff';
      this.drawHudCoinStatText(coinsChipX + coinsChipWidth / 2, rowCenterY, coinsText, rowFontSize);

      ctx.fillStyle = breakdown.leveledUp ? '#ffd54f' : 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(secondText, secondChipX + secondChipWidth / 2, rowCenterY);
    } else {
      this.drawRewardChipBox(centerX - coinsChipWidth / 2, boxTop, coinsChipWidth, boxHeight);
      ctx.fillStyle = '#ffffff';
      this.drawHudCoinStatText(centerX, rowCenterY, coinsText, rowFontSize);
    }

    ctx.restore();
  }

  // A wall band flush against all four canvas edges, drawn under the
  // furniture/escapes/characters (called right after drawFloor()) so it
  // reads as the room's wall: furniture sits in front of it (and covers
  // most of it, since furniture is placed flush to the same edges), while
  // any wall left uncovered by furniture — corners, the gaps beside a
  // centered wall run, and crucially the mouse-hole gap left in
  // generateKitchenFurniture() — stays visible. Drawn as two stroked
  // borders (outer at the canvas edge, inner where the band meets the
  // floor) around a filled band, to read as wall thickness rather than a
  // flat painted stripe.
  drawWalls() {
    const t = this.layout.wallBandThickness;
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.save();
    this.ctx.fillStyle = COLORS.WALL_FILL;
    this.ctx.fillRect(0, 0, w, t); // top
    this.ctx.fillRect(0, h - t, w, t); // bottom
    this.ctx.fillRect(0, 0, t, h); // left
    this.ctx.fillRect(w - t, 0, t, h); // right

    this.ctx.strokeStyle = COLORS.WALL_TRIM;
    this.ctx.lineWidth = Math.max(1, 2 * this.layout.scale);
    this.ctx.strokeRect(1, 1, w - 2, h - 2); // outer border
    this.ctx.strokeRect(t, t, w - t * 2, h - t * 2); // inner border
    this.ctx.restore();
  }

  // One guaranteed-visible mouse hole: generateKitchenFurniture() leaves a
  // real gap in one wall's tile run each game and records it as
  // this.wallGap. That gap gets the first escape, placed exactly in the
  // open floor space where a tile would otherwise be — since nothing is
  // drawn over that spot, the mouse stays visible there instead of ducking
  // under solid furniture (see Mouse.js / FURNITURE_SPRITES comment above).
  generateEscapes(count) {
    const escapes = [];
    const escapeSize = this.layout.escapeSize;

    if (this.wallGap) {
      const gap = this.wallGap;
      const x = gap.x + gap.width / 2 - escapeSize / 2;
      const y = gap.wall === 'top' ? 0 : this.canvas.height - escapeSize;
      escapes.push(new Escape(x, y, escapeSize, escapeSize, gap.wall));
    }

    // Escape draws itself rotated per wall (see Escape.js) so the hole's
    // opening always faces into the room rather than always facing "down".
    const WALL_NAMES = ['top', 'bottom', 'left', 'right'];
    while (escapes.length < count) {
      const wall = Math.floor(Math.random() * 4);
      const x = wall === 2 ? 0 : wall === 3 ? this.canvas.width - escapeSize : Math.random() * (this.canvas.width - escapeSize);
      const y = wall === 0 ? 0 : wall === 1 ? this.canvas.height - escapeSize : Math.random() * (this.canvas.height - escapeSize);
      escapes.push(new Escape(x, y, escapeSize, escapeSize, WALL_NAMES[wall]));
    }

    return escapes;
  }

  generateKitchenFurniture() {
    const furniture = [];
    const {
      scale, moduleScale, diningScale, wallBandThickness, wallOffset,
      topWallHeight, bottomWallHeight, leftWallWidth, rightWallWidth,
      spawnClearance, catSizeApprox, mouseSizeApprox, dogSizeApprox,
    } = this.layout;
    const SPACING = 10 * scale;

    // cabinet and every decorated counter variant (see MODULE_SCALE_MULTIPLIERS
    // above) render at a smaller effective scale than sink/stove, so their much
    // bigger native renders still come out at CABINET_TARGET_HEIGHT's on-screen
    // height. A no-op (returns moduleScale unchanged) for sink/stove, which
    // were never affected by any of this.
    const moduleScaleFor = (type) => MODULE_SCALE_MULTIPLIERS[type] ? moduleScale * MODULE_SCALE_MULTIPLIERS[type] : moduleScale;

    // Builds one wall module with its back (the edge facing the wall) flush
    // against the wall band's front face — wallBandThickness in from the
    // canvas edge, not a shared floor baseline. Every piece's back touches
    // the wall this way regardless of its native height, so there's never a
    // strip of bare floor visible between a shorter piece and the wall;
    // only the front (facing the room) varies by height instead.
    // Bottom-wall modules are rotated 180° (top wall stays unrotated) so
    // cabinet's single remaining trim band (see MODULE_SPECS.cabinet above)
    // ends up facing the room on both walls instead of facing the wall on
    // one of them — sink/stove never appear on the bottom wall today (see
    // BOTTOM_WALL_ORDER), so this doesn't affect their orientation.
    const makeModule = (type, x, isTop) => {
      const spec = MODULE_SPECS[type];
      const effectiveScale = moduleScaleFor(type);
      const height = spec.height * effectiveScale;
      const y = isTop ? wallBandThickness : this.canvas.height - wallBandThickness - height;
      return new Furniture(x, y, type, spec.sprite, isTop ? 0 : 180, spec.width, spec.height, effectiveScale, spec.cropX, spec.cropY);
    };

    // Places `order` edge-to-edge using each piece's own scaled width
    // (unlike the old fixed-cell-width layout, since these renders aren't a
    // uniform size), centered as a group. One slot is skipped if this wall
    // was chosen for the mouse-hole gap this game. `extraWidth` reserves
    // additional room *within the centering calculation* without actually
    // placing anything there — the top wall's fridge needs this: it's a
    // separate object placed immediately after the run finishes (see below),
    // so it has to be accounted for here or the run centers as if the fridge
    // didn't exist, leaving it too little room and pushing it off-canvas
    // (confirmed live: the fridge rendered 7-21px past the right edge, in
    // every single game at every canvas size tested, before this existed).
    const buildWall = (order, isTop, extraWidth = 0) => {
      const scaledWidths = order.map(type => MODULE_SPECS[type].width * moduleScaleFor(type));
      const totalWidth = scaledWidths.reduce((a, b) => a + b, 0);
      let cursorX = Math.max(0, (this.canvas.width - totalWidth - extraWidth) / 2);
      const wallName = isTop ? 'top' : 'bottom';
      const gapIndex = gapWall === wallName ? Math.floor(Math.random() * order.length) : -1;
      const wallHeight = isTop ? topWallHeight : bottomWallHeight;

      order.forEach((type, i) => {
        const w = scaledWidths[i];
        if (i === gapIndex) {
          this.wallGap = { x: cursorX, y: isTop ? 0 : this.canvas.height - wallHeight, width: w, height: wallHeight, wall: wallName };
        } else {
          furniture.push(makeModule(type, cursorX, isTop));
        }
        cursorX += w;
      });

      return cursorX;
    };

    // Places `order` edge-to-edge vertically along the left or right wall,
    // rotated 90/270 so each module's long edge runs along the wall.
    // Confined strictly to the band between the top and bottom walls (not
    // flush to the very top/bottom of the canvas) so it can never corner-
    // overlap the top wall's fridge or the bottom wall's run. Each module's
    // back is flush against the wall band's front face — x=wallBandThickness
    // for left, canvas.width-wallBandThickness-depth for right — the same
    // back-to-wall alignment as the horizontal walls, rather than flush to
    // the raw canvas edge.
    // `extraLength` mirrors buildWall()'s `extraWidth` — reserves room
    // within the vertical centering for a fridge that might land at the end
    // of this wall's run (see the fridge placement below), without actually
    // placing anything there itself. Returns the end cursorY so the caller
    // can append the fridge flush after the run, same pattern as buildWall.
    const buildWallVertical = (order, isLeft, extraLength = 0) => {
      // Same moduleScaleFor(type) treatment buildWall() uses above — left/
      // right walls only ever place 'cabinet' (no decorated substitution
      // happens here, see the substitution logic's own comment below), but
      // cabinet's own art swap means even its unmodified appearances need
      // the multiplier applied, not just the ones being substituted for.
      // Confirmed necessary the same way the horizontal-wall version of this
      // bug was: without it, left/right wall cabinets would render at the
      // old *unscaled* ~1.85x size while topWallHeight/bottomWallHeight's
      // reservation (and this same wall's own leftWallWidth/rightWallWidth)
      // correctly expect the *scaled* size — a mismatch that would overflow
      // the reserved band.
      const scaledLengths = order.map(type => MODULE_SPECS[type].width * moduleScaleFor(type));
      const totalLength = scaledLengths.reduce((a, b) => a + b, 0);
      const bandTop = topWallHeight;
      const bandHeight = this.canvas.height - bottomWallHeight - topWallHeight;
      let cursorY = bandTop + Math.max(0, (bandHeight - totalLength - extraLength) / 2);
      const rotation = isLeft ? LEFT_WALL_ROTATION : RIGHT_WALL_ROTATION;

      order.forEach((type, i) => {
        const spec = MODULE_SPECS[type];
        const effectiveScale = moduleScaleFor(type);
        const depth = spec.height * effectiveScale;
        const x = isLeft ? wallBandThickness : this.canvas.width - wallBandThickness - depth;
        furniture.push(new Furniture(x, cursorY, type, spec.sprite, rotation, spec.width, spec.height, effectiveScale, spec.cropX, spec.cropY));
        cursorY += scaledLengths[i];
      });

      return cursorY;
    };

    // Pick exactly one wall to leave one module out of, each game — that gap
    // becomes this.wallGap, read by generateEscapes() to place a guaranteed-
    // visible mouse hole there. Only top/bottom are in the pool — left/right
    // are solid runs with no gap (generateEscapes()'s x/y math only handles
    // horizontal walls today).
    const gapWall = Math.random() < 0.5 ? 'top' : 'bottom';
    this.wallGap = null;

    // Randomize how much of each wall's *_WALL_ORDER actually gets built
    // this game — a random subsequence (not just a trimmed prefix/suffix,
    // so which specific pieces survive varies too), not the full array
    // every time. Reported live as every kitchen looking too similarly
    // "full" ("too many cabinets/counters that show up always... some
    // kitchens have a lot of counter space, some don't").
    //
    // Floor is half of each wall's full length (rounded up), not 1/0 —
    // reported live as too sparse with that lower floor ("furniture now too
    // few"), asked to land "midway between what was [always full] and what
    // is [1/0 floor]" as a stopgap rather than tuning to a specific number
    // (an eventual player-facing density option was floated for later, not
    // built now). Halfway between "always full" and "as low as 1 or 0" is a
    // floor of half the full count, not a change to the ceiling (still the
    // full order) — pulls the average back up toward full without removing
    // the low end's variety entirely.
    //
    // Deliberately computed (and, below, decorated-counter-substituted)
    // *before* the fridge-fit check that follows, not after — this used to
    // be the other way around, with the fridge-fit check reasoning about a
    // conservative worst case (the full static array, with every 'cabinet'
    // slot assumed to become the single widest possible decorated variant)
    // computed *before* either of these ran, since at the time neither had
    // run yet. That worst-case padding became so pessimistic once 5
    // decorated counter variants existed that it made the top/bottom walls
    // *permanently* fail their own fit check at every canvas size (the
    // scaling system keeps every ratio constant across sizes, so this
    // wasn't a small-canvas edge case — confirmed live via 500 sampled
    // layouts: the fridge landed on left/right in literally 500/500 games,
    // 0/500 on top or bottom, versus the roughly-even split across all four
    // walls this feature is supposed to have). Resolving the *actual* wall
    // composition first and checking fridge-fit against that real result
    // (see topOrderWidth/bottomOrderWidth below) replaces a padded guess
    // with ground truth — strictly more accurate, and removes the need for
    // any worst-case reasoning (or a maxCabinetSlotWidth-style constant) at
    // all, rather than trying to tune the padding back down.
    const pickWallDensity = (fullOrder) => {
      const min = Math.ceil(fullOrder.length / 2);
      const count = min + Math.floor(Math.random() * (fullOrder.length - min + 1));
      const indices = fullOrder.map((_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      return indices.slice(0, count).sort((a, b) => a - b).map(i => fullOrder[i]);
    };
    const actualTopOrder = pickWallDensity(TOP_WALL_ORDER);
    const actualBottomOrder = pickWallDensity(BOTTOM_WALL_ORDER);
    const actualLeftOrder = pickWallDensity(LEFT_WALL_ORDER);
    const actualRightOrder = pickWallDensity(RIGHT_WALL_ORDER);

    // Fill plain 'cabinet' slots on the top/bottom walls with decorated
    // variants first, falling back to blank cabinet only for whatever's
    // left over — per explicit direction: "favor counter pieces that are
    // not blank, with the blanks as extras to fill any space on the wall if
    // needed." This replaced an earlier version where blank cabinet was the
    // default and each decorated variant only had a 50% chance to take an
    // offered slot even when one was available — the opposite priority from
    // what's wanted now. (Left/right walls stay untouched — their fridge-fit
    // math is already exact, using the fixed *_WITH_FRIDGE orders below,
    // since decorated substitution never happens there.) Mutates
    // actualTopOrder/actualBottomOrder's entries *in place* — the
    // substituted type then flows through the exact same width/centering/
    // rotation/gap logic a plain cabinet would have, no special-casing
    // needed anywhere else in buildWall() itself. All cabinet slots across
    // both walls are pooled into one shuffled list first (not decided
    // per-wall independently) so a one-off type can never land on both
    // walls in the same game.
    const cabinetSlots = [];
    [actualTopOrder, actualBottomOrder].forEach(order => {
      order.forEach((type, i) => {
        if (type === 'cabinet') cabinetSlots.push({ order, i });
      });
    });
    for (let i = cabinetSlots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cabinetSlots[i], cabinetSlots[j]] = [cabinetSlots[j], cabinetSlots[i]];
    }
    // One shuffled "offer pool" covering every allowed appearance across all
    // decorated variants — each COUNTER_ONE_OFF_TYPES entry appears once
    // (so it can win at most one slot), 'counterFlowers' appears
    // COUNTER_FLOWERS_MAX_APPEARANCES times (so it can win up to that many,
    // never more, since the pool itself only has that many tickets for it).
    // Shuffled so *which* slots get decorated (when there are fewer slots
    // than pool entries) and *which* pool entries get left out (when
    // there are more pool entries than slots) both stay randomized, not
    // fixed by array order.
    const counterOfferPool = [
      ...COUNTER_ONE_OFF_TYPES,
      ...Array(COUNTER_FLOWERS_MAX_APPEARANCES).fill('counterFlowers'),
    ];
    for (let i = counterOfferPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [counterOfferPool[i], counterOfferPool[j]] = [counterOfferPool[j], counterOfferPool[i]];
    }
    // Every pool entry takes the next available pooled slot outright — no
    // random decline. The pool has 6 tickets (4 one-off types + 2 flower
    // tickets) against at most 6 cabinet-type slots across both walls
    // combined (TOP_WALL_ORDER's 2 + BOTTOM_WALL_ORDER's 4) — cabinetSlots
    // can never exceed 6 (density-trimming only ever removes slots, never
    // adds beyond the static arrays' own totals), so the pool's 6 tickets
    // are always enough to cover every cabinet slot that exists this game.
    // In practice this means blank cabinet no longer appears on the top/
    // bottom walls at all under current numbers — the "fallback for
    // whatever's left over" case is real (this loop still stops cleanly if
    // it ever isn't true) but doesn't currently trigger, since there's
    // never more space than the pool can cover. If that's more decoration
    // than wanted, the lever to pull is the pool size (fewer one-off types,
    // or dropping COUNTER_FLOWERS_MAX_APPEARANCES), not this loop.
    let counterSlotIndex = 0;
    for (const type of counterOfferPool) {
      if (counterSlotIndex >= cabinetSlots.length) break;
      const slot = cabinetSlots[counterSlotIndex];
      slot.order[slot.i] = type;
      counterSlotIndex++;
    }

    // Fridge: used to always trail the top wall's run (always "top-right"),
    // flagged live as wanting placement variety. It's still wall-mounted
    // (a real fridge sits against a wall, unlike the freestanding dining
    // set below) but which of the 4 walls it lands on is now randomized
    // each game, appended flush after whatever run already occupies that
    // wall — the same "flush after the existing run" placement the top
    // wall always used, just generalized to whichever wall gets picked.
    // Independent of `gapWall` above (the mouse-hole gap) — the two can
    // land on the same wall or different ones, no interaction between them.
    // FRIDGE_SCALE_MULTIPLIER (see its own comment above) — every fridge
    // dimension below derives from these two, so fixing the multiplier in
    // just these two definitions propagates correctly to every fit-check
    // and placement call site further down.
    const fridgeScale = moduleScale * FRIDGE_SCALE_MULTIPLIER;
    const fridgeWidth = FRIDGE_SPEC.width * fridgeScale;
    const fridgeHeight = FRIDGE_SPEC.height * fridgeScale;
    // On a vertical wall the fridge is rotated 90°/270° like every other
    // vertical-wall module, which swaps its axes (see Furniture.js): the
    // dimension that runs *along* the wall is its native width scaled
    // (matching buildWallVertical's own scaledLengths), and the dimension
    // that reaches *into the room* is its native height scaled — the
    // opposite of the horizontal-wall case just above.
    const fridgeAlongWall = FRIDGE_SPEC.width * fridgeScale;
    const fridgeIntoRoom = FRIDGE_SPEC.height * fridgeScale;

    // Only randomize among walls the fridge actually fits on alongside that
    // wall's own modules — confirmed live that picking blindly among all 4
    // isn't safe: LEFT_WALL_ORDER/RIGHT_WALL_ORDER (2 cabinets) plus the
    // fridge doesn't fit the vertical band's height at any canvas size
    // (the horizontal walls' 4-module runs plus the fridge do fit, with
    // margin, at every size tested — it's specifically the vertical walls'
    // runs colliding with a shorter available band that breaks, and since
    // the board's aspect ratio is fixed, that's true at every scale, not
    // just small mobile canvases). Picking blind and leaning on the
    // placement clamp below to paper over it reproduced the exact same
    // "cabinet/fridge overlap" failure mode the horizontal-only version of
    // this feature had before its own fit-reservation fix — so this checks
    // fit *before* picking, rather than clamping *after* picking and hoping.
    // Left/right use their reduced *_WITH_FRIDGE orders (one cabinet, not
    // two) for this check, since that's the order actually built below when
    // the fridge lands there — checking the normal two-cabinet order would
    // simply never pass, permanently locking the fridge out of side walls.
    // No decorated substitution ever happens on left/right, so these two
    // stay exact against the fixed static orders, same as always.
    //
    // Top/bottom now measure the *actual* resolved actualTopOrder/
    // actualBottomOrder (already density-trimmed and decorated-counter-
    // substituted above) instead of guessing a worst case from the static
    // TOP_WALL_ORDER/BOTTOM_WALL_ORDER — see the comment on
    // actualTopOrder/actualBottomOrder's own definitions above for why the
    // guess was replaced with ground truth rather than just re-tuned.
    const topOrderWidth = actualTopOrder.reduce((sum, type) => sum + MODULE_SPECS[type].width * moduleScaleFor(type), 0);
    const bottomOrderWidth = actualBottomOrder.reduce((sum, type) => sum + MODULE_SPECS[type].width * moduleScaleFor(type), 0);
    const leftOrderWithFridgeLength = LEFT_WALL_ORDER_WITH_FRIDGE.reduce((sum, type) => sum + MODULE_SPECS[type].width * moduleScaleFor(type), 0);
    const rightOrderWithFridgeLength = RIGHT_WALL_ORDER_WITH_FRIDGE.reduce((sum, type) => sum + MODULE_SPECS[type].width * moduleScaleFor(type), 0);
    const verticalBandHeight = this.canvas.height - topWallHeight - bottomWallHeight;
    const fridgeFitsWall = {
      top: topOrderWidth + fridgeWidth <= this.canvas.width,
      bottom: bottomOrderWidth + fridgeWidth <= this.canvas.width,
      left: leftOrderWithFridgeLength + fridgeAlongWall <= verticalBandHeight,
      right: rightOrderWithFridgeLength + fridgeAlongWall <= verticalBandHeight,
    };
    const candidateWalls = ['top', 'bottom', 'left', 'right'].filter(wall => fridgeFitsWall[wall]);
    // Independent of `gapWall` above (the mouse-hole gap) — the two can
    // land on the same wall or different ones, no interaction between them.
    // Top is the fallback on the (untested-in-practice) chance nothing
    // fits — it's the one wall confirmed to always have room to spare.
    const fridgeWall = candidateWalls.length > 0
      ? candidateWalls[Math.floor(Math.random() * candidateWalls.length)]
      : 'top';

    // 1. Top wall: cabinet/stove/sink/cabinet, back flush against the wall
    // band. `fridgeWidth` is passed as `extraWidth` only when the fridge
    // actually landed here, so the run centers itself leaving enough room
    // for the fridge that follows — centering as if the fridge didn't exist
    // is exactly what pushed it off-canvas before this reservation existed.
    const topEndX = buildWall(actualTopOrder, true, fridgeWall === 'top' ? fridgeWidth : 0);

    // 2. Bottom wall: same treatment, flush against the bottom edge, with a
    // different order than the top wall for a bit of variety.
    const bottomEndX = buildWall(actualBottomOrder, false, fridgeWall === 'bottom' ? fridgeWidth : 0);

    // 3. Left and right walls: cabinet runs rotated to stand against the
    // vertical walls, confined to the band between the top and bottom walls
    // so nothing corners-overlaps. Whichever side carries the fridge this
    // game builds its reduced *_WITH_FRIDGE order instead of the normal
    // two-cabinet one (see that constant's comment for why) — deliberately
    // still the fixed, non-randomized order in that case, so the fridge-fit
    // math above (which assumes exactly that order) stays accurate.
    const leftEndY = buildWallVertical(fridgeWall === 'left' ? LEFT_WALL_ORDER_WITH_FRIDGE : actualLeftOrder, true, fridgeWall === 'left' ? fridgeAlongWall : 0);
    const rightEndY = buildWallVertical(fridgeWall === 'right' ? RIGHT_WALL_ORDER_WITH_FRIDGE : actualRightOrder, false, fridgeWall === 'right' ? fridgeAlongWall : 0);

    // Place the fridge flush after whichever wall's run it landed on.
    // `Math.min`/clamp on each branch is a belt-and-suspenders backstop in
    // case the reservation above still doesn't leave quite enough room on
    // some canvas size — pulling the fridge back this way could in
    // principle mean it sits closer to (or, rarely, slightly overlapping)
    // the last module on that wall, which is a much smaller visual cost
    // than rendering off the board entirely.
    //
    // FRIDGE_ROTATIONS, not LEFT_WALL_ROTATION/RIGHT_WALL_ROTATION/0/180
    // directly: the fridge render's own back/front edges are flipped
    // relative to cabinet's (confirmed live — "the fridge asset is
    // backwards, the part facing the wall should face front"), so every
    // rotation used for it is offset 180° from what the exact same wall
    // uses for cabinet/sink/stove. Kept as its own named map, not a shared
    // constant with an inline `+180`, so the actual rotation value used is
    // visible at the call site rather than requiring the reader to do the
    // arithmetic themselves.
    if (fridgeWall === 'top') {
      const fridgeX = Math.min(topEndX, this.canvas.width - fridgeWidth);
      furniture.push(new Furniture(fridgeX, wallBandThickness, 'fridge', FURNITURE_SPRITES.FRIDGE, FRIDGE_ROTATIONS.top, FRIDGE_SPEC.width, FRIDGE_SPEC.height, fridgeScale, FRIDGE_SPEC.cropX, FRIDGE_SPEC.cropY));
    } else if (fridgeWall === 'bottom') {
      const fridgeX = Math.min(bottomEndX, this.canvas.width - fridgeWidth);
      const fridgeY = this.canvas.height - wallBandThickness - fridgeHeight;
      furniture.push(new Furniture(fridgeX, fridgeY, 'fridge', FURNITURE_SPRITES.FRIDGE, FRIDGE_ROTATIONS.bottom, FRIDGE_SPEC.width, FRIDGE_SPEC.height, fridgeScale, FRIDGE_SPEC.cropX, FRIDGE_SPEC.cropY));
    } else if (fridgeWall === 'left') {
      const fridgeY = Math.min(leftEndY, this.canvas.height - bottomWallHeight - fridgeAlongWall);
      furniture.push(new Furniture(wallBandThickness, fridgeY, 'fridge', FURNITURE_SPRITES.FRIDGE, FRIDGE_ROTATIONS.left, FRIDGE_SPEC.width, FRIDGE_SPEC.height, fridgeScale, FRIDGE_SPEC.cropX, FRIDGE_SPEC.cropY));
    } else {
      const fridgeY = Math.min(rightEndY, this.canvas.height - bottomWallHeight - fridgeAlongWall);
      const fridgeX = this.canvas.width - wallBandThickness - fridgeIntoRoom;
      furniture.push(new Furniture(fridgeX, fridgeY, 'fridge', FURNITURE_SPRITES.FRIDGE, FRIDGE_ROTATIONS.right, FRIDGE_SPEC.width, FRIDGE_SPEC.height, fridgeScale, FRIDGE_SPEC.cropX, FRIDGE_SPEC.cropY));
    }

    // Helper to check overlap, used for the freestanding dining set.
    const overlaps = (x, y, width, height) => {
      return furniture.some(f => {
        return !(x + width + SPACING < f.x ||
                 x > f.x + f.width + SPACING ||
                 y + height + SPACING < f.y ||
                 y > f.y + f.height + SPACING);
      });
    };

    // Entity spawn positions to avoid — must match resetGameObjects() exactly
    const catSpawnX = this.canvas.width / 2;
    const catSpawnY = this.canvas.height - bottomWallHeight - spawnClearance;
    const catSize = catSizeApprox;
    const mouseSpawnX = 100 * scale;
    const mouseSpawnY = 100 * scale;
    const mouseSize = mouseSizeApprox;
    const dogSpawnX = 200 * scale;
    const dogSpawnY = topWallHeight + spawnClearance;
    const dogSize = dogSizeApprox;
    const SPAWN_BUFFER = 20 * scale;

    const blocksSpawn = (x, y, width, height) => {
      const spawns = [
        { x: catSpawnX, y: catSpawnY, size: catSize },
        { x: mouseSpawnX, y: mouseSpawnY, size: mouseSize },
        { x: dogSpawnX, y: dogSpawnY, size: dogSize }
      ];

      return spawns.some(spawn => {
        return !(x > spawn.x + spawn.size + SPAWN_BUFFER ||
                 x + width < spawn.x - SPAWN_BUFFER ||
                 y > spawn.y + spawn.size + SPAWN_BUFFER ||
                 y + height < spawn.y - SPAWN_BUFFER);
      });
    };

    const INTERIOR_MARGIN = 20 * scale;
    const playableX = wallOffset + INTERIOR_MARGIN + leftWallWidth;
    const playableY = topWallHeight + INTERIOR_MARGIN;
    const playableRightEdge = this.canvas.width - wallOffset - INTERIOR_MARGIN - rightWallWidth;
    const playableMaxWidth = playableRightEdge - playableX;
    const playableMaxHeight = this.canvas.height - bottomWallHeight - INTERIOR_MARGIN - playableY;

    // Exposed for resetGameObjects()'s resolveClearSpawn() — the same
    // interior bounds the dining set below searches within, reused so a
    // fallback mouse spawn is guaranteed to fit the same way the dining set
    // does.
    this.playableArea = { x: playableX, y: playableY, width: playableMaxWidth, height: playableMaxHeight };

    // 4. Dining set: a single table piece now that the chairs are baked
    // into the render itself (see TABLE_SPEC's own comment) — one
    // random-search placement instead of the old side-by-side two-piece
    // layout, sized off the table's own footprint alone.
    const plantScale = diningScale * PLANT_SCALE_MULTIPLIER;
    const cartScale = diningScale * CART_SCALE_MULTIPLIER;
    const shelfScale = diningScale * SHELF_SCALE_MULTIPLIER;
    const tableScale = diningScale * TABLE_SCALE_MULTIPLIER;
    const tableWidth = TABLE_SPEC.width * tableScale;
    const tableHeight = TABLE_SPEC.height * tableScale;

    let diningAttempts = 0;
    while (diningAttempts < 300) {
      const x = playableX + Math.random() * Math.max(0, playableMaxWidth - tableWidth);
      const y = playableY + Math.random() * Math.max(0, playableMaxHeight - tableHeight);

      if (!overlaps(x, y, tableWidth, tableHeight) && !blocksSpawn(x, y, tableWidth, tableHeight)) {
        furniture.push(new Furniture(x, y, 'table', FURNITURE_SPRITES.TABLE, 0, TABLE_SPEC.width, TABLE_SPEC.height, tableScale, TABLE_SPEC.cropX, TABLE_SPEC.cropY));
        break;
      }
      diningAttempts++;
    }

    // 5. Utility/baker's shelf: freestanding corner/wall decor, placed
    // *before* the cart/plant below — its on-screen footprint is the
    // biggest of the three corner-preferred decor pieces (see
    // SHELF_SCALE_MULTIPLIER above), and the cart already had to learn this
    // lesson the hard way: whichever of these pieces is biggest needs first
    // pick of the 4 corners, or it loses the corner-priority race to the
    // smaller ones far more often (confirmed live for the cart itself —
    // see its own comment below). Same corner-candidate/wall-fallback shape
    // as the cart's own placement, including the left/right footprint swap
    // for a rotated placement — copied structure, not a shared helper,
    // matching how the cart's own block was written (this codebase's
    // established style is a few similar lines per freestanding piece
    // rather than an early abstraction over three call sites).
    const shelfWidth = SHELF_SPEC.width * shelfScale;
    const shelfHeight = SHELF_SPEC.height * shelfScale;
    const SHELF_WALL_MARGIN = 6 * scale;
    const shelfCornerCandidates = [
      { x: wallBandThickness + SHELF_WALL_MARGIN, y: wallBandThickness + SHELF_WALL_MARGIN, wall: 'top' },
      { x: this.canvas.width - wallBandThickness - SHELF_WALL_MARGIN - shelfWidth, y: wallBandThickness + SHELF_WALL_MARGIN, wall: 'top' },
      { x: wallBandThickness + SHELF_WALL_MARGIN, y: this.canvas.height - wallBandThickness - SHELF_WALL_MARGIN - shelfHeight, wall: 'bottom' },
      { x: this.canvas.width - wallBandThickness - SHELF_WALL_MARGIN - shelfWidth, y: this.canvas.height - wallBandThickness - SHELF_WALL_MARGIN - shelfHeight, wall: 'bottom' },
    ];
    for (let i = shelfCornerCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shelfCornerCandidates[i], shelfCornerCandidates[j]] = [shelfCornerCandidates[j], shelfCornerCandidates[i]];
    }

    let shelfPlaced = false;
    for (const candidate of shelfCornerCandidates) {
      if (!overlaps(candidate.x, candidate.y, shelfWidth, shelfHeight) && !blocksSpawn(candidate.x, candidate.y, shelfWidth, shelfHeight)) {
        furniture.push(new Furniture(candidate.x, candidate.y, 'shelf', FURNITURE_SPRITES.SHELF, SHELF_ROTATIONS[candidate.wall], SHELF_SPEC.width, SHELF_SPEC.height, shelfScale, SHELF_SPEC.cropX, SHELF_SPEC.cropY));
        shelfPlaced = true;
        break;
      }
    }

    if (!shelfPlaced) {
      let shelfAttempts = 0;
      const WALL_NAMES_FOR_SHELF = ['top', 'bottom', 'left', 'right'];
      while (!shelfPlaced && shelfAttempts < 200) {
        const wall = Math.floor(Math.random() * 4);
        const wallName = WALL_NAMES_FOR_SHELF[wall];
        const rotated = wall === 2 || wall === 3;
        const footprintWidth = rotated ? shelfHeight : shelfWidth;
        const footprintHeight = rotated ? shelfWidth : shelfHeight;
        const alongTop = wallBandThickness + SHELF_WALL_MARGIN + Math.random() * Math.max(0, this.canvas.width - 2 * (wallBandThickness + SHELF_WALL_MARGIN) - footprintWidth);
        const alongSide = wallBandThickness + SHELF_WALL_MARGIN + Math.random() * Math.max(0, this.canvas.height - 2 * (wallBandThickness + SHELF_WALL_MARGIN) - footprintHeight);
        const x = wall === 2 ? wallBandThickness + SHELF_WALL_MARGIN
          : wall === 3 ? this.canvas.width - wallBandThickness - SHELF_WALL_MARGIN - footprintWidth
          : alongTop;
        const y = wall === 0 ? wallBandThickness + SHELF_WALL_MARGIN
          : wall === 1 ? this.canvas.height - wallBandThickness - SHELF_WALL_MARGIN - footprintHeight
          : alongSide;

        if (!overlaps(x, y, footprintWidth, footprintHeight) && !blocksSpawn(x, y, footprintWidth, footprintHeight)) {
          furniture.push(new Furniture(x, y, 'shelf', FURNITURE_SPRITES.SHELF, SHELF_ROTATIONS[wallName], SHELF_SPEC.width, SHELF_SPEC.height, shelfScale, SHELF_SPEC.cropX, SHELF_SPEC.cropY));
          shelfPlaced = true;
        }
        shelfAttempts++;
      }
    }
    // Same no-op-if-no-room philosophy as the plant/cart below.

    // 6. Cart: freestanding corner/wall decor, placed *before* the plant
    // (below) — the cart's footprint is roughly double the plant's (its
    // native content is closer to a wall module's size than to the
    // plant's), so if it went last it lost the corner-priority race far
    // more often: confirmed via an automated sampling pass (repeatedly
    // regenerating the layout and logging whether placement succeeded)
    // that cart-after-plant silently failed to place (the same
    // no-op-if-no-room fallback the plant already had) on roughly 1 in 4
    // layouts, reported live as "I tried 5 times and never saw it." Going
    // before the plant gives the bigger piece first pick of the 4 corners
    // while they're all still open; the plant's own success rate barely
    // moves in exchange, since it's small enough to still find room in
    // whatever's left over (a corner or wall spot) most of the time. Now
    // runs *after* the shelf above for the identical reason, once the
    // shelf turned out to be the biggest of the three. Passable for the
    // cat (and the mouse, which ignores all furniture regardless), blocking
    // for the dog (see CAT_NON_BLOCKING_FURNITURE_TYPES/DOG_NON_BLOCKING_
    // FURNITURE_TYPES above) — a solid cart is a believable thing for the
    // cat/mouse to duck past but for the dog to actually bump into, so the
    // dog has a reason to route around something the cat/mouse can cut
    // straight through.
    const cartWidth = CART_SPEC.width * cartScale;
    const cartHeight = CART_SPEC.height * cartScale;
    const CART_WALL_MARGIN = 6 * scale;
    // Corner candidates are always top/bottom-oriented — the cart is placed
    // at its native landscape footprint (cartWidth × cartHeight) in every
    // corner, resting against whichever horizontal wall that corner is on
    // (never rotated to portrait to instead rest against the vertical wall
    // at that same corner), so each one only ever needs the 'top' or
    // 'bottom' rotation, never 'left'/'right'.
    const cartCornerCandidates = [
      { x: wallBandThickness + CART_WALL_MARGIN, y: wallBandThickness + CART_WALL_MARGIN, wall: 'top' },
      { x: this.canvas.width - wallBandThickness - CART_WALL_MARGIN - cartWidth, y: wallBandThickness + CART_WALL_MARGIN, wall: 'top' },
      { x: wallBandThickness + CART_WALL_MARGIN, y: this.canvas.height - wallBandThickness - CART_WALL_MARGIN - cartHeight, wall: 'bottom' },
      { x: this.canvas.width - wallBandThickness - CART_WALL_MARGIN - cartWidth, y: this.canvas.height - wallBandThickness - CART_WALL_MARGIN - cartHeight, wall: 'bottom' },
    ];
    for (let i = cartCornerCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cartCornerCandidates[i], cartCornerCandidates[j]] = [cartCornerCandidates[j], cartCornerCandidates[i]];
    }

    let cartPlaced = false;
    for (const candidate of cartCornerCandidates) {
      if (!overlaps(candidate.x, candidate.y, cartWidth, cartHeight) && !blocksSpawn(candidate.x, candidate.y, cartWidth, cartHeight)) {
        furniture.push(new Furniture(candidate.x, candidate.y, 'cart', FURNITURE_SPRITES.CART, CART_ROTATIONS[candidate.wall], CART_SPEC.width, CART_SPEC.height, cartScale, CART_SPEC.cropX, CART_SPEC.cropY));
        cartPlaced = true;
        break;
      }
    }

    if (!cartPlaced) {
      let cartAttempts = 0;
      const WALL_NAMES_FOR_CART = ['top', 'bottom', 'left', 'right'];
      while (!cartPlaced && cartAttempts < 200) {
        const wall = Math.floor(Math.random() * 4);
        const wallName = WALL_NAMES_FOR_CART[wall];
        // A left/right rotation (90/270) swaps the on-screen footprint to
        // portrait (see Furniture's own width/height-swap-on-rotation
        // logic) — the placement math has to use that same swapped
        // footprint for left/right, not the cart's native landscape
        // cartWidth/cartHeight, or the positioned box wouldn't match what
        // Furniture actually ends up drawing/colliding as.
        const rotated = wall === 2 || wall === 3;
        const footprintWidth = rotated ? cartHeight : cartWidth;
        const footprintHeight = rotated ? cartWidth : cartHeight;
        const alongTop = wallBandThickness + CART_WALL_MARGIN + Math.random() * Math.max(0, this.canvas.width - 2 * (wallBandThickness + CART_WALL_MARGIN) - footprintWidth);
        const alongSide = wallBandThickness + CART_WALL_MARGIN + Math.random() * Math.max(0, this.canvas.height - 2 * (wallBandThickness + CART_WALL_MARGIN) - footprintHeight);
        const x = wall === 2 ? wallBandThickness + CART_WALL_MARGIN
          : wall === 3 ? this.canvas.width - wallBandThickness - CART_WALL_MARGIN - footprintWidth
          : alongTop;
        const y = wall === 0 ? wallBandThickness + CART_WALL_MARGIN
          : wall === 1 ? this.canvas.height - wallBandThickness - CART_WALL_MARGIN - footprintHeight
          : alongSide;

        if (!overlaps(x, y, footprintWidth, footprintHeight) && !blocksSpawn(x, y, footprintWidth, footprintHeight)) {
          furniture.push(new Furniture(x, y, 'cart', FURNITURE_SPRITES.CART, CART_ROTATIONS[wallName], CART_SPEC.width, CART_SPEC.height, cartScale, CART_SPEC.cropX, CART_SPEC.cropY));
          cartPlaced = true;
        }
        cartAttempts++;
      }
    }
    // Same no-op-if-no-room philosophy as the plant below.

    // 7. Plant: small freestanding decor, passable rather than a collision
    // obstacle (see CAT_NON_BLOCKING_FURNITURE_TYPES/DOG_NON_BLOCKING_
    // FURNITURE_TYPES above) — the project owner wants the cat/dog able to
    // walk through or behind it, with a knocked-
    // over/animated reaction on contact planned as a separate follow-up
    // (not implemented yet; there's nothing to react to until this placement
    // itself was confirmed working). Prefers a room corner — same
    // "opportunistic, not guaranteed" spirit as the v2 furniture pack's
    // corner-counter attempt, minus that attempt's actual problem (a
    // built-in counter needing to seam-match its neighbors at a precise
    // joint) — this is freestanding, so any corner with open space works
    // with no seam/style-matching risk at all. Falls back to any open spot
    // along a wall (not open floor generally — a potted plant reads as wall/
    // corner dressing, not a mid-room obstacle like the dining set) if
    // every corner happens to be occupied this game. Runs *after* the shelf
    // and cart (see points 5-6 above for why) — its own small footprint
    // means giving up first pick of the corners barely affects how often
    // it finds room.
    const plantWidth = PLANT_SPEC.width * plantScale;
    const plantHeight = PLANT_SPEC.height * plantScale;
    const PLANT_WALL_MARGIN = 6 * scale;
    const plantCornerCandidates = [
      { x: wallBandThickness + PLANT_WALL_MARGIN, y: wallBandThickness + PLANT_WALL_MARGIN },
      { x: this.canvas.width - wallBandThickness - PLANT_WALL_MARGIN - plantWidth, y: wallBandThickness + PLANT_WALL_MARGIN },
      { x: wallBandThickness + PLANT_WALL_MARGIN, y: this.canvas.height - wallBandThickness - PLANT_WALL_MARGIN - plantHeight },
      { x: this.canvas.width - wallBandThickness - PLANT_WALL_MARGIN - plantWidth, y: this.canvas.height - wallBandThickness - PLANT_WALL_MARGIN - plantHeight },
    ];
    // Shuffle so it isn't always the same corner (e.g. top-left) that wins
    // whenever more than one happens to be free.
    for (let i = plantCornerCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [plantCornerCandidates[i], plantCornerCandidates[j]] = [plantCornerCandidates[j], plantCornerCandidates[i]];
    }

    let plantPlaced = false;
    for (const candidate of plantCornerCandidates) {
      if (!overlaps(candidate.x, candidate.y, plantWidth, plantHeight) && !blocksSpawn(candidate.x, candidate.y, plantWidth, plantHeight)) {
        furniture.push(new Furniture(candidate.x, candidate.y, 'plant', FURNITURE_SPRITES.PLANT, 0, PLANT_SPEC.width, PLANT_SPEC.height, plantScale, PLANT_SPEC.cropX, PLANT_SPEC.cropY));
        plantPlaced = true;
        break;
      }
    }

    if (!plantPlaced) {
      let plantAttempts = 0;
      while (!plantPlaced && plantAttempts < 100) {
        const wall = Math.floor(Math.random() * 4);
        const alongTop = wallBandThickness + PLANT_WALL_MARGIN + Math.random() * Math.max(0, this.canvas.width - 2 * (wallBandThickness + PLANT_WALL_MARGIN) - plantWidth);
        const alongSide = wallBandThickness + PLANT_WALL_MARGIN + Math.random() * Math.max(0, this.canvas.height - 2 * (wallBandThickness + PLANT_WALL_MARGIN) - plantHeight);
        const x = wall === 2 ? wallBandThickness + PLANT_WALL_MARGIN
          : wall === 3 ? this.canvas.width - wallBandThickness - PLANT_WALL_MARGIN - plantWidth
          : alongTop;
        const y = wall === 0 ? wallBandThickness + PLANT_WALL_MARGIN
          : wall === 1 ? this.canvas.height - wallBandThickness - PLANT_WALL_MARGIN - plantHeight
          : alongSide;

        if (!overlaps(x, y, plantWidth, plantHeight) && !blocksSpawn(x, y, plantWidth, plantHeight)) {
          furniture.push(new Furniture(x, y, 'plant', FURNITURE_SPRITES.PLANT, 0, PLANT_SPEC.width, PLANT_SPEC.height, plantScale, PLANT_SPEC.cropX, PLANT_SPEC.cropY));
          plantPlaced = true;
        }
        plantAttempts++;
      }
    }
    // No placement at all (every corner and every wall-adjacent spot
    // occupied) is left as a no-op, same "an empty spot is a normal kitchen,
    // not a bug" philosophy already applied to the dining set and the
    // (since-removed) corner counter.

    return furniture;
  }
}
