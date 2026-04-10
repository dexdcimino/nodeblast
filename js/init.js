import State from './state.js';
import { signIn, signOut, onAuthReady } from './auth.js';
import { renderHexGrid } from './hex-grid.js';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  State.theme = theme;
  localStorage.setItem('nb-theme', theme);
  const sun = document.getElementById('icon-sun');
  const moon = document.getElementById('icon-moon');
  if (sun && moon) {
    sun.style.display = theme === 'dark' ? 'none' : 'block';
    moon.style.display = theme === 'dark' ? 'block' : 'none';
  }
}

function updateAuthUI(user, profile) {
  const signinBtn = document.getElementById('signin-btn');
  const pill = document.getElementById('profile-pill');
  const pillImg = document.getElementById('pill-img');
  const pillName = document.getElementById('pill-name');

  if (user && profile) {
    signinBtn.style.display = 'none';
    pill.style.display = 'flex';
    pillImg.src = profile.photoURL || user.photoURL || '';
    pillName.textContent = profile.displayName || user.displayName || 'anon';
    pillName.style.color = '#' + (profile.hexCode || '5AAA72');
  } else {
    signinBtn.style.display = 'inline-flex';
    pill.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(State.theme);

  document.getElementById('theme-btn').addEventListener('click', () => {
    document.documentElement.classList.add('theme-transition');
    applyTheme(State.theme === 'dark' ? 'light' : 'dark');
    setTimeout(() => document.documentElement.classList.remove('theme-transition'), 300);
  });

  document.getElementById('signin-btn').addEventListener('click', () => signIn('google'));
  document.getElementById('profile-pill').addEventListener('click', () => {
    if (confirm('Sign out?')) signOut();
  });

  onAuthReady(updateAuthUI);

  renderHexGrid();
  window.addEventListener('resize', () => renderHexGrid());
});
