// No iOS browser has a beforeinstallprompt-style API (that's
// Chromium-desktop/Android only; WebKit doesn't implement it, and iOS
// requires every browser there to render on WebKit regardless of engine
// branding) — there's no way to trigger the real "Add to Home Screen"
// dialog or even detect that it's available. The only thing we CAN do is
// detect the situation where adding to the home screen would actually help
// (an iPhone/iPod, not already launched from a home-screen icon) and show
// our own banner pointing the player toward Share > Add to Home Screen
// manually — the standard workaround every iOS-targeting PWA uses for
// this, since the real Fullscreen API is unavailable on iPhone (see
// SetupScreen.js) and a home-screen launch is the actual fix for
// reclaiming the browser's toolbar space (see manifest.json/the
// apple-mobile-web-app-* tags in index.html).
//
// Not Safari-only: confirmed live (by the project owner, on their own
// iPhone) that adding to home screen via Chrome-iOS and launching from
// that icon *does* get a real standalone-ish launch too, not just an
// ordinary bookmark that reopens inside Chrome's normal browser chrome —
// contradicting what an earlier version of this file (and CLAUDE.md)
// assumed based on older iOS/Chrome-iOS behavior. So this deliberately
// does NOT exclude other iOS browsers by user agent — every iOS browser
// gets the same eligibility check (iPhone/iPod, not already standalone).

// Counts dismissals rather than a single boolean flag — a player might
// dismiss it once out of reflex on a day they don't feel like fiddling
// with Share > Add to Home Screen, without meaning "never show me this
// again." MAX_DISMISSALS lets it come back on later visits and only stops
// for good once it's genuinely been waved off this many times. A new key
// name (not reusing the old boolean one) so an earlier single dismissal
// from before this changed can't be misread as a number.
const DISMISS_COUNT_KEY = 'kattrap_homeScreenHintDismissCount';
const MAX_DISMISSALS = 10;

// iPadOS 13+ requests desktop sites by default and its Safari reports a
// Mac-style user agent, but iPadOS already gets the real Fullscreen API
// (see CLAUDE.md's Fullscreen support entry) — it doesn't need this hint
// at all, so this is deliberately scoped to iPhone/iPod only, not a
// broader "any iOS device" check that would also (incorrectly) match iPad.
function isIphoneOrIpod() {
  return /iPhone|iPod/.test(navigator.userAgent);
}

// True once the game has actually been launched from a home-screen icon —
// checks both signals rather than just one, since they're not
// interchangeable: `navigator.standalone` is Apple's own non-standard
// property (historically Safari-specific, and not guaranteed to be set by
// every other iOS browser's own standalone launch — Chrome's iOS app
// doesn't necessarily set it even when it IS running standalone), while
// `display-mode: standalone` is the standard, cross-browser media feature
// most Chromium-family browsers (including Chrome-iOS) actually report
// through. Checking only `navigator.standalone` would incorrectly keep
// showing this to a Chrome-iOS player already using their home-screen icon.
function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function getDismissCount() {
  try {
    return parseInt(localStorage.getItem(DISMISS_COUNT_KEY), 10) || 0;
  } catch (e) {
    // Storage disabled/unavailable (e.g. some private-browsing configs) —
    // treat as "never dismissed" rather than letting this throw and block
    // the rest of init().
    return 0;
  }
}

function shouldShowHint() {
  return isIphoneOrIpod() && !isStandalone() && getDismissCount() < MAX_DISMISSALS;
}

function dismiss(banner) {
  banner.hidden = true;
  try {
    localStorage.setItem(DISMISS_COUNT_KEY, String(getDismissCount() + 1));
  } catch (e) {
    // Same as above — worst case a dismissal doesn't stick and the hint
    // shows again next load, which is a much smaller problem than
    // throwing here.
  }
}

export function setupHomeScreenHint() {
  if (!shouldShowHint()) return;

  const banner = document.getElementById('homeScreenHint');
  const closeBtn = document.getElementById('homeScreenHintClose');
  if (!banner) return;

  banner.hidden = false;
  if (closeBtn) {
    closeBtn.addEventListener('click', () => dismiss(banner));
  }
}
