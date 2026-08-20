import { login } from './api.js';

// One-shot callback registered by openLoginModal(), fired on a successful
// login - keeps this module unaware of screens/ScreenManager entirely,
// same separation settingsMenu.js keeps from GameScreen (event-based
// there since multiple things care; a direct callback is simpler here
// since only SetupScreen ever opens this modal).
let onSuccessCallback = null;

export function setupLoginModal() {
  const modal = document.getElementById('loginModal');
  const form = document.getElementById('loginForm');
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const errorEl = document.getElementById('loginError');
  const closeBtn = document.getElementById('loginCloseBtn');
  const submitBtn = document.getElementById('loginSubmitBtn');
  if (!modal || !form || !usernameInput || !passwordInput || !errorEl || !submitBtn) return;

  const close = () => {
    modal.hidden = true;
    form.reset();
    errorEl.hidden = true;
    onSuccessCallback = null;
  };

  closeBtn.addEventListener('click', close);

  // Click outside the card (on the dimmed backdrop) closes it - same
  // convention as #creditsModal.
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in...';

    try {
      await login(usernameInput.value, passwordInput.value);
      const callback = onSuccessCallback;
      close();
      if (callback) callback();
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log In';
    }
  });
}

// Opens the modal and registers what happens on a successful login.
// SetupScreen calls this rather than showing the modal itself, keeping
// its own code purely canvas-driven the way every other screen is.
export function openLoginModal(onSuccess) {
  const modal = document.getElementById('loginModal');
  const usernameInput = document.getElementById('loginUsername');
  if (!modal) return;
  onSuccessCallback = onSuccess;
  modal.hidden = false;
  usernameInput?.focus();
}
