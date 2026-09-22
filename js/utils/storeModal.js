import {
  equipItem,
  getStore,
  purchaseItem,
  sellItem,
  unequipItem,
  getDecorStore,
  purchaseDecorItem,
  sellDecorItem,
} from './api.js';
import { getSpriteSrc, PORTRAITS } from './outfits.js?v=1';
import { getUIScale, isTouch, REFERENCE_WIDTH } from './scale.js?v=1';
import { playSellChaChingSound, playStoreWhooshSound } from './audio.js?v=5';

// Registered by openStoreModal(), fired whenever a purchase changes the
// wallet - GameScreen uses this to keep its own this.wallet (and the
// HUD it drives) in sync without a redundant re-fetch. Same one-shot-
// callback shape loginModal.js uses for its own success callback.
let onWalletUpdateCallback = null;

// Called with (character, outfitItem|null) whenever an equip/unequip
// actually succeeds, so GameScreen can swap the live in-game sprite right
// away (GameScreen.applyEquippedOutfit) instead of only picking up the
// new look on next reload - equipping used to only update this modal's
// own pedestal/DB state, leaving the actual on-screen character stale
// until a refresh re-ran init()'s getEquipped() fetch.
let onOutfitChangeCallback = null;

// Called with (character, decorItem, owned) whenever a Pet Shop Boys
// purchase or sell actually succeeds (owned=true/false respectively), so
// GameScreen can place/remove the item in the *current* kitchen right
// away (GameScreen.handleDecorOwnershipChange) instead of only showing up
// on the next fresh layout - same "don't make the player wait for a
// reload to see their purchase" reasoning as onOutfitChangeCallback above,
// just for decor instead of cosmetics.
let onDecorChangeCallback = null;

// Which storefront panel is showing - 'bloomingtails' (cosmetics, the
// dressing room) or 'pawgreens' (perks, a plain shopping list). Split per
// explicit direction ("remove the non-clothes items from this store, we
// will create a new store for those things called Pawgreens") - both
// panels share one modal shell and one network fetch (see currentState
// below), just filtered client-side by item_type. Reset to
// 'bloomingtails' every time the modal is freshly opened.
let currentTab = 'bloomingtails';

// Which cosmetic is currently shown on the Bloomingtails pedestal -
// module-level so it survives a local re-render (arrow click, a
// purchase/equip) without needing a fresh network fetch every time.
// Pawgreens has no equivalent - every perk row is self-contained (see
// buildShoppingListRow()), there's nothing to "preview" the way trying on an
// outfit means something. Reset only when the modal is freshly opened.
let previewedSlug = null;

// Pet Shop Boys' own equivalent of previewedSlug above - browsed the same
// way Bloomingtails' cosmetics are (arrows cycle through one item at a
// time), per explicit direction ("more like Bloomingtails than
// Pawgreens... browse through with arrows, like the outfits"), rather
// than Pawgreens' plain list. Reset only when the modal is freshly opened.
let previewedDecorSlug = null;

// The last real fetch's own (character, wallet, items) - arrow clicks
// only need to change *which* cosmetic is previewed and redraw, not
// re-fetch the whole catalog from the network. Only a purchase/equip
// (which actually changes owned/equipped/coins) re-fetches via
// renderItems(). null until the first successful renderItems() call.
let currentState = null;

// Pet Shop Boys' own equivalent of currentState above - a separate fetch
// (getDecorStore(), not getStore(character)) since decor isn't scoped to a
// character's catalog at all (see kpground-api's StoreItem.character).
// `character`/`wallet` here are still the same ones openStoreModal() was
// given though - decor purchases spend from that same character's wallet,
// there's just no separate "which character's catalog" question for the
// item list itself. Fetched eagerly alongside currentState in
// openStoreModal() (not lazily on first tab switch) so switching to this
// tab is a pure local redraw too, same "both/all panels share their own
// fetch, tab switch is local" shape the other two panels already have.
let decorState = null;

