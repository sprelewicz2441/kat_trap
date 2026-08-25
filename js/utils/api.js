// Thin client for kpground-api (see ../../../../kpground-api/CLAUDE.md for
// the backend side of every endpoint called here). Auth is OAuth2 bearer
// tokens, not cookies - chosen backend-side so it keeps working once this
// game moves to its own top-level domain, see that repo's CLAUDE.md for why.

// Deployed as a Render Web Service on the free tier (see kpground-api's
// CLAUDE.md Deploy section) - no custom domain yet, so this points at the
// raw onrender.com URL rather than an api.kpground.com CNAME (that would
// be a 3rd custom domain on Render's free workspace tier, a real cost -
// see ../kpground/CLAUDE.md's cost note). Revisit if that tradeoff changes.
// Local dev always means the Django dev server on 127.0.0.1:8000 (its
// default port).
const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
export const API_BASE_URL = isLocalHost ? 'http://127.0.0.1:8000' : 'https://kpground-api.onrender.com';

// Must match the client_id django-oauth-toolkit's Application record was
// seeded with (kpground-api's accounts/constants.py + seed_kathryn command).
const CLIENT_ID = 'kattrap-frontend';

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'kattrap_access_token',
  REFRESH_TOKEN: 'kattrap_refresh_token',
  USERNAME: 'kattrap_username',
};

// Wrapped in try/catch throughout, same convention as
// homeScreenHint.js's dismiss-count storage - some private-browsing
// configs restrict localStorage entirely, and a login that just doesn't
// persist across a reload is a better failure mode than a thrown error
// blocking the setup screen.
function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Restricted storage - session just won't survive a reload.
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clear if storage was never writable.
  }
}

export function getAccessToken() {
  return storageGet(STORAGE_KEYS.ACCESS_TOKEN);
}

export function getUsername() {
  return storageGet(STORAGE_KEYS.USERNAME);
}

export function isLoggedIn() {
  return Boolean(getAccessToken());
}

export function logout() {
  storageRemove(STORAGE_KEYS.ACCESS_TOKEN);
  storageRemove(STORAGE_KEYS.REFRESH_TOKEN);
  storageRemove(STORAGE_KEYS.USERNAME);
}

function storeTokenResponse(data, username) {
  storageSet(STORAGE_KEYS.ACCESS_TOKEN, data.access_token);
  storageSet(STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token);
  if (username) storageSet(STORAGE_KEYS.USERNAME, username);
}

export async function kathrynQuickLogin() {
  const response = await fetch(`${API_BASE_URL}/api/auth/kathryn-quicklogin/`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Kathryn quick-login is unavailable right now.');
  }
  const data = await response.json();
  storeTokenResponse(data, 'kathryn');
  return data;
}

