// ── AI Keywords ───────────────────────────────────────────────────────────────

const _DEFAULT_KEYWORDS = [];
const _KEYWORDS_STORAGE_KEY = 'ytca_ai_keywords';
const _MAX_KEYWORDS = 10;

function getAiKeywords() {
  try {
    const stored = localStorage.getItem(_KEYWORDS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return [..._DEFAULT_KEYWORDS];
}

function setAiKeywords(keywords) {
  if (!keywords.length) {
    localStorage.removeItem(_KEYWORDS_STORAGE_KEY);
  } else {
    localStorage.setItem(_KEYWORDS_STORAGE_KEY, JSON.stringify(keywords));
  }
}

/**
 * Show a modal with a keyword tag editor.
 * Options: { title, bodyHtml, submitLabel, submitDisabled, onConfirm }
 * onConfirm(keywords) is called with the keyword array.
 */
function showAiPromptModal({ title = '✨ AI Score', bodyHtml = '', submitLabel = 'Start Scoring', submitDisabled = false, onConfirm }) {
  const existing = document.getElementById('_ytca-prompt-modal');
  if (existing) existing.remove();

  let keywords = [...getAiKeywords()];

  const modal = document.createElement('div');
  modal.id = '_ytca-prompt-modal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:600px;width:92vw">
      <div class="modal-header">
        <span class="modal-title">${esc(title)}</span>
        <button class="modal-close" id="_pm-close">&times;</button>
      </div>
      ${bodyHtml ? `<div id="_pm-body">${bodyHtml}</div>` : ''}
      <div style="padding:0 0 10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span class="api-key-label" style="margin:0">Keywords (Example: cooking, fresh, homestyle) <span id="_pm-count" style="color:var(--text-3);font-weight:normal">(${keywords.length}/${_MAX_KEYWORDS})</span></span>
          <button class="btn btn-secondary" id="_pm-reset" style="font-size:0.75rem;padding:2px 8px">Clear All</button>
        </div>
        <div id="_pm-tags" style="display:flex;flex-wrap:wrap;gap:6px;min-height:32px;padding:8px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px;margin-bottom:8px"></div>
        <div style="display:flex;gap:6px">
          <input id="_pm-input" type="text" placeholder="Add keyword…" maxlength="60"
            style="flex:1;background:var(--bg-2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:0.85rem;box-sizing:border-box">
          <button class="nav-btn" id="_pm-add" style="white-space:nowrap">Add</button>
        </div>
        <p style="color:var(--text-3);font-size:0.75rem;margin:6px 0 0">At least 1 keyword required. Comments matching any keyword score higher. Press Enter to add.</p>
      </div>
      <div class="modal-actions">
        <button class="nav-btn" id="_pm-cancel">Cancel</button>
        <button class="nav-btn" id="_pm-submit" ${submitDisabled ? 'disabled' : ''}>${esc(submitLabel)}</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  function renderTags() {
    const container = document.getElementById('_pm-tags');
    container.innerHTML = keywords.map((kw, i) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg-3);color:var(--text);border:1px solid var(--border-2);border-radius:4px;padding:3px 8px;font-size:0.82rem">
        ${esc(kw)}
        <span data-idx="${i}" style="cursor:pointer;color:var(--text-3);font-size:1rem;line-height:1" title="Remove">&times;</span>
      </span>`
    ).join('');
    container.querySelectorAll('[data-idx]').forEach(btn => {
      btn.onclick = () => { keywords.splice(Number(btn.dataset.idx), 1); renderTags(); };
    });
    const countEl = document.getElementById('_pm-count');
    if (countEl) countEl.textContent = `(${keywords.length}/${_MAX_KEYWORDS})`;
    const submitBtn = document.getElementById('_pm-submit');
    if (submitBtn) submitBtn.disabled = keywords.length === 0 || submitDisabled;
  }

  function addKeyword() {
    const input = document.getElementById('_pm-input');
    const val = input.value.trim();
    if (!val || keywords.length >= _MAX_KEYWORDS) return;
    if (keywords.some(k => k.toLowerCase() === val.toLowerCase())) { input.value = ''; return; }
    keywords.push(val);
    input.value = '';
    renderTags();
  }

  renderTags();

  const close = () => modal.remove();
  document.getElementById('_pm-close').onclick = close;
  document.getElementById('_pm-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  document.getElementById('_pm-add').onclick = addKeyword;
  document.getElementById('_pm-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addKeyword(); }
  });

  document.getElementById('_pm-reset').onclick = () => {
    keywords = [..._DEFAULT_KEYWORDS];
    renderTags();
  };

  document.getElementById('_pm-submit').onclick = () => {
    setAiKeywords(keywords);
    close();
    onConfirm(keywords);
  };
}

// ── Nav counts ────────────────────────────────────────────────────────────────

async function loadNavCounts() {
  try {
    const res = await fetch('/api/counts');
    if (!res.ok) return;
    const counts = await res.json();
    const map = { aggregate: 'nav-count-aggregate', saved: 'nav-count-saved', blacklist: 'nav-count-blacklist', deleted: 'nav-count-deleted' };
    Object.entries(map).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = counts[key] ?? 0;
    });
  } catch (_) {}
}

// Auto-run on DOMContentLoaded if nav badges are present
document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.nav-badge')) loadNavCounts();
});

// ── HTML Escaping ─────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function fmtN(n) {
  const num = Number(n);
  return isNaN(num) ? '0' : num.toLocaleString();
}

// fmt: like fmtN but returns 'N/A' for non-numeric input (used by report.js)
function fmt(n) {
  const num = Number(n);
  return isNaN(num) ? (n || 'N/A') : num.toLocaleString();
}

function secondsToHms(s) {
  s = parseInt(s) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    : `${m}:${String(sec).padStart(2,'0')}`;
}

function formatDate(d) {
  if (!d) return 'N/A';
  if (/^\d{8}$/.test(d)) return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6)}`;
  return d;
}

// ── Row Animation ──────────────────────────────────────────────────────────────

function animateRowOut(tr, onDone) {
  tr.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
  tr.style.opacity = '0';
  tr.style.transform = 'translateX(-12px)';
  tr.style.pointerEvents = 'none';
  setTimeout(() => {
    Array.from(tr.cells).forEach(td => {
      td.style.transition = 'padding 0.15s ease, line-height 0.15s ease';
      td.style.paddingTop = '0';
      td.style.paddingBottom = '0';
      td.style.lineHeight = '0';
      td.style.overflow = 'hidden';
    });
    setTimeout(() => { tr.remove(); if (onDone) onDone(); }, 160);
  }, 230);
}

// ── Sorting ────────────────────────────────────────────────────────────────────

function _sortCmp(a, b, col, dir) {
  let aVal = a[col] ?? '', bVal = b[col] ?? '';
  if (typeof aVal === 'string' || typeof bVal === 'string') {
    aVal = String(aVal); bVal = String(bVal);
    return dir === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
  }
  aVal = Number(aVal) || 0; bVal = Number(bVal) || 0;
  return dir === 'desc' ? bVal - aVal : aVal - bVal;
}

function updateSortIndicators(panelId, sortCol, sortDir) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.querySelectorAll('th.sort-active').forEach(th => th.classList.remove('sort-active','sort-asc'));
  const colMap = { text:'text', like_count:'like_count', author:'author', _reportTitle:'video' };
  const colname = colMap[sortCol];
  if (colname) {
    const th = panel.querySelector(`th[data-colname="${colname}"]`);
    if (th) { th.classList.add('sort-active'); if (sortDir === 'asc') th.classList.add('sort-asc'); }
  }
}

// ── API Action Helpers ─────────────────────────────────────────────────────────

function _postAction(endpoint, comment) {
  fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({comment}),
  }).then(() => loadNavCounts()).catch(e => console.error(`${endpoint} failed:`, e));
}

