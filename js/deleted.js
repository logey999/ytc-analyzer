// ── Deleted page: Deleted comments ──────────────────────────────────────────

const COL_DEFS = CONFIG.columns.aggregate;

// Action handler for permanent removal
function deletedPermanentlyRemove(comment, row, table) {
  _deleteAction('/api/deleted/' + encodeURIComponent(comment.id));
  table.removeRow(comment.id, row);
}

// Create deleted table manager
const deletedTable = new TableManager({
  panelId: 'main-content',
  apiEndpoint: CONFIG.api.deleted,
  pageSize: CONFIG.ui.pageSize,
  columns: COL_DEFS,
  colPrefKey: CONFIG.storage.colPrefPrefix + 'deleted_page',
  defaultColPrefs: {
    topic_rating: false,
    topic_confidence: false,
    like_count: false,
    author: false,
    video: false,
  },
  emptyMessage: 'No deleted comments yet.',
  toolbarExtra: '<button class="btn btn-danger" onclick="openDeleteAllModal()" style="white-space:nowrap;border:1px solid rgba(255,45,45,0.3)">Empty Trash</button>',
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

// ── Delete All ────────────────────────────────────────────────────────────────

function openDeleteAllModal() {
  document.getElementById('deleted-delete-all-modal').classList.add('open');
}

function closeDeleteAllModal(e) {
  if (e && e.target !== document.getElementById('deleted-delete-all-modal')) return;
  document.getElementById('deleted-delete-all-modal').classList.remove('open');
}

async function confirmDeleteAll() {
  document.getElementById('deleted-delete-all-modal').classList.remove('open');
  try {
    await fetch('/api/deleted', { method: 'DELETE' });
    deletedTable.data = [];
    deletedTable.page = 0;
    deletedTable.render();
    loadNavCounts();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('deleted-delete-all-modal')?.classList.remove('open');
});