// Sizes #storeCard to match the intro cutscene's own modal footprint
// (Cutscene.js: modalMargin = 50 * getUIScale(canvasWidth), modal fills
// the rest of the canvas) per explicit direction that this modal should
// read the same size as that one - a "big, immersive carousel," not a
// small popup. This is a DOM overlay rather than something canvas-drawn,
// so it doesn't sit inside the canvas the way Cutscene's own modal does;
// this reads the canvas's actual on-screen box and matches the card to
// it directly, using the exact same margin formula for a real (not just
// approximate) size match. Also resizes #storePedestalCanvas's *CSS
// display* size (not its width/height attributes, which would clear
// whatever's already drawn) to fill most of the pedestal scene's own
// actual rendered box - read via getBoundingClientRect() after layout.
// Called on open, again once the item list has actually loaded (its
// content can shift the scene's available height slightly), on tab
// switch, and on resize/orientationchange while the modal stays open.
function applyModalSizing() {
  const canvas = document.getElementById('gameCanvas');
  const card = document.getElementById('storeCard');
  const scene = document.getElementById('storePedestalScene');
  const pedestalCanvas = document.getElementById('storePedestalCanvas');
  if (!canvas || !card || !scene || !pedestalCanvas) return;

  if (isTouch()) {
    // Sized off the true viewport, not just the canvas's own box - the
    // canvas itself already excludes the side/top gutters the d-pad/
    // action buttons live in (see resizeCanvas()'s own touch-device width
    // margin), so sizing the card off canvas.width/height alone (the
    // desktop branch below) left a visible strip around the card on
    // mobile where the touch controls showed through #storeModal's own
    // translucent scrim - reported live as "looks awful on mobile,
    // controls visible behind it". Margin is deliberately computed
    // without any touch multiplier (unlike getUIScale() below, which
    // doubles it for touch) - per explicit follow-up direction the card
    // should keep "a margin in the same scale as desktop," not one
    // inflated by a multiplier that was tuned for button/text sizing, not
    // gaps. This still reaches past the canvas's own gutter and covers
    // the touch controls; it just no longer goes flush to zero.
    const margin = 50 * (window.innerWidth / REFERENCE_WIDTH);
    card.style.width = `${Math.max(300, window.innerWidth - margin * 2)}px`;
    card.style.height = `${Math.max(340, window.innerHeight - margin * 2)}px`;
  } else {
    const uiScale = getUIScale(canvas.width);
    const margin = 50 * uiScale;
    card.style.width = `${Math.max(300, canvas.width - margin * 2)}px`;
    card.style.height = `${Math.max(340, canvas.height - margin * 2)}px`;
  }

  // Only meaningful while Bloomingtails is the visible panel - the scene
  // lays out at zero size while its panel is [hidden], so skip measuring
  // it then rather than sizing the canvas off a bogus zero-height rect.
  if (currentTab !== 'bloomingtails') return;
  const sceneRect = scene.getBoundingClientRect();
  // The backdrop now fills the whole card (see styles.css - "make the
  // dressing room bigger... the full background") rather than a smaller
  // inset box with its own heading/name/button stacked around it, so
  // this same fraction-of-scene formula naturally yields a bigger
  // character than the previous layout did without needing its own bump.
  const size = Math.max(80, Math.min(sceneRect.height * 0.72, sceneRect.width * 0.5));
  pedestalCanvas.style.width = `${size}px`;
  pedestalCanvas.style.height = `${size}px`;
}

export function setupStoreModal() {
  const modal = document.getElementById('storeModal');
  const closeBtn = document.getElementById('storeCloseBtn');
  if (!modal || !closeBtn) return;

  // Fires storemodaltoggle the same way settingsMenu.js's settingsmenutoggle
  // does, so GameScreen can pause/resume in lockstep with this modal's
  // actual visible state.
  const finishClose = () => {
    modal.hidden = true;
    window.removeEventListener('resize', applyModalSizing);
    window.removeEventListener('orientationchange', applyModalSizing);
    document.dispatchEvent(new CustomEvent('storemodaltoggle', { detail: { open: false } }));
    onWalletUpdateCallback = null;
    onOutfitChangeCallback = null;
    onDecorChangeCallback = null;
  };

  // Same console-style whoosh played on open (see openStoreModal(), and
  // audio.js's playStoreWhooshSound()), reused here rather than a second
  // synthesized sound - open and close are the same kind of transition in
  // opposite directions. The visual close mirrors
  // #storeCard's own entry pop-in (styles.css's credits-pop-in keyframes)
  // by playing that exact animation in reverse via .store-card-closing
  // (animation-direction: reverse) rather than hand-authoring a separate
  // fade-out - actually hiding the modal is deferred to 'animationend' so
  // the shrink-and-fade is visible instead of the card just vanishing.
  // prefers-reduced-motion skips straight to finishClose() the same way
  // #storeCard's own entry animation is disabled for that media query.
  const close = () => {
    if (modal.hidden) return;
    playStoreWhooshSound();
    const card = document.getElementById('storeCard');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!card || reduceMotion) {
      finishClose();
      return;
    }
    // A hard timeout backstop, not just 'animationend' alone - reported
    // live as the store's dark scrim staying stuck forever (game
    // unplayable) on a device/browser where the event apparently never
    // fired. `#storeModal`'s translucent backdrop sits above everything
    // else at z-index 90 with no pointer-events:none, so a finishClose()
    // that never runs blocks the entire board, not just the store itself
    // - too severe a failure mode to depend on a single DOM event firing
    // reliably. `done` guards against both firing (animationend then
    // clearing the timeout, or vice versa).
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      card.removeEventListener('animationend', finish);
      clearTimeout(fallbackTimer);
      card.classList.remove('store-card-closing');
      finishClose();
    };
    card.addEventListener('animationend', finish);
    const fallbackTimer = setTimeout(finish, 400);
    card.classList.add('store-card-closing');
  };

  closeBtn.addEventListener('click', close);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  // Outfit-browsing arrows - only ever cycle Bloomingtails' own cosmetic
  // catalog (see cycleOutfit()'s own comment for why perks were never
  // part of this, even before Pawgreens split them into their own store).
  document.getElementById('storePrevOutfitBtn').addEventListener('click', () => cycleOutfit(-1));
  document.getElementById('storeNextOutfitBtn').addEventListener('click', () => cycleOutfit(1));

  // Pet Shop Boys' own browsing arrows - same cycle-by-one-item gesture
  // as the outfit arrows above, over decorState's catalog instead of
  // currentState's cosmetics.
  document.getElementById('petShopPrevBtn').addEventListener('click', () => cyclePetShopItem(-1));
  document.getElementById('petShopNextBtn').addEventListener('click', () => cyclePetShopItem(1));

  document.getElementById('storeTabBloomingtails').addEventListener('click', () => switchTab('bloomingtails'));
  document.getElementById('storeTabPawgreens').addEventListener('click', () => switchTab('pawgreens'));
  document.getElementById('storeTabPetShop').addEventListener('click', () => switchTab('petshop'));
}

