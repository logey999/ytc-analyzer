// ── Keep page: Saved comments ─────────────────────────────────────────────

const COL_DEFS = CONFIG.columns.aggregate;

// Cross-panel action handlers
function keepToBlacklist(comment, row, table) {
  _postAction('/api/comment/discard', comment);
  _deleteAction('/api/keep/' + encodeURIComponent(comment.id));
  table.removeRow(comment.id, row);
}

function keepToDeleted(comment, row, table) {
  _postAction('/api/comment/delete', comment);
  _deleteAction('/api/keep/' + encodeURIComponent(comment.id));
  table.removeRow(comment.id, row);
}

// Create keep table manager
const keepTable = new TableManager({
  panelId: 'main-content',
  apiEndpoint: CONFIG.api.keep,
  pageSize: CONFIG.ui.pageSize,
  columns: COL_DEFS,
  colPrefKey: CONFIG.storage.colPrefPrefix + 'keep_page',
  emptyMessage: 'No kept comments yet. Use + on comments to keep them here.',
  actions: [
    { label: '🚫', title: 'Move to Blacklist', className: 'btn-blacklist', handler: keepToBlacklist },
    { label: '🗑', title: 'Move to Deleted', className: 'btn-delete', handler: keepToDeleted },
  ],
});

// Register in global object for onclick handlers
__tableManagers['main-content'] = keepTable;

// Load on page ready
document.addEventListener('DOMContentLoaded', () => {
  keepTable.load();
});
