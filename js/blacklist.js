// ── Blacklist page ────────────────────────────────────────────────────────────

const COL_DEFS = CONFIG.columns.blacklist;

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
  defaultColPrefs: {
    topic_rating: false,
    topic_confidence: false,
    like_count: false,
    author: false,
    video: false,
  },
  emptyMessage: 'No blacklisted comments yet.',
  toolbarExtra: '<button class="btn btn-danger" onclick="openDeleteAllModal()" style="white-space:nowrap;border:1px solid rgba(255,45,45,0.3)">Delete All</button>',
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

// ── Delete All ────────────────────────────────────────────────────────────────

function openDeleteAllModal() {
  document.getElementById('blacklist-delete-all-modal').classList.add('open');
}

function closeDeleteAllModal(e) {
  if (e && e.target !== document.getElementById('blacklist-delete-all-modal')) return;
  document.getElementById('blacklist-delete-all-modal').classList.remove('open');
}

async function confirmDeleteAll() {
  document.getElementById('blacklist-delete-all-modal').classList.remove('open');
  try {
    await fetch('/api/blacklist', { method: 'DELETE' });
    blacklistTable.data = [];
    blacklistTable.page = 0;
    blacklistTable.render();
    loadNavCounts();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('blacklist-delete-all-modal')?.classList.remove('open');
});
