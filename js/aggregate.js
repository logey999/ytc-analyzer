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
        // Correct endpoint path - add slash
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

    // Merge comments from all reports
    for (const result of results) {
      if (!result || !Array.isArray(result.comments)) continue;
      for (const c of result.comments) {
        merged.push({
          ...c,
          _reportPath: result._reportPath,
          _reportTitle: result._reportTitle
        });
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
