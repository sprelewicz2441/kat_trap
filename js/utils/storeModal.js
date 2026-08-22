import { equipItem, getStore, purchaseItem, unequipItem } from './api.js';
import { getSpriteSrc, PORTRAITS } from './outfits.js';
import { getUIScale } from './scale.js?v=1';

// Registered by openStoreModal(), fired whenever a purchase changes the
// wallet - GameScreen uses this to keep its own this.wallet (and the
// HUD it drives) in sync without a redundant re-fetch. Same one-shot-
// callback shape loginModal.js uses for its own success callback.
let onWalletUpdateCallback = null;

// Which item's slug is currently shown on the dressing-room pedestal -
// module-level so it survives a local re-render (arrow click, row click,
// a purchase/equip) without needing a fresh network fetch every time.
// Reset only when the modal is freshly opened (openStoreModal()).
let previewedSlug = null;

// The last real fetch's own (character, wallet, items) - arrow/row clicks
// only need to change *which* item is previewed and redraw, not re-fetch
// the whole catalog from the network. Only a purchase/equip (which
// actually changes owned/equipped/wallet state) re-fetches via
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
// actual rendered box - read via getBoundingClientRect() after layout,
// since #storePedestalScene is a flex-grow region whose real height
// depends on how much room the heading/wallet-line/name/button/list
// around it are taking, not something computable from the modal's total
// height alone. Called on open, again once the item list has actually
// loaded (its content can shift the scene's available height slightly),
// and on resize/orientationchange while the modal stays open.
function applyModalSizing() {
  const canvas = document.getElementById('gameCanvas');
  const card = document.getElementById('storeCard');
  const scene = document.getElementById('storePedestalScene');
  const pedestalCanvas = document.getElementById('storePedestalCanvas');
  if (!canvas || !card || !scene || !pedestalCanvas) return;

  const uiScale = getUIScale(canvas.width);
  const margin = 50 * uiScale;
  card.style.width = `${Math.max(300, canvas.width - margin * 2)}px`;
  card.style.height = `${Math.max(340, canvas.height - margin * 2)}px`;

  const sceneRect = scene.getBoundingClientRect();
  const size = Math.max(80, Math.min(sceneRect.height * 0.62, sceneRect.width * 0.42));
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
  const close = () => {
    modal.hidden = true;
    window.removeEventListener('resize', applyModalSizing);
    window.removeEventListener('orientationchange', applyModalSizing);
    document.dispatchEvent(new CustomEvent('storemodaltoggle', { detail: { open: false } }));
    onWalletUpdateCallback = null;
  };

  closeBtn.addEventListener('click', close);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  // Outfit-browsing arrows - only ever cycle the character's *cosmetic*
  // catalog (see cycleOutfit()'s own comment for why perks aren't part of
  // this), and are set up once here since the buttons themselves are
  // static markup, not rebuilt per render like the list rows below.
  document.getElementById('storePrevOutfitBtn').addEventListener('click', () => cycleOutfit(-1));
  document.getElementById('storeNextOutfitBtn').addEventListener('click', () => cycleOutfit(1));
}

function walletLineText(wallet) {
  return `${wallet.coins} coins · Level ${wallet.level}`;
}

// One Image per src, loaded once and reused - repeatedly previewing the
// same look (very likely today, since every placeholder cosmetic still
// points at the same default sprite_src - see kpground-api's seed_store)
// shouldn't re-request/re-decode the image every click. Page-lifetime
// cache, same "small assets, never evicted" reasoning as
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

// Draws whichever item is currently being "tried on" onto the dressing-
// room pedestal (#storePedestalCanvas) - same source-rect crop technique
// CharacterSelectScreen's own character cards use (see
// js/utils/outfits.js's shared PORTRAITS), just drawn into a small canvas
// inside this DOM modal instead of that screen's own canvas. `item` is
// whatever's currently previewed, or null for "nothing to preview yet"
// (an empty catalog, or a failed fetch) - still draws the character's own
// default look either way, so the pedestal never sits empty.
function drawPedestalPortrait(character, item) {
  const crop = PORTRAITS[character];
  const canvas = document.getElementById('storePedestalCanvas');
  if (!canvas || !crop) return;

  // Only a cosmetic actually changes what's drawn - previewing a perk (or
  // nothing) shows the character's plain default look, with the sparkle
  // below standing in for "this is the effect you'd be trying on" instead.
  const src = item && item.item_type === 'cosmetic' ? getSpriteSrc(character, item) : getSpriteSrc(character);
  const img = getPortraitImage(src);
  const ctx = canvas.getContext('2d');

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / crop.sw, canvas.height / crop.sh);
    const dw = crop.sw * scale;
    const dh = crop.sh * scale;
    // Bottom-anchored, horizontally centered - "standing on the pedestal"
    // rather than centered in the canvas, so the character's feet line up
    // with the pedestal ellipse drawn in CSS just below this canvas.
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, (canvas.width - dw) / 2, canvas.height - dh, dw, dh);
  };

  if (img.complete && img.naturalWidth > 0) {
    draw();
  } else {
    img.onload = draw;
  }
}

