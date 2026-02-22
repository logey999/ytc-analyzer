// ── Ideas page: Saved comments ─────────────────────────────────────────────

const COL_DEFS = CONFIG.columns.aggregate;

// Cross-panel action handlers
function ideasToBlacklist(comment, row, table) {
  _postAction('/api/comment/discard', comment);
  _deleteAction('/api/ideas/' + encodeURIComponent(comment.id));
  table.removeRow(comment.id, row);
}

function ideasToDeleted(comment, row, table) {
  _postAction('/api/comment/delete', comment);
  _deleteAction('/api/ideas/' + encodeURIComponent(comment.id));
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

// Create ideas table manager
const ideasTable = new TableManager({
  panelId: 'main-content',
  apiEndpoint: CONFIG.api.ideas,
  pageSize: CONFIG.ui.pageSize,
  columns: COL_DEFS,
  colPrefKey: CONFIG.storage.colPrefPrefix + 'idea_page',
  emptyMessage: 'No kept comments yet. Use + on comments to keep them here.',
  actions: [
    { label: '🚫', title: 'Move to Blacklist', className: 'btn-blacklist', handler: ideasToBlacklist },
    { label: '🗑', title: 'Move to Deleted', className: 'btn-delete', handler: ideasToDeleted },
  ],
});

// Register in global object for onclick handlers
__tableManagers['main-content'] = ideasTable;

// Load on page ready
document.addEventListener('DOMContentLoaded', () => {
  ideasTable.load();
});
