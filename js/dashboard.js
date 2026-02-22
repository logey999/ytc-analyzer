// ── State ─────────────────────────────────────────────────────────────────────

const MAX_JOBS = 10;
const _jobs = new Map();

// ── Panel switching ───────────────────────────────────────────────────────────

let _aggregateLoaded = false;
let _ideasLoaded     = false;
let _blacklistLoaded = false;
let _deletedLoaded   = false;

let _ideasComments     = [];
let _blacklistComments = [];
let _deletedComments   = [];

let _ideaSortCol      = 'like_count'; let _ideaSortDir      = 'desc';
let _aggSortCol       = 'like_count'; let _aggSortDir       = 'desc';
let _blacklistSortCol = 'like_count'; let _blacklistSortDir = 'desc';
let _deletedSortCol   = 'like_count'; let _deletedSortDir   = 'desc';

const PANELS = ['reports', 'aggregate', 'ideas', 'blacklist', 'deleted'];

function switchPanel(name) {
  PANELS.forEach(p => {
    document.getElementById('panel-' + p).style.display = (p === name) ? '' : 'none';
    document.getElementById('ptab-'  + p).classList.toggle('active', p === name);
  });
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.style.display = (name === 'reports') ? '' : 'none';
  const panel = document.querySelector('.reports-panel');
  if (panel) panel.classList.toggle('panel-fullwidth', name !== 'reports');
  if (name === 'aggregate' && !_aggregateLoaded) loadAggregate();
  if (name === 'ideas'     && !_ideasLoaded)     loadIdeas();
  if (name === 'blacklist' && !_blacklistLoaded) loadBlacklist();
  if (name === 'deleted'   && !_deletedLoaded)   loadDeleted();
}

// ── Tab counts ────────────────────────────────────────────────────────────────

function setTabCount(panel, n) {
  const el = document.getElementById(panel + '-count');
  if (el) el.textContent = (typeof n === 'number' && n > 0) ? n.toLocaleString() : '—';
}

function updateTabCounts() {
  setTabCount('agg',       _aggComments.length);
  setTabCount('ideas',     _ideasComments.length);
  setTabCount('blacklist', _blacklistComments.length);
  setTabCount('deleted',   _deletedComments.length);
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
  setTabCount('reports', reports.length);

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

function truncate(s, n) {
  return String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s);
}

function fmtN(n) {
  const num = Number(n);
  return isNaN(num) ? '0' : num.toLocaleString();
}

document.getElementById('url-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startAnalyze();
});

// ── Row removal animation ──────────────────────────────────────────────────────

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

// ── Shared action helpers ─────────────────────────────────────────────────────

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

function _removeFromList(list, id) {
  const idx = list.findIndex(c => c.id === id);
  if (idx >= 0) list.splice(idx, 1);
}

function _addToListIfLoaded(list, loaded, comment) {
  if (!loaded || !comment) return;
  if (!list.some(c => c.id === comment.id)) list.unshift(comment);
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

const AGG_PAGE_SIZE = 100;
let _aggComments = [];
let _aggPage = 0;
let _aggColPrefs = JSON.parse(localStorage.getItem('ytca_cols_agg') || '{}');

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
      for (const c of comments) merged.push({ ...c, _reportPath, _reportTitle });
    }

    merged.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
    _aggComments = merged;
    _aggPage = 0;
    _aggregateLoaded = true;
    setTabCount('agg', merged.length);
    renderAggPage(0);

  } catch (e) {
    pane.innerHTML = `<div class="reports-empty">Failed to load: ${esc(e.message)}</div>`;
  }
}

function buildColSelector(cols, prefs, toggleFn) {
  const checkboxes = cols.map(c => `
    <label>
      <input type="checkbox" data-col="${c.id}" ${prefs[c.id] !== false ? 'checked' : ''}
        onchange="${toggleFn}('${c.id}', this.checked)">
      ${c.label}
    </label>`).join('');
  return `<div class="col-selector"><span class="col-selector-label">Columns:</span>${checkboxes}</div>`;
}

const COL_DEFS = [
  {id: 'text',       label: 'Comment'},
  {id: 'like_count', label: 'Likes'},
  {id: 'author',     label: 'Author'},
  {id: 'video',      label: 'Video'},
];

function applyColVisibility(panelId, prefs) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  ['text','like_count','author','video'].forEach(col => {
    const visible = prefs[col] !== false;
    panel.querySelectorAll(`[data-colname="${col}"]`).forEach(el => {
      el.style.display = visible ? '' : 'none';
    });
  });
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

