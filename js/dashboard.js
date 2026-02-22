// ── State ─────────────────────────────────────────────────────────────────────

const MAX_JOBS = 10;
// Map<jobKey, {jobKey, url, status, el, reportPath}>
// status: 'cached' | 'running' | 'done' | 'error'
const _jobs = new Map();

// ── Panel switching ───────────────────────────────────────────────────────────

let _aggregateLoaded = false;

function switchPanel(name) {
  document.getElementById('panel-reports').style.display   = name === 'reports'   ? '' : 'none';
  document.getElementById('panel-aggregate').style.display = name === 'aggregate' ? '' : 'none';
  document.getElementById('ptab-reports').classList.toggle('active',   name === 'reports');
  document.getElementById('ptab-aggregate').classList.toggle('active', name === 'aggregate');
  if (name === 'aggregate' && !_aggregateLoaded) loadAggregate();
}

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
  const count = document.getElementById('reports-count');

  count.textContent = reports.length;

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

function activeJobCount() {
  let n = 0;
  for (const j of _jobs.values()) {
    if (j.status === 'running' || j.status === 'cached') n++;
  }
  return n;
}

function updateAnalyzeBtn() {
  const btn = document.getElementById('analyze-btn');
  const full = _jobs.size >= MAX_JOBS;
  btn.disabled = full;
  btn.innerHTML = full ? `&#9654;&nbsp; Queue full (${MAX_JOBS})` : '&#9654;&nbsp; Analyze';
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

  // Add action buttons
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

  // Add view link
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
  if (!url || _jobs.size >= MAX_JOBS) return;

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
      const meta = `Cached · ${Number(e.comment_count).toLocaleString()} comments · ${e.date}`;
      setJobCached(jobKey, e.title || url, meta);
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

  // Remove cache buttons, mark as done
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

  // Reset row UI
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
    if (data.job_id) {
      streamProgress(jobKey, data.job_id);
    }
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
        es.close();
        updateAnalyzeBtn();
        return;
      }
      if (msg.msg) {
        setJobRunning(jobKey, msg.msg);
      }
      if (msg.done) {
        const job = _jobs.get(jobKey);
        if (job) {
          job.status = 'done';
          job.reportPath = msg.report_path;
        }
        setJobDone(jobKey, msg.title || null, msg.report_path);
        es.close();
        updateAnalyzeBtn();
        loadReports();
      }
    } catch (_) {}
  };

  es.onerror = () => {
    const job = _jobs.get(jobKey);
    if (job && job.status === 'running') {
      job.status = 'error';
      setJobError(jobKey, 'Connection lost.');
    }
    es.close();
    updateAnalyzeBtn();
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

document.getElementById('url-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startAnalyze();
});

// ── Aggregate ─────────────────────────────────────────────────────────────────

const AGG_PAGE_SIZE = 200;
let _aggComments = [];
let _aggPage = 0;

async function loadAggregate() {
  const pane = document.getElementById('panel-aggregate');
  pane.innerHTML = '<div class="reports-empty">Loading all comments…</div>';

  try {
    const res = await fetch('/api/reports');
    const reports = await res.json();

    if (!reports.length) {
      pane.innerHTML = '<div class="reports-empty">No reports yet.</div>';
      return;
    }

    // Fetch all report data in parallel
    const results = await Promise.allSettled(
      reports.map(r =>
        fetch('/api/report-data/' + encodeURIComponent(r.path))
          .then(r2 => r2.json())
          .then(data => ({ ...data, _reportPath: r.path, _reportTitle: r.title || r.path }))
      )
    );

    const merged = [];
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { comments, _reportPath, _reportTitle } = result.value;
      if (!Array.isArray(comments)) continue;
      for (const c of comments) {
        merged.push({ ...c, _reportPath, _reportTitle });
      }
    }

    // Sort by like count descending
    merged.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));

    _aggComments = merged;
    _aggPage = 0;
    _aggregateLoaded = true;
    renderAggPage(0);

  } catch (e) {
    pane.innerHTML = `<div class="reports-empty">Failed to load: ${esc(e.message)}</div>`;
  }
}

function renderAggPage(page) {
  const total = _aggComments.length;
  const totalPages = Math.max(1, Math.ceil(total / AGG_PAGE_SIZE));
  _aggPage = Math.max(0, Math.min(page, totalPages - 1));
  const start = _aggPage * AGG_PAGE_SIZE;
  const slice = _aggComments.slice(start, start + AGG_PAGE_SIZE);

  const info = `Page ${_aggPage + 1} of ${totalPages} &nbsp;·&nbsp; ${total.toLocaleString()} total comments`;
  const atFirst = _aggPage === 0;
  const atLast  = _aggPage >= totalPages - 1;

  const rows = slice.map((c, i) => {
    const rank = start + i + 1;
    return `<tr>
      <td class="rank">${rank}</td>
      <td class="col-video"><a href="/report?path=${encodeURIComponent(c._reportPath)}" title="${escAttr(c._reportTitle)}">${esc(truncate(c._reportTitle, 28))}</a></td>
      <td class="col-author">${esc(c.author)}</td>
      <td class="col-likes">${fmtN(c.like_count)}</td>
      <td class="col-text">${esc(c.text)}</td>
    </tr>`;
  }).join('');

  document.getElementById('panel-aggregate').innerHTML = `
    <div class="agg-toolbar">
      <span class="pg-info">${info}</span>
      <div style="display:flex;gap:8px">
        <button class="pg-btn" onclick="renderAggPage(_aggPage-1)" ${atFirst ? 'disabled' : ''}>&#8592; Prev</button>
        <button class="pg-btn" onclick="renderAggPage(_aggPage+1)" ${atLast  ? 'disabled' : ''}>Next &#8594;</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Video</th><th>Author</th><th>Likes</th><th>Comment</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="agg-toolbar">
      <span class="pg-info">${info}</span>
      <div style="display:flex;gap:8px">
        <button class="pg-btn" onclick="renderAggPage(_aggPage-1)" ${atFirst ? 'disabled' : ''}>&#8592; Prev</button>
        <button class="pg-btn" onclick="renderAggPage(_aggPage+1)" ${atLast  ? 'disabled' : ''}>Next &#8594;</button>
      </div>
    </div>`;
}

function truncate(s, n) {
  return String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s);
}

function fmtN(n) {
  const num = Number(n);
  return isNaN(num) ? '0' : num.toLocaleString();
}

loadReports();