// Swaps which panel is visible without re-fetching - all three panels
// already share their own fetch, made once up front (see openStoreModal()/
// renderItems()/renderDecorItems()), so switching tabs is purely a local
// redraw.
function switchTab(tab) {
  if (tab === currentTab) return;
  currentTab = tab;

  document.getElementById('bloomingtailsPanel').hidden = tab !== 'bloomingtails';
  document.getElementById('pawgreensPanel').hidden = tab !== 'pawgreens';
  document.getElementById('petShopPanel').hidden = tab !== 'petshop';
  document.getElementById('storeTabBloomingtails').setAttribute('aria-selected', String(tab === 'bloomingtails'));
  document.getElementById('storeTabPawgreens').setAttribute('aria-selected', String(tab === 'pawgreens'));
  document.getElementById('storeTabPetShop').setAttribute('aria-selected', String(tab === 'petshop'));

  if (tab === 'bloomingtails') {
    updateBloomingtailsPreview();
  } else if (tab === 'pawgreens') {
    renderPawgreensList();
  } else {
    updatePetShopPreview();
  }
  // The scene's real box only exists once its panel is actually visible -
  // re-measure now that the flip above has taken effect.
  applyModalSizing();
}

// The real doober-coin art (same asset the in-game HUD/doober pickups
// use - see GameScreen.js's drawHudCoinStatText()) stands in for the
// word "coins" everywhere in the store, matching that existing
// icon-not-text convention rather than introducing a second one here.
// Icon-then-value order also matches the HUD's own drawing order.
const COIN_ICON_HTML = '<img src="./assets/doober_coin.png" class="coin-icon" alt="coins">';

// Sets element.innerHTML rather than .textContent, since these are the
// only two spots in the store that need to embed the coin icon inline
// with text - safe here since every interpolated value is a number the
// server returned, never raw user input.
function walletLineHtml(wallet) {
  return `${COIN_ICON_HTML}${wallet.coins} · Level ${wallet.level}`;
}

// One Image per src, loaded once and reused - cycling back to a look
// already viewed this session shouldn't re-request/re-decode the image.
// Page-lifetime cache, same "small assets, never evicted" reasoning as
// CharacterSelectScreen's own portraitImages.
const portraitImageCache = {};
function getPortraitImage(src) {
  if (!portraitImageCache[src]) {
    const img = new Image();
    img.src = src;
    portraitImageCache[src] = img;
  }
  return portraitImageCache[src];
}

// Per-character fit adjustment for the dressing-room pedestal only -
// independent of PORTRAITS' crop rect and CharacterSelectScreen's own
// sizing, which are untouched. Cat's portrait read too large against the
// pedestal backdrop/scene at the default fit-to-box scale; multiplying the
// scale down (rather than changing the crop) keeps the existing
// bottom-anchored draw() below working unmodified - a smaller scale still
// lands the character's feet exactly on canvas.height, it's only the
// height *above* the feet that shrinks. Mouse's own east-facing crop
// (PORTRAITS.mouse) needed the same treatment once it replaced the
// earlier south-facing one.
const PEDESTAL_SIZE_MULTIPLIER = {
  cat: 0.75,
  mouse: 0.7,
};

// Mouse's east-facing crop leaves a real, measured gap between the
// character's own feet and the frame's native bottom edge (~64px out of
// 327px, checked directly off the alpha channel), unlike cat/dog's crops
// where the feet already sit flush against the very bottom of the frame.
// Plain bottom-anchoring (see draw() below) therefore left the mouse
// looking like it was hovering above the pedestal rather than standing on
// it. This nudges the whole draw down into that native margin - in native
// (pre-scale) pixels, so it scales proportionally with
// PEDESTAL_SIZE_MULTIPLIER rather than over- or under-shooting at
// different sizes. One value now covers both the default look and every
// cosmetic recolor - see PEDESTAL_DEFAULT_SIZE_BOOST's own comment below
// for why that used to need a separate, bigger value here and no longer
// does.
const PEDESTAL_VERTICAL_NUDGE = {
  mouse: 30,
};

// Cosmetic recolor sheets (cat_v2_tutu_*.png, mouse_v2_tutu_*.png) used to
// be extracted per-frame - tight alpha bbox crop, independently resized to
// fill the native frame - with no shared anchor/scale across frames or
// against the hand-authored default sprite. That let each recolor's frame
// 0 (cat/dog) / frame 4 (mouse) - the exact frames PORTRAITS crops for
// this pedestal - fill noticeably more of the frame than the default
// does: cat's default filled ~86% of the crop's height where a recolor
// filled 100%; mouse's default filled ~62% where a recolor filled ~75%.
// PEDESTAL_DEFAULT_SIZE_BOOST used to paper over exactly that gap by
// scaling the default look up further whenever it's what's being drawn
// (see getPedestalSizeMultiplier's isDefaultLook param) - a display-only
// patch that left the underlying asset mismatch in place for gameplay
// (Cat.js/Mouse.js draw() have no equivalent boost, so an equipped
// cosmetic actually rendered bigger in-game than the default, clipping
// ears at the top of the frame - reported live as "shoes above heads" in
// the walk-cycle animation).
//
// Fixed at the asset level instead (see CLAUDE.md's Currency & economy
// section, cosmetics bullet, for the normalization script): every cat/
// mouse recolor frame is now re-cropped and re-anchored to match the
// default sprite's own alpha-channel bbox for that exact frame index
// (same content height, same bottom edge, same horizontal center), so the
// default and every recolor now fill their shared crop rect identically.
// Dog's own recolors were checked against the same script and came back
// within ~5% of the default already (no visible clipping), so they were
// left untouched - dog keeps its own small width-based boost below.
const PEDESTAL_DEFAULT_SIZE_BOOST = {
  dog: 1.14,
};

