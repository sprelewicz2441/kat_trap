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
    // Real generated art (2026-09-16, replacing the flat-vector
    // placeholder) - third and final real-art pass, after two rounds of
    // camera-angle correction. First pass: a real photographic perspective
    // camera (however flatly framed) still had a genuine vanishing point/
    // foreshortening that read as subtly "off" against this game's
    // furniture, which is rendered as a true orthographic projection
    // (zero perspective) - confirmed by direct comparison against
    // kitchen_fridge_v3.webp/kitchen_counter_flowers.webp, which turned
    // out to be mostly-top-down with only a small front-facing band
    // (the fridge's actual door/handles are a small strip at the very
    // bottom of the frame, not the large plain panel above it, which is
    // its top surface - easy to misread at a glance). Second pass fixed
    // the projection but still showed the fish in full side profile,
    // inconsistent with a steeply-overhead camera. This final pass adds
    // more decoration (plants, rocks, coral, a starfish) and views the
    // fish from more of a top-down angle, matching the rest of the
    // furniture's own top-down-with-a-little-front convention.
    //
    // Background-removed the same way every pass was: connected-component
    // flood fill from a plain white background (still not a native
    // transparent export - none of these generators support that),
    // hysteresis-grown through the low-saturation shadow gradient so it
    // doesn't get kept as opaque content, checked for (and clear of) any
    // stray fragment (see Lessons learned).
    spriteSrc: './assets/decor_fish_tank.webp?v=4',
    width: 952,
    height: 690,
    cropX: 5,
    cropY: 5,
    placement: 'freestanding',
    // Height-matched to the cart/shelf's own final on-screen height
    // (CART_SPEC.height * 0.32 ≈ SHELF_SPEC.height * 0.35 ≈ 297) the same
    // way their own multipliers were derived, rather than guessed fresh -
    // a tank on its stand should read as real furniture, not small decor
    // like the plant. Expect to retune once checked live, same as every
    // other scale multiplier in this file's GameScreen.js counterparts.
    scaleMultiplier: 0.43,
    catBlocks: true,
    dogBlocks: true,
  },
  'bird-cage': {
    slug: 'bird-cage',
    // Real generated art (2026-09-16, replacing the flat-vector
    // placeholder) - same iteration path as the fish tank (see its own
    // comment above): a real photographic-perspective first pass, then an
    // edit asking for a steeper top-down camera (which this generator
    // nailed on the very next try, unlike the fish tank's extra round),
    // then a third edit fixing a rendering-style regression the top-down
    // edit introduced (the cage came back as a flat vector/cartoon
    // illustration - visible outline strokes, flat color fills - rather
    // than a photorealistic render, an easy defect to miss without
    // comparing side by side against the kitchen's own photoreal assets).
    // Background-removed the same connected-component-flood-fill way as
    // every other kitchen asset (see Lessons learned) - a clean single
    // component with no holes eaten through the wire lattice, a real risk
    // for an object this open/see-through that didn't end up happening
    // here.
    spriteSrc: './assets/decor_bird_cage.webp?v=2',
    width: 604,
    height: 730,
    cropX: 5,
    cropY: 5,
    placement: 'freestanding',
    // Height-matched to the fish tank's own final on-screen height (its
    // own scaleMultiplier 0.43 * height 690 ≈ 297), same target every
    // freestanding piece in this registry converges on, rather than
    // guessed fresh. Expect to retune once checked live, same as every
    // other scale multiplier in this file's GameScreen.js counterparts.
    scaleMultiplier: 0.41,
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
