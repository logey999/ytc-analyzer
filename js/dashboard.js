// ── Dashboard: Reports list and analysis control ────────────────────────────

// ── AI Scoring mode toggle ───────────────────────────────────────────────────

function getAiMode() {
  return localStorage.getItem('aiScoringMode') || 'manual';
}

function setAiMode(mode) {
  if (mode === 'auto' && getAiMode() !== 'auto') {
    const container = document.getElementById('auto-ai-keywords');
    const kws = getAiKeywords();
    container.innerHTML = kws.map(kw => `<span class="kw-tag">${esc(kw)}</span>`).join('');
    document.getElementById('auto-ai-modal').classList.add('open');
    return;
  }
  localStorage.setItem('aiScoringMode', mode);
  _renderAiModeButtons();
}

function confirmAutoAi() {
  document.getElementById('auto-ai-modal').classList.remove('open');
  localStorage.setItem('aiScoringMode', 'auto');
  _renderAiModeButtons();
}

function closeAutoAiModal(event) {
  if (event && event.target !== document.getElementById('auto-ai-modal')) return;
  document.getElementById('auto-ai-modal').classList.remove('open');
}

function _renderAiModeButtons() {
  const mode = getAiMode();
  document.getElementById('ai-mode-manual')?.classList.toggle('active', mode === 'manual');
  document.getElementById('ai-mode-auto')?.classList.toggle('active', mode === 'auto');
}

async function triggerAutoAiScore(reportPath) {
  try {
    await fetch('/api/ai-score/' + reportPath, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: getAiKeywords() }) });
  } catch (_) { /* best-effort */ }
}

// ── State ─────────────────────────────────────────────────────────────────────

const _jobs = new Map();
let _lastReports = [];
let _sortBy  = 'date'; // 'date' | 'name'
let _sortDir = 'desc';
let _reportPage = 0;
const _reportsPerPage = 20;


// ── Load reports ──────────────────────────────────────────────────────────────

async function loadReports(newPath = null) {
  try {
    const res = await fetch('/api/reports');
    _lastReports = await res.json();
    renderReports(_lastReports, newPath);
    loadNavCounts();
  } catch (e) {
    document.getElementById('panel-reports').innerHTML =
      '<div class="reports-empty">Failed to load reports.</div>';
  }
}

function sortReports(reports) {
  return [...reports].sort((a, b) => {
    let va, vb;
    if (_sortBy === 'name') {
      va = (a.title || '').toLowerCase();
      vb = (b.title || '').toLowerCase();
    } else {
      // Use full ISO datetime for precise ordering; fall back to date string
      va = a.created_at || a.date || '';
      vb = b.created_at || b.date || '';
    }
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return _sortDir === 'asc' ? cmp : -cmp;
  });
}

function setSort(by) {
  if (_sortBy === by) {
    _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
  } else {
    _sortBy  = by;
    _sortDir = by === 'date' ? 'desc' : 'asc';
  }
  _reportPage = 0;
  updateSortButtons();
  renderReports(_lastReports);
}

function updateSortButtons() {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    const by = btn.dataset.sort;
    const active = by === _sortBy;
    btn.classList.toggle('sort-btn-active', active);
    btn.textContent = btn.dataset.label + (active ? (_sortDir === 'desc' ? ' ↓' : ' ↑') : '');
  });
}

function renderReports(reports, newPath = null) {
  const list = document.getElementById('panel-reports');

  // Preserve active (running/cached) job cards — they live at the top of the list
  const activeJobCards = [...list.querySelectorAll('.job-card')].filter(el => {
    const jobKey = el.id.replace('job-', '');
    const job = _jobs.get(jobKey);
    return job && (job.status === 'running' || job.status === 'cached');
  });

  // Remove everything that isn't an active job card
  [...list.children].forEach(c => {
    if (!c.classList.contains('job-card')) c.remove();
  });

  if (!reports.length && !activeJobCards.length) {
    list.innerHTML = '<div class="reports-empty">No reports yet. Analyze a video to get started.</div>';
    updateReportPagination(0);
    return;
  }

  const sorted = sortReports(reports);
  const total = sorted.length;
  const start = _reportPage * _reportsPerPage;
  const page = sorted.slice(start, start + _reportsPerPage);

  page.forEach(r => {
    const isNew = newPath !== null && r.path === newPath;
    list.insertAdjacentHTML('beforeend', buildReportCardHTML(r, isNew));
  });

  updateReportPagination(total);
}

