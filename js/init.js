import State, { BRAND } from './state.js';
import { signIn, signOut, onAuthReady, enterGuestMode, saveProfile } from './auth.js';
import { applyTheme, applyPalette, initThemeToggle, initPalettePickers } from './theme.js';
import { initColorPicker } from './color.js';
import { initTooltips, initAccountMenu, initAudioSettings, toast, showModal } from './ui-events.js';
import { renderHexGrid } from './hex-grid.js';

function showAuthOverlay() {
  document.getElementById('auth-overlay')?.classList.add('visible');
}
function hideAuthOverlay() {
  document.getElementById('auth-overlay')?.classList.remove('visible');
}

function setAvatarEl(el, profile, user) {
  if (!el) return;
  el.innerHTML = '';
  const src = profile?.photoURL || user?.photoURL || '';
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    el.appendChild(img);
  } else {
    el.textContent = (profile?.displayName || 'A').charAt(0).toUpperCase();
  }
}

function updateAuthUI(user, profile) {
  const signinBtn = document.getElementById('signin-btn');
  const acctBtn = document.getElementById('acct-btn');
  const overlay = document.getElementById('auth-overlay');
  const banner = document.getElementById('guest-signin-banner');

  const hexColor = '#' + (profile?.hexCode || '5AAA72');

  if (user || State.guest) {
    hideAuthOverlay();
    signinBtn.style.display = 'none';
    acctBtn.style.display = 'flex';
    acctBtn.style.setProperty('--acct-hex', hexColor);

    setAvatarEl(document.getElementById('acct-avatar-sm'), profile, user);
    setAvatarEl(document.getElementById('acct-avatar'), profile, user);

    const name = profile?.displayName || user?.displayName || 'Account';
    document.getElementById('acct-name-short').textContent = name;
    document.getElementById('acct-name').textContent = name;
    document.getElementById('acct-hex-label').textContent = '#' + (profile?.hexCode || '5aaa72');

    document.querySelectorAll('#acct-avatar-sm, #acct-avatar, #acct-hex-dot, #acct-edit-color-preview')
      .forEach(el => el.style.setProperty('--acct-hex', hexColor));
    document.getElementById('acct-avatar-sm').style.borderColor = hexColor;
    document.getElementById('acct-avatar').style.borderColor = hexColor;
    document.getElementById('acct-hex-dot').style.background = hexColor;
    document.getElementById('acct-edit-color-preview').style.background = hexColor;

    if (State.guest) banner?.classList.add('visible');
    else banner?.classList.remove('visible');
  } else {
    showAuthOverlay();
    signinBtn.style.display = 'inline-flex';
    acctBtn.style.display = 'none';
    banner?.classList.remove('visible');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Brand name
  document.getElementById('hdr-brand').textContent = BRAND;

  // Theme + palette first (pre-paint)
  applyTheme(State.theme, true);
  applyPalette(State.palette);

  // Core chrome
  initTooltips();
  initThemeToggle();
  initPalettePickers();
  initColorPicker();
  initAudioSettings();
  initAccountMenu({
    onSignOut: () => {
      showModal({
        title: 'Sign out?',
        msg: 'You will need to sign in again to access your account.',
        confirmLabel: 'Sign out',
        danger: true,
        onConfirm: () => signOut(),
      });
    },
    onSaveProfile: async (updates) => {
      await saveProfile(updates);
      updateAuthUI(State.user, State.profile);
    },
  });

  // Auth overlay buttons
  document.getElementById('google-signin-btn')?.addEventListener('click', () => signIn('google'));
  document.getElementById('github-signin-btn')?.addEventListener('click', () => signIn('github'));
  document.getElementById('guest-mode-btn')?.addEventListener('click', () => {
    enterGuestMode();
    updateAuthUI(null, State.profile);
  });

  // Header sign-in button re-opens auth overlay
  document.getElementById('signin-btn')?.addEventListener('click', showAuthOverlay);

  // Guest banner sign-in buttons
  document.getElementById('guest-banner-google')?.addEventListener('click', () => signIn('google'));
  document.getElementById('guest-banner-github')?.addEventListener('click', () => signIn('github'));

  // Restore guest mode if set
  if (localStorage.getItem('nb-guest') === '1') {
    enterGuestMode();
    updateAuthUI(null, State.profile);
  } else {
    showAuthOverlay();
  }

  onAuthReady(updateAuthUI);

  renderHexGrid();
  window.addEventListener('resize', () => renderHexGrid());
});
