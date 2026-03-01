// ── Aggregate page: All comments from all reports ────────────────────────────

const COL_DEFS = CONFIG.columns.aggregate;

// Cross-panel action handlers
function aggToSave(comment, row, table) {
  _postAction('/api/comment/save', comment);
  table.removeRow(comment.id, row);
}

function aggToBlacklist(comment, row, table) {
  _postAction('/api/comment/blacklist', comment);
  table.removeRow(comment.id, row);
}

function aggToDeleted(comment, row, table) {
  _postAction('/api/comment/delete', comment);
  table.removeRow(comment.id, row);
}

// Create aggregate table manager
const aggTable = new TableManager({
  panelId: 'main-content',
  apiEndpoint: CONFIG.api.reports,
  pageSize: CONFIG.ui.pageSize,
  columns: COL_DEFS,
  colPrefKey: CONFIG.storage.colPrefPrefix + 'agg_page',
  defaultColPrefs: {
    topic_rating: false,
    topic_confidence: false,
    like_count: false,
    author: false,
    video: false,
  },
  emptyMessage: 'No comments yet.',
  toolbarExtra: '<button class="btn btn-secondary" id="save-all-btn" onclick="saveAllFiltered()" style="white-space:nowrap">Save All</button><button class="btn btn-danger" onclick="showDeleteAllModal()" style="white-space:nowrap;border:1px solid rgba(255,45,45,0.3)">Delete All</button>',
  actions: [
    { label: '+', title: 'Save', className: 'btn-save', handler: aggToSave },
    { label: '🚫', title: 'Add to Blacklist', className: 'btn-blacklist', handler: aggToBlacklist },
    { label: '🗑', title: 'Move to Deleted', className: 'btn-delete', handler: aggToDeleted },
  ],
});

// Register in global object for onclick handlers
__tableManagers['main-content'] = aggTable;

// Custom load: fetch all reports and merge comments
aggTable.loadAggregate = async function() {
  if (this.loading) return;
  this.loading = true;
  const pane = document.getElementById(this.config.panelId);

  try {
    if (pane) pane.innerHTML = '<div class="reports-empty">Loading all comments…</div>';

    // Fetch list of reports
    const reportsRes = await fetch(CONFIG.api.reports);
    if (!reportsRes.ok) throw new Error(`Reports fetch failed: ${reportsRes.status}`);
    const reports = await reportsRes.json();

    if (!reports.length) {
      pane.innerHTML = '<div class="reports-empty">No reports yet.</div>';
      this.loading = false;
      return;
    }

    // Fetch each report's data in parallel
    const merged = [];
    const reportDataPromises = reports.map(async (r) => {
      try {
        const endpoint = CONFIG.api.reportData + '/' + r.path;
        const res = await fetch(endpoint);

        if (!res.ok) {
          console.warn(`Failed to load report ${r.path}: ${res.status}`);
          return null;
        }

        const data = await res.json();
        return {
          comments: data.comments || [],
          _reportPath: r.path,
          _reportTitle: r.title || r.path
        };
      } catch (e) {
        console.warn(`Error loading report ${r.path}:`, e);
        return null;
      }
    });

    const results = await Promise.all(reportDataPromises);

    // Detect if any reports have scoring in progress
    const anyInProgress = reports.some(r => r.ai_score_status === 'in_progress');
    this.config.scoringInProgress = anyInProgress;

    // Merge comments from all reports; detect if any are scored
    let hasScores = false;
    for (const result of results) {
      if (!result || !Array.isArray(result.comments)) continue;
      for (const c of result.comments) {
        merged.push({
          ...c,
          _reportPath: result._reportPath,
          _reportTitle: result._reportTitle
        });
        if (c.topic_rating != null && Number(c.topic_rating) >= 1) hasScores = true;
      }
    }

    // Auto-show scoring columns when scores exist or scoring is in progress
    if (hasScores || anyInProgress) {
      const savedPrefs = JSON.parse(localStorage.getItem(this.config.colPrefKey) || '{}');
      if (!('topic_rating' in savedPrefs)) {
        this.colPrefs.topic_rating = true;
        this.colPrefs.topic_confidence = true;
      }
    }

    // Update and render
    this.data = merged;
    this.page = 0;
    this.loaded = true;
    this.sort(this.sortCol, this.sortDir);
    this.render();

  } catch (e) {
    console.error('Aggregate load error:', e);
    pane.innerHTML = `<div class="reports-empty">Failed to load: ${esc(e.message)}</div>`;
  } finally {
    this.loading = false;
  }
};

aggTable.load = aggTable.loadAggregate;

// After aggregate loads, check if AI Score All should be disabled
const _origLoad = aggTable.loadAggregate.bind(aggTable);
aggTable.loadAggregate = async function() {
  await _origLoad();
  _updateAiScoreAllState();
};
aggTable.load = aggTable.loadAggregate;

async function _updateAiScoreAllState() {
  const btn = document.getElementById('ai-score-all-btn');
  if (!btn) return;
  try {
    const res = await fetch(CONFIG.api.aiScoreAggregate);
    const data = await res.json();
    const nothingToScore = (data.eligible_count || 0) === 0 && (data.pending_count || 0) === 0;
    const nothingToPoll = (data.pending_count || 0) === 0;
    btn.disabled = nothingToScore;
    btn.title = nothingToScore
      ? (data.scored_count > 0 ? 'All comments are already scored' : 'No comments available for scoring')
      : '';
    const pollBtn = document.getElementById('ai-score-check-btn');
    if (pollBtn) pollBtn.style.display = nothingToPoll ? 'none' : '';
  } catch (_) {}
}

// ── Save All Filtered ──────────────────────────────────────────────────────

