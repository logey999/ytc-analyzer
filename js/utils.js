// ── AI Prompt ─────────────────────────────────────────────────────────────────

const _DEFAULT_AI_PROMPT =
`You analyse comments on a YouTube video to identify video topic potential.

Rate each comment 1-10:
  8-10  Clear actionable question or topic idea the creator could make a video about
  4-7   Vague interest or partial topic signal
  1-3   General praise, reaction, off-topic, or no usable topic idea

Confidence: how certain you are given the clarity of the comment (0-100).

Return a JSON array in the same order as the input:
[{"rating": N, "confidence": N}, ...]`;

const _PROMPT_STORAGE_KEY = 'ytca_ai_score_prompt';

function getAiPrompt() {
  return localStorage.getItem(_PROMPT_STORAGE_KEY) || _DEFAULT_AI_PROMPT;
}

/**
 * Show a modal with an editable AI prompt textarea.
 * Options: { title, bodyHtml, submitLabel, submitDisabled, onConfirm }
 * onConfirm(prompt) is called with the (possibly edited) prompt string.
 */
function showAiPromptModal({ title = '✨ AI Score', bodyHtml = '', submitLabel = 'Start Scoring', submitDisabled = false, onConfirm }) {
  const existing = document.getElementById('_ytca-prompt-modal');
  if (existing) existing.remove();

  const prompt = getAiPrompt();
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
          <span class="api-key-label" style="margin:0">Scoring Prompt</span>
          <button class="btn btn-secondary" id="_pm-reset" style="font-size:0.75rem;padding:2px 8px">Reset to Default</button>
        </div>
        <textarea id="_pm-textarea" spellcheck="false" style="width:100%;height:190px;resize:vertical;font-family:monospace;font-size:0.78rem;line-height:1.5;background:var(--bg-2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;box-sizing:border-box">${esc(prompt)}</textarea>
      </div>
      <div class="modal-actions">
        <button class="nav-btn" id="_pm-cancel">Cancel</button>
        <button class="nav-btn" id="_pm-submit" ${submitDisabled ? 'disabled' : ''}>${esc(submitLabel)}</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('_pm-close').onclick = close;
  document.getElementById('_pm-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  document.getElementById('_pm-reset').onclick = () => {
    document.getElementById('_pm-textarea').value = _DEFAULT_AI_PROMPT;
  };

  document.getElementById('_pm-submit').onclick = () => {
    const p = document.getElementById('_pm-textarea').value.trim();
    const finalPrompt = p || _DEFAULT_AI_PROMPT;
    // Persist only if different from default
    if (finalPrompt === _DEFAULT_AI_PROMPT) {
      localStorage.removeItem(_PROMPT_STORAGE_KEY);
    } else {
      localStorage.setItem(_PROMPT_STORAGE_KEY, finalPrompt);
    }
    close();
    onConfirm(finalPrompt);
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
  return `<div class="col-selector"><span class="col-selector-label">Columns:</span>${checkboxes}</div>`;
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