function _deleteAction(endpoint) {
  fetch(endpoint, {method: 'DELETE'})
    .then(() => loadNavCounts()).catch(e => console.error(`${endpoint} failed:`, e));
}

// ── Column Visibility ──────────────────────────────────────────────────────────

function buildColSelector(cols, prefs, toggleFn) {
  const checkboxes = cols.map(c => `
    <label>
      <input type="checkbox" data-col="${c.id}" ${prefs[c.id] !== false ? 'checked' : ''}
        onchange="${toggleFn}('${c.id}', this.checked)">
      ${c.label}
    </label>`).join('');
  return `<div class="col-selector">${checkboxes}</div>`;
}

function applyColVisibility(panelId, prefs) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  // Apply visibility based on prefs
  Object.entries(prefs).forEach(([col, visible]) => {
    const display = visible ? '' : 'none';
    panel.querySelectorAll(`[data-colname="${col}"]`).forEach(el => {
      el.style.display = display;
    });
  });
}

// ── Keyboard arrow-key pagination ─────────────────────────────────────────────
const _PG_TIP_KEY = 'ytca_pg_arrow_tip_dismissed';

function _showPaginationTip() {
  if (localStorage.getItem(_PG_TIP_KEY)) return;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:400px">
      <div class="modal-header">
        <span class="modal-title">Tip</span>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="modal-desc">You can use the <b>← →</b> keyboard keys to navigate between pages.</div>
      <label style="display:flex;align-items:center;gap:8px;padding:12px 20px;font-size:0.85rem;color:var(--text-2);cursor:pointer">
        <input type="checkbox" id="_pg-tip-dismiss"> Don't show again
      </label>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.remove();
  });
  modal.querySelector('#_pg-tip-dismiss').addEventListener('change', function() {
    if (this.checked) localStorage.setItem(_PG_TIP_KEY, '1');
    else localStorage.removeItem(_PG_TIP_KEY);
  });
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.pg-btn');
  if (btn && !btn.disabled) _showPaginationTip();
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select, [contenteditable]')) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const btns = document.querySelectorAll('.pg-btn:not([disabled])');
  for (const btn of btns) {
    const text = btn.textContent;
    if (e.key === 'ArrowLeft' && text.includes('Prev')) { btn.click(); return; }
    if (e.key === 'ArrowRight' && text.includes('Next')) { btn.click(); return; }
  }
});
