// iOS Safari has no beforeinstallprompt-style API (that's Chromium-only;
// WebKit doesn't implement it at all) — there's no way to trigger the real
// "Add to Home Screen" dialog or even detect that it's available. The only
// thing we CAN do is detect the situation where adding to the home screen
// would actually help (iOS Safari specifically, not already launched from
// one) and show our own banner pointing the player toward Share > Add to
// Home Screen manually — the standard workaround every iOS-targeting PWA
// uses for this, since the real Fullscreen API is unavailable on iPhone
// (see SetupScreen.js) and a home-screen launch is the actual fix for
// reclaiming Safari's toolbar space (see manifest.json/the
// apple-mobile-web-app-* tags in index.html).

const DISMISSED_KEY = 'kattrap_homeScreenHintDismissed';

// iPadOS 13+ requests desktop sites by default and its Safari reports a
// Mac-style user agent, but iPadOS already gets the real Fullscreen API
// (see CLAUDE.md's Fullscreen support entry) — it doesn't need this hint
// at all, so this is deliberately scoped to iPhone/iPod only, not a
// broader "any iOS device" check that would also (incorrectly) match iPad.
function isIphoneOrIpod() {
  return /iPhone|iPod/.test(navigator.userAgent);
}

// Chrome/Firefox/Edge/Opera on iOS are all WebKit under the hood (Apple
// requires it) but each still tags its own browser in the UA string, and
// none of them get the Safari-specific "launched from home screen ==
// standalone" hook — adding to home screen from Chrome on iPhone just
// makes an ordinary bookmark that reopens in Chrome's normal UI (see
// CLAUDE.md). The hint is only actually useful in Safari itself.
function isOtherIosBrowser() {
  return /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
}

// True once the game has actually been launched from a home-screen icon
// added via Safari — Apple's own (non-standard, Safari-only) property for
// this; no other reliable cross-browser signal exists.
function isStandalone() {
  return window.navigator.standalone === true;
}

function isHintDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'true';
  } catch (e) {
    // Storage disabled/unavailable (e.g. some private-browsing configs) —
    // treat as "not dismissed" rather than letting this throw and block
    // the rest of init().
    return false;
  }
}

function shouldShowHint() {
  return isIphoneOrIpod() && !isOtherIosBrowser() && !isStandalone() && !isHintDismissed();
}

function dismiss(banner) {
  banner.hidden = true;
  try {
    localStorage.setItem(DISMISSED_KEY, 'true');
  } catch (e) {
    // Same as above — worst case the hint reappears next load, which is a
    // much smaller problem than throwing here.
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
