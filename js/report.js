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

function renderReport({ video_info, comments, blacklist_count, saved_count, deleted_count }) {
  const vi = video_info || {};
  _videoInfo = vi;
  _blacklistedCount = blacklist_count || 0;
  _savedCount = saved_count || 0;
  _deletedCount = deleted_count || 0;
  const allComments = comments || [];
  _pendingCount = allComments.length;
  const channel = String(vi.channel || '');
  const cb = vi.claude_batch || null;
  // Detect partial scoring: status=ended but some comments still have rating=-1
  const hasUnscored = cb && cb.status === 'ended' &&
    allComments.some(c => !c.topic_rating || Number(c.topic_rating) < 1);

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
        ${_renderScoringButton(cb, hasUnscored)}
      </div>
      <div class="video-desc" id="video-desc">${esc(vi.description || '')}</div>
    </div>

    <!-- All Comments -->
    <div class="card">
      <div id="pane-all"></div>
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
      { id: 'topic_rating',     label: 'AIScore' },
      { id: 'topic_confidence', label: 'AIConf' },
      { id: 'like_count',       label: 'Likes' },
      { id: 'author',           label: 'Author' },
      { id: 'video',            label: 'Video' },
    ],
    colPrefKey: 'ytca_cols_report_all',
    defaultColPrefs: {
      topic_rating: scoringActive,
      topic_confidence: scoringActive,
      like_count: false,
      author: false,
      video: false,
    },
    scoringInProgress: cb && cb.status === 'in_progress',
    emptyMessage: 'No comments.',
    toolbarExtra: '<button class="btn btn-secondary" onclick="saveAllFiltered()" id="save-all-btn" style="white-space:nowrap">Save All</button><button class="btn btn-danger" onclick="showDeleteAllModal()" style="white-space:nowrap;border:1px solid rgba(255,45,45,0.3)">Delete All</button>',
    actions: [
      {
        label: '+',
        title: 'Save',
        className: 'btn-save',
        handler: async (comment, row, tm) => {
          try {
            await fetch('/api/comment/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ comment: _withContext(comment) }),
            });
            tm.removeRow(comment.id, row);
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

// ── AI Scoring ────────────────────────────────────────────────────────────────

function _renderScoringButton(cb, hasUnscored = false) {
  const status = cb && cb.status;
  let inner = '';
  if (!status) {
    inner = `<button class="nav-btn" id="ai-score-btn" onclick="runAiScoring()">&#10024; AI Score</button>`;
  } else if (status === 'in_progress') {
    inner = `<button class="btn-ai-refresh spinning" id="ai-score-check-btn" onclick="checkScoringNow()" title="AI scoring in progress — click to check now">&#10227;</button>`;
  } else if (status === 'ended') {
    if (hasUnscored) {
      inner = `<button class="nav-btn" id="ai-score-btn" onclick="runAiScoring()" title="Some comments were not scored — click to score remaining">&#10024; Score Remaining</button>`;
    } else {
      inner = `<span class="nav-btn disabled" id="ai-score-btn" title="AI scoring complete">Scored &#10003;</span>`;
    }
  } else if (status === 'partial_failure') {
    const unscored = cb.unscored_count ? ` (${cb.unscored_count} unscored)` : '';
    inner = `<button class="nav-btn btn-warning" id="ai-score-btn" onclick="runAiScoring()" title="Scoring partially failed${unscored} — click to retry remaining">&#9888; Partial Failure</button>`;
  } else if (status === 'error') {
    inner = `<button class="nav-btn" id="ai-score-btn" onclick="runAiScoring()" title="Previous attempt failed — click to retry">&#10024; Retry Score</button>`;
  }
  return `<span id="scoring-controls">${inner}</span>`;
}

function _updateScoringControls(cb, hasUnscored = false) {
  const el = document.getElementById('scoring-controls');
  if (el) el.outerHTML = _renderScoringButton(cb, hasUnscored);
}

async function runAiScoring() {
  const btn = document.getElementById('ai-score-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  let bodyHtml = '';
  let submitLabel = 'Start Scoring';
  let submitDisabled = false;

  try {
    const data = _allTable ? _allTable.data : [];
    const total = data.length;
    const scored = data.filter(c => Number(c.topic_rating) >= 1).length;
    const unscored = total - scored;

    if (unscored === 0 && scored === 0) {
      bodyHtml = `<p class="modal-desc"><strong>${total.toLocaleString()} comment${total !== 1 ? 's' : ''}</strong> will be submitted for AI scoring.</p>`;
    } else {
      if (unscored > 0) {
        bodyHtml += `<p class="modal-desc"><strong>${unscored.toLocaleString()} comment${unscored !== 1 ? 's' : ''}</strong> will be submitted for AI scoring.</p>`;
      }
      if (scored > 0) {
        bodyHtml += `<p class="modal-desc">Already scored: <strong>${scored.toLocaleString()}</strong> — will be skipped.</p>`;
      }
      submitLabel = unscored > 0 ? `Score ${unscored.toLocaleString()} Comments` : 'Nothing to score';
      submitDisabled = unscored === 0;
    }
    bodyHtml += `<p class="modal-desc" style="color:var(--text-3)">Scoring uses the Anthropic Batches API. Results are written back automatically when ready.</p>`;
  } finally {
    if (btn) { btn.disabled = false; }
  }

  showAiPromptModal({
    title: '✨ AI Score',
    bodyHtml,
    submitLabel,
    submitDisabled,
    onConfirm: async (keywords) => {
      if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
      try {
        const res = await fetch(`/api/ai-score/${REPORT_PATH}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords }),
        });
        const data = await res.json();
        if (data.error) {
          alert('AI Scoring error: ' + data.error);
          if (btn) { btn.disabled = false; }
          return;
        }
        _updateScoringControls({ status: 'in_progress' });
        if (_allTable) {
          _allTable.config.scoringInProgress = true;
          _allTable.colPrefs.topic_rating = true;
          _allTable.colPrefs.topic_confidence = true;
          localStorage.setItem(_allTable.config.colPrefKey, JSON.stringify(_allTable.colPrefs));
          _allTable.render();
        }
        _startScoringPoll();
      } catch (e) {
        alert('Network error: ' + e.message);
        if (btn) { btn.disabled = false; }
      }
    },
  });
}

async function checkScoringNow() {
  const btn = document.getElementById('ai-score-check-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    await fetch('/api/ai-score-poll', { method: 'POST' });
    const res = await fetch(`/api/ai-score/${REPORT_PATH}`);
    const data = await res.json();
    const cb = data.claude_batch;
    const status = cb && cb.status;
    if (status === 'ended' || status === 'error' || status === 'partial_failure') {
      if (_scoringPollTimer) { clearInterval(_scoringPollTimer); _scoringPollTimer = null; }
      await _applyFreshScores(cb);
    }
  } catch (e) {
    console.error('Check scoring error:', e);
  } finally {
    const checkBtn = document.getElementById('ai-score-check-btn');
    if (checkBtn) { checkBtn.disabled = false; checkBtn.innerHTML = '&#10227;'; }
  }
}

function _startScoringPoll() {
  if (_scoringPollTimer) clearInterval(_scoringPollTimer);
  _scoringPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/ai-score/${REPORT_PATH}`);
      const data = await res.json();
      const cb = data.claude_batch;
      const status = cb && cb.status;
      if (status === 'ended' || status === 'error' || status === 'partial_failure') {
        clearInterval(_scoringPollTimer);
        _scoringPollTimer = null;
        await _applyFreshScores(cb);
      }
    } catch (_) {}
  }, 30_000); // poll every 30 s
}

async function _applyFreshScores(cb) {
  try {
    const res = await fetch('/api/report-data/' + REPORT_PATH);
    if (!res.ok) return;
    const data = await res.json();
    const comments = data.comments || [];
    comments.forEach(c => {
      c._reportPath = REPORT_PATH;
      c._reportTitle = (data.video_info && data.video_info.title) || REPORT_PATH;
    });
    const hasUnscored = cb && cb.status === 'ended' &&
      comments.some(c => !c.topic_rating || Number(c.topic_rating) < 1);
    // Show scoring columns when we have results
    if (cb && cb.status === 'ended' && !hasUnscored && _allTable) {
      _allTable.colPrefs.topic_rating = true;
      _allTable.colPrefs.topic_confidence = true;
      localStorage.setItem(_allTable.config.colPrefKey,
        JSON.stringify(_allTable.colPrefs));
    }
    if (_allTable) _allTable.setData(comments);
    _updateScoringControls(cb, hasUnscored);
  } catch (_) {}
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

// ── Save All / Delete All ─────────────────────────────────────────────────────

async function saveAllFiltered() {
  if (!_allTable) return;
  const filtered = _allTable.getFilteredData();
  if (!filtered.length) return;

  const btn = document.getElementById('save-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = `Saving ${filtered.length}…`; }

  for (const comment of filtered) {
    try {
      await fetch('/api/comment/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: _withContext(comment) }),
      });
      _pendingCount = Math.max(0, _pendingCount - 1); _savedCount++;
    } catch (_) {}
  }

  // Reload report to reflect changes
  await loadReport();
  loadNavCounts();
}

function showDeleteAllModal() {
  if (!_allTable) return;
  const filtered = _allTable.getFilteredData();
  if (!filtered.length) return;

  const existing = document.getElementById('_ytca-delall-modal');
  if (existing) existing.remove();

  const count = filtered.length;
  const modal = document.createElement('div');
  modal.id = '_ytca-delall-modal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;width:92vw">
      <div class="modal-header">
        <span class="modal-title">Delete All Comments</span>
        <button class="modal-close" id="_da-close">&times;</button>
      </div>
      <p class="modal-desc">What should happen to all <strong>${count.toLocaleString()}</strong> filtered comment${count !== 1 ? 's' : ''}?</p>
      <div class="modal-actions">
        <button class="nav-btn" id="_da-cancel">Cancel</button>
        <button class="btn btn-secondary" id="_da-blacklist" style="white-space:nowrap">Move to Blacklist</button>
        <button class="btn btn-danger" id="_da-delete" style="border:1px solid rgba(255,45,45,0.3);white-space:nowrap">Move to Deleted</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('_da-close').onclick = close;
  document.getElementById('_da-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  document.getElementById('_da-blacklist').onclick = () => { close(); _bulkMove('/api/comment/blacklist'); };
  document.getElementById('_da-delete').onclick = () => { close(); _bulkMove('/api/comment/delete'); };
}

async function _bulkMove(endpoint) {
  if (!_allTable) return;
  const filtered = _allTable.getFilteredData();
  for (const comment of filtered) {
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: _withContext(comment) }),
      });
    } catch (_) {}
  }
  await loadReport();
  loadNavCounts();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('_ytca-delall-modal')?.remove();
});

// ── Init ──────────────────────────────────────────────────────────────────────

// Clean up polling timers on page navigation
window.addEventListener('beforeunload', () => {
  if (_scoringPollTimer) { clearInterval(_scoringPollTimer); _scoringPollTimer = null; }
});

loadReport();