function getPedestalSizeMultiplier(character, isDefaultLook) {
  const base = PEDESTAL_SIZE_MULTIPLIER[character] ?? 1;
  const boost = isDefaultLook ? (PEDESTAL_DEFAULT_SIZE_BOOST[character] ?? 1) : 1;
  return base * boost;
}

// Draws whichever cosmetic is currently being "tried on" onto the
// dressing-room pedestal (#storePedestalCanvas) - same source-rect crop
// technique CharacterSelectScreen's own character cards use (see
// js/utils/outfits.js's shared PORTRAITS), just drawn into a small canvas
// inside this DOM modal instead of that screen's own canvas. `item` is
// whatever's currently previewed, or null (an empty cosmetic catalog, or
// a failed fetch) - still draws the character's own default look either
// way, so the pedestal never sits empty.
function drawPedestalPortrait(character, item) {
  const crop = PORTRAITS[character];
  const canvas = document.getElementById('storePedestalCanvas');
  if (!canvas || !crop) return;

  const src = getSpriteSrc(character, item);
  const img = getPortraitImage(src);
  const ctx = canvas.getContext('2d');

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const isDefaultLook = !item || item.isDefault;
    const scale =
      Math.min(canvas.width / crop.sw, canvas.height / crop.sh) *
      getPedestalSizeMultiplier(character, isDefaultLook);
    const dw = crop.sw * scale;
    const dh = crop.sh * scale;
    const verticalNudge = (PEDESTAL_VERTICAL_NUDGE[character] ?? 0) * scale;
    // Bottom-anchored, horizontally centered - "standing on the pedestal"
    // rather than centered in the canvas, so the character's feet line up
    // with the pedestal in the backdrop photo. verticalNudge shifts that
    // anchor down into a crop's own native bottom margin, for characters
    // whose feet don't already sit flush against the frame's edge.
    ctx.drawImage(
      img,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      (canvas.width - dw) / 2,
      canvas.height - dh + verticalNudge,
      dw,
      dh
    );
  };

  if (img.complete && img.naturalWidth > 0) {
    draw();
  } else {
    img.onload = draw;
  }
}

// A synthetic slug for the character's own built-in look - never a real
// StoreItem/slug from the backend (see buildDefaultCosmeticItem() below),
// so it can't collide with previewedSlug's other sentinel value (null,
// "nothing previewed yet").
const DEFAULT_OUTFIT_SLUG = '__default__';

// The default look isn't a StoreItem at all - it was never for sale, so
// there's nothing to buy/own/sell. But the dressing room still needs a
// real, always-present, always-free entry the player can cycle to and
// equip explicitly (rather than only ever reaching it as a side effect of
// un-equipping whatever else is worn) - this builds that entry client-side
// each render rather than seeding a $0 row in kpground-api's catalog,
// since "not sellable" and "always owned" would otherwise need their own
// special-cased fields on a real StoreItem just for this one case.
// sprite_src is left null - getSpriteSrc() already falls back to each
// character's own DEFAULT_SPRITE_SRC when nothing's equipped, so drawing
// this "item" reuses that exact same fallback rather than duplicating it.
function buildDefaultCosmeticItem(realCosmetics) {
  return {
    slug: DEFAULT_OUTFIT_SLUG,
    name: 'Original Look',
    item_type: 'cosmetic',
    slot: 'outfit',
    sprite_src: null,
    description: "This character's original look - always free to wear.",
    cost: 0,
    min_level: 1,
    owned: true,
    // No EquippedItem row for any real cosmetic means the backend is
    // already serving the default look - mirror that same "nothing
    // equipped" condition here instead of tracking it independently.
    equipped: !realCosmetics.some((item) => item.equipped),
    isDefault: true,
  };
}

// The one list every cycle/preview/pick-a-fallback path should read from -
// the default entry always first, then whatever's actually in the store.
function getCosmeticsWithDefault(items) {
  const realCosmetics = items.filter((item) => item.item_type === 'cosmetic');
  return [buildDefaultCosmeticItem(realCosmetics), ...realCosmetics];
}

