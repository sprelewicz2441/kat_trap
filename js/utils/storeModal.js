import { equipItem, getStore, purchaseItem, sellItem, unequipItem } from './api.js';
import { getSpriteSrc, PORTRAITS } from './outfits.js';
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
// buildPawgreensRow()), there's nothing to "preview" the way trying on an
// outfit means something. Reset only when the modal is freshly opened.
let previewedSlug = null;

// The last real fetch's own (character, wallet, items) - arrow clicks
// only need to change *which* cosmetic is previewed and redraw, not
// re-fetch the whole catalog from the network. Only a purchase/equip
// (which actually changes owned/equipped/coins) re-fetches via
// renderItems(). null until the first successful renderItems() call.
let currentState = null;

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

  document.getElementById('storeTabBloomingtails').addEventListener('click', () => switchTab('bloomingtails'));
  document.getElementById('storeTabPawgreens').addEventListener('click', () => switchTab('pawgreens'));
}

// Swaps which panel is visible without re-fetching - both panels already
// share the one currentState fetch (see openStoreModal()/renderItems()),
// so switching tabs is purely a local redraw.
function switchTab(tab) {
  if (tab === currentTab) return;
  currentTab = tab;

  document.getElementById('bloomingtailsPanel').hidden = tab !== 'bloomingtails';
  document.getElementById('pawgreensPanel').hidden = tab !== 'pawgreens';
  document.getElementById('storeTabBloomingtails').setAttribute('aria-selected', String(tab === 'bloomingtails'));
  document.getElementById('storeTabPawgreens').setAttribute('aria-selected', String(tab === 'pawgreens'));

  if (tab === 'bloomingtails') {
    updateBloomingtailsPreview();
  } else {
    renderPawgreensList();
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
    const scale = Math.min(canvas.width / crop.sw, canvas.height / crop.sh);
    const dw = crop.sw * scale;
    const dh = crop.sh * scale;
    // Bottom-anchored, horizontally centered - "standing on the pedestal"
    // rather than centered in the canvas, so the character's feet line up
    // with the pedestal in the backdrop photo.
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, (canvas.width - dw) / 2, canvas.height - dh, dw, dh);
  };

  if (img.complete && img.naturalWidth > 0) {
    draw();
  } else {
    img.onload = draw;
  }
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
  } else {
    btn.disabled = wallet.coins < item.cost;
    btn.innerHTML = `Buy — ${COIN_ICON_HTML}${item.cost}`;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Buying...';
      try {
        const updatedWallet = await purchaseItem(character, item.slug);
        if (onWalletUpdateCallback) onWalletUpdateCallback(updatedWallet);
        await refreshAfterChange(updatedWallet);
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
  if (!item.owned) {
    sellBtn.hidden = true;
    sellBtn.onclick = null;
    return;
  }
  sellBtn.hidden = false;
  sellBtn.disabled = false;
  sellBtn.innerHTML = `Sell — ${COIN_ICON_HTML}${sellPriceFor(item)}`;
  sellBtn.onclick = async () => {
    sellBtn.disabled = true;
    sellBtn.textContent = 'Selling...';
    try {
      const updatedWallet = await sellItem(character, item.slug);
      if (onWalletUpdateCallback) onWalletUpdateCallback(updatedWallet);
      // Selling an equipped cosmetic reverts it to the default look on
      // the backend too (see sell_item()) - mirrors the equip-toggle
      // button's own onOutfitChangeCallback(character, null) call for
      // unequip, so the live in-game sprite reverts immediately instead
      // of only picking up the change on next reload.
      if (item.equipped && onOutfitChangeCallback) onOutfitChangeCallback(character, null);
      // Popup + sound fire before refreshAfterChange() redraws the panel
      // (which can hide/replace this exact button), while sellBtn's
      // position is still the real one the popup should float up from.
      spawnCoinPopup(sellBtn, sellPriceFor(item));
      playSellChaChingSound();
      await refreshAfterChange(updatedWallet);
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
  const cosmetics = items.filter((item) => item.item_type === 'cosmetic');
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

  const hasOutfits = cosmetics.length > 0;
  document.getElementById('storePrevOutfitBtn').hidden = !hasOutfits;
  document.getElementById('storeNextOutfitBtn').hidden = !hasOutfits;
}

// Moves the pedestal preview to the next/previous cosmetic. Wraps around
// at either end rather than stopping, so there's no dead-end arrow state
// to disable.
function cycleOutfit(direction) {
  if (!currentState) return;
  const cosmetics = currentState.items.filter((item) => item.item_type === 'cosmetic');
  if (cosmetics.length === 0) return;

  const currentIndex = cosmetics.findIndex((item) => item.slug === previewedSlug);
  const nextIndex =
    currentIndex === -1
      ? (direction > 0 ? 0 : cosmetics.length - 1)
      : (currentIndex + direction + cosmetics.length) % cosmetics.length;

  previewedSlug = cosmetics[nextIndex].slug;
  updateBloomingtailsPreview();
}

// A perk's row in the Pawgreens list - self-contained (name, description,
// and its own working Buy/Owned/locked button) since there's no character
// preview to focus a single shared action button's target on the way
// Bloomingtails has. Reuses wireItemButton() for the actual state/click
// logic so purchase behavior can't drift between the two stores.
function buildPawgreensRow(item, character, wallet) {
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
  perks.forEach((item) => listEl.appendChild(buildPawgreensRow(item, character, wallet)));
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
  // "current outfit" is the natural thing to show first), falling back
  // to the first cosmetic, or nothing at all if there are none.
  const cosmetics = items.filter((item) => item.item_type === 'cosmetic');
  if (!cosmetics.some((item) => item.slug === previewedSlug)) {
    const equipped = cosmetics.find((item) => item.equipped);
    previewedSlug = (equipped || cosmetics[0] || null)?.slug ?? null;
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
// equipped/coins all changed) - re-derives character from currentState
// rather than threading it through every action-button handler separately.
// freshWallet: the wallet a purchase/sell call just returned, if any -
// equip/unequip don't touch coins so they have none to pass. Without this,
// a purchase's own updated wallet only ever reached GameScreen's HUD (via
// onWalletUpdateCallback); this modal's own currentState.wallet - which
// #storeWalletLine and every item's affordability/lock check read from -
// kept showing the pre-purchase coin count for the rest of the session,
// making a second buy look wrongly affordable or wrongly locked until the
// store was closed and reopened.
function refreshAfterChange(freshWallet) {
  if (!currentState) return Promise.resolve();
  return renderItems(currentState.character, freshWallet || currentState.wallet);
}

// wallet: the character's current wallet (from GameScreen's this.wallet),
// used as the modal's starting state so it doesn't need its own fetch
// before first paint. onWalletUpdate: called with the fresh wallet after
// any purchase, so the caller's own wallet display stays in sync.
// onOutfitChange: called with (character, outfitItem|null) after a
// successful equip/unequip, so the caller can update the live in-game
// sprite immediately (see onOutfitChangeCallback's own comment above).
export function openStoreModal(character, wallet, onWalletUpdate, onOutfitChange) {
  const modal = document.getElementById('storeModal');
  if (!modal) return;
  playStoreWhooshSound();
  onWalletUpdateCallback = onWalletUpdate;
  onOutfitChangeCallback = onOutfitChange;
  // A fresh open shouldn't remember what a *previous* character's store
  // session had on the pedestal, or which tab they'd wandered to last.
  previewedSlug = null;
  currentTab = 'bloomingtails';
  document.getElementById('bloomingtailsPanel').hidden = false;
  document.getElementById('pawgreensPanel').hidden = true;
  document.getElementById('storeTabBloomingtails').setAttribute('aria-selected', 'true');
  document.getElementById('storeTabPawgreens').setAttribute('aria-selected', 'false');

  modal.hidden = false;
  // Sized *after* unhiding, not before - a hidden element lays out at
  // zero size, so measuring it any earlier would size everything wrong.
  applyModalSizing();
  window.addEventListener('resize', applyModalSizing);
  window.addEventListener('orientationchange', applyModalSizing);
  document.dispatchEvent(new CustomEvent('storemodaltoggle', { detail: { open: true } }));
  renderItems(character, wallet);
}
