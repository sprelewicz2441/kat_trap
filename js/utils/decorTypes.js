// Pet Shop Boys decor catalog metadata - the client-side geometry/behavior
// companion to kpground-api's StoreItem rows (item_type='decor', see
// kpground-api/kattrap/management/commands/seed_store.py's PET_SHOP_ITEMS).
// The backend only ever tracks slug/name/cost/sprite_src/is_active - exactly
// the same split cosmetics already use (outfits.js's PORTRAITS crop map
// lives client-side too, not on the StoreItem row). Keyed by slug so it
// lines up 1:1 with the backend catalog with no separate ID mapping.
//
// Adding a new freestanding decor item is meant to be one entry here (plus
// its own seed_store.py row) - no placement-code changes needed. See
// GameScreen.js's generateKitchenFurniture(), which places every *owned*,
// placement:'freestanding' entry here via one shared corner/wall-search
// helper, sorted biggest-footprint-first automatically (see Lessons learned
// in CLAUDE.md on why manual per-item ordering was a real, repeated bug for
// the plant/cart/shelf's own hand-written placement blocks - this registry
// exists specifically so a growing Pet Shop Boys catalog doesn't repeat
// that).
//
// placement:'counter' entries (hamster-cage) are cataloged here too but not
// yet wired into a placement pool - kept is_active:false on the backend
// until that's built (see generateKitchenFurniture()'s own comment on why
// this round didn't touch the counter-substitution pool's already-tuned
// capacity math).
//
// width/height/cropX/cropY are each sprite's real alpha-channel content
// bbox (not the raw file's own dimensions), measured the same way as every
// kitchen_*.webp module - see CLAUDE.md's Lessons learned. catBlocks/
// dogBlocks default to true (a solid obstacle for both, like ordinary
// furniture) - set either to false only for a piece deliberately meant to
// be passable, the way plant/cart/shelf are for some combination of the two
// (see GameScreen.js's CAT_NON_BLOCKING_FURNITURE_TYPES/DOG_NON_BLOCKING_
// FURNITURE_TYPES, which fold these flags in automatically).
export const DECOR_TYPES = {
  'fish-tank': {
    slug: 'fish-tank',
    spriteSrc: './assets/decor_fish_tank.webp?v=1',
    width: 641,
    height: 741,
    cropX: 30,
    cropY: 140,
    placement: 'freestanding',
    // Tuned by eye against the cart/shelf's own on-screen size (a tank on
    // its stand should read as real furniture, not small decor like the
    // plant) - expect to retune once checked live, same as every other
    // scale multiplier in this file's GameScreen.js counterparts.
    scaleMultiplier: 0.3,
    catBlocks: true,
    dogBlocks: true,
  },
  'bird-cage': {
    slug: 'bird-cage',
    spriteSrc: './assets/decor_bird_cage.webp?v=1',
    width: 361,
    height: 751,
    cropX: 120,
    cropY: 130,
    placement: 'freestanding',
    // Narrower footprint than the fish tank at the same content height, so
    // a slightly bigger multiplier still lands close to the same on-screen
    // size rather than reading tiny next to it.
    scaleMultiplier: 0.34,
    catBlocks: true,
    dogBlocks: true,
  },
  'hamster-cage': {
    slug: 'hamster-cage',
    spriteSrc: './assets/decor_hamster_cage.webp?v=1',
    width: 1421,
    height: 635,
    cropX: 40,
    cropY: 60,
    // Not yet placed anywhere - see this file's own header comment and
    // generateKitchenFurniture()'s. Kept here (rather than left out
    // entirely) so the eventual counter-substitution wiring is "read this
    // entry," not "invent one from scratch."
    placement: 'counter',
    scaleMultiplier: null,
    catBlocks: true,
    dogBlocks: true,
  },
};

// Every registry entry whose `placement` is 'freestanding' - what
// GameScreen.js's freestanding-decor placement pass iterates over, filtered
// down to whichever of these the player actually owns.
export function getFreestandingDecorTypes() {
  return Object.values(DECOR_TYPES).filter((d) => d.placement === 'freestanding');
}
