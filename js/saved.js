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

// ── Export CSV ──────────────────────────────────────────────────────────────

const EXPORT_COLUMNS = [
  { id: 'text', label: 'Comment' },
  { id: 'like_count', label: 'Likes' },
  { id: 'author', label: 'Author' },
  { id: 'topic_rating', label: 'AI Score' },
  { id: 'topic_confidence', label: 'AI Confidence' },
  { id: '_reportTitle', label: 'Video' },
  { id: 'id', label: 'Comment ID' },
  { id: 'author_channel_id', label: 'Author Channel ID' },
  { id: 'timestamp', label: 'Timestamp' },
  { id: 'parent', label: 'Parent' },
];

function showExportModal() {
  const existing = document.getElementById('_ytca-export-modal');
  if (existing) existing.remove();

  // Load saved prefs or default to first 5 columns enabled, in default order
  const savedPrefs = JSON.parse(localStorage.getItem('ytca_export_cols') || 'null');
  let columns;
  if (savedPrefs && Array.isArray(savedPrefs)) {
    // Merge: keep saved order/enabled state, add any new columns at end
    const known = new Set(savedPrefs.map(c => c.id));
    columns = savedPrefs.map(c => ({ ...c }));
    EXPORT_COLUMNS.forEach(c => {
      if (!known.has(c.id)) columns.push({ id: c.id, label: c.label, enabled: false });
    });
  } else {
    columns = EXPORT_COLUMNS.map((c, i) => ({ ...c, enabled: i < 5 }));
  }

  const modal = document.createElement('div');
  modal.id = '_ytca-export-modal';
  modal.className = 'modal-overlay open';

  function render() {
    modal.innerHTML = `
      <div class="modal-box" style="max-width:440px;width:92vw">
        <div class="modal-header">
          <span class="modal-title">Export Saved Comments</span>
          <button class="modal-close" id="_ex-close">&times;</button>
        </div>
        <p class="modal-desc">Select columns and drag to reorder.</p>
        <div id="_ex-list" style="display:flex;flex-direction:column;gap:2px">
          ${columns.map((c, i) => `
            <div class="export-col-row" draggable="true" data-idx="${i}"
              style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-3);border:1px solid var(--border);border-radius:4px;cursor:grab;user-select:none">
              <span style="color:var(--text-3);font-size:0.75rem;cursor:grab">☰</span>
              <input type="checkbox" data-col="${c.id}" ${c.enabled ? 'checked' : ''}>
              <span style="font-size:0.85rem;color:var(--text)">${esc(c.label)}</span>
            </div>
          `).join('')}
        </div>
        <div class="modal-actions">
          <button class="nav-btn" id="_ex-cancel">Cancel</button>
          <button class="btn btn-primary" id="_ex-download">Download CSV</button>
        </div>
      </div>`;

    // Wire close
    const close = () => modal.remove();
    document.getElementById('_ex-close').onclick = close;
    document.getElementById('_ex-cancel').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    // Wire checkboxes
    modal.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.onchange = () => {
        const col = columns.find(c => c.id === cb.dataset.col);
        if (col) col.enabled = cb.checked;
      };
    });

    // Wire drag reorder
    const list = document.getElementById('_ex-list');
    let dragIdx = null;
    list.querySelectorAll('.export-col-row').forEach(row => {
      row.addEventListener('dragstart', e => {
        dragIdx = Number(row.dataset.idx);
        e.dataTransfer.effectAllowed = 'move';
        row.style.opacity = '0.4';
      });
      row.addEventListener('dragend', () => { row.style.opacity = ''; });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        const dropIdx = Number(row.dataset.idx);
        if (dragIdx === null || dragIdx === dropIdx) return;
        const [moved] = columns.splice(dragIdx, 1);
        columns.splice(dropIdx, 0, moved);
        dragIdx = null;
        render();
      });
    });

    // Wire download
    document.getElementById('_ex-download').onclick = () => {
      const enabledCols = columns.filter(c => c.enabled);
      if (enabledCols.length === 0) return;

      // Save prefs
      localStorage.setItem('ytca_export_cols', JSON.stringify(columns));

      // Build CSV
      const data = savedTable.getFilteredData();
      const csvRows = [];
      csvRows.push(enabledCols.map(c => csvEscape(c.label)).join(','));
      data.forEach(comment => {
        csvRows.push(enabledCols.map(c => csvEscape(String(comment[c.id] ?? ''))).join(','));
      });
      const csv = csvRows.join('\n');

      // Download
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      const filename = `ytc-analyzer-saved-${dd}-${mm}-${yyyy}.csv`;

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      modal.remove();
    };
  }

  document.body.appendChild(modal);
  render();
}

// ── Delete All ──────────────────────────────────────────────────────────────

function showDeleteAllModal() {
  const count = savedTable.data.length;
  if (!count) return;

  const existing = document.getElementById('_ytca-delall-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = '_ytca-delall-modal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;width:92vw">
      <div class="modal-header">
        <span class="modal-title">Delete All Saved</span>
        <button class="modal-close" id="_da-close">&times;</button>
      </div>
      <p class="modal-desc">Move all <strong>${count.toLocaleString()}</strong> saved comment${count !== 1 ? 's' : ''} to the Deleted bin?</p>
      <div class="modal-actions">
        <button class="nav-btn" id="_da-cancel">Cancel</button>
        <button class="btn btn-danger" id="_da-confirm" style="border:1px solid rgba(255,45,45,0.3)">Delete All</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('_da-close').onclick = close;
  document.getElementById('_da-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  document.getElementById('_da-confirm').onclick = async () => {
    close();
    try {
      await fetch('/api/saved/delete-all', { method: 'POST' });
      savedTable.data = [];
      savedTable.render();
      loadNavCounts();
    } catch (e) {
      console.error('Delete all failed:', e);
    }
  };
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('_ytca-delall-modal')?.remove();
});

function csvEscape(val) {
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

// Create saved table manager
const savedTable = new TableManager({
  panelId: 'main-content',
  apiEndpoint: CONFIG.api.saved,
  pageSize: CONFIG.ui.pageSize,
  columns: COL_DEFS,
  colPrefKey: CONFIG.storage.colPrefPrefix + 'saved_page',
  defaultColPrefs: {
    topic_rating: false,
    topic_confidence: false,
    like_count: false,
    author: false,
    video: false,
  },
  emptyMessage: 'No saved comments yet. Use + on comments to save them here.',
  toolbarExtra: '<button class="btn btn-secondary" onclick="showExportModal()" style="white-space:nowrap">Export CSV</button><button class="btn btn-danger" onclick="showDeleteAllModal()" style="white-space:nowrap;border:1px solid rgba(255,45,45,0.3)">Delete All</button>',
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
