// ── Auto-Filter Settings ────────────────────────────────────────────────────

// Each entry can have an optional `slider` property for a threshold sub-control.
// slider: { key, label, detail, min, max, step, default, format }
const FILTER_DEFS = [
  // ── simple toggles (no slider) — fill the top rows in pairs ────────────────
  { key: 'blacklist_match', label: 'Known Blacklist',    detail: '',    default: true },
  { key: 'min_alpha',       label: 'No Letters',         detail: '',      default: true },
  { key: 'emoji_only',      label: 'Emoji Only',         detail: '',             default: true },
  { key: 'url_only',        label: 'URL / Link Only',    detail: '',                        default: true },
  { key: 'timestamp_only',  label: 'Timestamp Only',     detail: '',             default: true },
  { key: 'repeat_char',     label: 'Repeated Chars',     detail: '',                default: true },
  // ── slider pairs — placed together so each pair shares a grid row ──────────
  { key: 'min_chars',       label: 'Too Short',          detail: '',               default: true,
    slider: {
      key: 'min_chars_threshold',
      label: 'Minimum Characters',
      detail: 'Blacklist shorter than this many characters',
      min: 1, max: 20, step: 1, default: 3,
      format: v => Math.round(v) + ' chars',
    }
  },
  { key: 'min_words',       label: 'Too Few Words',      detail: '',              default: true,
    slider: {
      key: 'min_words_threshold',
      label: 'Minimum Words',
      detail: 'Blacklist fewer than this many words',
      min: 1, max: 10, step: 1, default: 3,
      format: v => Math.round(v) + ' words',
    }
  },
  { key: 'sentiment_filter', label: 'Negative Sentiment', detail: '', default: true,
    slider: {
      key: 'sentiment_threshold',
      label: 'Negativity Threshold',
      detail: 'Blacklist comments at or below this score (−1.00 = very strict, 0.00 = any negative)',
      min: -1.0, max: 0.0, step: 0.05, default: -0.5,
      format: v => parseFloat(v).toFixed(2),
    }
  },
  { key: 'dedup',           label: 'Remove Duplicates',  detail: '',               default: true,
    slider: {
      key: 'dedup_threshold',
      label: 'Similarity Cutoff',
      detail: 'Near-duplicate similarity threshold (lower % = catch more duplicates)',
      min: 50, max: 100, step: 5, default: 85,
      format: v => Math.round(v) + '%',
    }
  },
  { key: 'english_only',    label: 'Non-English',        detail: '',               default: true },
];

const _FS_KEY = 'ytc_filter_settings';

function getFilterSettings() {
  const defaults = {};
  for (const f of FILTER_DEFS) {
    defaults[f.key] = f.default;
    if (f.slider) defaults[f.slider.key] = f.slider.default;
  }
  try {
    const stored = JSON.parse(localStorage.getItem(_FS_KEY) || '{}');
    return { ...defaults, ...stored };
  } catch {
    return defaults;
  }
}

function _saveFilterSettings(settings) {
  localStorage.setItem(_FS_KEY, JSON.stringify(settings));
}

function _onFilterToggle(key, checked) {
  const settings = getFilterSettings();
  settings[key] = checked;
  _saveFilterSettings(settings);

  // Enable/disable the associated slider row if this filter has one
  const def = FILTER_DEFS.find(f => f.key === key);
  if (def?.slider) {
    const row   = document.getElementById(`fslider-row-${def.slider.key}`);
    const input = document.getElementById(`fslider-${def.slider.key}`);
    if (row)   row.classList.toggle('filter-slider-row--disabled', !checked);
    if (input) input.disabled = !checked;
  }
}

function _onSliderChange(key, value) {
  const settings = getFilterSettings();
  settings[key] = parseFloat(value);
  _saveFilterSettings(settings);

  // Update the displayed value using the format function from the def
  for (const f of FILTER_DEFS) {
    if (f.slider?.key === key) {
      const display = document.getElementById(`fslider-val-${key}`);
      if (display) display.textContent = f.slider.format(parseFloat(value));
      break;
    }
  }
}

