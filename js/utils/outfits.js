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
// equipped, i.e. the default look, which is everyone's state today since
// no cosmetic outfits exist yet). Not yet called with a real
// equippedOutfit anywhere - GameScreen doesn't fetch equip state, only
// the wallet - so this always resolves to the default for now.
export function getSpriteSrc(character, equippedOutfit = null) {
  return equippedOutfit?.sprite_src || DEFAULT_SPRITE_SRC[character];
}
