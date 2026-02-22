// ── Nav counts ────────────────────────────────────────────────────────────────

async function loadNavCounts() {
  try {
    const res = await fetch('/api/counts');
    if (!res.ok) return;
    const counts = await res.json();
    const map = { aggregate: 'nav-count-aggregate', keep: 'nav-count-keep', blacklist: 'nav-count-blacklist', deleted: 'nav-count-deleted' };
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
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  }).catch(e => console.error(`${endpoint} failed:`, e));
}

function _deleteAction(endpoint) {
  fetch(endpoint, {method: 'DELETE'})
    .catch(e => console.error(`${endpoint} failed:`, e));
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