function updateReportPagination(total) {
  const el = document.getElementById('reports-pagination');
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(total / _reportsPerPage));
  if (_reportPage >= totalPages) _reportPage = totalPages - 1;
  if (total <= _reportsPerPage) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';
  const start = _reportPage * _reportsPerPage + 1;
  const end = Math.min((_reportPage + 1) * _reportsPerPage, total);
  el.querySelector('.pg-info').textContent = `${start}–${end} of ${total}`;
  el.querySelector('.pg-prev').disabled = _reportPage === 0;
  el.querySelector('.pg-next').disabled = _reportPage >= totalPages - 1;
}

function reportPagePrev() {
  if (_reportPage > 0) { _reportPage--; renderReports(_lastReports); }
}

function reportPageNext() {
  const totalPages = Math.ceil(_lastReports.length / _reportsPerPage);
  if (_reportPage < totalPages - 1) { _reportPage++; renderReports(_lastReports); }
}

function buildReportCardHTML(r, isNew = false) {
  const thumb = r.thumbnail
    ? `<img class="report-card-thumb" src="${escAttr(r.thumbnail)}" alt="" loading="lazy" onerror="this.replaceWith(makePlaceholder())">`
    : `<div class="report-card-thumb-placeholder">&#9654;</div>`;

  const date  = r.date       ? r.date : '—';
  const views = r.view_count ? Number(r.view_count).toLocaleString() + ' views' : '';

  const n  = Number(r.comment_count || 0).toLocaleString();
  const k  = Number(r.saved_count    || 0).toLocaleString();
  const bl = Number(r.blacklist_count|| 0).toLocaleString();
  const dl = Number(r.deleted_count  || 0).toLocaleString();
  const statsLabel = r.comment_count != null
    ? `${n} pending · ${k} saved - ${bl} blacklisted · ${dl} deleted`
    : '';

  const newClass = isNew ? ' report-card-new' : '';
  const pathAttr = escAttr(r.path);
  const titleAttr = escAttr(r.title || r.path);

  const aiIcon = r.ai_score_status === 'ended'
    ? `<span class="report-card-ai-slot ai-scoring-badge ai-scoring-done" title="AI scored">&#10024;</span>`
    : r.ai_score_status === 'in_progress'
      ? `<button class="report-card-ai-slot btn-ai-refresh spinning" title="AI scoring in progress — click to check now" data-path="${pathAttr}" onclick="checkDashboardScoring(event, this)">&#10227;</button>`
      : `<span class="report-card-ai-slot"></span>`;

  return `<a class="report-card${newClass}" href="/report?path=${encodeURIComponent(r.path)}">
    <button class="report-card-delete-btn" title="Delete report"
      data-path="${pathAttr}" data-title="${titleAttr}"
      onclick="openDeleteReportModal(event, this)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    </button>
    ${aiIcon}
    ${thumb}
    <div class="report-card-body">
      <div class="report-card-title">${esc(r.title || r.path)}</div>
      <div class="report-card-meta">
        <span>${esc(r.channel)}</span>
        ${date       ? `<span>&#183; ${esc(date)}</span>`       : ''}
        ${views      ? `<span>&#183; ${esc(views)}</span>`      : ''}
        ${statsLabel ? `<span>&#183; ${esc(statsLabel)}</span>` : ''}
      </div>
    </div>
  </a>`;
}

function makePlaceholder() {
  const d = document.createElement('div');
  d.className = 'report-card-thumb-placeholder';
  d.innerHTML = '&#9654;';
  return d;
}

// ── Job cards (in-list) ───────────────────────────────────────────────────────

function updateAnalyzeBtn() {
  const btn = document.getElementById('analyze-btn');
  const full = _jobs.size >= CONFIG.ui.maxJobs;
  btn.disabled = full;
  btn.innerHTML = full ? `&#9654;&nbsp; Queue full (${CONFIG.ui.maxJobs})` : '&#9654;&nbsp; Analyze';
}

function createJobCard(jobKey, urlDisplay) {
  // Clear the empty-state placeholder if present
  const empty = document.querySelector('#panel-reports .reports-empty');
  if (empty) empty.remove();

  const card = document.createElement('div');
  card.className = 'report-card job-card report-card-new';
  card.id = 'job-' + jobKey;
  card.innerHTML = `
    <div class="report-card-thumb--job">
      <div class="spinner"></div>
    </div>
    <div class="report-card-body">
      <div class="report-card-title">${esc(urlDisplay)}</div>
      <div class="report-card-meta">
        <span class="job-phase-label">Fetching</span>
        <span class="job-status-text">Starting…</span>
      </div>
      <div class="job-progress-track"><div class="job-progress-bar" style="width:0%"></div></div>
    </div>`;

  document.getElementById('panel-reports').prepend(card);
  card.addEventListener('animationend', () => card.classList.remove('report-card-new'), { once: true });
  return card;
}