function toggleAggCol(colName, visible) {
  _aggColPrefs[colName] = visible;
  localStorage.setItem('ytca_cols_agg', JSON.stringify(_aggColPrefs));
  applyColVisibility('panel-aggregate', _aggColPrefs);
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

  const rows = slice.map(c => `<tr>
    <td class="col-actions" data-colname="actions">
      <button class="btn-action btn-keep"      title="Add to Ideas"     onclick="aggToIdeas(event,'${escAttr(c.id)}')">&#128161;</button>
      <button class="btn-action btn-blacklist" title="Add to Blacklist" onclick="aggToBlacklist(event,'${escAttr(c.id)}')">&#128683;</button>
      <button class="btn-action btn-delete"    title="Move to Deleted"  onclick="aggToDeleted(event,'${escAttr(c.id)}')">&#128465;</button>
    </td>
    <td class="col-text"   data-colname="text">${esc(c.text)}</td>
    <td class="col-likes"  data-colname="like_count">${fmtN(c.like_count)}</td>
    <td class="col-author" data-colname="author">${esc(c.author)}</td>
    <td class="col-video"  data-colname="video"><a href="/report?path=${encodeURIComponent(c._reportPath)}" title="${escAttr(c._reportTitle)}">${esc(truncate(c._reportTitle, 28))}</a></td>
  </tr>`).join('');

  const paginator = `
    <div class="agg-toolbar">
      <span class="pg-info">${info}</span>
      <div style="display:flex;gap:8px">
        <button class="pg-btn" onclick="renderAggPage(_aggPage-1)" ${atFirst ? 'disabled' : ''}>&#8592; Prev</button>
        <button class="pg-btn" onclick="renderAggPage(_aggPage+1)" ${atLast  ? 'disabled' : ''}>Next &#8594;</button>
      </div>
    </div>`;

  document.getElementById('panel-aggregate').innerHTML = `
    ${buildColSelector(COL_DEFS, _aggColPrefs, 'toggleAggCol')}
    ${paginator}
    <div class="table-wrap"><table>
      <thead><tr>
        <th data-colname="actions"></th>
        <th data-colname="text"       class="sortable" onclick="sortAggregate('text')">Comment</th>
        <th data-colname="like_count" class="sortable" onclick="sortAggregate('like_count')">Likes</th>
        <th data-colname="author"     class="sortable" onclick="sortAggregate('author')">Author</th>
        <th data-colname="video"      class="sortable" onclick="sortAggregate('_reportTitle')">Video</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${paginator}`;

  updateSortIndicators('panel-aggregate', _aggSortCol, _aggSortDir);
  applyColVisibility('panel-aggregate', _aggColPrefs);
  setTabCount('agg', total);
}

// Aggregate action handlers

function _aggRemove(commentId, row, renderFn) {
  _removeFromList(_aggComments, commentId);
  if (row) animateRowOut(row, () => { renderFn(); updateTabCounts(); });
  else { renderFn(); updateTabCounts(); }
}

async function aggToIdeas(evt, commentId) {
  evt.stopPropagation();
  const comment = _aggComments.find(c => c.id === commentId);
  if (!comment) return;
  const row = evt.target.closest('tr');
  if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);

  _postAction('/api/comment/keep', comment);
  _addToListIfLoaded(_ideasComments, _ideasLoaded, comment);
  _aggRemove(commentId, row, () => renderAggPage(_aggPage));
}

async function aggToBlacklist(evt, commentId) {
  evt.stopPropagation();
  const comment = _aggComments.find(c => c.id === commentId);
  const row = evt.target.closest('tr');
  if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);

  _postAction('/api/comment/discard', comment);
  _addToListIfLoaded(_blacklistComments, _blacklistLoaded, comment);
  _aggRemove(commentId, row, () => renderAggPage(_aggPage));
}

async function aggToDeleted(evt, commentId) {
  evt.stopPropagation();
  const comment = _aggComments.find(c => c.id === commentId);
  const row = evt.target.closest('tr');
  if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);

  _postAction('/api/comment/delete', comment);
  _addToListIfLoaded(_deletedComments, _deletedLoaded, comment);
  _aggRemove(commentId, row, () => renderAggPage(_aggPage));
}

