// ── Module state for interactivity ────────────────────────────────────────────

let _sortCol = 'like_count';
let _sortDir = 'desc';
let _colPrefs = JSON.parse(localStorage.getItem('ytca_cols_report') || '{}');
let _videoInfo = {};
let _discardedCount = 0;
let _keptCount = 0;

// ── Helpers (now in js/utils.js) ───────────────────────────────────────────────
// esc, escAttr, fmt, secondsToHms, formatDate, animateRowOut are all in js/utils.js

// ── URL params ────────────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const REPORT_PATH = params.get('path') || '';

// ── Navigation (prev/next) ────────────────────────────────────────────────────

let _allReports = [];

async function loadNavigation() {
  try {
    const res = await fetch('/api/reports');
    _allReports = await res.json();
    // API returns newest-first; "prev" = previously created = older = higher index
    const idx = _allReports.findIndex(r => r.path === REPORT_PATH);
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    if (idx >= 0 && idx < _allReports.length - 1) {
      btnPrev.classList.remove('disabled');
      btnPrev._target = _allReports[idx + 1].path;
    }
    if (idx > 0) {
      btnNext.classList.remove('disabled');
      btnNext._target = _allReports[idx - 1].path;
    }
  } catch (_) {}
}

function navigate(dir) {
  const btn = document.getElementById('btn-' + dir);
  if (btn._target) {
    window.location.href = '/report?path=' + encodeURIComponent(btn._target);
  }
}

// ── Load report data ──────────────────────────────────────────────────────────