// Shared Buy/Equip/Owned/locked logic for a single item - both
// Bloomingtails' one pedestal button and each of Pawgreens' own per-row
// buttons funnel through this so there's only one purchase/equip/state
// code path to keep correct, even though the two stores wire it up to
// different DOM shapes (one shared button vs. one button per row).
// Mutates `btn` directly and returns nothing - callers just build the
// button element differently around it.
function wireItemButton(btn, character, wallet, item) {
  btn.onclick = null;
  btn.classList.remove('store-item-equipped');

  if (item.isDefault) {
    // Nothing to buy or toggle off here - "wearing" the default is just
    // whatever state a real EquippedItem's absence already means, so
    // equipping it is only ever unequip_slot() (a documented no-op if
    // that's already the case, see kpground-api's services.py), never
    // equip_item() with some item_slug.
    btn.disabled = item.equipped;
    btn.textContent = item.equipped ? 'Wearing It' : 'Try It On';
    btn.classList.toggle('store-item-equipped', item.equipped);
    if (!item.equipped) {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await unequipItem(character, item.slot);
          if (onOutfitChangeCallback) onOutfitChangeCallback(character, null);
          await refreshAfterChange();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = err.message || 'Failed';
        }
      };
    }
    return;
  }

  if (item.owned && item.item_type === 'cosmetic') {
    // Cosmetics stay actionable once owned - a toggle between wearing
    // this look and reverting to the default, rather than a dead-end
    // "Owned" label. "Try It On"/"Wearing It" rather than the plainer
    // "Equip"/"Equipped" per explicit "more fun words" direction - fits
    // the dressing-room/boutique framing this whole panel already uses
    // (see the pedestal-scene comments above) better than generic
    // game-UI inventory language.
    btn.disabled = false;
    btn.textContent = item.equipped ? 'Wearing It' : 'Try It On';
    btn.classList.toggle('store-item-equipped', item.equipped);
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (item.equipped) {
          await unequipItem(character, item.slot);
          if (onOutfitChangeCallback) onOutfitChangeCallback(character, null);
        } else {
          await equipItem(character, item.slug);
          if (onOutfitChangeCallback) onOutfitChangeCallback(character, item);
        }
        await refreshAfterChange();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = err.message || 'Failed';
      }
    };
  } else if (item.owned) {
    // Perks have nothing to toggle - owning one just makes its effect
    // permanently active.
    btn.disabled = true;
    btn.textContent = 'Owned';
  } else if (wallet.level < item.min_level) {
    btn.disabled = true;
    btn.textContent = `Requires Lvl ${item.min_level}`;
  } else if (wallet.coins < item.cost) {
    // Same disabled state as the owned/level-locked branches above (no
    // onclick - a disabled button doesn't fire clicks anyway, but this
    // matches their style of not wiring one at all rather than relying on
    // the disabled attribute alone). Labeled "Need", not "Buy" - showing
    // the same "Buy" text whether or not the player could actually afford
    // it (previously true even once the disabled style was legible) gave
    // no reason a click did nothing, which read as the button being
    // broken rather than correctly gated on funds.
    btn.disabled = true;
    btn.innerHTML = `Need ${COIN_ICON_HTML}${item.cost}`;
  } else {
    btn.disabled = false;
    btn.innerHTML = `Buy ${COIN_ICON_HTML}${item.cost}`;
    // Pet Shop Boys decor buys through its own endpoint (not scoped to a
    // character's catalog - see kpground-api's StoreItem.character), but
    // `character` still means the same thing everywhere: whose wallet
    // pays. Branching on item_type here (rather than a second copy of this
    // whole branch) is what keeps decor purchases going through the exact
    // same button-state/error-handling code as cosmetics/perks.
    const purchase = item.item_type === 'decor' ? purchaseDecorItem : purchaseItem;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Buying...';
      try {
        const updatedWallet = await purchase(character, item.slug);
        if (onWalletUpdateCallback) onWalletUpdateCallback(updatedWallet);
        // Decor-only - places the item in the *current* kitchen right
        // away rather than waiting for the next fresh layout (see
        // onDecorChangeCallback's own comment above).
        if (item.item_type === 'decor' && onDecorChangeCallback) onDecorChangeCallback(character, item, true);
        await refreshAfterChange(item, updatedWallet);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = err.message || 'Purchase failed';
      }
    };
  }
}

// Matches kpground-api's economy.py SELL_REFUND_FRACTION - duplicated
// here (not fetched) because the sell button has to show its price
// before the player ever clicks it, the same reason "Buy — {cost}" above
// already needs the item's cost client-side rather than round-tripping
// for it first.
const SELL_REFUND_FRACTION = 0.2;

function sellPriceFor(item) {
  return Math.round(item.cost * SELL_REFUND_FRACTION);
}

// A "+N" coin popup for a successful sell, floating up from wherever the
// sell button that triggered it actually sits (the Bloomingtails pedestal
// button and each Pawgreens row's own button are in different places, so
// this positions itself off the real element rather than one fixed spot).
// A plain document.body child, not scoped inside #storeCard, so it isn't
// clipped by the card's own overflow:hidden. Cleanup is a fixed
// setTimeout rather than waiting on 'animationend' - this is purely
// decorative, so there's no need to risk the same "event never fires"
// failure mode #storeCard's own close animation had to add a fallback
// for (see setupStoreModal()'s close()) - simpler to just always use a
// timeout here since nothing depends on the popup actually finishing.
function spawnCoinPopup(anchorEl, amount) {
  const rect = anchorEl.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'store-coin-popup';
  popup.style.left = `${rect.left + rect.width / 2}px`;
  popup.style.top = `${rect.top}px`;
  popup.innerHTML = `+${amount} ${COIN_ICON_HTML}`;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 950);
}