function sortAggregate(col) {
  if (_aggSortCol === col) _aggSortDir = _aggSortDir === 'desc' ? 'asc' : 'desc';
  else { _aggSortCol = col; _aggSortDir = 'desc'; }
  _aggComments.sort((a, b) => _sortCmp(a, b, col, _aggSortDir));
  renderAggPage(0);
}

function _sortCmp(a, b, col, dir) {
  let aVal = a[col] ?? '', bVal = b[col] ?? '';
  if (typeof aVal === 'string' || typeof bVal === 'string') {
    aVal = String(aVal); bVal = String(bVal);
    return dir === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
  }
  aVal = Number(aVal) || 0; bVal = Number(bVal) || 0;
  return dir === 'desc' ? bVal - aVal : aVal - bVal;
}

// ── Ideas ─────────────────────────────────────────────────────────────────────

const IDEAS_PAGE_SIZE = 100;
let _ideasPage = 0;
let _ideaColPrefs = JSON.parse(localStorage.getItem('ytca_cols_idea') || '{}');

async function loadIdeas() {
  const pane = document.getElementById('panel-ideas');
  pane.innerHTML = '<div class="reports-empty">Loading ideas…</div>';

  try {
    const res = await fetch('/api/ideas');
    const ideas = await res.json();

    if (!Array.isArray(ideas)) {
      pane.innerHTML = '<div class="reports-empty">Failed to load ideas.</div>';
      return;
    }

    _ideasComments = ideas;
    _ideasLoaded = true;
    setTabCount('ideas', ideas.length);

    if (!ideas.length) {
      pane.innerHTML = '<div class="reports-empty">No ideas yet. Use 💡 on comments to save them here.</div>';
      return;
    }
    renderIdeasTable();

  } catch (e) {
    pane.innerHTML = `<div class="reports-empty">Failed to load: ${esc(e.message)}</div>`;
  }
}

function toggleIdeaCol(colName, visible) {
  _ideaColPrefs[colName] = visible;
  localStorage.setItem('ytca_cols_idea', JSON.stringify(_ideaColPrefs));
  applyColVisibility('panel-ideas', _ideaColPrefs);
}

function renderIdeasTable() {
  const total = _ideasComments.length;
  if (!total) {
    document.getElementById('panel-ideas').innerHTML =
      '<div class="reports-empty">No ideas yet. Use 💡 on comments to save them here.</div>';
    setTabCount('ideas', 0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / IDEAS_PAGE_SIZE));
  _ideasPage = Math.max(0, Math.min(_ideasPage, totalPages - 1));
  const start = _ideasPage * IDEAS_PAGE_SIZE;
  const slice = _ideasComments.slice(start, start + IDEAS_PAGE_SIZE);

  const info = `Page ${_ideasPage + 1} of ${totalPages} &nbsp;·&nbsp; ${total.toLocaleString()} ideas`;
  const atFirst = _ideasPage === 0, atLast = _ideasPage >= totalPages - 1;

  const rows = slice.map(c => {
    const reportLink = c._reportPath
      ? `<a href="/report?path=${encodeURIComponent(c._reportPath)}" title="${escAttr(c._reportTitle)}">${esc(truncate(c._reportTitle, 28))}</a>`
      : '—';
    return `<tr data-idea-id="${escAttr(c.id)}">
      <td class="col-actions" data-colname="actions">
        <button class="btn-action btn-blacklist" title="Move to Blacklist" onclick="ideasToBlacklist(event,'${escAttr(c.id)}')">&#128683;</button>
        <button class="btn-action btn-delete"    title="Move to Deleted"   onclick="ideasToDeleted(event,'${escAttr(c.id)}')">&#128465;</button>
      </td>
      <td class="col-text"   data-colname="text">${esc(c.text)}</td>
      <td class="col-likes"  data-colname="like_count">${fmtN(c.like_count)}</td>
      <td class="col-author" data-colname="author">${esc(c.author)}</td>
      <td class="col-video"  data-colname="video">${reportLink}</td>
    </tr>`;
  }).join('');

  const paginator = `
    <div class="agg-toolbar">
      <span class="pg-info">${info}</span>
      <div style="display:flex;gap:8px">
        <button class="pg-btn" onclick="changeIdeasPage(-1)" ${atFirst ? 'disabled' : ''}>&#8592; Prev</button>
        <button class="pg-btn" onclick="changeIdeasPage(1)"  ${atLast  ? 'disabled' : ''}>Next &#8594;</button>
      </div>
    </div>`;

  document.getElementById('panel-ideas').innerHTML = `
    ${buildColSelector(COL_DEFS, _ideaColPrefs, 'toggleIdeaCol')}
    ${paginator}
    <div class="table-wrap"><table>
      <thead><tr>
        <th data-colname="actions"></th>
        <th data-colname="text"       class="sortable" onclick="sortIdeas('text')">Comment</th>
        <th data-colname="like_count" class="sortable" onclick="sortIdeas('like_count')">Likes</th>
        <th data-colname="author"     class="sortable" onclick="sortIdeas('author')">Author</th>
        <th data-colname="video"      class="sortable" onclick="sortIdeas('_reportTitle')">Video</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${paginator}`;

  updateSortIndicators('panel-ideas', _ideaSortCol, _ideaSortDir);
  applyColVisibility('panel-ideas', _ideaColPrefs);
  setTabCount('ideas', total);
}

