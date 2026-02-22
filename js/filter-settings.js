// ── Auto-Filter Settings ────────────────────────────────────────────────────

const FILTER_DEFS = [
  { key: 'min_chars',      label: 'Too Short',           detail: 'Drop comments under 3 characters',                  default: true  },
  { key: 'min_alpha',      label: 'No Letters',          detail: 'Drop comments with fewer than 2 alphabetic chars',  default: true  },
  { key: 'min_words',      label: 'Too Few Words',       detail: 'Drop comments with fewer than 3 words',             default: true  },
  { key: 'emoji_only',     label: 'Emoji Only',          detail: 'Drop comments that are just emoji with no text',    default: true  },
  { key: 'url_only',       label: 'URL / Link Only',     detail: 'Drop comments that are just a link',               default: true  },
  { key: 'timestamp_only', label: 'Timestamp Only',      detail: 'Drop bare timestamps like "2:34" or "1:23:45"',    default: true  },
  { key: 'repeat_char',    label: 'Repeated Characters', detail: 'Drop "lolololol", "!!!!!" and similar spam',       default: true  },
  { key: 'blacklist_match', label: 'Known Blacklist',    detail: 'Auto-blacklist comments matching your existing blacklist', default: true },
  { key: 'english_only',   label: 'English Only',        detail: 'Drop non-English comments',                        default: true  },
  { key: 'dedup',          label: 'Remove Duplicates',   detail: 'Blacklist all copies of duplicate comments',        default: true  },
];

const _FS_KEY = 'ytc_filter_settings';

function getFilterSettings() {
  const defaults = Object.fromEntries(FILTER_DEFS.map(f => [f.key, f.default]));
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

function _onFilterChange(key, checked) {
  const settings = getFilterSettings();
  settings[key] = checked;
  _saveFilterSettings(settings);
}

function _renderFilterToggles() {
  const list = document.getElementById('filter-list');
  if (!list) return;
  const settings = getFilterSettings();
  list.innerHTML = FILTER_DEFS.map(f => `
    <label class="filter-row" for="filter-cb-${f.key}">
      <div class="filter-info">
        <span class="filter-name">${esc(f.label)}</span>
        <span class="filter-detail">${esc(f.detail)}</span>
      </div>
      <div class="toggle-wrap">
        <input class="toggle-cb" type="checkbox" id="filter-cb-${f.key}"
          ${settings[f.key] ? 'checked' : ''}
          onchange="_onFilterChange('${f.key}', this.checked)">
        <label class="toggle-track" for="filter-cb-${f.key}"></label>
      </div>
    </label>
  `).join('');
}

function openFilterSettings() {
  _renderFilterToggles();
  document.getElementById('filter-settings-modal').classList.add('open');
}

function closeFilterSettings(e) {
  if (e && e.target !== document.getElementById('filter-settings-modal')) return;
  document.getElementById('filter-settings-modal').classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('filter-settings-modal')?.classList.remove('open');
});