// A second, independent button next to whatever wireItemButton() above
// is driving (the Bloomingtails pedestal's single action button, or a
// Pawgreens row's own buy button) - selling is orthogonal to that
// button's own owned/equip/locked state, so it's simpler as its own
// small always-present-but-usually-hidden button than another branch
// inside wireItemButton() itself. Hidden whenever the item isn't owned,
// since there's nothing to sell back.
function wireSellButton(sellBtn, character, item) {
  if (!item.owned || item.isDefault) {
    sellBtn.hidden = true;
    sellBtn.onclick = null;
    return;
  }
  sellBtn.hidden = false;
  sellBtn.disabled = false;
  sellBtn.innerHTML = `Sell for ${COIN_ICON_HTML}${sellPriceFor(item)}`;
  // Same item_type branch wireItemButton()'s own buy button uses above -
  // decor sells through its own endpoint too.
  const sell = item.item_type === 'decor' ? sellDecorItem : sellItem;
  sellBtn.onclick = async () => {
    sellBtn.disabled = true;
    sellBtn.textContent = 'Selling...';
    try {
      const updatedWallet = await sell(character, item.slug);
      if (onWalletUpdateCallback) onWalletUpdateCallback(updatedWallet);
      // Selling an equipped cosmetic reverts it to the default look on
      // the backend too (see sell_item()) - mirrors the equip-toggle
      // button's own onOutfitChangeCallback(character, null) call for
      // unequip, so the live in-game sprite reverts immediately instead
      // of only picking up the change on next reload. A no-op for decor,
      // which is never equipped.
      if (item.equipped && onOutfitChangeCallback) onOutfitChangeCallback(character, null);
      // Removes the item from the *current* kitchen right away - same
      // live-sync reasoning as the purchase side above, just the removal
      // half (otherwise a sold decor piece would keep showing in the room
      // until the next fresh layout, looking owned when it no longer is).
      if (item.item_type === 'decor' && onDecorChangeCallback) onDecorChangeCallback(character, item, false);
      // Popup + sound fire before refreshAfterChange() redraws the panel
      // (which can hide/replace this exact button), while sellBtn's
      // position is still the real one the popup should float up from.
      spawnCoinPopup(sellBtn, sellPriceFor(item));
      playSellChaChingSound();
      await refreshAfterChange(item, updatedWallet);
    } catch (err) {
      sellBtn.disabled = false;
      sellBtn.textContent = err.message || 'Sell failed';
    }
  };
}

// Re-draws the Bloomingtails pedestal canvas, name label, and action
// button for whatever `previewedSlug` currently points at - without
// re-fetching from the network. Called after every local state change
// (arrow click, a purchase/equip) and once whenever the tab switches back
// to Bloomingtails; renderItems() calls this too once its fresh fetch
// lands.
function updateBloomingtailsPreview() {
  if (!currentState) return;
  const { character, wallet, items } = currentState;
  // Re-set on every local redraw, not just after renderItems()'s own
  // fetch - a Pet Shop Boys purchase/sell updates currentState.wallet too
  // (see refreshAfterChange()) without going through renderItems(), so
  // this can't rely on that alone to stay fresh once this tab is switched
  // back to.
  document.getElementById('storeWalletLine').innerHTML = walletLineHtml(wallet);
  const cosmetics = getCosmeticsWithDefault(items);
  // The default entry is always present, so this only stays null while
  // currentState itself hasn't loaded yet.
  const item = cosmetics.find((i) => i.slug === previewedSlug) || null;

  drawPedestalPortrait(character, item);

  const btn = document.getElementById('storePedestalActionBtn');
  btn.hidden = !item;
  const sellBtn = document.getElementById('storePedestalSellBtn');
  if (item) {
    wireItemButton(btn, character, wallet, item);
    wireSellButton(sellBtn, character, item);
  } else {
    sellBtn.hidden = true;
  }

  const nameEl = document.getElementById('storePreviewName');
  nameEl.textContent = item ? item.name : '';

  // The default entry is always "available" but was never bought - only a
  // real purchased cosmetic should read as "Owned" here, otherwise every
  // character's own built-in look would confusingly claim to be owned too.
  const ownedBadge = document.getElementById('storePreviewOwnedBadge');
  ownedBadge.hidden = !item || item.isDefault || !item.owned;
  // The badge and sell button are always shown/hidden together (both
  // conditioned on "a real owned cosmetic" - see wireSellButton() and the
  // line above), so the wrapping row just mirrors the badge's own state
  // rather than tracking a third, separately-computed condition.
  document.getElementById('storeOwnedSellRow').hidden = ownedBadge.hidden;

  const hasOutfits = cosmetics.length > 0;
  document.getElementById('storePrevOutfitBtn').hidden = !hasOutfits;
  document.getElementById('storeNextOutfitBtn').hidden = !hasOutfits;
}

// Moves the pedestal preview to the next/previous cosmetic. Wraps around
// at either end rather than stopping, so there's no dead-end arrow state
// to disable.
function cycleOutfit(direction) {
  if (!currentState) return;
  const cosmetics = getCosmeticsWithDefault(currentState.items);

  const currentIndex = cosmetics.findIndex((item) => item.slug === previewedSlug);
  const nextIndex =
    currentIndex === -1
      ? (direction > 0 ? 0 : cosmetics.length - 1)
      : (currentIndex + direction + cosmetics.length) % cosmetics.length;

  previewedSlug = cosmetics[nextIndex].slug;
  updateBloomingtailsPreview();
}

// One row in a plain-shopping-list panel - Pawgreens' own perks today
// (Pet Shop Boys used to share this too, before it moved to a Bloomingtails-
// style browse-with-arrows layout instead - see updatePetShopPreview()/
// cyclePetShopItem() - per explicit direction that decor should read more
// like trying on an outfit than shopping a list). Self-contained (name,
// description, and its own working Buy/Owned/locked button) since Pawgreens
// has no character preview to focus a single shared action button's
// target on the way Bloomingtails has. Reuses wireItemButton()/
// wireSellButton() for the actual state/click logic so purchase/sell
// behavior can't drift between stores - kept generically named/shaped in
// case a future list-style store wants it again.
function buildShoppingListRow(item, character, wallet) {
  const row = document.createElement('div');
  row.className = 'pawgreens-item';

  const info = document.createElement('div');
  info.className = 'pawgreens-item-info';
  const nameEl = document.createElement('strong');
  nameEl.textContent = item.name;
  info.appendChild(nameEl);
  if (item.description) {
    const descEl = document.createElement('span');
    descEl.textContent = item.description;
    info.appendChild(descEl);
  }
  row.appendChild(info);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'store-item-buy';
  wireItemButton(btn, character, wallet, item);
  row.appendChild(btn);

  // wireSellButton() hides this itself whenever the item isn't owned, so
  // it's safe to always append - no owned/unowned branch needed here.
  const sellBtn = document.createElement('button');
  sellBtn.type = 'button';
  sellBtn.className = 'store-item-sell';
  wireSellButton(sellBtn, character, item);
  row.appendChild(sellBtn);

  return row;
}

