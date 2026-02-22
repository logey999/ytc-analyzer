// ── Deleted page: Deleted comments ──────────────────────────────────────────

const COL_DEFS = CONFIG.columns.aggregate;

// Action handler for permanent removal
function deletedPermanentlyRemove(comment, row, table) {
  _deleteAction('/api/deleted/' + encodeURIComponent(comment.id));
  table.removeRow(comment.id, row);
}

function _deleteAction(endpoint) {
  fetch(endpoint, {method: 'DELETE'})
    .catch(e => console.error(`${endpoint} failed:`, e));
}

// Create deleted table manager
const deletedTable = new TableManager({
  panelId: 'main-content',
  apiEndpoint: CONFIG.api.deleted,
  pageSize: CONFIG.ui.pageSize,
  columns: COL_DEFS,
  colPrefKey: CONFIG.storage.colPrefPrefix + 'deleted_page',
  emptyMessage: 'No deleted comments yet.',
  actions: [
    { label: '✕', title: 'Permanently remove', className: 'btn-delete-perm', handler: deletedPermanentlyRemove },
  ],
});

// Register in global object for onclick handlers
__tableManagers['main-content'] = deletedTable;

// Load on page ready
document.addEventListener('DOMContentLoaded', () => {
  deletedTable.load();
});