function _renderFilterToggles() {
  const list = document.getElementById('filter-list');
  if (!list) return;
  const settings = getFilterSettings();

  list.innerHTML = FILTER_DEFS.map(f => {
    const isOn = settings[f.key];

    const toggleRow = `
      <label class="filter-row${f.slider ? ' filter-row--has-slider' : ''}" for="filter-cb-${f.key}">
        <div class="filter-info">
          <span class="filter-name">${esc(f.label)}</span>
          <span class="filter-detail">${esc(f.detail)}</span>
        </div>
        <div class="toggle-wrap">
          <input class="toggle-cb" type="checkbox" id="filter-cb-${f.key}"
            ${isOn ? 'checked' : ''}
            onchange="_onFilterToggle('${f.key}', this.checked)">
          <label class="toggle-track" for="filter-cb-${f.key}"></label>
        </div>
      </label>`;

    if (!f.slider) return `<div class="filter-group">${toggleRow}</div>`;

    const s   = f.slider;
    const val = settings[s.key] ?? s.default;
    const sliderRow = `
      <div class="filter-slider-row${isOn ? '' : ' filter-slider-row--disabled'}" id="fslider-row-${s.key}">
        <div class="filter-slider-labels">
          <span class="filter-slider-label">${esc(s.label)}</span>
          <span class="filter-slider-detail">${esc(s.detail)}</span>
        </div>
        <div class="filter-slider-control">
          <input type="range" class="filter-slider" id="fslider-${s.key}"
            min="${s.min}" max="${s.max}" step="${s.step}" value="${val}"
            ${isOn ? '' : 'disabled'}
            oninput="_onSliderChange('${s.key}', this.value)">
          <span class="filter-slider-val" id="fslider-val-${s.key}">${s.format(val)}</span>
        </div>
      </div>`;

    return `<div class="filter-group">${toggleRow}${sliderRow}</div>`;
  }).join('');
}

// ── API Key management ────────────────────────────────────────────────────────

async function _loadApiKeys() {
  try {
    const res  = await fetch('/api/env-keys');
    const data = await res.json();
    const ytInput = document.getElementById('api-key-youtube');
    const anInput = document.getElementById('api-key-anthropic');
    if (ytInput) ytInput.placeholder = data.YOUTUBE_API_KEY
      ? `Already set (ends ${data.YOUTUBE_API_KEY})`
      : 'Not configured';
    if (anInput) anInput.placeholder = data.ANTHROPIC_API_KEY
      ? `Already set (ends ${data.ANTHROPIC_API_KEY})`
      : 'Not configured';
  } catch (_) {}
}

async function _saveApiKeys() {
  const ytInput  = document.getElementById('api-key-youtube');
  const anInput  = document.getElementById('api-key-anthropic');
  const statusEl = document.getElementById('api-keys-status');
  const btn      = document.querySelector('.api-keys-save-btn');

  const payload = {};
  if (ytInput && ytInput.value.trim()) payload.YOUTUBE_API_KEY   = ytInput.value.trim();
  if (anInput && anInput.value.trim()) payload.ANTHROPIC_API_KEY = anInput.value.trim();

  if (!Object.keys(payload).length) {
    if (statusEl) { statusEl.textContent = 'Nothing to save.'; setTimeout(() => { statusEl.textContent = ''; }, 2000); }
    return;
  }

  if (btn) btn.disabled = true;
  try {
    const res  = await fetch('/api/env-keys', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      if (ytInput) ytInput.value = '';
      if (anInput) anInput.value = '';
      await _loadApiKeys();
      if (statusEl) { statusEl.textContent = 'Saved.'; setTimeout(() => { statusEl.textContent = ''; }, 2500); }
    } else {
      if (statusEl) statusEl.textContent = data.error || 'Error saving.';
    }
  } catch (_) {
    if (statusEl) statusEl.textContent = 'Network error.';
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openFilterSettings() {
  _renderFilterToggles();
  _loadApiKeys();
  document.getElementById('filter-settings-modal').classList.add('open');
}

function closeFilterSettings(e) {
  if (e && e.target !== document.getElementById('filter-settings-modal')) return;
  document.getElementById('filter-settings-modal').classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('filter-settings-modal')?.classList.remove('open');
});
