import { equipItem, getStore, purchaseItem, unequipItem } from './api.js';

// Registered by openStoreModal(), fired whenever a purchase changes the
// wallet - GameScreen uses this to keep its own this.wallet (and the
// HUD it drives) in sync without a redundant re-fetch. Same one-shot-
// callback shape loginModal.js uses for its own success callback.
let onWalletUpdateCallback = null;

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

// One item's row - shared by both the Perks and Outfits sections below so
// the two can't drift into visually different item treatments.
function buildItemRow(character, wallet, item, onChanged) {
  const row = document.createElement('div');
  row.className = 'store-item';

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
    return;
  }

  listEl.innerHTML = '';

  if (items.length === 0) {
    listEl.textContent = 'Nothing in the store yet - check back soon!';
    return;
  }

  // Re-render from scratch on any change (purchase, equip, unequip) -
  // simplest way to keep every row's owned/equipped/afford state correct
  // relative to every other row (e.g. a purchase can drop coins below what
  // a different still-unbought item needs), matching this function's own
  // existing re-fetch-on-purchase behavior, just also covering equip now.
  const rerender = (updatedWallet) => renderItems(character, updatedWallet || wallet);

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
      listEl.appendChild(buildItemRow(character, wallet, item, rerender));
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
  modal.hidden = false;
  document.dispatchEvent(new CustomEvent('storemodaltoggle', { detail: { open: true } }));
  renderItems(character, wallet);
}