async function saveAllFiltered() {
  const filtered = aggTable.getFilteredData();
  if (!filtered.length) return;

  const btn = document.getElementById('save-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = `Saving ${filtered.length}…`; }

  let saved = 0;
  for (const comment of filtered) {
    try {
      await fetch('/api/comment/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
      saved++;
    } catch (_) {}
  }

  // Reload to reflect changes
  await aggTable.loadAggregate();
  loadNavCounts();
  if (btn) { btn.disabled = false; btn.textContent = 'Save All'; }
}

// ── Delete All ────────────────────────────────────────────────────────────

function showDeleteAllModal() {
  const filtered = aggTable.getFilteredData();
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
        <span class="modal-title">Delete All Pending</span>
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

  document.getElementById('_da-blacklist').onclick = () => { close(); _bulkMove('/api/comment/blacklist', filtered); };
  document.getElementById('_da-delete').onclick = () => { close(); _bulkMove('/api/comment/delete', filtered); };
}

async function _bulkMove(endpoint, comments) {
  for (const comment of comments) {
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
    } catch (_) {}
  }
  await aggTable.loadAggregate();
  loadNavCounts();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('_ytca-delall-modal')?.remove();
});

// Load on page ready
document.addEventListener('DOMContentLoaded', () => {
  aggTable.load();
});

// ── AI Score All ───────────────────────────────────────────────────────────────

let _scoringPollTimer = null;

async function openAiScoreModal() {
  // Show a loading state briefly while fetching counts
  const scoreAllBtn = document.getElementById('ai-score-all-btn');
  if (scoreAllBtn) { scoreAllBtn.disabled = true; scoreAllBtn.textContent = 'Loading…'; }

  let bodyHtml = '<p class="modal-desc" style="color:var(--text-3)">Checking scoring status…</p>';
  let eligible_count = 0;
  let submitLabel = 'Nothing to score';
  let submitDisabled = true;

  try {
    const res = await fetch(CONFIG.api.aiScoreAggregate);
    const data = await res.json();
    const { eligible_count: ec, eligible_reports, pending_count, pending_reports, scored_count } = data;
    eligible_count = ec || 0;

    if (eligible_count === 0 && pending_count === 0) {
      bodyHtml = `<p class="modal-desc"><strong>Nothing to score.</strong><br>
        ${scored_count > 0
          ? `All ${scored_count.toLocaleString()} comments have already been scored.`
          : 'No comments are available for scoring.'}</p>`;
    } else {
      bodyHtml = '';
      if (eligible_count > 0) {
        bodyHtml += `<p class="modal-desc"><strong>${eligible_count.toLocaleString()} comment${eligible_count !== 1 ? 's' : ''}</strong>
          across <strong>${eligible_reports} report${eligible_reports !== 1 ? 's' : ''}</strong> will be submitted.</p>`;
      }
      if (scored_count > 0) {
        bodyHtml += `<p class="modal-desc">Already scored: <strong>${scored_count.toLocaleString()}</strong> — will be skipped.</p>`;
      }
      if (pending_count > 0) {
        bodyHtml += `<p class="modal-desc">Pending: <strong>${pending_count.toLocaleString()}</strong> across ${pending_reports} report${pending_reports !== 1 ? 's' : ''} — will be skipped.</p>`;
      }
      submitLabel = eligible_count > 0 ? `Score ${eligible_count.toLocaleString()} Comments` : 'Nothing to score';
      submitDisabled = eligible_count === 0;
    }
  } catch (e) {
    bodyHtml = `<p class="modal-desc" style="color:#f87171">Failed to load status: ${esc(e.message)}</p>`;
  } finally {
    if (scoreAllBtn) { scoreAllBtn.disabled = false; scoreAllBtn.textContent = '✨ AI Score All'; }
  }

  showAiPromptModal({
    title: '✨ AI Score All',
    bodyHtml,
    submitLabel,
    submitDisabled,
    onConfirm: async (keywords) => {
      try {
        const res = await fetch(CONFIG.api.aiScoreAggregate, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords }),
        });
        const data = await res.json();
        if (data.error) { alert('AI Scoring error: ' + data.error); return; }
        const btn = document.getElementById('ai-score-all-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Scoring…'; }
        aggTable.config.scoringInProgress = true;
        aggTable.colPrefs.topic_rating = true;
        aggTable.colPrefs.topic_confidence = true;
        localStorage.setItem(aggTable.config.colPrefKey, JSON.stringify(aggTable.colPrefs));
        aggTable.render();
        _startAggregateScoringPoll();
      } catch (e) {
        alert('Network error: ' + e.message);
      }
    },
  });
}

async function checkScoringNow() {
  const btn = document.getElementById('ai-score-check-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    await fetch('/api/ai-score-poll', { method: 'POST' });
    await aggTable.loadAggregate();
  } catch (e) {
    console.error('Check scoring error:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#10227;'; }
  }
}

// Clean up polling timers on page navigation
window.addEventListener('beforeunload', () => {
  if (_scoringPollTimer) { clearInterval(_scoringPollTimer); _scoringPollTimer = null; }
});

function _startAggregateScoringPoll() {
  if (_scoringPollTimer) clearInterval(_scoringPollTimer);
  _scoringPollTimer = setInterval(async () => {
    try {
      const res = await fetch(CONFIG.api.aiScoreAggregate);
      const data = await res.json();
      if (data.pending_count === 0) {
        clearInterval(_scoringPollTimer);
        _scoringPollTimer = null;
        const btn = document.getElementById('ai-score-all-btn');
        if (btn) { btn.disabled = false; btn.textContent = '✨ AI Score All'; }
        aggTable.loadAggregate();
      }
    } catch (_) {}
  }, 30_000);
}
