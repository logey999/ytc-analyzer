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
    const res = await fetch('/api/report-data/' + encodeURIComponent(REPORT_PATH));
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

function renderReport({ video_info, comments, phrases }) {
  const vi = video_info || {};
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

  const html = `
    <!-- Video Info -->
    <div class="card">
      <div class="card-title">Video Info</div>
      <div class="video-card-inner">
        ${thumbHtml}
        <div class="video-info-body">
          <p class="video-title">${esc(vi.title || '')}</p>
          <div class="video-meta">
            <span><strong>Channel:</strong> ${esc(channel || 'N/A')}</span>
            <span class="meta-sep">&bull;</span>
            <span><strong>Uploaded:</strong> ${esc(uploadDate)}</span>
            <span class="meta-sep">&bull;</span>
            <span><strong>Duration:</strong> ${esc(secondsToHms(vi.duration))}</span>
            <span class="meta-sep">&bull;</span>
            <span><strong>Views:</strong> ${fmt(vi.view_count)}</span>
            <span class="meta-sep">&bull;</span>
            <span><strong>Likes:</strong> ${fmt(vi.like_count)}</span>
            <span class="meta-sep">&bull;</span>
            <span><strong>Comments analysed:</strong> ${fmt(comments.length)}</span>
            ${yt_url ? `<a href="${escAttr(yt_url)}" class="yt-link" target="_blank" rel="noopener">Watch on YouTube &#8599;</a>` : ''}
          </div>
          <div class="desc">${esc((vi.description || '').slice(0, 1000))}</div>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="card">
      <div class="section-tabs">
        <button class="tab active" onclick="showTab('top100', this)">Top 100 Liked</button>
        <button class="tab" onclick="showTab('all', this)">All Comments</button>
        <button class="tab" onclick="showTab('phrases', this)">Repeated Phrases</button>
      </div>

      <!-- Pane: Top 100 -->
      <div id="pane-top100" class="tab-pane">
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Author</th><th>Likes</th><th>Comment</th></tr></thead>
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
            <thead><tr><th>#</th><th>Author</th><th>Likes</th><th>Comment</th></tr></thead>
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
  renderRows('top100-body', comments.slice(0, 100), 0, channel, channelId);

  // Setup all-comments pagination
  _allComments = comments;
  _channel = channel;
  _channelId = channelId;
  renderPage(0);

  // Phrases chart
  if (phrases && phrases.length) {
    renderPhrasesChart(phrases);
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function showTab(id, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.getElementById('pane-' + id).style.display = '';
  btn.classList.add('active');
}

// ── All comments pagination ───────────────────────────────────────────────────

const PAGE_SIZE = 200;
let _allComments = [];
let _channel = '';
let _channelId = '';
let _currentPage = 0;

function renderRows(tbodyId, slice, offset, channel, channelId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = slice.map((c, i) => {
    const rank = offset + i + 1;
    const isCreator = channelId
      ? (String(c.author_channel_id || '') === channelId)
      : (channel && String(c.author).trim() === channel.trim());
    const authorCls = isCreator ? 'col-author creator' : 'col-author';
    return `<tr>
      <td class="rank">${rank}</td>
      <td class="${authorCls}">${esc(c.author)}</td>
      <td class="col-likes">${fmt(c.like_count)}</td>
      <td class="col-text">${esc(c.text)}</td>
    </tr>`;
  }).join('');
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
}

function changePage(delta) {
  renderPage(_currentPage + delta);
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

// ── Init ──────────────────────────────────────────────────────────────────────

loadNavigation();
loadReport();
