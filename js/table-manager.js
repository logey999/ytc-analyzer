// ── TableManager: Unified table abstraction ────────────────────────────────────
//
// Manages a single data table with pagination, sorting, column visibility,
// and row animations. Reduces ~600 lines of duplication from dashboard.js

class TableManager {
  constructor(config) {
    // config: {
    //   panelId: string,           // DOM id of panel container
    //   apiEndpoint: string,       // API endpoint to fetch data from
    //   pageSize: number,          // items per page
    //   columns: array,            // column definitions [{id, label}, ...]
    //   colPrefKey: string,        // localStorage key for column preferences
    //   tabCountId: string,        // DOM id of tab count element (optional)
    //   actions: array,            // action buttons [{label, title, className, handler}, ...]
    //   emptyMessage: string,      // message when no data
    //   onLoad: function,          // callback after loading (optional)
    // }
    this.config = config;
    this.data = [];
    this.page = 0;
    this.sortCol = 'like_count';
    this.sortDir = 'desc';

    // Load column visibility preferences
    this.colPrefs = JSON.parse(
      localStorage.getItem(config.colPrefKey) || '{}'
    );

    this.loaded = false;
    this.loading = false;
  }

  // Load data from API endpoint
  async load() {
    if (this.loading) return;
    this.loading = true;

    const pane = document.getElementById(this.config.panelId);
    if (pane) {
      pane.innerHTML = '<div class="reports-empty">Loading…</div>';
    }

    try {
      const res = await fetch(this.config.apiEndpoint);
      const items = await res.json();

      // Handle nested data structures (e.g., aggregate loading all reports)
      this.data = Array.isArray(items) ? items : [];
      this.page = 0;
      this.loaded = true;

      // Sort by default
      this.sort(this.sortCol, this.sortDir);

      // Update tab count
      this.setTabCount(this.data.length);

      // Re-render
      this.render();

      // Call optional callback
      if (this.config.onLoad) {
        this.config.onLoad();
      }
    } catch (e) {
      pane.innerHTML = `<div class="reports-empty">Failed to load: ${esc(e.message)}</div>`;
    }

    this.loading = false;
  }

  // Render current page of data
  render() {
    const total = this.data.length;
    const totalPages = Math.max(1, Math.ceil(total / this.config.pageSize));
    this.page = Math.max(0, Math.min(this.page, totalPages - 1));
    const start = this.page * this.config.pageSize;
    const slice = this.data.slice(start, start + this.config.pageSize);

    // Check if empty
    if (!total) {
      document.getElementById(this.config.panelId).innerHTML =
        `<div class="reports-empty">${this.config.emptyMessage || 'No data.'}</div>`;
      this.setTabCount(0);
      return;
    }

    // Build rows
    const rows = slice.map((c, idx) => this._buildRow(c, start + idx)).join('');

    // Build paginator
    const info = `Page ${this.page + 1} of ${totalPages} &nbsp;·&nbsp; ${total.toLocaleString()} total`;
    const atFirst = this.page === 0;
    const atLast = this.page >= totalPages - 1;
    const paginator = `
      <div class="agg-toolbar">
        <span class="pg-info">${info}</span>
        <div style="display:flex;gap:8px">
          <button class="pg-btn" onclick="__tableManagers['${this.config.panelId}'].changePage(-1)" ${atFirst ? 'disabled' : ''}>&#8592; Prev</button>
          <button class="pg-btn" onclick="__tableManagers['${this.config.panelId}'].changePage(1)"  ${atLast ? 'disabled' : ''}>Next &#8594;</button>
        </div>
      </div>`;

    // Build column selector
    const colSelector = buildColSelector(
      this.config.columns,
      this.colPrefs,
      `__tableManagers['${this.config.panelId}'].toggleColumn`
    );

    // Render to DOM
    const panel = document.getElementById(this.config.panelId);
    const theadHtml = this._buildTableHead();
    panel.innerHTML = `
      ${colSelector}
      ${paginator}
      <div class="table-wrap"><table>
        <thead>${theadHtml}</thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${paginator}`;

    // Apply column visibility
    this.applyColVisibility();

    // Update sort indicators
    this.updateSortIndicators();

    // Update tab count
    this.setTabCount(total);
  }