// The single Buy/Equip/Owned/locked action for whatever's currently
// previewed - replaces the old one-button-per-row design now that every
// action routes through the pedestal instead. Shared by perks and
// cosmetics alike so there's only ever one purchase/equip code path to
// keep correct.
function updateActionButton(character, wallet, item) {
  const btn = document.getElementById('storePedestalActionBtn');
  btn.onclick = null;
  btn.classList.remove('store-item-equipped');
  btn.hidden = !item;
  if (!item) return;

  if (item.owned && item.item_type === 'cosmetic') {
    // Cosmetics stay actionable once owned - a toggle between wearing
    // this look and reverting to the default, rather than a dead-end
    // "Owned" label. Perks have nothing to toggle - owning one just
    // makes its effect permanently active.
    btn.disabled = false;
    btn.textContent = item.equipped ? 'Equipped' : 'Equip';
    btn.classList.toggle('store-item-equipped', item.equipped);
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (item.equipped) {
          await unequipItem(character, item.slot);
        } else {
          await equipItem(character, item.slug);
        }
        await refreshAfterChange();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = err.message || 'Failed';
      }
    };
  } else if (item.owned) {
    btn.disabled = true;
    btn.textContent = 'Owned';
  } else if (wallet.level < item.min_level) {
    btn.disabled = true;
    btn.textContent = `Requires Lvl ${item.min_level}`;
  } else {
    btn.disabled = wallet.coins < item.cost;
    btn.textContent = `Buy — ${item.cost} coins`;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Buying...';
      try {
        const updatedWallet = await purchaseItem(character, item.slug);
        if (onWalletUpdateCallback) onWalletUpdateCallback(updatedWallet);
        await renderItems(character, updatedWallet);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = err.message || 'Purchase failed';
      }
    };
  }
}

// Re-draws the pedestal canvas, name label, action button, and (for
// perks) which list row is highlighted - everything that depends on
// `previewedSlug` - without re-fetching from the network. Called after
// every local state change (arrow click, perk row click); renderItems()
// itself calls this too once its fresh fetch lands, so both paths funnel
// through the exact same drawing logic.
function updatePreview() {
  if (!currentState) return;
  const { character, wallet, items } = currentState;
  const item = items.find((i) => i.slug === previewedSlug) || null;

  drawPedestalPortrait(character, item);
  updateActionButton(character, wallet, item);

  const sparkle = document.getElementById('storeCharmSparkle');
  sparkle.classList.toggle('visible', Boolean(item) && item.item_type === 'perk');

  const nameEl = document.getElementById('storePreviewName');
  nameEl.textContent = item ? item.name : '';

  document.querySelectorAll('#storeItemsList .store-item').forEach((row) => {
    row.classList.toggle('previewing', row.dataset.slug === previewedSlug);
  });

  const cosmetics = items.filter((i) => i.item_type === 'cosmetic');
  const hasOutfits = cosmetics.length > 0;
  document.getElementById('storePrevOutfitBtn').hidden = !hasOutfits;
  document.getElementById('storeNextOutfitBtn').hidden = !hasOutfits;
}

// Moves the pedestal preview to the next/previous item in the character's
// *cosmetic* catalog only - perks are deliberately left out of this
// cycle (selected by clicking their row in the list below instead) since
// "scroll through and try one on" is specifically an outfit gesture, not
// something that makes sense for an invisible gameplay effect. Wraps
// around at either end rather than stopping, so there's no dead-end
// arrow state to disable. If nothing previewed is currently a cosmetic
// (a perk, or nothing at all), `direction` picks which end to land on
// first rather than computing an offset from a nonexistent index.
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
  updatePreview();
}

