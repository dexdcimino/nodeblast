import State, { BRAND } from './state.js';
import { signIn, signOut, onAuthReady, saveProfile } from './auth.js';
import { applyTheme, applyPalette, initThemeToggle, initPalettePickers } from './theme.js';
import { initColorPicker } from './color.js';
import { initTooltips, initAccountMenu, initAudioSettings, showModal } from './ui-events.js';
import { renderHexGrid } from './hex-grid.js';

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
  const hexColor = '#' + (profile?.hexCode || '5AAA72');

  if (user) {
    closeSigninMenu();
    signinBtn.style.display = 'none';
    acctBtn.style.display = 'flex';

    setAvatarEl(document.getElementById('acct-avatar-sm'), profile, user);
    setAvatarEl(document.getElementById('acct-avatar'), profile, user);

    const name = profile?.displayName || user.displayName || 'Account';
    document.getElementById('acct-name-short').textContent = name;
    document.getElementById('acct-name').textContent = name;
    document.getElementById('acct-hex-label').textContent = '#' + (profile?.hexCode || '5aaa72');

    document.getElementById('acct-avatar-sm').style.borderColor = hexColor;
    document.getElementById('acct-avatar').style.borderColor = hexColor;
    document.getElementById('acct-hex-dot').style.background = hexColor;
    document.getElementById('acct-edit-color-preview').style.background = hexColor;
  } else {
    signinBtn.style.display = 'inline-flex';
    acctBtn.style.display = 'none';
  }
}

function openSigninMenu() {
  const menu = document.getElementById('signin-menu');
  const btn = document.getElementById('signin-btn');
  if (!menu || !btn) return;
  const rect = btn.getBoundingClientRect();
  menu.style.top = (rect.bottom + 6) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  menu.style.left = 'auto';
  menu.classList.add('open');
}
function closeSigninMenu() {
  document.getElementById('signin-menu')?.classList.remove('open');
  const err = document.getElementById('auth-error');
  if (err) err.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('hdr-brand').textContent = BRAND;

  applyTheme(State.theme, true);
  applyPalette(State.palette);

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

  // Header sign-in button → open dropdown
  document.getElementById('signin-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('signin-menu');
    if (menu?.classList.contains('open')) closeSigninMenu();
    else openSigninMenu();
  });

  // Sign-in provider buttons
  document.getElementById('google-signin-btn')?.addEventListener('click', async () => {
    await signIn('google');
    closeSigninMenu();
  });
  document.getElementById('github-signin-btn')?.addEventListener('click', async () => {
    await signIn('github');
    closeSigninMenu();
  });

  // Dismiss sign-in dropdown on outside click
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('signin-menu');
    if (!menu?.classList.contains('open')) return;
    if (menu.contains(e.target)) return;
    if (document.getElementById('signin-btn')?.contains(e.target)) return;
    closeSigninMenu();
  });

  onAuthReady(updateAuthUI);

  renderHexGrid();
  window.addEventListener('resize', () => renderHexGrid());
});
