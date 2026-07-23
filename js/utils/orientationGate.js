// Milestone-scope mobile support: rather than making the whole game work in
// portrait too, we require landscape and show a full-screen prompt until
// the device is rotated (see CLAUDE.md Mobile responsiveness). Checked on
// load and on resize/orientationchange rather than a pure CSS media query,
// since "portrait" here means the viewport's actual aspect ratio, not a
// fixed device breakpoint — a narrow desktop window should trigger it too.
export function setupOrientationGate() {
  const gate = document.getElementById('orientationGate');
  if (!gate) return;

  const checkOrientation = () => {
    const isPortrait = window.innerHeight > window.innerWidth;
    gate.style.display = isPortrait ? 'flex' : 'none';
  };

  checkOrientation();
  window.addEventListener('resize', checkOrientation);
  window.addEventListener('orientationchange', checkOrientation);
}