function setJobRunning(jobKey, msg, phase, pct) {
  const card = document.getElementById('job-' + jobKey);
  if (!card) return;
  card.querySelector('.job-status-text').textContent = msg;

  const phaseEl = card.querySelector('.job-phase-label');
  if (phaseEl && phase) {
    phaseEl.textContent = phase === 'classify' ? 'Classifying' : 'Fetching';
    phaseEl.dataset.phase = phase;
  }

  const bar = card.querySelector('.job-progress-bar');
  if (bar && pct != null) {
    // Fetch phase maps to 0–70% of the bar; classify maps to 70–100%
    const barPct = phase === 'classify'
      ? 70 + Math.round(pct * 0.30)
      : Math.round(pct * 0.70);
    bar.style.width = barPct + '%';
  }
}

function setJobCached(jobKey, title, metaText) {
  const card = document.getElementById('job-' + jobKey);
  if (!card) return;
  card.classList.add('job-cached');
  card.querySelector('.report-card-title').textContent = title;

  const statusEl = card.querySelector('.job-status-text');
  statusEl.className = 'job-status-text status-cache';
  statusEl.textContent = metaText;

  card.querySelector('.report-card-thumb--job').innerHTML = `
    <button class="job-cache-btn job-cache-use" onclick="useCached('${jobKey}')">Use Cached</button>
    <button class="job-cache-btn job-cache-fresh" onclick="fetchFresh('${jobKey}')">Fetch Fresh</button>`;
}

function setJobDone(jobKey, title, reportPath) {
  const card = document.getElementById('job-' + jobKey);
  if (!card) return;

  const job = _jobs.get(jobKey);
  if (job) { job.status = 'done'; job.reportPath = reportPath; }

  // Remove cached buttons from thumb if present, show checkmark
  card.querySelector('.report-card-thumb--job').innerHTML = '<span class="job-done-check">&#10003;</span>';

  card.classList.remove('job-cached');
  card.classList.add('job-done');

  if (title) card.querySelector('.report-card-title').textContent = title;

  const meta = card.querySelector('.report-card-meta');
  meta.innerHTML = `<span class="job-status-text status-done">Done</span>`;

  // Make card clickable while the temp card is still visible
  card.style.cursor = 'pointer';
  card.onclick = (e) => {
    if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
    window.location.href = '/report?path=' + encodeURIComponent(reportPath);
  };

  // Auto AI scoring
  if (getAiMode() === 'auto') triggerAutoAiScore(reportPath);

  // After a short pause, slide the temp card out, then swap in the real card
  setTimeout(() => {
    card.classList.add('report-card-exit');
    card.addEventListener('animationend', () => {
      loadReports(reportPath);
    }, { once: true });
  }, 1200);

  updateAnalyzeBtn();
}

function setJobError(jobKey, msg) {
  const card = document.getElementById('job-' + jobKey);
  if (!card) return;
  card.classList.remove('job-cached');
  card.classList.add('job-error');
  card.querySelector('.report-card-thumb--job').innerHTML = '<span style="font-size:1.1rem;color:var(--red)">&#10007;</span>';

  const meta = card.querySelector('.report-card-meta');
  meta.innerHTML = `<span class="job-status-text status-error">${esc(msg)}</span>`;
}

// ── Analyze flow ──────────────────────────────────────────────────────────────

async function startAnalyze() {
  const input = document.getElementById('url-input');
  const url = input.value.trim();
  if (!url || _jobs.size >= CONFIG.ui.maxJobs) return;
  input.value = '';

  const jobKey = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const urlDisplay = url.length > 55 ? url.slice(0, 52) + '…' : url;
  const card = createJobCard(jobKey, urlDisplay);
  _jobs.set(jobKey, { jobKey, url, status: 'running', el: card, reportPath: null });
  updateAnalyzeBtn();

  try {
    const res  = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url, filter_settings: getFilterSettings()}),
    });
    const data = await res.json();

    if (data.error) {
      _jobs.get(jobKey).status = 'error';
      setJobError(jobKey, data.error);
      updateAnalyzeBtn();
      return;
    }
    if (data.existing) {
      const e = data.existing;
      _jobs.get(jobKey).status = 'cached';
      _jobs.get(jobKey).reportPath = e.path;
      setJobCached(jobKey, e.title || url,
        `Cached · ${Number(e.comment_count).toLocaleString()} comments · ${e.date}`);
      updateAnalyzeBtn();
      return;
    }
    if (data.job_id) {
      setJobRunning(jobKey, 'Fetching comments…');
      streamProgress(jobKey, data.job_id);
    }
  } catch (err) {
    _jobs.get(jobKey).status = 'error';
    setJobError(jobKey, 'Network error: ' + err.message);
    updateAnalyzeBtn();
  }
}