// A perk's row in the list below - informational (name/description plus
// a plain status badge, not a button) since the actual action always
// happens via the single pedestal button now. Clicking anywhere on the
// row previews it.
function buildPerkRow(item, wallet) {
  const row = document.createElement('div');
  row.className = 'store-item';
  row.dataset.slug = item.slug;
  row.addEventListener('click', () => {
    previewedSlug = item.slug;
    updatePreview();
  });

  const info = document.createElement('div');
  info.className = 'store-item-info';
  const nameEl = document.createElement('strong');
  nameEl.textContent = item.name;
  info.appendChild(nameEl);
  if (item.description) {
    const descEl = document.createElement('span');
    descEl.textContent = item.description;
    info.appendChild(descEl);
  }
  row.appendChild(info);

  const status = document.createElement('span');
  status.className = 'store-item-status';
  if (item.owned) {
    status.textContent = 'Owned';
  } else if (wallet.level < item.min_level) {
    status.textContent = `Lvl ${item.min_level}`;
  } else {
    status.textContent = `${item.cost} coins`;
  }
  row.appendChild(status);

  return row;
}

// Re-fetches the catalog and rebuilds everything - called on open and
// again after a purchase/equip actually changes owned/equipped/wallet
// state (arrow/row clicks alone don't need this, see updatePreview()).
async function renderItems(character, wallet) {
  const listEl = document.getElementById('storeItemsList');
  const walletLineEl = document.getElementById('storeWalletLine');
  walletLineEl.textContent = walletLineText(wallet);
  listEl.textContent = 'Loading...';

  let items;
  try {
    items = await getStore(character);
  } catch (err) {
    listEl.textContent = 'Could not load the store right now.';
    currentState = { character, wallet, items: [] };
    previewedSlug = null;
    updatePreview();
    return;
  }

  currentState = { character, wallet, items };

  // Keeps whatever was already previewed if it still exists; otherwise
  // prefers the character's actually-equipped cosmetic (the "current
  // outfit" is the natural thing to show first), falling back to the
  // first perk, or nothing at all if the catalog is empty.
  if (!items.some((item) => item.slug === previewedSlug)) {
    const equippedCosmetic = items.find((item) => item.item_type === 'cosmetic' && item.equipped);
    const firstPerk = items.find((item) => item.item_type === 'perk');
    previewedSlug = (equippedCosmetic || firstPerk || null)?.slug ?? null;
  }

  listEl.innerHTML = '';
  const perks = items.filter((item) => item.item_type === 'perk');
  perks.forEach((item) => listEl.appendChild(buildPerkRow(item, wallet)));
  if (perks.length === 0) {
    listEl.textContent = 'Nothing here yet - check back soon!';
  }

  updatePreview();
  // The list's real content (vs. the "Loading..." placeholder it had a
  // moment ago) can shift how much height the flex-grow pedestal scene
  // actually ends up with - re-measure now that it has settled.
  applyModalSizing();
}

// Only a purchase/equip actually needs a fresh network fetch (owned/
// equipped/coins all changed) - re-derives character/wallet from
// currentState rather than threading them through every action-button
// handler separately.
function refreshAfterChange() {
  if (!currentState) return Promise.resolve();
  return renderItems(currentState.character, currentState.wallet);
}

// wallet: the character's current wallet (from GameScreen's this.wallet),
// used as the modal's starting state so it doesn't need its own fetch
// before first paint. onWalletUpdate: called with the fresh wallet after
// any purchase, so the caller's own wallet display stays in sync.
export function openStoreModal(character, wallet, onWalletUpdate) {
  const modal = document.getElementById('storeModal');
  if (!modal) return;
  onWalletUpdateCallback = onWalletUpdate;
  // A fresh open shouldn't remember what a *previous* character's store
  // session had on the pedestal - renderItems() below re-derives a real
  // default (the equipped look, or the first perk) for whichever
  // character this actually is.
  previewedSlug = null;
  modal.hidden = false;
  // Sized *after* unhiding, not before - a hidden element lays out at
  // zero size, so measuring it any earlier would size everything wrong.
  applyModalSizing();
  window.addEventListener('resize', applyModalSizing);
  window.addEventListener('orientationchange', applyModalSizing);
  document.dispatchEvent(new CustomEvent('storemodaltoggle', { detail: { open: true } }));
  renderItems(character, wallet);
}
