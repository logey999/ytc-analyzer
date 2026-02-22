// ── Dashboard: Reports list and analysis control ────────────────────────────

// ── State ─────────────────────────────────────────────────────────────────────

const _jobs = new Map();

// ── Load reports on startup ───────────────────────────────────────────────────

async function loadReports() {
  try {
    const res = await fetch('/api/reports');
    const reports = await res.json();
    renderReports(reports);
  } catch (e) {
    document.getElementById('panel-reports').innerHTML =
      '<div class="reports-empty">Failed to load reports.</div>';
  }
}

function renderReports(reports) {
  const list = document.getElementById('panel-reports');

  if (!reports.length) {
    list.innerHTML = '<div class="reports-empty">No reports yet. Analyze a video to get started.</div>';
    return;
  }

  list.innerHTML = reports.map(r => {
    const thumb = r.thumbnail
      ? `<img class="report-card-thumb" src="${escAttr(r.thumbnail)}" alt="" loading="lazy" onerror="this.replaceWith(makePlaceholder())">`
      : `<div class="report-card-thumb-placeholder">&#9654;</div>`;

    const date     = r.date  ? r.date : '—';
    const views    = r.view_count    ? Number(r.view_count).toLocaleString()    + ' views'    : '';
    const comments = r.comment_count ? Number(r.comment_count).toLocaleString() + ' comments' : '';

    return `<a class="report-card" href="/report?path=${encodeURIComponent(r.path)}">
      ${thumb}
      <div class="report-card-body">
        <div class="report-card-title">${esc(r.title || r.path)}</div>
        <div class="report-card-meta">
          <span>${esc(r.channel)}</span>
          ${date     ? `<span>&#183; ${esc(date)}</span>`     : ''}
          ${views    ? `<span>&#183; ${esc(views)}</span>`    : ''}
          ${comments ? `<span>&#183; ${esc(comments)}</span>` : ''}
        </div>
      </div>
      <span class="report-card-arrow">&#8594;</span>
    </a>`;
  }).join('');
}

function makePlaceholder() {
  const d = document.createElement('div');
  d.className = 'report-card-thumb-placeholder';
  d.innerHTML = '&#9654;';
  return d;
}

// ── Job rows ──────────────────────────────────────────────────────────────────

function updateAnalyzeBtn() {
  const btn = document.getElementById('analyze-btn');
  const full = _jobs.size >= CONFIG.ui.maxJobs;
  btn.disabled = full;
  btn.innerHTML = full ? `&#9654;&nbsp; Queue full (${CONFIG.ui.maxJobs})` : '&#9654;&nbsp; Analyze';
}

function showJobsArea() {
  document.getElementById('jobs-area').style.display = 'flex';
}

function createJobRow(jobKey, urlDisplay) {
  showJobsArea();
  const row = document.createElement('div');
  row.className = 'job-row';
  row.id = 'job-' + jobKey;
  row.innerHTML = `
    <div class="job-icon"><div class="spinner"></div></div>
    <div class="job-body">
      <div class="job-title">${esc(urlDisplay)}</div>
      <div class="job-status">Starting…</div>
    </div>`;
  document.getElementById('jobs-list').prepend(row);
  return row;
}

function setJobRunning(jobKey, msg) {
  const row = document.getElementById('job-' + jobKey);
  if (!row) return;
  row.querySelector('.job-status').textContent = msg;
  row.querySelector('.job-status').className = 'job-status';
}

function setJobCached(jobKey, title, metaText) {
  const row = document.getElementById('job-' + jobKey);
  if (!row) return;
  row.className = 'job-row job-cached';
  row.querySelector('.job-icon').innerHTML = '&#128190;';
  row.querySelector('.job-title').textContent = title;
  const statusEl = row.querySelector('.job-status');
  statusEl.className = 'job-status status-cache';
  statusEl.textContent = metaText;
  const btns = document.createElement('div');
  btns.className = 'job-cache-btns';
  btns.innerHTML = `
    <button class="btn-xs btn-xs-secondary" onclick="useCached('${jobKey}')">Use Cached</button>
    <button class="btn-xs btn-xs-primary"   onclick="fetchFresh('${jobKey}')">Fetch Fresh</button>`;
  row.querySelector('.job-body').appendChild(btns);
}

function setJobDone(jobKey, title, reportPath) {
  const row = document.getElementById('job-' + jobKey);
  if (!row) return;
  row.className = 'job-row job-done';
  row.querySelector('.job-icon').innerHTML = '&#10003;';
  if (title) row.querySelector('.job-title').textContent = title;
  const statusEl = row.querySelector('.job-status');
  statusEl.className = 'job-status status-done';
  statusEl.textContent = 'Done';
  const link = document.createElement('a');
  link.className = 'job-view-link';
  link.href = '/report?path=' + encodeURIComponent(reportPath);
  link.textContent = 'View →';
  row.appendChild(link);
}

function setJobError(jobKey, msg) {
  const row = document.getElementById('job-' + jobKey);
  if (!row) return;
  row.className = 'job-row job-error';
  row.querySelector('.job-icon').innerHTML = '&#10007;';
  const statusEl = row.querySelector('.job-status');
  statusEl.className = 'job-status status-error';
  statusEl.textContent = msg;
}

// ── Analyze flow ──────────────────────────────────────────────────────────────

async function startAnalyze() {
  const input = document.getElementById('url-input');
  const url = input.value.trim();
  if (!url || _jobs.size >= CONFIG.ui.maxJobs) return;
  input.value = '';

  const jobKey = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const urlDisplay = url.length > 45 ? url.slice(0, 42) + '…' : url;
  const row = createJobRow(jobKey, urlDisplay);
  _jobs.set(jobKey, {jobKey, url, status: 'running', el: row, reportPath: null});
  updateAnalyzeBtn();

  try {
    const res  = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url}),
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
  const row = document.getElementById('job-' + jobKey);
  const btns = row.querySelector('.job-cache-btns');
  if (btns) btns.remove();
  row.className = 'job-row job-done';
  row.querySelector('.job-icon').innerHTML = '&#10003;';
  const statusEl = row.querySelector('.job-status');
  statusEl.className = 'job-status status-done';
  statusEl.textContent = 'Done';
  const link = document.createElement('a');
  link.className = 'job-view-link';
  link.href = '/report?path=' + encodeURIComponent(job.reportPath);
  link.textContent = 'View →';
  row.appendChild(link);
  updateAnalyzeBtn();
}

async function fetchFresh(jobKey) {
  const job = _jobs.get(jobKey);
  if (!job) return;
  const url = job.url;
  job.status = 'running';
  const row = document.getElementById('job-' + jobKey);
  row.className = 'job-row';
  row.querySelector('.job-icon').innerHTML = '<div class="spinner"></div>';
  const btns = row.querySelector('.job-cache-btns');
  if (btns) btns.remove();
  const statusEl = row.querySelector('.job-status');
  statusEl.className = 'job-status';
  statusEl.textContent = 'Starting fresh fetch…';

  try {
    const res  = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url, force: true}),
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
      if (msg.msg) setJobRunning(jobKey, msg.msg);
      if (msg.done) {
        const job = _jobs.get(jobKey);
        if (job) { job.status = 'done'; job.reportPath = msg.report_path; }
        setJobDone(jobKey, msg.title || null, msg.report_path);
        es.close(); updateAnalyzeBtn(); loadReports(); updateQuotaDisplay();
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

// ── Keyboard support ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('url-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startAnalyze();
  });
});

// ── API Quota tracking ────────────────────────────────────────────────────────

async function updateQuotaDisplay() {
  try {
    const res = await fetch('/api/quota');
    const quota = await res.json();
    const display = document.getElementById('quota-display');
    if (display) {
      display.textContent = `(${quota.used.toLocaleString()} / ${quota.limit.toLocaleString()} units)`;
      display.classList.remove('quota-low', 'quota-critical');
      if (quota.remaining < 2000) display.classList.add('quota-low');
      if (quota.remaining < 500) display.classList.add('quota-critical');
    }
  } catch (e) {
    console.error('Failed to fetch quota:', e);
  }
}

// ── Initialization ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadReports();
  updateQuotaDisplay();
});
