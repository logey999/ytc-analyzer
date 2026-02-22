// ── Import Blacklist Settings ──────────────────────────────────────────────────

function openFilterSettings() {
  document.getElementById('filter-settings-modal').classList.add('open');
}

function closeFilterSettings(e) {
  if (e && e.target !== document.getElementById('filter-settings-modal')) return;
  document.getElementById('filter-settings-modal').classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('filter-settings-modal')?.classList.remove('open');
});
