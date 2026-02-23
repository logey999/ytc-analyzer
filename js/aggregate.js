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
  },
  emptyMessage: 'No comments yet.',
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

    // Auto-show scoring columns when scores exist, unless user has set a preference
    if (hasScores) {
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

// Load on page ready
document.addEventListener('DOMContentLoaded', () => {
  aggTable.load();
});

// ── AI Score All ───────────────────────────────────────────────────────────────

let _scoringPollTimer = null;

async function openAiScoreModal() {
  const modal = document.getElementById('ai-score-modal');
  const body = document.getElementById('ai-score-modal-body');
  const confirmBtn = document.getElementById('ai-score-confirm-btn');

  body.innerHTML = '<p class="modal-desc">Loading…</p>';
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Score';
  modal.classList.add('open');

  try {
    const res = await fetch(CONFIG.api.aiScoreAggregate);
    const data = await res.json();
    const { eligible_count, eligible_reports, pending_count, pending_reports, scored_count } = data;

    if (eligible_count === 0 && pending_count === 0) {
      body.innerHTML = `<p class="modal-desc">
        <strong>Nothing to score.</strong><br>
        ${scored_count > 0
          ? `All ${scored_count.toLocaleString()} comments have already been scored.`
          : 'No comments are available for scoring.'}
      </p>`;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Nothing to score';
      return;
    }

    let html = '';
    if (eligible_count > 0) {
      html += `<p class="modal-desc">
        <strong>${eligible_count.toLocaleString()} comment${eligible_count !== 1 ? 's' : ''}</strong>
        across <strong>${eligible_reports} report${eligible_reports !== 1 ? 's' : ''}</strong>
        will be submitted for AI scoring.
      </p>`;
    }
    if (scored_count > 0) {
      html += `<p class="modal-desc">
        Already scored: &nbsp;<strong>${scored_count.toLocaleString()} comments</strong> &mdash; will be skipped.
      </p>`;
    }
    if (pending_count > 0) {
      html += `<p class="modal-desc">
        Pending batches: &nbsp;<strong>${pending_count.toLocaleString()} comments</strong>
        across ${pending_reports} report${pending_reports !== 1 ? 's' : ''} &mdash; will be skipped.
      </p>`;
    }
    html += `<p class="modal-desc" style="margin-top:4px;color:var(--text-3)">
      Scoring uses the Anthropic Batches API. Results are written back automatically when ready.
    </p>`;

    body.innerHTML = html;
    confirmBtn.disabled = eligible_count === 0;
    confirmBtn.textContent = eligible_count > 0
      ? `Score ${eligible_count.toLocaleString()} Comments`
      : 'Nothing to score';
  } catch (e) {
    body.innerHTML = `<p class="modal-desc" style="color:#f87171">Failed to load status: ${esc(e.message)}</p>`;
    confirmBtn.disabled = true;
  }
}

function closeAiScoreModal(event) {
  if (event && event.target !== document.getElementById('ai-score-modal')) return;
  document.getElementById('ai-score-modal').classList.remove('open');
}

async function confirmAiScoring() {
  const confirmBtn = document.getElementById('ai-score-confirm-btn');
  const body = document.getElementById('ai-score-modal-body');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Submitting…';

  try {
    const res = await fetch(CONFIG.api.aiScoreAggregate, { method: 'POST' });
    const data = await res.json();

    if (data.error) {
      body.innerHTML += `<p class="modal-desc" style="color:#f87171">Error: ${esc(data.error)}</p>`;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Retry';
      return;
    }

    document.getElementById('ai-score-modal').classList.remove('open');

    // Update toolbar button state
    const scoreAllBtn = document.getElementById('ai-score-all-btn');
    if (scoreAllBtn) {
      scoreAllBtn.disabled = true;
      scoreAllBtn.textContent = 'Scoring\u2026';
    }

    _startAggregateScoringPoll();
  } catch (e) {
    body.innerHTML += `<p class="modal-desc" style="color:#f87171">Network error: ${esc(e.message)}</p>`;
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Retry';
  }
}

function _startAggregateScoringPoll() {
  if (_scoringPollTimer) clearInterval(_scoringPollTimer);
  _scoringPollTimer = setInterval(async () => {
    try {
      const res = await fetch(CONFIG.api.aiScoreAggregate);
      const data = await res.json();
      if (data.pending_count === 0) {
        clearInterval(_scoringPollTimer);
        _scoringPollTimer = null;
        location.reload();
      }
    } catch (_) {}
  }, 30_000);
}
