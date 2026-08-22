import { equipItem, getStore, purchaseItem, unequipItem } from './api.js';
import { getSpriteSrc, PORTRAITS } from './outfits.js';

// Registered by openStoreModal(), fired whenever a purchase changes the
// wallet - GameScreen uses this to keep its own this.wallet (and the
// HUD it drives) in sync without a redundant re-fetch. Same one-shot-
// callback shape loginModal.js uses for its own success callback.
let onWalletUpdateCallback = null;

// Which item's slug is currently shown on the dressing-room pedestal (see
// updatePedestal()) - module-level so it survives renderItems() re-runs
// (a purchase/equip shouldn't reset what's on display), reset only when
// the modal is freshly opened (openStoreModal()) or the previewed item no
// longer exists in a fresh fetch.
let previewedSlug = null;

export function setupStoreModal() {
  const modal = document.getElementById('storeModal');
  const closeBtn = document.getElementById('storeCloseBtn');
  if (!modal || !closeBtn) return;

  // Fires storemodaltoggle the same way settingsMenu.js's settingsmenutoggle
  // does, so GameScreen can pause/resume in lockstep with this modal's
  // actual visible state.
  const close = () => {
    modal.hidden = true;
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
}

function walletLineText(wallet) {
  return `${wallet.coins} coins · Level ${wallet.level}`;
}

// Named-color lookup for a cosmetic's swatch dot (buildItemRow() below) -
// there's no dedicated color field on StoreItem (sprite_src is a full
// image path, not a color), so this just matches whichever known color
// word appears in the item's own slug. Falls back to a neutral gray dot
// for any cosmetic whose slug doesn't mention one of these - keeps every
// cosmetic row visually consistent (a dot either way) rather than some
// rows having one and others not. Add to this map as more cosmetic colors
// ship; it's presentation only; won't affect purchase/equip logic
// regardless of whether a slug matches.
const SWATCH_COLORS = {
  purple: '#8a2be2',
  pink: '#ff69b4',
  teal: '#29b6f6',
  orange: '#fb8c00',
  green: '#4caf50',
};

function swatchColorFor(item) {
  const match = Object.keys(SWATCH_COLORS).find((color) => item.slug.includes(color));
  return match ? SWATCH_COLORS[match] : '#9e9e9e';
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

// Draws whichever character/item is currently being "tried on" onto the
// dressing-room pedestal (#storePedestalCanvas) - same source-rect crop
// technique CharacterSelectScreen's own character cards use (see
// js/utils/outfits.js's shared PORTRAITS), just drawn into a small canvas
// inside this DOM modal instead of the character-select screen's own
// canvas. `item` is whatever's currently selected in the list below, or
// null for "nothing to preview yet" (an empty catalog, or a failed
// fetch) - still draws the character's own default look either way, so
// the pedestal never sits empty.
function updatePedestal(character, item) {
  const crop = PORTRAITS[character];
  const canvas = document.getElementById('storePedestalCanvas');
  const sparkle = document.getElementById('storeCharmSparkle');
  const caption = document.getElementById('storePreviewCaption');
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

  if (sparkle) sparkle.classList.toggle('visible', Boolean(item) && item.item_type === 'perk');

  caption.innerHTML = '';
  if (item) {
    const nameEl = document.createElement('strong');
    nameEl.textContent = item.name;
    caption.appendChild(nameEl);
    if (item.description) {
      const descEl = document.createElement('span');
      descEl.textContent = item.description;
      caption.appendChild(descEl);
    }
  }
}

// One item's row - shared by both the Perks and Outfits sections below so
// the two can't drift into visually different item treatments. Clicking
// anywhere on the row (not just the buy/equip button) previews it on the
// pedestal - the button's own click bubbles up into this too, which is
// fine: buying or equipping something you weren't already looking at
// should also put it on display.
function buildItemRow(character, wallet, item, onChanged, isPreviewed) {
  const row = document.createElement('div');
  row.className = 'store-item';
  row.classList.toggle('previewing', isPreviewed);
  row.addEventListener('click', () => {
    document.querySelectorAll('#storeItemsList .store-item.previewing').forEach((el) => {
      el.classList.remove('previewing');
    });
    row.classList.add('previewing');
    previewedSlug = item.slug;
    updatePedestal(character, item);
  });

  if (item.item_type === 'cosmetic') {
    const swatch = document.createElement('span');
    swatch.className = 'store-item-swatch';
    swatch.style.backgroundColor = swatchColorFor(item);
    row.appendChild(swatch);
  }

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

  const button = document.createElement('button');
  button.className = 'store-item-buy';

  if (item.owned && item.item_type === 'cosmetic') {
    // Cosmetics stay actionable once owned - a toggle between wearing
    // this look and reverting to the default, rather than a dead-end
    // "Owned" label. Perks (below) have nothing to toggle - owning one
    // just makes its effect permanently active.
    button.textContent = item.equipped ? 'Equipped' : 'Equip';
    button.classList.toggle('store-item-equipped', item.equipped);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (item.equipped) {
          await unequipItem(character, item.slot);
        } else {
          await equipItem(character, item.slug);
        }
        onChanged();
      } catch (err) {
        button.disabled = false;
        button.textContent = err.message || 'Failed';
      }
    });
  } else if (item.owned) {
    button.textContent = 'Owned';
    button.disabled = true;
  } else if (wallet.level < item.min_level) {
    button.textContent = `Lvl ${item.min_level}`;
    button.disabled = true;
  } else {
    button.textContent = `${item.cost} coins`;
    button.disabled = wallet.coins < item.cost;
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Buying...';
      try {
        const updatedWallet = await purchaseItem(character, item.slug);
        if (onWalletUpdateCallback) onWalletUpdateCallback(updatedWallet);
        onChanged(updatedWallet);
      } catch (err) {
        button.disabled = false;
        button.textContent = err.message || 'Purchase failed';
      }
    });
  }

  row.appendChild(button);
  return row;
}

