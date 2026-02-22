// ── Blacklist page: Discarded comments ──────────────────────────────────────

const COL_DEFS = CONFIG.columns.aggregate;

// Cross-panel action handler
function blacklistToDeleted(comment, row, table) {
  _deleteAction('/api/blacklist/' + encodeURIComponent(comment.id));
  _postAction('/api/comment/delete', comment);
  table.removeRow(comment.id, row);
}

// Create blacklist table manager
const blacklistTable = new TableManager({
  panelId: 'main-content',
  apiEndpoint: CONFIG.api.blacklist,
  pageSize: CONFIG.ui.pageSize,
  columns: COL_DEFS,
  colPrefKey: CONFIG.storage.colPrefPrefix + 'blacklist_page',
  emptyMessage: 'No blacklisted comments yet.',
  actions: [
    { label: '🗑', title: 'Move to Deleted', className: 'btn-delete', handler: blacklistToDeleted },
  ],
});

// Register in global object for onclick handlers
__tableManagers['main-content'] = blacklistTable;

// Load on page ready
document.addEventListener('DOMContentLoaded', () => {
  blacklistTable.load();
});