// Hits django-oauth-toolkit's own stock /o/token/ endpoint directly (no
// custom backend view for this path) - password grant, chosen backend-
// side since there's no server here to receive an OAuth redirect
// callback. See kpground-api/CLAUDE.md's Auth section.
export async function login(username, password) {
  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
    client_id: CLIENT_ID,
  });
  const response = await fetch(`${API_BASE_URL}/o/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    throw new Error('Login failed - check your username and password.');
  }
  const data = await response.json();
  storeTokenResponse(data, username);
  return data;
}

// Every kattrap economy endpoint goes through this so the Authorization
// header / base URL / error handling can't drift between call sites.
async function apiFetch(path, options = {}) {
  const token = getAccessToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.detail || `Request to ${path} failed (${response.status}).`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export function getWallets() {
  return apiFetch('/api/kattrap/wallets/');
}

export function getStore(character) {
  return apiFetch(`/api/kattrap/store/${character}/`);
}

export function purchaseItem(character, itemSlug) {
  return apiFetch(`/api/kattrap/store/${character}/purchase/`, {
    method: 'POST',
    body: JSON.stringify({ item_slug: itemSlug }),
  });
}

// Refunds a fraction of the item's original cost (see kpground-api's
// economy.py SELL_REFUND_FRACTION) and reverts it to unowned - if it was
// equipped, the backend also reverts that slot to its default look, so
// storeModal.js only needs to fire onOutfitChangeCallback locally to keep
// the live in-game sprite in sync (same as unequipItem's own caller).
export function sellItem(character, itemSlug) {
  return apiFetch(`/api/kattrap/store/${character}/sell/`, {
    method: 'POST',
    body: JSON.stringify({ item_slug: itemSlug }),
  });
}

// Returns { [slot]: item } for whatever's currently equipped - an empty
// object means every slot is at its default look. Only cosmetics can be
// equipped; only 'outfit' exists as a slot today (see kpground-api's
// ItemSlot), but every caller here already treats the response as a dict
// keyed by slot, so a future second slot needs no frontend changes either.
export function getEquipped(character) {
  return apiFetch(`/api/kattrap/equipped/${character}/`);
}

export function equipItem(character, itemSlug) {
  return apiFetch(`/api/kattrap/store/${character}/equip/`, {
    method: 'POST',
    body: JSON.stringify({ item_slug: itemSlug }),
  });
}

export function unequipItem(character, slot) {
  return apiFetch(`/api/kattrap/store/${character}/unequip/`, {
    method: 'POST',
    body: JSON.stringify({ slot }),
  });
}

export function getDailyGiftStatus() {
  return apiFetch('/api/kattrap/daily-gift/status/');
}

export function claimDailyGift() {
  return apiFetch('/api/kattrap/daily-gift/claim/', { method: 'POST' });
}

// coinsCollected: in-gameplay pickup tally for the round, submitted once
// here rather than one network call per pickup (see kpground-api
// CLAUDE.md's MAX_COINS_COLLECTED_PER_ROUND note) - the pickup mechanic
// itself isn't built in the frontend yet, so callers pass 0 for now.
export function submitRound(character, result, coinsCollected = 0) {
  return apiFetch('/api/kattrap/rounds/submit/', {
    method: 'POST',
    body: JSON.stringify({ character, result, coins_collected: coinsCollected }),
  });
}

const PENDING_ROUNDS_KEY = 'kattrap_pendingRounds';
// A sanity ceiling, not a real history feature - same philosophy as
// kpground-api's own MAX_COINS_COLLECTED_PER_ROUND. Drops the oldest
// queued round first; losing one very old unsynced round after a long
// outage is a fine tradeoff against unbounded localStorage growth.
const MAX_PENDING_ROUNDS = 20;

function getPendingRounds() {
  try {
    return JSON.parse(storageGet(PENDING_ROUNDS_KEY) || '[]');
  } catch {
    return [];
  }
}

function setPendingRounds(rounds) {
  storageSet(PENDING_ROUNDS_KEY, JSON.stringify(rounds));
}

// Called instead of submitRound() whenever a round finishes with no live
// connection (offline quick-login, or submitRound() itself failing
// mid-flight) - see SetupScreen.js and GameScreen.js's endGame() - so the
// result isn't just lost. flushPendingRounds() replays these later, in
// the same session or a future one.
export function queuePendingRound(character, result, coinsCollected) {
  const rounds = getPendingRounds();
  rounds.push({ character, result, coinsCollected });
  if (rounds.length > MAX_PENDING_ROUNDS) rounds.shift();
  setPendingRounds(rounds);
}

// Replays queued rounds against the real endpoint in order, stopping at
// the first failure so nothing's skipped or reordered - whatever's left
// just stays queued for next time. Returns the wallet from the last round
// that submitted successfully (or null if none did or the queue was
// empty) - that's the only state a caller actually needs, since it's the
// up-to-date wallet after every queued round has been applied.
export async function flushPendingRounds() {
  const rounds = getPendingRounds();
  let lastWallet = null;
  while (rounds.length > 0) {
    const round = rounds[0];
    try {
      lastWallet = await submitRound(round.character, round.result, round.coinsCollected);
      rounds.shift();
      setPendingRounds(rounds);
    } catch {
      break;
    }
  }
  return lastWallet;
}