async function loadReport() {
  if (!REPORT_PATH) {
    showError('No report path specified. <a href="/">Go to dashboard</a>');
    return;
  }

  try {
    const res = await fetch('/api/report-data/' + REPORT_PATH);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showError(err.error || 'Failed to load report.');
      return;
    }
    const data = await res.json();
    renderReport(data);
  } catch (e) {
    showError('Network error: ' + e.message);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderReport({ video_info, comments, phrases, discarded_count, kept_count }) {
  const vi = video_info || {};
  _videoInfo = vi;
  _discardedCount = discarded_count || 0;
  _keptCount = kept_count || 0;

  const channel = String(vi.channel || '');
  const channelId = String(vi.channel_id || '');

  document.title = `${vi.title || REPORT_PATH} — ytc-analyzer`;

  // Validate URL
  let yt_url = vi.webpage_url || '';
  if (!yt_url.startsWith('https://')) yt_url = '';

  // Thumbnail
  const thumbHtml = vi.thumbnail
    ? `<img class="video-thumb" src="${escAttr(vi.thumbnail)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'video-thumb-placeholder\\'>&#9654;</div>'">`
    : `<div class="video-thumb-placeholder">&#9654;</div>`;

  const uploadDate = formatDate(vi.upload_date);
  const statsHtml = `<span class="comment-stats">${fmt(_discardedCount)} discarded · ${fmt(_keptCount)} kept</span>`;

  const html = `
    <!-- Video Info (compact) -->
    <div class="video-strip">
      ${vi.thumbnail ? `<img class="strip-thumb" src="${escAttr(vi.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
      <div class="strip-body">
        <div class="strip-title">${esc(vi.title || REPORT_PATH)}</div>
        <div class="strip-meta">
          <span>${esc(channel || 'N/A')}</span>
          <span class="meta-sep">&bull;</span>
          <span>${esc(uploadDate)}</span>
          <span class="meta-sep">&bull;</span>
          <span>${esc(secondsToHms(vi.duration))}</span>
          <span class="meta-sep">&bull;</span>
          <span>${fmt(vi.view_count)} views</span>
          <span class="meta-sep">&bull;</span>
          <span>${fmt(vi.like_count)} likes</span>
          <span class="meta-sep">&bull;</span>
          <span>${fmt(comments.length)} comments · ${fmt(_discardedCount)} blacklisted · ${fmt(_keptCount)} kept</span>
        </div>
      </div>
      <div class="strip-actions">
        ${yt_url ? `<a href="${escAttr(yt_url)}" class="nav-btn" target="_blank" rel="noopener">Watch &#8599;</a>` : ''}
        <button class="nav-btn" onclick="toggleDesc(this)">Description</button>
      </div>
      <div class="video-desc" id="video-desc">${esc(vi.description || '')}</div>
    </div>

    <!-- Tabs -->
    <div class="card">
      ${buildColSelector(REPORT_COLS)}
      <div class="section-tabs">
        <button class="tab active" onclick="showTab('top100', this)">Top Liked</button>
        <button class="tab" onclick="showTab('all', this)">All Comments</button>
        <button class="tab" onclick="showTab('phrases', this)">Repeated Phrases</button>
      </div>

      <!-- Pane: Top 100 -->
      <div id="pane-top100" class="tab-pane">
        <div class="table-wrap">
          <table>
            <thead><tr><th data-colname="actions">&#9829;/&#10005;</th><th data-colname="text" class="sortable" onclick="handleSortClick('text')">Comment</th><th data-colname="like_count" class="sortable" onclick="handleSortClick('like_count')">Likes</th><th data-colname="author" class="sortable" onclick="handleSortClick('author')">Author</th></tr></thead>
            <tbody id="top100-body"></tbody>
          </table>
        </div>
      </div>

      <!-- Pane: All Comments -->
      <div id="pane-all" class="tab-pane" style="display:none">
        <div class="pagination-bar">
          <button class="pg-btn" id="pg-prev" onclick="changePage(-1)">&#8592; Prev</button>
          <span class="pg-info" id="pg-info"></span>
          <button class="pg-btn" id="pg-next" onclick="changePage(1)">Next &#8594;</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th data-colname="actions">&#9829;/&#10005;</th><th data-colname="text" class="sortable" onclick="handleSortClick('text')">Comment</th><th data-colname="like_count" class="sortable" onclick="handleSortClick('like_count')">Likes</th><th data-colname="author" class="sortable" onclick="handleSortClick('author')">Author</th></tr></thead>
            <tbody id="all-body"></tbody>
          </table>
        </div>
        <div class="pagination-bar">
          <button class="pg-btn" id="pg-prev2" onclick="changePage(-1)">&#8592; Prev</button>
          <span class="pg-info" id="pg-info2"></span>
          <button class="pg-btn" id="pg-next2" onclick="changePage(1)">Next &#8594;</button>
        </div>
      </div>

      <!-- Pane: Phrases -->
      <div id="pane-phrases" class="tab-pane" style="display:none">
        ${phrases && phrases.length
          ? `<div class="chart-container"><canvas id="phrases-chart"></canvas></div>`
          : `<p class="no-data">Not enough data to generate a phrases chart.</p>`
        }
      </div>
    </div>
  `;

  document.getElementById('main-content').innerHTML = html;

  // Render Top 100
  renderRows('top100-body', comments.slice(0, 100), 0, channel, channelId, REPORT_PATH);

  // Setup all-comments pagination
  _allComments = comments;
  _channel = channel;
  _channelId = channelId;
  renderPage(0);

  // Phrases chart
  if (phrases && phrases.length) {
    renderPhrasesChart(phrases);
  }

  // Update sort indicators
  updateSortIndicators();
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function showTab(id, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.getElementById('pane-' + id).style.display = '';
  btn.classList.add('active');
}

// ── All comments pagination ───────────────────────────────────────────────────

const PAGE_SIZE = CONFIG.ui.pageSize;
const REPORT_COLS = [
  {id: 'text',       label: 'Comment'},
  {id: 'like_count', label: 'Likes'},
  {id: 'author',     label: 'Author'},
];
let _allComments = [];
let _channel = '';
let _channelId = '';
let _currentPage = 0;

function renderRows(tbodyId, slice, offset, channel, channelId, reportPath = REPORT_PATH) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = slice.map((c, i) => {
    const rank = offset + i + 1;
    const isCreator = channelId
      ? (String(c.author_channel_id || '') === channelId)
      : (channel && String(c.author).trim() === channel.trim());
    const authorCls = isCreator ? 'col-author creator' : 'col-author';
    return `<tr>
      ${buildActionBtns(c, reportPath)}
      <td class="col-text" data-colname="text">${esc(c.text)}</td>
      <td class="col-likes" data-colname="like_count">${fmt(c.like_count)}</td>
      <td class="${authorCls}" data-colname="author">${esc(c.author)}</td>
    </tr>`;
  }).join('');

  // Apply column visibility
  applyColVisibilityReport();
}

function renderPage(page) {
  const total = _allComments.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  _currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const start = _currentPage * PAGE_SIZE;
  renderRows('all-body', _allComments.slice(start, start + PAGE_SIZE), start, _channel, _channelId);
  const info = `Page ${_currentPage + 1} of ${totalPages} &nbsp;·&nbsp; ${total.toLocaleString()} comments`;
  document.getElementById('pg-info').innerHTML = info;
  document.getElementById('pg-info2').innerHTML = info;
  const atFirst = _currentPage === 0;
  const atLast  = _currentPage >= totalPages - 1;
  document.getElementById('pg-prev').disabled  = atFirst;
  document.getElementById('pg-prev2').disabled = atFirst;
  document.getElementById('pg-next').disabled  = atLast;
  document.getElementById('pg-next2').disabled = atLast;
  document.getElementById('pane-all').scrollIntoView({behavior: 'smooth', block: 'start'});
  updateSortIndicators();
}

function changePage(delta) {
  renderPage(_currentPage + delta);
}

// Wrapper for backward compatibility
function applyColVisibility() {
  applyColVisibilityReport();
}

// ── Phrases chart (Chart.js) ──────────────────────────────────────────────────

function renderPhrasesChart(phrases) {
  const canvas = document.getElementById('phrases-chart');
  if (!canvas) return;

  const labels = phrases.map(p => p[0]);
  const values = phrases.map(p => p[1]);

  // Adjust canvas height based on number of phrases
  const barH = 36;
  canvas.height = Math.max(160, labels.length * barH + 80);

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Occurrences',
        data: values,
        backgroundColor: 'rgba(45,212,191,0.75)',
        borderColor: 'rgba(45,212,191,1)',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e1e24',
          titleColor: '#e8e8ed',
          bodyColor: '#a0a0b0',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#606070', font: { size: 11 } },
        },
        y: {
          grid: { display: false },
          ticks: { color: '#e8e8ed', font: { size: 11.5 } },
        },
      },
    },
  });
}

// ── Error display ─────────────────────────────────────────────────────────────

function showError(msg) {
  document.getElementById('main-content').innerHTML =
    `<div class="error-msg">${msg}</div>`;
}

// ── Description toggle ───────────────────────────────────────────────────────

function toggleDesc(btn) {
  const el = document.getElementById('video-desc');
  const visible = el.classList.toggle('visible');
  btn.textContent = visible ? 'Hide Description' : 'Show Description';
}

// ── Action buttons and persistence ────────────────────────────────────────────

function buildActionBtns(comment, reportPath) {
  return `
    <td class="col-actions" data-colname="actions">
      <button class="btn-action btn-keep" title="Keep" onclick="actionKeep(event, this, '${escAttr(comment.id)}', '${escAttr(reportPath)}')">+</button>
      <button class="btn-action btn-discard" title="Add to Blacklist" onclick="actionDiscard(event, this, '${escAttr(comment.id)}', '${escAttr(reportPath)}')">🚫</button>
      <button class="btn-action btn-delete" title="Move to Deleted" onclick="actionDelete(event, this, '${escAttr(comment.id)}', '${escAttr(reportPath)}')">🗑</button>
    </td>
  `;
}

function animateRowOut(tr) {
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
    setTimeout(() => tr.remove(), 160);
  }, 230);
}

async function actionKeep(evt, btn, commentId, reportPath) {
  evt.stopPropagation();
  const comment = findComment(commentId);
  if (!comment) return;

  // Attach report context
  comment._reportPath = reportPath;
  comment._reportTitle = _videoInfo.title || reportPath;
  comment._thumbnail = _videoInfo.thumbnail || '';

  try {
    await fetch('/api/comment/keep', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({comment}),
    });
    animateRowOut(btn.closest('tr'));
  } catch (e) {
    console.error('Failed to keep comment:', e);
  }
}

async function actionDiscard(evt, btn, commentId, reportPath) {
  evt.stopPropagation();
  const comment = findComment(commentId);
  if (!comment) return;
  comment._reportPath = reportPath;
  comment._reportTitle = _videoInfo.title || reportPath;
  comment._thumbnail = _videoInfo.thumbnail || '';
  try {
    await fetch('/api/comment/discard', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({comment}),
    });
    const idx = _allComments.findIndex(c => c.id === commentId);
    if (idx >= 0) _allComments.splice(idx, 1);
    animateRowOut(btn.closest('tr'));
  } catch (e) {
    console.error('Failed to discard comment:', e);
  }
}

async function actionDelete(evt, btn, commentId, reportPath) {
  evt.stopPropagation();
  const comment = findComment(commentId);
  if (!comment) return;
  comment._reportPath = reportPath;
  comment._reportTitle = _videoInfo.title || reportPath;
  comment._thumbnail = _videoInfo.thumbnail || '';
  try {
    await fetch('/api/comment/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({comment}),
    });
    const idx = _allComments.findIndex(c => c.id === commentId);
    if (idx >= 0) _allComments.splice(idx, 1);
    animateRowOut(btn.closest('tr'));
  } catch (e) {
    console.error('Failed to delete comment:', e);
  }
}

function findComment(id) {
  return _allComments.find(c => c.id === id);
}

// ── Sorting ────────────────────────────────────────────────────────────────────

function handleSortClick(colName) {
  if (_sortCol === colName) {
    _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
  } else {
    _sortCol = colName;
    _sortDir = 'desc';
  }

  // Re-sort comments
  _allComments.sort((a, b) => {
    let aVal = a[_sortCol] ?? '';
    let bVal = b[_sortCol] ?? '';

    if (typeof aVal === 'string' || typeof bVal === 'string') {
      aVal = String(aVal); bVal = String(bVal);
      return _sortDir === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
    }

    aVal = Number(aVal) || 0;
    bVal = Number(bVal) || 0;
    return _sortDir === 'desc' ? bVal - aVal : aVal - bVal;
  });

  renderPage(0);
}

// ── Sort state indicators ────────────────────────────────────────────────────────

function updateSortIndicators() {
  document.querySelectorAll('th.sort-active').forEach(th => {
    th.classList.remove('sort-active', 'sort-asc');
  });
  const active = document.querySelector(`th[data-colname="${_sortCol}"]`);
  if (active) {
    active.classList.add('sort-active');
    if (_sortDir === 'asc') active.classList.add('sort-asc');
  }
}

// ── Column visibility ──────────────────────────────────────────────────────────

// Custom buildColSelector for report page (uses local _colPrefs)
function buildColSelector(cols) {
  const checkboxes = cols
    .filter(c => c.id !== 'actions') // Always show actions
    .map(c => `
      <label>
        <input type="checkbox" data-col="${c.id}" ${_colPrefs[c.id] !== false ? 'checked' : ''}
          onchange="toggleColVisibility('${c.id}', this.checked)">
        ${c.label}
      </label>
    `).join('');

  return `
    <div class="col-selector">
      <span class="col-selector-label">Columns:</span>
      ${checkboxes}
    </div>
  `;
}

function toggleColVisibility(colName, visible) {
  _colPrefs[colName] = visible;
  localStorage.setItem('ytca_cols_report', JSON.stringify(_colPrefs));
  applyColVisibilityReport();
}

function applyColVisibilityReport() {
  Object.entries(_colPrefs).forEach(([col, visible]) => {
    const display = visible ? '' : 'none';
    document.querySelectorAll(`[data-colname="${col}"]`).forEach(el => {
      el.style.display = display;
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadNavigation();
loadReport();
