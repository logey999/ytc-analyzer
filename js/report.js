// ── Module state ───────────────────────────────────────────────────────────────

let _videoInfo = {};
let _blacklistedCount = 0;
let _savedCount = 0;
let _deletedCount = 0;
let _pendingCount = 0;
let _allTable = null;
let _scoringPollTimer = null;

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

function renderReport({ video_info, comments, phrases, blacklist_count, saved_count, deleted_count }) {
  const vi = video_info || {};
  _videoInfo = vi;
  _blacklistedCount = blacklist_count || 0;
  _savedCount = saved_count || 0;
  _deletedCount = deleted_count || 0;
  const allComments = comments || [];
  _pendingCount = allComments.length;
  const channel = String(vi.channel || '');
  const cb = vi.claude_batch || null;

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
          <span id="strip-views">${fmt(vi.view_count)} views</span>
          <span class="meta-sep">&bull;</span>
          <span id="strip-likes">${fmt(vi.like_count)} likes</span>
          <span class="meta-sep">&bull;</span>
          <span id="strip-counts">${fmt(allComments.length)} pending - ${fmt(_savedCount)} saved - ${fmt(_blacklistedCount)} blacklisted · ${fmt(_deletedCount)} deleted</span>
        </div>
      </div>
      <div class="strip-actions">
        ${yt_url ? `<a href="${escAttr(yt_url)}" class="nav-btn" target="_blank" rel="noopener">Watch &#8599;</a>` : ''}
        <button class="nav-btn" onclick="toggleDesc(this)">Description</button>
        ${_renderScoringButton(cb)}
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

  // Determine whether scoring columns should be visible
  const scoringDone = cb && cb.status === 'ended';
  const scoringActive = cb && (cb.status === 'in_progress' || cb.status === 'ended');

  // Setup TableManager for All Comments
  _allTable = new TableManager({
    panelId: 'pane-all',
    pageSize: CONFIG.ui.pageSize,
    columns: [
      { id: 'text',             label: 'Comment' },
      { id: 'like_count',       label: 'Likes' },
      { id: 'topic_rating',     label: 'Score' },
      { id: 'topic_confidence', label: 'Conf%' },
      { id: 'author',           label: 'Author' },
      { id: 'video',            label: 'Video' },
    ],
    colPrefKey: 'ytca_cols_report_all',
    defaultColPrefs: {
      video: false,
      topic_rating: scoringActive,
      topic_confidence: scoringActive,
    },
    emptyMessage: 'No comments.',
    actions: [
      {
        label: '+',
        title: 'Save',
        className: 'btn-save',
        handler: async (comment, row) => {
          try {
            await fetch('/api/comment/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ comment: _withContext(comment) }),
            });
            animateRowOut(row);
            _pendingCount = Math.max(0, _pendingCount - 1); _savedCount++;
            loadNavCounts(); refreshStripCounts();
          } catch (e) { console.error('Failed to save comment:', e); }
        },
      },
      {
        label: '🚫',
        title: 'Add to Blacklist',
        className: 'btn-blacklist',
        handler: async (comment, row, tm) => {
          try {
            await fetch('/api/comment/blacklist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ comment: _withContext(comment) }),
            });
            tm.removeRow(comment.id, row);
            _pendingCount = Math.max(0, _pendingCount - 1); _blacklistedCount++;
            loadNavCounts(); refreshStripCounts();
          } catch (e) { console.error('Failed to blacklist comment:', e); }
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
            _pendingCount = Math.max(0, _pendingCount - 1); _deletedCount++;
            loadNavCounts(); refreshStripCounts();
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

  // Start polling if scoring is in progress
  if (cb && cb.status === 'in_progress') {
    _startScoringPoll();
  }
}

// ── Strip count refresh ────────────────────────────────────────────────────────

function refreshStripCounts() {
  const el = document.getElementById('strip-counts');
  if (el) {
    el.textContent = `${fmt(_pendingCount)} pending - ${fmt(_savedCount)} saved - ${fmt(_blacklistedCount)} blacklisted · ${fmt(_deletedCount)} deleted`;
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

// ── AI Scoring ────────────────────────────────────────────────────────────────

function _renderScoringButton(cb) {
  const status = cb && cb.status;
  if (!status) {
    return `<button class="nav-btn" id="ai-score-btn" onclick="runAiScoring()">&#10024; AI Score</button>`;
  }
  if (status === 'in_progress') {
    return `<span class="nav-btn disabled" id="ai-score-btn">Scoring&#8230;</span>`;
  }
  if (status === 'ended') {
    return `<span class="nav-btn disabled" id="ai-score-btn" title="AI scoring complete">Scored &#10003;</span>`;
  }
  if (status === 'error') {
    return `<button class="nav-btn" id="ai-score-btn" onclick="runAiScoring()" title="Previous attempt failed — click to retry">&#10024; Retry Score</button>`;
  }
  return '';
}

async function runAiScoring() {
  const btn = document.getElementById('ai-score-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    const res = await fetch(`/api/ai-score/${REPORT_PATH}`, { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      alert('AI Scoring error: ' + data.error);
      if (btn) { btn.disabled = false; btn.textContent = '✨ AI Score'; }
      return;
    }
    // Reload report to update button state and show pending columns
    loadReport();
  } catch (e) {
    alert('Network error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '✨ AI Score'; }
  }
}

function _startScoringPoll() {
  if (_scoringPollTimer) clearInterval(_scoringPollTimer);
  _scoringPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/ai-score/${REPORT_PATH}`);
      const data = await res.json();
      const status = data.claude_batch && data.claude_batch.status;
      if (status === 'ended' || status === 'error') {
        clearInterval(_scoringPollTimer);
        _scoringPollTimer = null;
        loadReport(); // Reload to show actual scores (or error state)
      }
    } catch (_) {}
  }, 30_000); // poll every 30 s
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