  // Build a single row
  _buildRow(comment, rank) {
    const actions = this.config.actions
      .map(a => `
        <button class="btn-action ${a.className}" title="${a.title}"
          onclick="__tableManagers['${this.config.panelId}'].handleAction('${a.label}', event, '${escAttr(comment.id)}')">
          ${a.label}
        </button>
      `).join('');

    const columns = this.config.columns.map(col => {
      let val = comment[col.id] ?? '';
      if (col.id === 'video' || col.id === '_reportTitle') {
        const path = comment._reportPath;
        const title = comment._reportTitle || path;
        val = path
          ? `<a href="/report?path=${encodeURIComponent(path)}" title="${escAttr(title)}">${esc(truncate(title, 28))}</a>`
          : '—';
        return `<td class="col-${col.id}" data-colname="${col.id}">${val}</td>`;
      }
      if (col.id === 'like_count') {
        val = fmtN(val);
      } else {
        val = esc(val);
      }
      return `<td class="col-${col.id}" data-colname="${col.id}">${val}</td>`;
    }).join('');

    return `<tr>
      <td class="col-actions" data-colname="actions">${actions}</td>
      ${columns}
    </tr>`;
  }

  // Build table head
  _buildTableHead() {
    const colHeaders = this.config.columns.map(col => `
      <th data-colname="${col.id}" class="sortable" onclick="__tableManagers['${this.config.panelId}'].sort('${col.id}')">
        ${col.label}
      </th>
    `).join('');

    return `<tr>
      <th data-colname="actions"></th>
      ${colHeaders}
    </tr>`;
  }

  // Handle action button click
  handleAction(actionLabel, evt, commentId) {
    evt.stopPropagation();
    const action = this.config.actions.find(a => a.label === actionLabel);
    if (!action) return;

    const comment = this.data.find(c => c.id === commentId);
    if (!comment) return;

    const row = evt.target.closest('tr');
    if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);

    // Call the action handler
    action.handler(comment, row, this);
  }

  // Remove a row from the table
  removeRow(commentId, rowEl, onDone) {
    if (!rowEl) {
      // No animation, just remove from data and re-render
      const idx = this.data.findIndex(c => c.id === commentId);
      if (idx >= 0) this.data.splice(idx, 1);
      this.render();
      if (onDone) onDone();
      return;
    }

    // Animate out and remove
    animateRowOut(rowEl, () => {
      const idx = this.data.findIndex(c => c.id === commentId);
      if (idx >= 0) this.data.splice(idx, 1);
      this.render();
      if (onDone) onDone();
    });
  }

  // Change page
  changePage(delta) {
    this.page += delta;
    this.render();
  }

  // Sort by column
  sort(col, dir = null) {
    if (col === this.sortCol && dir === null) {
      // Toggle direction
      this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      // New column
      this.sortCol = col;
      this.sortDir = dir || 'desc';
    }

    this.data.sort((a, b) => _sortCmp(a, b, this.sortCol, this.sortDir));
    this.page = 0;
    this.render();
  }

  // Toggle column visibility
  toggleColumn(colName, visible) {
    this.colPrefs[colName] = visible;
    localStorage.setItem(this.config.colPrefKey, JSON.stringify(this.colPrefs));
    this.applyColVisibility();
  }

  // Apply column visibility preferences
  applyColVisibility() {
    const panel = document.getElementById(this.config.panelId);
    if (!panel) return;
    Object.entries(this.colPrefs).forEach(([col, visible]) => {
      const display = visible ? '' : 'none';
      panel.querySelectorAll(`[data-colname="${col}"]`).forEach(el => {
        el.style.display = display;
      });
    });
  }

  // Update sort indicators (arrows on column headers)
  updateSortIndicators() {
    const panel = document.getElementById(this.config.panelId);
    if (!panel) return;
    panel.querySelectorAll('th.sort-active').forEach(th => {
      th.classList.remove('sort-active', 'sort-asc');
    });
    const th = panel.querySelector(`th[data-colname="${this.sortCol}"]`);
    if (th) {
      th.classList.add('sort-active');
      if (this.sortDir === 'asc') th.classList.add('sort-asc');
    }
  }

  // Update tab count badge
  setTabCount(n) {
    if (!this.config.tabCountId) return;
    const el = document.getElementById(this.config.tabCountId);
    if (el) el.textContent = (typeof n === 'number' && n > 0) ? n.toLocaleString() : '—';
  }

  // Add a comment to the table (for moves from other tables)
  addComment(comment) {
    if (!this.data.some(c => c.id === comment.id)) {
      this.data.unshift(comment);
    }
  }
}

// Global registry to allow onclick handlers to call TableManager methods
const __tableManagers = {};