// Rebuilds the Pawgreens list from currentState - called once whenever
// the tab switches to Pawgreens and again after any purchase (via
// refreshAfterChange()'s fresh fetch), same "local redraw vs. real
// re-fetch" split Bloomingtails' own updateBloomingtailsPreview() uses.
function renderPawgreensList() {
  if (!currentState) return;
  const { character, wallet, items } = currentState;
  const listEl = document.getElementById('pawgreensItemsList');
  const walletLineEl = document.getElementById('pawgreensWalletLine');
  walletLineEl.innerHTML = walletLineHtml(wallet);

  const perks = items.filter((item) => item.item_type === 'perk');
  listEl.innerHTML = '';
  if (perks.length === 0) {
    listEl.textContent = 'Nothing here yet - check back soon!';
    return;
  }
  perks.forEach((item) => listEl.appendChild(buildShoppingListRow(item, character, wallet)));
}

// Pet Shop Boys' own equivalent of updateBloomingtailsPreview() above - a
// local redraw from decorState for whatever `previewedDecorSlug` currently
// points at, no re-fetch. Unlike Bloomingtails there's no synthetic
// "default" entry to fall back to (every decor item is a real purchase,
// nothing is "always owned") and no sprite-sheet crop math - each item is
// one flat product-shot image, so this sets a plain <img> src rather than
// drawing to a canvas.
function updatePetShopPreview() {
  if (!decorState) return;
  const { character, wallet, items } = decorState;
  // Same "re-set on every local redraw" reasoning as
  // updateBloomingtailsPreview()'s own #storeWalletLine line - a
  // Bloomingtails/Pawgreens purchase updates decorState.wallet too (see
  // refreshAfterChange()) without going through renderDecorItems().
  document.getElementById('petShopWalletLine').innerHTML = walletLineHtml(wallet);

  const item = items.find((i) => i.slug === previewedDecorSlug) || null;

  const imageEl = document.getElementById('petShopPreviewImage');
  imageEl.hidden = !item;
  if (item) {
    imageEl.src = item.sprite_src;
    imageEl.alt = item.name;
  }

  const btn = document.getElementById('petShopActionBtn');
  btn.hidden = !item;
  const sellBtn = document.getElementById('petShopSellBtn');
  if (item) {
    wireItemButton(btn, character, wallet, item);
    wireSellButton(sellBtn, character, item);
  } else {
    sellBtn.hidden = true;
  }

  document.getElementById('petShopPreviewName').textContent = item
    ? item.name
    : decorState.error
      ? 'Could not load the store right now.'
      : (items.length === 0 ? 'Nothing here yet - check back soon!' : '');
  document.getElementById('petShopPreviewDescription').textContent = item ? item.description : '';

  const ownedBadge = document.getElementById('petShopPreviewOwnedBadge');
  ownedBadge.hidden = !item || !item.owned;
  // Same "row mirrors the badge's own state" reasoning as
  // #storeOwnedSellRow's own comment above.
  document.getElementById('petShopOwnedSellRow').hidden = ownedBadge.hidden;

  const hasItems = items.length > 0;
  document.getElementById('petShopPrevBtn').hidden = !hasItems;
  document.getElementById('petShopNextBtn').hidden = !hasItems;
}

// Moves the preview to the next/previous decor item - same wrap-around
// behavior as cycleOutfit() above.
function cyclePetShopItem(direction) {
  if (!decorState) return;
  const { items } = decorState;
  if (items.length === 0) return;

  const currentIndex = items.findIndex((item) => item.slug === previewedDecorSlug);
  const nextIndex =
    currentIndex === -1
      ? (direction > 0 ? 0 : items.length - 1)
      : (currentIndex + direction + items.length) % items.length;

  previewedDecorSlug = items[nextIndex].slug;
  updatePetShopPreview();
}

// Pet Shop Boys' own equivalent of renderItems() above - a separate fetch
// (getDecorStore(), not getStore(character)) since decor isn't part of
// any character's own catalog. Called once from openStoreModal() (so the
// tab is ready before it's ever switched to) and again from
// refreshAfterChange() whenever a decor purchase/sell actually changes
// owned state.
async function renderDecorItems(character, wallet) {
  document.getElementById('petShopWalletLine').innerHTML = walletLineHtml(wallet);

  let items;
  try {
    items = await getDecorStore();
  } catch (err) {
    decorState = { character, wallet, items: [], error: true };
    previewedDecorSlug = null;
    updatePetShopPreview();
    return;
  }

  decorState = { character, wallet, items, error: false };

  // Same "keep whatever was already previewed if it still exists"
  // fallback renderItems() uses for cosmetics - falls back to the first
  // item rather than "the equipped one" (decor has no equip concept).
  if (!items.some((item) => item.slug === previewedDecorSlug)) {
    previewedDecorSlug = items.length > 0 ? items[0].slug : null;
  }

  updatePetShopPreview();
  applyModalSizing();
}

