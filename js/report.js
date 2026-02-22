// ── Module state ───────────────────────────────────────────────────────────────

let _videoInfo = {};
let _discardedCount = 0;
let _keptCount = 0;
let _allTable = null;

// ── Helpers (in js/utils.js) ──────────────────────────────────────────────────
// esc, escAttr, fmt, fmtN, secondsToHms, formatDate, animateRowOut

// ── URL params ────────────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const REPORT_PATH = params.get('path') || '';

// ── Navigation (prev/next) ────────────────────────────────────────────────────

let _allReports = [];

async function loadNavigation() {
  try {
    const res = await fetch('/api/reports');
    _allReports = await res.json();
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
    const filters = (() => {
      try { return JSON.parse(localStorage.getItem('ytc_filter_settings') || '{}'); } catch { return {}; }
    })();
    const qp = new URLSearchParams({
      minWords: filters.minWords !== false ? '1' : '0',
      minChars: filters.minChars !== false ? '1' : '0',
      minAlpha: filters.minAlpha !== false ? '1' : '0',
    });
    const res = await fetch('/api/report-data/' + REPORT_PATH + '?' + qp);
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

function renderReport({ video_info, comments, phrases, discarded_count, kept_count, deleted_count }) {
  const vi = video_info || {};
  _videoInfo = vi;
  _discardedCount = discarded_count || 0;
  _keptCount = kept_count || 0;
  const _deletedCount = deleted_count || 0;
  const allComments = comments || [];
  const channel = String(vi.channel || '');

  document.title = `${vi.title || REPORT_PATH} — ytc-analyzer`;

  let yt_url = vi.webpage_url || '';
  if (!yt_url.startsWith('https://')) yt_url = '';

  const uploadDate = formatDate(vi.upload_date);

  const html = `
    <!-- Video Info -->
    <div class="video-strip">
      <div class="strip-nav">
        <button class="nav-btn disabled" id="btn-prev" onclick="navigate('prev')">&#8592;</button>
        <button class="nav-btn disabled" id="btn-next" onclick="navigate('next')">&#8594;</button>
      </div>
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
          <span>${fmt(allComments.length)} comments · ${fmt(vi.filtered_out || 0)} filtered - ${fmt(_keptCount)} kept - ${fmt(_discardedCount)} blacklisted · ${fmt(_deletedCount)} deleted</span>
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
      <div class="section-tabs">
        <button class="tab active" onclick="showTab('all', this)">All Comments</button>
        <button class="tab" onclick="showTab('phrases', this)">Repeated Phrases</button>
      </div>

      <!-- Pane: All Comments (managed by TableManager) -->
      <div id="pane-all" class="tab-pane"></div>

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
  loadNavigation();

  // Annotate comments with report context for the video column
  allComments.forEach(c => {
    c._reportPath = REPORT_PATH;
    c._reportTitle = vi.title || REPORT_PATH;
  });

  // Setup TableManager for All Comments
  _allTable = new TableManager({
    panelId: 'pane-all',
    pageSize: CONFIG.ui.pageSize,
    columns: [
      { id: 'text',       label: 'Comment' },
      { id: 'like_count', label: 'Likes' },
      { id: 'author',     label: 'Author' },
      { id: 'video',      label: 'Video' },
    ],
    colPrefKey: 'ytca_cols_report_all',
    defaultColPrefs: { video: false },
    emptyMessage: 'No comments.',
    actions: [
      {
        label: '+',
        title: 'Keep',
        className: 'btn-keep',
        handler: async (comment, row) => {
          try {
            await fetch('/api/comment/keep', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ comment: _withContext(comment) }),
            });
            animateRowOut(row);
          } catch (e) { console.error('Failed to keep comment:', e); }
        },
      },
      {
        label: '🚫',
        title: 'Add to Blacklist',
        className: 'btn-discard',
        handler: async (comment, row, tm) => {
          try {
            await fetch('/api/comment/discard', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ comment: _withContext(comment) }),
            });
            tm.removeRow(comment.id, row);
          } catch (e) { console.error('Failed to discard comment:', e); }
        },
      },
      {
        label: '🗑',
        title: 'Move to Deleted',
        className: 'btn-delete',
        handler: async (comment, row, tm) => {
          try {
            await fetch('/api/comment/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ comment: _withContext(comment) }),
            });
            tm.removeRow(comment.id, row);
          } catch (e) { console.error('Failed to delete comment:', e); }
        },
      },
    ],
  });
  __tableManagers['pane-all'] = _allTable;
  _allTable.setData(allComments);

  // Phrases chart
  if (phrases && phrases.length) {
    renderPhrasesChart(phrases);
  }
}

// Attach report context to a comment before sending to API
function _withContext(comment) {
  return Object.assign({}, comment, {
    _reportPath: REPORT_PATH,
    _reportTitle: _videoInfo.title || REPORT_PATH,
    _thumbnail: _videoInfo.thumbnail || '',
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function showTab(id, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.getElementById('pane-' + id).style.display = '';
  btn.classList.add('active');
}

// ── Phrases chart (Chart.js) ──────────────────────────────────────────────────

function renderPhrasesChart(phrases) {
  const canvas = document.getElementById('phrases-chart');
  if (!canvas) return;

  const labels = phrases.map(p => p[0]);
  const values = phrases.map(p => p[1]);

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

// ── Description toggle ────────────────────────────────────────────────────────

function toggleDesc(btn) {
  const el = document.getElementById('video-desc');
  const visible = el.classList.toggle('visible');
  btn.textContent = visible ? 'Hide Description' : 'Show Description';
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadReport();