// Re-fetches and re-renders the item list in place - called on open and
// again after a successful purchase/equip, so owned/affordable/locked
// states stay accurate without closing and reopening the modal. Grouped
// into "Perks" and "Outfits" sections (only rendered if that type has any
// items) rather than one flat list, now that a character's catalog can mix
// both - see kpground-api's StoreItem.item_type.
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
    // Still show the character on the pedestal even though the rack
    // itself failed to load - a dressing room with a broken price tag
    // shouldn't also hide the mirror.
    updatePedestal(character, null);
    return;
  }

  listEl.innerHTML = '';

  if (items.length === 0) {
    listEl.textContent = 'Nothing in the store yet - check back soon!';
    updatePedestal(character, null);
    return;
  }

  // Re-render from scratch on any change (purchase, equip, unequip) -
  // simplest way to keep every row's owned/equipped/afford state correct
  // relative to every other row (e.g. a purchase can drop coins below what
  // a different still-unbought item needs), matching this function's own
  // existing re-fetch-on-purchase behavior, just also covering equip now.
  const rerender = (updatedWallet) => renderItems(character, updatedWallet || wallet);

  // Keeps whatever was already being previewed across a re-render if it
  // still exists; otherwise prefers the character's actually-equipped
  // cosmetic (the "current outfit" is the natural thing to show first),
  // falling back to just the first item in the catalog.
  let previewedItem = items.find((item) => item.slug === previewedSlug);
  if (!previewedItem) {
    previewedItem = items.find((item) => item.item_type === 'cosmetic' && item.equipped) || items[0];
  }
  previewedSlug = previewedItem.slug;
  updatePedestal(character, previewedItem);

  const sections = [
    { type: 'perk', heading: 'Perks' },
    { type: 'cosmetic', heading: 'Outfits' },
  ];

  sections.forEach(({ type, heading }) => {
    const sectionItems = items.filter((item) => item.item_type === type);
    if (sectionItems.length === 0) return;

    const headingEl = document.createElement('h3');
    headingEl.className = 'store-section-heading';
    headingEl.textContent = heading;
    listEl.appendChild(headingEl);

    sectionItems.forEach((item) => {
      listEl.appendChild(buildItemRow(character, wallet, item, rerender, item.slug === previewedSlug));
    });
  });
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
  // default (the equipped look, or the first item) for whichever
  // character this actually is.
  previewedSlug = null;
  modal.hidden = false;
  document.dispatchEvent(new CustomEvent('storemodaltoggle', { detail: { open: true } }));
  renderItems(character, wallet);
}