// Re-fetches the catalog and rebuilds both panels' data - called on open
// and again after a purchase/equip actually changes owned/equipped/
// wallet state (arrow clicks alone don't need this). Only the *visible*
// panel actually redraws its DOM; the other picks up the fresh
// currentState next time its tab is switched to.
async function renderItems(character, wallet) {
  document.getElementById('storeWalletLine').innerHTML = walletLineHtml(wallet);

  let items;
  try {
    items = await getStore(character);
  } catch (err) {
    currentState = { character, wallet, items: [] };
    previewedSlug = null;
    if (currentTab === 'bloomingtails') {
      updateBloomingtailsPreview();
    } else {
      document.getElementById('pawgreensItemsList').textContent = 'Could not load the store right now.';
    }
    return;
  }

  currentState = { character, wallet, items };

  // Keeps whatever cosmetic was already previewed if it still exists;
  // otherwise prefers the character's actually-equipped look (the
  // "current outfit" is the natural thing to show first) - the default
  // entry's own equipped flag already covers "nothing else is equipped",
  // so this always finds something now, never falling through to null.
  const cosmetics = getCosmeticsWithDefault(items);
  if (!cosmetics.some((item) => item.slug === previewedSlug)) {
    previewedSlug = cosmetics.find((item) => item.equipped).slug;
  }

  if (currentTab === 'bloomingtails') {
    updateBloomingtailsPreview();
  } else {
    renderPawgreensList();
  }
  // Content settling (list height, "Nothing here yet" text) can shift how
  // much room the flex-grow pedestal scene ends up with - re-measure now.
  applyModalSizing();
}

// Only a purchase/equip actually needs a fresh network fetch (owned/
// equipped/coins all changed) - re-derives character from currentState/
// decorState rather than threading it through every action-button handler
// separately. freshWallet: the wallet a purchase/sell call just returned,
// if any - equip/unequip don't touch coins so they have none to pass.
// Without this, a purchase's own updated wallet only ever reached
// GameScreen's HUD (via onWalletUpdateCallback); this modal's own
// currentState.wallet - which #storeWalletLine and every item's
// affordability/lock check read from - kept showing the pre-purchase coin
// count for the rest of the session, making a second buy look wrongly
// affordable or wrongly locked until the store was closed and reopened.
//
// `item` (the thing that was just bought/sold/equipped, or undefined for
// the equip/unequip call sites that predate Pet Shop Boys) decides *which*
// store's own catalog actually needs re-fetching - cosmetics/perks share
// one (currentState), decor has its own (decorState) - but every one of
// the three spends from the exact same character's one wallet, so
// freshWallet is applied to whichever of currentState/decorState already
// exists regardless of which store the change happened in. Otherwise
// buying a fish tank while Bloomingtails/Pawgreens still show the
// pre-purchase coin count (or vice versa) until the store's closed and
// reopened - the same staleness bug this function already exists to
// prevent, just for a third store now sharing the same wallet.
function refreshAfterChange(item, freshWallet) {
  if (freshWallet) {
    if (currentState) currentState.wallet = freshWallet;
    if (decorState) decorState.wallet = freshWallet;
  }

  if (item && item.item_type === 'decor') {
    if (!decorState) return Promise.resolve();
    return renderDecorItems(decorState.character, decorState.wallet);
  }

  if (!currentState) return Promise.resolve();
  return renderItems(currentState.character, currentState.wallet);
}

// wallet: the character's current wallet (from GameScreen's this.wallet),
// used as the modal's starting state so it doesn't need its own fetch
// before first paint. onWalletUpdate: called with the fresh wallet after
// any purchase, so the caller's own wallet display stays in sync.
// onOutfitChange: called with (character, outfitItem|null) after a
// successful equip/unequip, so the caller can update the live in-game
// sprite immediately (see onOutfitChangeCallback's own comment above).
// onDecorChange: called with (character, decorItem, owned) after a
// successful Pet Shop Boys purchase/sell, so the caller can place/remove
// the item in the live kitchen immediately (see onDecorChangeCallback's
// own comment above).
export function openStoreModal(character, wallet, onWalletUpdate, onOutfitChange, onDecorChange) {
  const modal = document.getElementById('storeModal');
  if (!modal) return;
  playStoreWhooshSound();
  onWalletUpdateCallback = onWalletUpdate;
  onOutfitChangeCallback = onOutfitChange;
  onDecorChangeCallback = onDecorChange;
  // A fresh open shouldn't remember what a *previous* character's store
  // session had on the pedestal, or which tab they'd wandered to last.
  previewedSlug = null;
  previewedDecorSlug = null;
  currentTab = 'bloomingtails';
  document.getElementById('bloomingtailsPanel').hidden = false;
  document.getElementById('pawgreensPanel').hidden = true;
  document.getElementById('petShopPanel').hidden = true;
  document.getElementById('storeTabBloomingtails').setAttribute('aria-selected', 'true');
  document.getElementById('storeTabPawgreens').setAttribute('aria-selected', 'false');
  document.getElementById('storeTabPetShop').setAttribute('aria-selected', 'false');

  modal.hidden = false;
  // Sized *after* unhiding, not before - a hidden element lays out at
  // zero size, so measuring it any earlier would size everything wrong.
  applyModalSizing();
  window.addEventListener('resize', applyModalSizing);
  window.addEventListener('orientationchange', applyModalSizing);
  document.dispatchEvent(new CustomEvent('storemodaltoggle', { detail: { open: true } }));
  renderItems(character, wallet);
  // Fetched eagerly alongside renderItems() above (not lazily on first
  // switch to this tab) - see decorState's own comment for why: it keeps
  // "switching tabs is a pure local redraw" true for all three panels,
  // not just the first two.
  renderDecorItems(character, wallet);
}