function changeIdeasPage(delta) { _ideasPage += delta; renderIdeasTable(); }

function _ideasRemove(commentId, row, renderFn) {
  _deleteAction(`/api/ideas/${encodeURIComponent(commentId)}`);
  _removeFromList(_ideasComments, commentId);
  if (row) animateRowOut(row, () => { renderFn(); updateTabCounts(); });
  else { renderFn(); updateTabCounts(); }
}

async function ideasToBlacklist(evt, commentId) {
  evt.stopPropagation();
  const comment = _ideasComments.find(c => c.id === commentId);
  const row = evt.target.closest('tr');
  if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);

  _postAction('/api/comment/discard', comment);
  _addToListIfLoaded(_blacklistComments, _blacklistLoaded, comment);
  _ideasRemove(commentId, row, renderIdeasTable);
}

async function ideasToDeleted(evt, commentId) {
  evt.stopPropagation();
  const comment = _ideasComments.find(c => c.id === commentId);
  const row = evt.target.closest('tr');
  if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);

  _postAction('/api/comment/delete', comment);
  _addToListIfLoaded(_deletedComments, _deletedLoaded, comment);
  _ideasRemove(commentId, row, renderIdeasTable);
}

function sortIdeas(col) {
  if (_ideaSortCol === col) _ideaSortDir = _ideaSortDir === 'desc' ? 'asc' : 'desc';
  else { _ideaSortCol = col; _ideaSortDir = 'desc'; }
  _ideasComments.sort((a, b) => _sortCmp(a, b, col, _ideaSortDir));
  _ideasPage = 0; renderIdeasTable();
}

// ── Blacklist ─────────────────────────────────────────────────────────────────

const BLACKLIST_PAGE_SIZE = 100;
let _blacklistPage = 0;
let _blacklistColPrefs = JSON.parse(localStorage.getItem('ytca_cols_blacklist') || '{}');

async function loadBlacklist() {
  const pane = document.getElementById('panel-blacklist');
  pane.innerHTML = '<div class="reports-empty">Loading blacklist…</div>';

  try {
    const res = await fetch('/api/blacklist');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();

    if (!Array.isArray(items)) {
      pane.innerHTML = '<div class="reports-empty">Failed to load blacklist.</div>';
      return;
    }

    _blacklistComments = items;
    _blacklistLoaded = true;
    setTabCount('blacklist', items.length);

    if (!items.length) {
      pane.innerHTML = '<div class="reports-empty">No blacklisted comments yet.</div>';
      return;
    }
    _blacklistPage = 0;
    renderBlacklistTable();

  } catch (e) {
    pane.innerHTML = `<div class="reports-empty">Failed to load: ${esc(e.message)}</div>`;
  }
}

function toggleBlacklistCol(colName, visible) {
  _blacklistColPrefs[colName] = visible;
  localStorage.setItem('ytca_cols_blacklist', JSON.stringify(_blacklistColPrefs));
  applyColVisibility('panel-blacklist', _blacklistColPrefs);
}