function useCached(jobKey) {
  const job = _jobs.get(jobKey);
  if (!job || !job.reportPath) return;
  job.status = 'done';
  setJobDone(jobKey, null, job.reportPath);
}

async function fetchFresh(jobKey) {
  const job = _jobs.get(jobKey);
  if (!job) return;
  const url = job.url;
  job.status = 'running';

  const card = document.getElementById('job-' + jobKey);
  card.classList.remove('job-cached', 'job-done', 'job-error');
  card.querySelector('.report-card-thumb--job').innerHTML = '<div class="spinner"></div>';
  card.querySelector('.job-status-text').className = 'job-status-text';
  card.querySelector('.job-status-text').textContent = 'Starting fresh fetch…';

  try {
    const res  = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url, force: true, filter_settings: getFilterSettings()}),
    });
    const data = await res.json();
    if (data.error) {
      job.status = 'error';
      setJobError(jobKey, data.error);
      updateAnalyzeBtn();
      return;
    }
    if (data.job_id) streamProgress(jobKey, data.job_id);
  } catch (err) {
    job.status = 'error';
    setJobError(jobKey, 'Network error: ' + err.message);
    updateAnalyzeBtn();
  }
}

function streamProgress(jobKey, serverId) {
  const es = new EventSource('/api/progress/' + serverId);
  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.ping) return;
      if (msg.error) {
        const job = _jobs.get(jobKey);
        if (job) job.status = 'error';
        setJobError(jobKey, msg.error);
        es.close(); updateAnalyzeBtn(); return;
      }
      if (msg.msg) setJobRunning(jobKey, msg.msg, msg.phase, msg.pct);
      if (msg.done) {
        setJobDone(jobKey, msg.title || null, msg.report_path);
        es.close();
      }
    } catch (_) {}
  };
  es.onerror = () => {
    const job = _jobs.get(jobKey);
    if (job && job.status === 'running') {
      job.status = 'error';
      setJobError(jobKey, 'Connection lost.');
    }
    es.close(); updateAnalyzeBtn();
  };
}

// ── Dashboard AI scoring check ───────────────────────────────────────────

async function checkDashboardScoring(event, btn) {
  event.preventDefault();
  event.stopPropagation();
  btn.disabled = true;
  try {
    await fetch('/api/ai-score-poll', { method: 'POST' });
    loadReports();
  } catch (_) {} finally {
    btn.disabled = false;
  }
}

// ── Keyboard support ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('url-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startAnalyze();
  });
});

// ── Delete report ─────────────────────────────────────────────────────────────

let _deleteReportPath = null;

function openDeleteReportModal(event, btn) {
  event.preventDefault();
  event.stopPropagation();
  _deleteReportPath = btn.dataset.path;
  document.getElementById('delete-report-title').textContent = btn.dataset.title;
  document.getElementById('delete-report-modal').classList.add('open');
}

function closeDeleteReportModal(event) {
  if (event && event.target !== document.getElementById('delete-report-modal')) return;
  document.getElementById('delete-report-modal').classList.remove('open');
  _deleteReportPath = null;
}

async function confirmDeleteReport(disposition) {
  if (!_deleteReportPath) return;
  const path = _deleteReportPath;
  document.getElementById('delete-report-modal').classList.remove('open');
  _deleteReportPath = null;

  try {
    const res = await fetch('/api/report/' + path, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposition }),
    });
    if (!res.ok && res.headers.get('content-type')?.includes('text/html')) {
      alert(`Delete failed: HTTP ${res.status} — is the server restarted?`);
      return;
    }
    const data = await res.json();
    if (data.error) {
      alert('Delete failed: ' + data.error);
      return;
    }
    // Animate the card out, then reload
    const card = [...document.querySelectorAll('.report-card')].find(el => {
      const btn = el.querySelector('.report-card-delete-btn');
      return btn && btn.dataset.path === path;
    });
    if (card) {
      card.classList.add('report-card-exit');
      card.addEventListener('animationend', () => loadReports(), { once: true });
    } else {
      loadReports();
    }
    loadNavCounts();
  } catch (err) {
    alert('Network error: ' + err.message);
  }
}


// ── Initialization ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  updateSortButtons();
  _renderAiModeButtons();
  loadReports();
});

// Refresh report counts when returning via browser back/forward (bfcache restore)
window.addEventListener('pageshow', (e) => {
  if (e.persisted) loadReports();
});
