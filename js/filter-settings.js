// ── Filter Settings ───────────────────────────────────────────────────────────
// Manages import filter preferences stored in localStorage.

const FILTER_DEFAULTS = { minWords: true, minChars: true, minAlpha: true };

function getFilterSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('ytc_filter_settings') || '{}');
    return { ...FILTER_DEFAULTS, ...saved };
  } catch { return { ...FILTER_DEFAULTS }; }
}

function saveFilterSettings() {
  const s = {
    minWords: document.getElementById('filter-min-words').checked,
    minChars: document.getElementById('filter-min-chars').checked,
    minAlpha: document.getElementById('filter-min-alpha').checked,
  };
  localStorage.setItem('ytc_filter_settings', JSON.stringify(s));
}

function openFilterSettings() {
  const s = getFilterSettings();
  document.getElementById('filter-min-words').checked = s.minWords;
  document.getElementById('filter-min-chars').checked = s.minChars;
  document.getElementById('filter-min-alpha').checked = s.minAlpha;
  document.querySelectorAll('.toggle-cb').forEach(cb => {
    cb.onchange = saveFilterSettings;
  });
  document.getElementById('filter-settings-modal').classList.add('open');
}

function closeFilterSettings(e) {
  if (e && e.target !== document.getElementById('filter-settings-modal')) return;
  document.getElementById('filter-settings-modal').classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('filter-settings-modal')?.classList.remove('open');
});