function renderBlacklistTable() {
  const total = _blacklistComments.length;
  if (!total) {
    document.getElementById('panel-blacklist').innerHTML =
      '<div class="reports-empty">No blacklisted comments yet.</div>';
    setTabCount('blacklist', 0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / BLACKLIST_PAGE_SIZE));
  _blacklistPage = Math.max(0, Math.min(_blacklistPage, totalPages - 1));
  const start = _blacklistPage * BLACKLIST_PAGE_SIZE;
  const slice = _blacklistComments.slice(start, start + BLACKLIST_PAGE_SIZE);

  const info = `Page ${_blacklistPage + 1} of ${totalPages} &nbsp;·&nbsp; ${total.toLocaleString()} blacklisted`;
  const atFirst = _blacklistPage === 0, atLast = _blacklistPage >= totalPages - 1;

  const rows = slice.map(c => {
    const reportLink = c._reportPath
      ? `<a href="/report?path=${encodeURIComponent(c._reportPath)}" title="${escAttr(c._reportTitle || '')}">${esc(truncate(c._reportTitle || c._reportPath, 28))}</a>`
      : '—';
    return `<tr>
      <td class="col-actions" data-colname="actions">
        <button class="btn-action btn-delete" title="Move to Deleted" onclick="blacklistToDeleted(event,'${escAttr(c.id)}')">&#128465;</button>
      </td>
      <td class="col-text"   data-colname="text">${esc(c.text)}</td>
      <td class="col-likes"  data-colname="like_count">${fmtN(c.like_count)}</td>
      <td class="col-author" data-colname="author">${esc(c.author)}</td>
      <td class="col-video"  data-colname="video">${reportLink}</td>
    </tr>`;
  }).join('');

  const paginator = `
    <div class="agg-toolbar">
      <span class="pg-info">${info}</span>
      <div style="display:flex;gap:8px">
        <button class="pg-btn" onclick="changeBlacklistPage(-1)" ${atFirst ? 'disabled' : ''}>&#8592; Prev</button>
        <button class="pg-btn" onclick="changeBlacklistPage(1)"  ${atLast  ? 'disabled' : ''}>Next &#8594;</button>
      </div>
    </div>`;

  document.getElementById('panel-blacklist').innerHTML = `
    ${buildColSelector(COL_DEFS, _blacklistColPrefs, 'toggleBlacklistCol')}
    ${paginator}
    <div class="table-wrap"><table>
      <thead><tr>
        <th data-colname="actions"></th>
        <th data-colname="text"       class="sortable" onclick="sortBlacklist('text')">Comment</th>
        <th data-colname="like_count" class="sortable" onclick="sortBlacklist('like_count')">Likes</th>
        <th data-colname="author"     class="sortable" onclick="sortBlacklist('author')">Author</th>
        <th data-colname="video"      class="sortable" onclick="sortBlacklist('_reportTitle')">Video</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${paginator}`;

  updateSortIndicators('panel-blacklist', _blacklistSortCol, _blacklistSortDir);
  applyColVisibility('panel-blacklist', _blacklistColPrefs);
  setTabCount('blacklist', total);
}

function changeBlacklistPage(delta) { _blacklistPage += delta; renderBlacklistTable(); }

async function blacklistToDeleted(evt, commentId) {
  evt.stopPropagation();
  const comment = _blacklistComments.find(c => c.id === commentId);
  const row = evt.target.closest('tr');
  if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);

  _deleteAction(`/api/blacklist/${encodeURIComponent(commentId)}`);
  _postAction('/api/comment/delete', comment);
  _addToListIfLoaded(_deletedComments, _deletedLoaded, comment);
  _removeFromList(_blacklistComments, commentId);

  if (row) animateRowOut(row, () => { renderBlacklistTable(); updateTabCounts(); });
  else { renderBlacklistTable(); updateTabCounts(); }
}

function sortBlacklist(col) {
  if (_blacklistSortCol === col) _blacklistSortDir = _blacklistSortDir === 'desc' ? 'asc' : 'desc';
  else { _blacklistSortCol = col; _blacklistSortDir = 'desc'; }
  _blacklistComments.sort((a, b) => _sortCmp(a, b, col, _blacklistSortDir));
  _blacklistPage = 0; renderBlacklistTable();
}

// ── Deleted ───────────────────────────────────────────────────────────────────

const DELETED_PAGE_SIZE = 100;
let _deletedPage = 0;
let _deletedColPrefs = JSON.parse(localStorage.getItem('ytca_cols_deleted') || '{}');

async function loadDeleted() {
  const pane = document.getElementById('panel-deleted');
  pane.innerHTML = '<div class="reports-empty">Loading deleted comments…</div>';

  try {
    const res = await fetch('/api/deleted');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();

    if (!Array.isArray(items)) {
      pane.innerHTML = '<div class="reports-empty">Failed to load deleted comments.</div>';
      return;
    }

    _deletedComments = items;
    _deletedLoaded = true;
    setTabCount('deleted', items.length);

    if (!items.length) {
      pane.innerHTML = '<div class="reports-empty">No deleted comments yet.</div>';
      return;
    }
    _deletedPage = 0;
    renderDeletedTable();

  } catch (e) {
    pane.innerHTML = `<div class="reports-empty">Failed to load: ${esc(e.message)}</div>`;
  }
}

