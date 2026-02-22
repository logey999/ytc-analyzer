// ── Blacklist page: Discarded comments ──────────────────────────────────────

const COL_DEFS = CONFIG.columns.aggregate;

// Cross-panel action handler
function blacklistToDeleted(comment, row, table) {
  _deleteAction('/api/blacklist/' + encodeURIComponent(comment.id));
  _postAction('/api/comment/delete', comment);
  table.removeRow(comment.id, row);
}

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
