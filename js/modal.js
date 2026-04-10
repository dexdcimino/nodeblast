// ══════════════════════════════════════════════════════
//  NodeBlast — MODAL MODULE (verbatim from DexNote)
//  Themed confirm dialog
// ══════════════════════════════════════════════════════

export function showModal({ title, msg, sub, confirmLabel, danger, onConfirm, deleteLabel, onDelete, onBack }) {
  const modal = document.getElementById('dex-modal');
  if (!modal) { if (window.confirm(msg)) onConfirm?.(); return; }
  if (modal._onBg) { modal.removeEventListener('click', modal._onBg); modal._onBg = null; }
  document.getElementById('dex-modal-title').textContent = title;
  document.getElementById('dex-modal-msg').innerHTML = msg;
  const subEl = document.getElementById('dex-modal-sub');
  if (subEl) { subEl.textContent = sub || ''; subEl.style.display = sub ? 'block' : 'none'; }
  const confirmBtn = document.getElementById('dex-modal-confirm');
  confirmBtn.textContent = confirmLabel || 'Confirm';
  confirmBtn.className = 'dex-modal-btn ' + (danger ? 'danger' : 'primary');

  const close = () => {
    modal.classList.remove('open');
    if (modal._onBg) { modal.removeEventListener('click', modal._onBg); modal._onBg = null; }
    if (modal._onKey) { document.removeEventListener('keydown', modal._onKey, true); modal._onKey = null; }
  };

  // Optional permanent delete button
  let deleteBtn = document.getElementById('dex-modal-delete');
  if (deleteLabel && onDelete) {
    if (!deleteBtn) {
      deleteBtn = document.createElement('button');
      deleteBtn.id = 'dex-modal-delete';
      deleteBtn.className = 'dex-modal-btn danger delete-btn';
      const btnContainer = document.getElementById('dex-modal-btns');
      btnContainer.insertBefore(deleteBtn, btnContainer.firstChild);
    }
    deleteBtn.textContent = deleteLabel;
    deleteBtn.onclick = () => { close(); onDelete(); };
    deleteBtn.style.display = 'block';
  } else if (deleteBtn) {
    deleteBtn.style.display = 'none';
  }

  // Optional back button
  let backBtn = document.getElementById('dex-modal-back');
  if (onBack) {
    if (!backBtn) {
      backBtn = document.createElement('button');
      backBtn.id = 'dex-modal-back';
      backBtn.className = 'dex-modal-btn dex-modal-back-btn';
    }
    const btnContainer = document.getElementById('dex-modal-btns');
    if (backBtn.parentNode !== btnContainer) {
      btnContainer.insertBefore(backBtn, btnContainer.firstChild);
    }
    backBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9,2 4,7 9,12"/></svg> Back';
    backBtn.dataset.tip = 'Back';
    backBtn.onclick = () => { close(); requestAnimationFrame(() => onBack()); };
    backBtn.style.display = 'flex';
  } else if (backBtn) {
    backBtn.style.display = 'none';
  }

  modal.classList.add('open');
  document.getElementById('dex-modal-cancel').onclick = (e) => { e.stopPropagation(); close(); };
  confirmBtn.onclick = (e) => { e.stopPropagation(); close(); onConfirm?.(); };
  const onBg = e => { if (e.target === modal) { e.stopPropagation(); close(); } };
  modal._onBg = onBg;
  modal.addEventListener('click', onBg);
  if (modal._onKey) { document.removeEventListener('keydown', modal._onKey, true); modal._onKey = null; }
  const onKey = e => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      close(); onConfirm?.();
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      close();
    }
  };
  modal._onKey = onKey;
  document.addEventListener('keydown', onKey, true);
}