function toggleDeletedCol(colName, visible) {
  _deletedColPrefs[colName] = visible;
  localStorage.setItem('ytca_cols_deleted', JSON.stringify(_deletedColPrefs));
  applyColVisibility('panel-deleted', _deletedColPrefs);
}

function renderDeletedTable() {
  const total = _deletedComments.length;
  if (!total) {
    document.getElementById('panel-deleted').innerHTML =
      '<div class="reports-empty">No deleted comments yet.</div>';
    setTabCount('deleted', 0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / DELETED_PAGE_SIZE));
  _deletedPage = Math.max(0, Math.min(_deletedPage, totalPages - 1));
  const start = _deletedPage * DELETED_PAGE_SIZE;
  const slice = _deletedComments.slice(start, start + DELETED_PAGE_SIZE);

  const info = `Page ${_deletedPage + 1} of ${totalPages} &nbsp;·&nbsp; ${total.toLocaleString()} deleted`;
  const atFirst = _deletedPage === 0, atLast = _deletedPage >= totalPages - 1;

  const rows = slice.map(c => {
    const reportLink = c._reportPath
      ? `<a href="/report?path=${encodeURIComponent(c._reportPath)}" title="${escAttr(c._reportTitle || '')}">${esc(truncate(c._reportTitle || c._reportPath, 28))}</a>`
      : '—';
    return `<tr>
      <td class="col-actions" data-colname="actions">
        <button class="btn-action btn-delete-perm" title="Permanently remove" onclick="deletedPermanentlyRemove(event,'${escAttr(c.id)}')">&#128465;</button>
      </td>
      <td class="col-text"   data-colname="text">${esc(c.text)}</td>
      <td class="col-likes"  data-colname="like_count">${fmtN(c.like_count)}</td>
      <td class="col-author" data-colname="author">${esc(c.author)}</td>
      <td class="col-video"  data-colname="video">${reportLink}</td>
    </tr>`;
  }).join('');

  const paginator = `
    <div class="agg-toolbar">
      <span class="pg-info">${info}</span>
      <div style="display:flex;gap:8px">
        <button class="pg-btn" onclick="changeDeletedPage(-1)" ${atFirst ? 'disabled' : ''}>&#8592; Prev</button>
        <button class="pg-btn" onclick="changeDeletedPage(1)"  ${atLast  ? 'disabled' : ''}>Next &#8594;</button>
      </div>
    </div>`;

  document.getElementById('panel-deleted').innerHTML = `
    ${buildColSelector(COL_DEFS, _deletedColPrefs, 'toggleDeletedCol')}
    ${paginator}
    <div class="table-wrap"><table>
      <thead><tr>
        <th data-colname="actions"></th>
        <th data-colname="text"       class="sortable" onclick="sortDeleted('text')">Comment</th>
        <th data-colname="like_count" class="sortable" onclick="sortDeleted('like_count')">Likes</th>
        <th data-colname="author"     class="sortable" onclick="sortDeleted('author')">Author</th>
        <th data-colname="video"      class="sortable" onclick="sortDeleted('_reportTitle')">Video</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${paginator}`;

  updateSortIndicators('panel-deleted', _deletedSortCol, _deletedSortDir);
  applyColVisibility('panel-deleted', _deletedColPrefs);
  setTabCount('deleted', total);
}

function changeDeletedPage(delta) { _deletedPage += delta; renderDeletedTable(); }

async function deletedPermanentlyRemove(evt, commentId) {
  evt.stopPropagation();
  const row = evt.target.closest('tr');
  if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);

  _deleteAction(`/api/deleted/${encodeURIComponent(commentId)}`);
  _removeFromList(_deletedComments, commentId);

  if (row) animateRowOut(row, () => { renderDeletedTable(); updateTabCounts(); });
  else { renderDeletedTable(); updateTabCounts(); }
}

function sortDeleted(col) {
  if (_deletedSortCol === col) _deletedSortDir = _deletedSortDir === 'desc' ? 'asc' : 'desc';
  else { _deletedSortCol = col; _deletedSortDir = 'desc'; }
  _deletedComments.sort((a, b) => _sortCmp(a, b, col, _deletedSortDir));
  _deletedPage = 0; renderDeletedTable();
}

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

loadReports();
updateQuotaDisplay();
