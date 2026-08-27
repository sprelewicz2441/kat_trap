// Resolves which sprite sheet a character should render with. Today this
// always returns each character's single default look - there's no
// purchasable outfit art yet. This is the one seam a future cosmetic-
// outfit feature needs to change: once a "look" exists as a full
// alternate sprite sheet (see kpground-api's StoreItem.sprite_src - the
// project's chosen approach, full swaps rather than layered pieces, at
// least for now), resolving it here means Cat.js/Dog.js/Mouse.js never
// need to know equip logic exists at all, only "what's my current src".
const DEFAULT_SPRITE_SRC = {
  cat: './assets/cat_v2.png?v=2',
  mouse: './assets/mouse_v2.png?v=1',
  dog: './assets/dog_v2.png?v=4',
};

// equippedOutfit: the 'outfit' slot's currently-equipped item, as
// returned by api.js's getEquipped() (null/undefined when nothing's
// equipped, i.e. the default look). Called from GameScreen.js's
// applyEquippedOutfit() with each character's real fetched equip state,
// and from storeModal.js's dressing-room pedestal preview with whichever
// item the player is currently looking at (which may not be equipped/
// owned yet - a preview, not a commitment).
export function getSpriteSrc(character, equippedOutfit = null) {
  return equippedOutfit?.sprite_src || DEFAULT_SPRITE_SRC[character];
}

// Native (unscaled) source-rect crop for each character's own sprite
// sheet - a small crop straight out of the sheet rather than new art,
// showing whichever frame reads best at rest. Shared by
// CharacterSelectScreen's character cards and storeModal's dressing-room
// pedestal preview so the two "here's what this character looks like"
// spots can't drift into different crops. Every cosmetic outfit is
// assumed to share this same frame geometry across looks (see
// getSpriteSrc() above - full alternate sprite sheets, not per-piece
// swaps) - a real cosmetic sprite sheet needs to match these same
// source-rect dimensions, same as this project's established asset-swap
// precedent (see CLAUDE.md: any new render needs the same padding/
// geometry check before wiring in).
export const PORTRAITS = {
  cat: { sx: 0, sy: 0, sw: 256, sh: 296 }, // v2 sprite — native pixel size (see Cat.js), not the logical 118×150 display size
  // east-facing profile, frame 1 (middle of the walk cycle) - was the
  // south-facing "running toward camera" frame, which read as diving/
  // falling at pedestal size and left too little clearance below the
  // face for the store's name label. A side profile shows the full body
  // and tutu/bow the same way Dog's own single-direction portrait
  // already does, with none of that overlap.
  mouse: { sx: 327, sy: 327, sw: 327, sh: 327 }, // v2 sprite — native pixel size (see Mouse.js)
  dog: { sx: 0, sy: 0, sw: 473, sh: 296 }, // v2 sprite — native pixel size (see Dog.js), not the logical 60×38 display size
};
