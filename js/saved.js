// ── Saved page: Saved comments ─────────────────────────────────────────────

const COL_DEFS = CONFIG.columns.aggregate;

// Cross-panel action handlers
function savedToBlacklist(comment, row, table) {
  _postAction('/api/comment/blacklist', comment);
  _deleteAction('/api/saved/' + encodeURIComponent(comment.id));
  table.removeRow(comment.id, row);
}

function savedToDeleted(comment, row, table) {
  _postAction('/api/comment/delete', comment);
  _deleteAction('/api/saved/' + encodeURIComponent(comment.id));
  table.removeRow(comment.id, row);
}

// Create saved table manager
const savedTable = new TableManager({
  panelId: 'main-content',
  apiEndpoint: CONFIG.api.saved,
  pageSize: CONFIG.ui.pageSize,
  columns: COL_DEFS,
  colPrefKey: CONFIG.storage.colPrefPrefix + 'saved_page',
  emptyMessage: 'No saved comments yet. Use + on comments to save them here.',
  actions: [
    { label: '🚫', title: 'Move to Blacklist', className: 'btn-blacklist', handler: savedToBlacklist },
    { label: '🗑', title: 'Move to Deleted', className: 'btn-delete', handler: savedToDeleted },
  ],
});

// Register in global object for onclick handlers
__tableManagers['main-content'] = savedTable;

// Load on page ready
document.addEventListener('DOMContentLoaded', () => {
  savedTable.load();
});
