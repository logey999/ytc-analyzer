# Refactoring Analysis — ytc-analyzer

This document outlines identified refactoring opportunities across the YouTube Comments Analyzer codebase, prioritized by impact and effort.

---

## 📋 Executive Summary

The project contains significant **code duplication** in JavaScript table/comment management (600+ lines) and **architectural limitations** from a single-page design. The highest-impact refactoring is extracting reusable table and utility components, followed by splitting the dashboard into a multi-page application.

### Quick Stats
- **JavaScript Duplication**: ~600 lines (4 identical table implementations)
- **Shared Utilities**: 5+ functions duplicated across `dashboard.js` and `report.js`
- **CSS Duplication**: Common patterns in `dashboard.css`, `report.css`, `report-page.css`
- **Current Architecture**: Single-page app with 5 hidden panels

---

## 🎯 Priority 1: Table Management Deduplication (CRITICAL)

**Impact**: 🔴 High | **Effort**: 🟢 Low | **Estimated Time**: 2-4 hours

### Problem

The `dashboard.js` file (1000+ lines) contains **4 nearly identical table implementations** for managing different comment lists:

1. **Aggregate** (all comments across reports)
2. **Ideas** (saved/kept comments)
3. **Blacklist** (discarded comments)
4. **Deleted** (permanently removed comments)

Each implementation duplicates:

| Component | Code | Functions Involved |
|-----------|------|-------------------|
| **Load Logic** | ~50 lines × 4 | `loadAggregate`, `loadIdeas`, `loadBlacklist`, `loadDeleted` |
| **Render** | ~70 lines × 4 | `renderAggPage`, `renderIdeasTable`, `renderBlacklistTable`, `renderDeletedTable` |
| **Sort** | ~15 lines × 4 | `sortAggregate`, `sortIdeas`, `sortBlacklist`, `sortDeleted` |
| **Column Prefs** | ~10 lines × 4 | `toggleAggCol`, `toggleIdeaCol`, `toggleBlacklistCol`, `toggleDeletedCol` |
| **Pagination** | ~10 lines × 3 | `changeIdeasPage`, `changeBlacklistPage`, `changeDeletedPage` |
| **Action Handlers** | ~30 lines × 4+ | `aggToIdeas`, `ideasToBlacklist`, `blacklistToDeleted`, etc. |

**Total Duplicated Code**: ~600 lines

### Current Architecture

```javascript
// dashboard.js — Current approach
_aggregateLoaded = false;
_ideasLoaded = false;
_blacklistLoaded = false;
_deletedLoaded = false;

async function loadAggregate() { /* 35 lines */ }
function renderAggPage(page) { /* 50 lines */ }
function sortAggregate(col) { /* 8 lines */ }
function toggleAggCol(colName, visible) { /* 5 lines */ }

async function loadIdeas() { /* 35 lines */ }
function renderIdeasTable() { /* 60 lines */ }
function sortIdeas(col) { /* 8 lines */ }
function toggleIdeaCol(colName, visible) { /* 5 lines */ }

// ... repeat 2 more times for Blacklist and Deleted
```

### Proposed Solution: TableManager Class

Extract a reusable `TableManager` class to handle all table operations:

```javascript
// js/table-manager.js
class TableManager {
  constructor(config) {
    this.config = config; // panelId, apiEndpoint, pageSize, columns, etc.
    this.data = [];
    this.currentPage = 0;
    this.sortCol = 'like_count';
    this.sortDir = 'desc';
    this.colPrefs = this._loadPrefs();
    this.loaded = false;
  }

  async load() { /* Single implementation */ }
  render(page) { /* Single implementation */ }
  sort(col) { /* Single implementation */ }
  toggleColumn(colName, visible) { /* Single implementation */ }
  changePage(delta) { /* Single implementation */ }

  // Action handlers
  handleAction(actionType, commentId) { /* Unified */ }
}

// Usage:
const aggTable = new TableManager({
  panelId: 'panel-aggregate',
  apiEndpoint: '/api/reports',
  pageSize: 100,
  columns: COL_DEFS,
  onAction: handleAggAction,
});
```

### Benefits

- ✅ Reduce duplication by 600 lines
- ✅ Single source of truth for table logic
- ✅ Easier to add new table types (e.g., Favorites, Tags)
- ✅ Consistent behavior across all tables
- ✅ Easier to maintain and test

### Implementation Steps

1. Extract `TableManager` class to `js/table-manager.js`
2. Create config object for each table
3. Replace individual load/render/sort functions with manager calls
4. Update action handlers to delegate to managers
5. Remove duplicate state variables
6. Test each table implementation

---

## 🎯 Priority 2: Shared Utilities Extraction

**Impact**: 🟡 Medium | **Effort**: 🟢 Low | **Estimated Time**: 1-2 hours

### Problem

Both `dashboard.js` and `report.js` independently implement the same utility functions:

```javascript
// Duplicated in dashboard.js AND report.js
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtN(n) {
  const num = Number(n);
  return isNaN(num) ? '0' : num.toLocaleString();
}

function truncate(s, n) {
  return String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s);
}
```

**Duplicated Utilities:**
- HTML escaping: `esc()`, `escAttr()`
- Number formatting: `fmtN()`, `fmt()`
- String manipulation: `truncate()`, `secondsToHms()`
- DOM animation: `animateRowOut()`
- Sorting comparison: `_sortCmp()`

### Proposed Solution: Create `js/utils.js`

```javascript
// js/utils.js — Shared utilities
export const HTML = {
  esc(s) { /* ... */ },
  escAttr(s) { /* ... */ },
};

export const Format = {
  number(n) { /* ... */ },
  date(d) { /* ... */ },
  time(s) { /* ... */ },
  truncate(s, n) { /* ... */ },
};

export const DOM = {
  animateRowOut(tr, onDone) { /* ... */ },
  updateSortIndicators(panelId, sortCol, sortDir) { /* ... */ },
};

export const Sort = {
  compare(a, b, col, dir) { /* ... */ },
  dateCompare(a, b, dir) { /* ... */ },
};
```

### Usage

```javascript
// dashboard.js
import { HTML, Format, DOM, Sort } from './utils.js';

const rows = comments.map(c => `
  <tr>
    <td>${HTML.esc(c.text)}</td>
    <td>${Format.number(c.like_count)}</td>
  </tr>
`);
```

### Benefits

- ✅ Single source of truth for utilities
- ✅ Easier to maintain and update
- ✅ Reduced bundle size (deduplicated)
- ✅ Consistent behavior across pages
- ✅ Easier to test utilities in isolation

---

## 🎯 Priority 3: CSS Consolidation

**Impact**: 🟡 Medium | **Effort**: 🟡 Medium | **Estimated Time**: 3-4 hours

### Problem

CSS duplication across three files:

**Common Patterns:**

| Pattern | Files | Duplication |
|---------|-------|-------------|
| **Table styles** | `dashboard.css`, `report.css`, `report-page.css` | ✅ Column layout, headers, cells |
| **Button styles** | `dashboard.css`, `report-page.css` | ✅ Primary, secondary, action buttons |
| **Pagination** | `dashboard.css`, `report-page.css` | ✅ Buttons, info text, layout |
| **Column selectors** | `dashboard.css`, `report-page.css` | ✅ Checkboxes, labels, layout |
| **Animations** | `dashboard.css`, `report-page.css` | ✅ Row removal, transitions |
| **Utilities** | All files | ✅ Spacing, colors, fonts |

### Proposed Solution: Modular CSS Structure

```
css/
├── theme.css           (Colors, fonts, CSS variables) ✅ Already good
├── tables.css          (All table styles)
├── buttons.css         (All button components)
├── pagination.css      (Pagination controls)
├── forms.css           (Input, select, checkbox styles)
├── layout.css          (Grid, flexbox, spacing utilities)
├── animations.css      (Transitions, keyframes)
├── dashboard.css       (Dashboard-specific only)
├── report-page.css     (Report page-specific only)
└── report.css          (Embedded report-specific) - remains as-is
```

### Current Files Structure

**dashboard.css**: ~400 lines
- Panel nav (tabs) ✅ Keep
- Sidebar layout ✅ Keep
- URL form ✅ Keep
- **Tables** → Extract to `tables.css`
- **Buttons** → Extract to `buttons.css`
- **Pagination** → Extract to `pagination.css`
- **Animations** → Extract to `animations.css`

**report-page.css**: ~200 lines
- Video card ✅ Keep
- Tabs ✅ Keep
- **Tables** → Extract to `tables.css`
- **Buttons** → Extract to `buttons.css`
- **Pagination** → Extract to `pagination.css`
- **Animations** → Extract to `animations.css`

### New Structure

```css
/* tables.css */
.table-wrap { /* ... */ }
table { /* ... */ }
thead { /* ... */ }
tbody { /* ... */ }
td, th { /* ... */ }
.sortable { /* ... */ }
.col-actions, .col-text, .col-likes, etc. { /* ... */ }

/* buttons.css */
.btn { /* ... */ }
.btn-primary { /* ... */ }
.btn-action { /* ... */ }
.btn-keep, .btn-blacklist, .btn-delete { /* ... */ }

/* pagination.css */
.pagination-bar { /* ... */ }
.pg-btn { /* ... */ }
.pg-info { /* ... */ }
.agg-toolbar { /* ... */ }
```

### Implementation Steps

1. Create `css/tables.css` with all table styling
2. Create `css/buttons.css` with all button styling
3. Create `css/pagination.css` with pagination styling
4. Create `css/animations.css` with transitions/keyframes
5. Create `css/forms.css` with form element styling
6. Remove duplicated CSS from `dashboard.css` and `report-page.css`
7. Update `index.html` and `report.html` to include new files
8. Verify styling across all pages

### Benefits

- ✅ Eliminate ~150 lines of CSS duplication
- ✅ Easier to maintain component styles
- ✅ Reusable styles across multiple pages
- ✅ Better separation of concerns
- ✅ Smaller individual CSS files

---

## 🎯 Priority 4: Multi-Page Architecture

**Impact**: 🟡 Medium | **Effort**: 🔴 High | **Estimated Time**: 8-12 hours

### Problem

**Current State**: Single `index.html` with 5 hidden panels

```html
<div class="reports-panel">
  <div id="panel-reports" class="reports-list"><!-- Reports --></div>
  <div id="panel-aggregate" style="display:none"><!-- Aggregate --></div>
  <div id="panel-ideas" style="display:none"><!-- Ideas --></div>
  <div id="panel-blacklist" style="display:none"><!-- Blacklist --></div>
  <div id="panel-deleted" style="display:none"><!-- Deleted --></div>
</div>
```

**Issues:**
- All JavaScript loaded regardless of current panel
- Single `dashboard.js` is monolithic (1000+ lines)
- Tab switching is all JavaScript
- All CSS loaded upfront
- Difficult to navigate directly to a specific panel
- No browser history support (can't back/forward)

### Proposed Solution: Multi-Page Redesign

**New Structure:**

```
├── index.html               → / (Dashboard - reports list)
├── aggregate.html           → /aggregate (All comments)
├── ideas.html               → /ideas (Saved ideas)
├── blacklist.html           → /blacklist (Discarded)
├── deleted.html             → /deleted (Permanently removed)
└── report.html              → /report?path=... (existing, unchanged)
```

**New Navigation:**

```javascript
// In header (shared component)
<nav>
  <a href="/">Dashboard</a>
  <a href="/aggregate">Aggregate</a>
  <a href="/ideas">Ideas</a>
  <a href="/blacklist">Blacklist</a>
  <a href="/deleted">Deleted</a>
</nav>
```

### Layout Changes

**Dashboard (`index.html`)**
```
┌─────────────────────────────────────────┐
│ Header + Nav                            │
├──────────┬──────────────────────────────┤
│          │ Reports List                 │
│ Sidebar  │ (Search, filters)            │
│          │                              │
└──────────┴──────────────────────────────┘
```

**Other Pages (`aggregate.html`, etc.)**
```
┌─────────────────────────────────────────┐
│ Header + Nav                            │
├─────────────────────────────────────────┤
│ Table Toolbar (filters, col selector)   │
│ ┌─────────────────────────────────────┐ │
│ │ Table (with sorting, pagination)    │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### JavaScript Organization

**Before:**
```
js/
├── dashboard.js (1000+ lines)
└── report.js (512 lines)
```

**After:**
```
js/
├── utils.js                    (Shared utilities)
├── table-manager.js            (Table component)
├── config.js                   (Configuration)
├── dashboard.js                (Dashboard page ~300 lines)
├── table-page.js               (Shared for table pages ~200 lines)
├── aggregate.js                (Aggregate page ~100 lines)
├── ideas.js                    (Ideas page ~100 lines)
├── blacklist.js                (Blacklist page ~100 lines)
├── deleted.js                  (Deleted page ~100 lines)
└── report.js                   (Report viewer ~512 lines)
```

### HTML Changes

**Shared Header (Optional: Create `includes/header.html` or as Jinja template)**

```html
<header>
  <a href="/" class="header-link">
    <div class="header-icon">&#9654;</div>
    <div class="header-text">
      <h1>ytc-analyzer</h1>
      <span class="subtitle">YouTube Comment Analyzer</span>
    </div>
  </a>
  <nav class="header-nav">
    <a href="/">Dashboard</a>
    <a href="/aggregate">Aggregate</a>
    <a href="/ideas">Ideas</a>
    <a href="/blacklist">Blacklist</a>
    <a href="/deleted">Deleted</a>
  </nav>
</header>
```

### Benefits

- ✅ Smaller JavaScript files (better performance)
- ✅ Lazy-loading of page-specific code
- ✅ Browser history support (back/forward)
- ✅ Direct URLs to specific pages
- ✅ Cleaner separation of concerns
- ✅ Easier to add new pages (e.g., Favorites, Tags)
- ✅ SEO-friendly page structure
- ✅ Reduced initial load time

### Implementation Steps

1. Refactor `dashboard.js` → Extract common functions to `utils.js`
2. Create `js/table-manager.js` (Priority 1)
3. Create `js/table-page.js` (shared logic for all table pages)
4. Create `aggregate.html` with minimal configuration
5. Create `ideas.html`, `blacklist.html`, `deleted.html`
6. Update `server.py` to serve new routes
7. Test navigation and functionality on each page
8. Update internal links to use new URLs

### Server Changes Required

```python
# server.py additions
@app.route('/')
def index():
    return send_from_directory(PROJECT_ROOT, 'index.html')

@app.route('/aggregate')
def aggregate():
    return send_from_directory(PROJECT_ROOT, 'aggregate.html')

@app.route('/ideas')
def ideas():
    return send_from_directory(PROJECT_ROOT, 'ideas.html')

@app.route('/blacklist')
def blacklist():
    return send_from_directory(PROJECT_ROOT, 'blacklist.html')

@app.route('/deleted')
def deleted():
    return send_from_directory(PROJECT_ROOT, 'deleted.html')

@app.route('/report')
def report():
    return send_from_directory(PROJECT_ROOT, 'report.html')
```

---

## 🎯 Priority 5: Panel Manager Class

**Impact**: 🟢 Low | **Effort**: 🟢 Low | **Estimated Time**: 1-2 hours

### Problem

Current state management is scattered:

```javascript
let _aggregateLoaded = false;
let _ideasLoaded = false;
let _blacklistLoaded = false;
let _deletedLoaded = false;

function switchPanel(name) {
  PANELS.forEach(p => {
    document.getElementById('panel-' + p).style.display = (p === name) ? '' : 'none';
    document.getElementById('ptab-' + p).classList.toggle('active', p === name);
  });
  // ... more logic
  if (name === 'aggregate' && !_aggregateLoaded) loadAggregate();
  if (name === 'ideas' && !_ideasLoaded) loadIdeas();
  // ...
}
```

### Proposed Solution: PanelManager Class

```javascript
// js/panel-manager.js
class PanelManager {
  constructor() {
    this.panels = new Map(); // panelId → {loaded, manager, config}
    this.currentPanel = 'reports';
  }

  register(panelId, config) {
    this.panels.set(panelId, {
      loaded: false,
      manager: null,
      config: config,
    });
  }

  async switchTo(panelId) {
    // Hide all panels
    this.panels.forEach((panel, id) => {
      document.getElementById('panel-' + id).style.display = 'none';
      document.getElementById('ptab-' + id).classList.remove('active');
    });

    // Show new panel
    document.getElementById('panel-' + panelId).style.display = '';
    document.getElementById('ptab-' + panelId).classList.add('active');

    // Load if not already loaded
    const panel = this.panels.get(panelId);
    if (!panel.loaded && panel.config.load) {
      panel.manager = new TableManager(panel.config);
      await panel.manager.load();
      panel.loaded = true;
    }

    this.currentPanel = panelId;
  }
}

// Usage:
const panelMgr = new PanelManager();
panelMgr.register('aggregate', { apiEndpoint: '/api/reports', /* ... */ });
panelMgr.register('ideas', { apiEndpoint: '/api/ideas', /* ... */ });
// ...

document.getElementById('ptab-aggregate').onclick = () => panelMgr.switchTo('aggregate');
```

### Benefits

- ✅ Centralized panel state management
- ✅ Consistent lazy-loading behavior
- ✅ Easier to add new panels
- ✅ Better separation of concerns

---

## 🎯 Priority 6: Configuration Extraction

**Impact**: 🟢 Low | **Effort**: 🟢 Low | **Estimated Time**: 1-2 hours

### Problem

Constants scattered throughout JavaScript:

```javascript
// dashboard.js
const MAX_JOBS = 10;
const AGG_PAGE_SIZE = 100;
const IDEAS_PAGE_SIZE = 100;
const BLACKLIST_PAGE_SIZE = 100;
const DELETED_PAGE_SIZE = 100;
const PANELS = ['reports', 'aggregate', 'ideas', 'blacklist', 'deleted'];

const COL_DEFS = [
  {id: 'text', label: 'Comment'},
  {id: 'like_count', label: 'Likes'},
  // ...
];

// report.js
const PAGE_SIZE = 100;
const REPORT_COLS = [
  {id: 'text', label: 'Comment'},
  {id: 'like_count', label: 'Likes'},
  // ...
];
```

### Proposed Solution: Create `js/config.js`

```javascript
// js/config.js
export const CONFIG = {
  api: {
    reports: '/api/reports',
    report: '/api/report',
    ideas: '/api/ideas',
    blacklist: '/api/blacklist',
    deleted: '/api/deleted',
    quota: '/api/quota',
  },

  ui: {
    maxJobs: 10,
    pageSize: 100,
  },

  columns: {
    table: [
      { id: 'text', label: 'Comment' },
      { id: 'like_count', label: 'Likes' },
      { id: 'author', label: 'Author' },
      { id: 'video', label: 'Video' }, // for aggregate
    ],
    report: [
      { id: 'text', label: 'Comment' },
      { id: 'like_count', label: 'Likes' },
      { id: 'author', label: 'Author' },
    ],
  },

  panels: {
    list: ['reports', 'aggregate', 'ideas', 'blacklist', 'deleted'],
    defaults: {
      aggregate: { pageSize: 100, sortCol: 'like_count' },
      ideas: { pageSize: 100, sortCol: 'like_count' },
      blacklist: { pageSize: 100, sortCol: 'like_count' },
      deleted: { pageSize: 100, sortCol: 'like_count' },
    },
  },

  storage: {
    colPrefKey: 'ytca_cols_',
    sortPrefKey: 'ytca_sort_',
  },
};

// Usage:
import { CONFIG } from './config.js';

const pageSize = CONFIG.ui.pageSize;
const columns = CONFIG.columns.table;
const apiUrl = CONFIG.api.ideas;
```

### Benefits

- ✅ Single source of truth for config
- ✅ Easier to adjust constants (page size, limits, etc.)
- ✅ No magic strings scattered throughout code
- ✅ Better for environment-specific config (dev vs. prod)

---

## 🎯 Priority 7: Server-Side Comment Storage

**Impact**: 🟡 Medium | **Effort**: 🟡 Medium | **Estimated Time**: 3-4 hours

### Problem

Comment storage logic is scattered in `server.py`:

```python
# server.py
DISCARDED_PATH = os.path.join(PROJECT_ROOT, "Reports", "discarded.json")
IDEAS_PATH = os.path.join(PROJECT_ROOT, "Reports", "ideas.json")
DELETED_PATH = os.path.join(PROJECT_ROOT, "Reports", "deleted.json")

def _load_json_store(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default

def _save_json_store(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)

# Endpoint code mixes loading/saving with HTTP logic
@app.route('/api/comment/keep', methods=['POST'])
def api_keep_comment():
    # ... load ideas.json, add comment, save ...
```

### Proposed Solution: CommentStore Class

```python
# Scripts/comment_store.py
import json
import os
import threading
from typing import List, Dict, Any

class CommentStore:
    """Persistent storage for comment collections (Ideas, Blacklist, Deleted)."""

    def __init__(self, store_path: str, store_type: str):
        self.store_path = store_path
        self.store_type = store_type
        self._lock = threading.Lock()

    def load(self) -> List[Dict[str, Any]]:
        """Load all comments from store."""
        try:
            with open(self.store_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    def save(self, comments: List[Dict[str, Any]]) -> None:
        """Atomically save comments to store."""
        with self._lock:
            tmp = self.store_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(comments, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.store_path)

    def add(self, comment: Dict[str, Any]) -> None:
        """Add a comment to the store (prevent duplicates)."""
        with self._lock:
            comments = self.load()
            if not any(c.get('id') == comment.get('id') for c in comments):
                comments.insert(0, comment)  # Most recent first
                self.save(comments)

    def remove(self, comment_id: str) -> None:
        """Remove a comment by ID."""
        with self._lock:
            comments = self.load()
            comments = [c for c in comments if c.get('id') != comment_id]
            self.save(comments)

    def get(self, comment_id: str) -> Dict[str, Any] | None:
        """Get a single comment by ID."""
        for comment in self.load():
            if comment.get('id') == comment_id:
                return comment
        return None

    def exists(self, comment_id: str) -> bool:
        """Check if a comment exists in the store."""
        return self.get(comment_id) is not None

    def move_to(self, comment_id: str, destination_store: 'CommentStore') -> None:
        """Move a comment to another store."""
        with self._lock:
            comment = self.get(comment_id)
            if comment:
                self.remove(comment_id)
                destination_store.add(comment)

# Usage:
ideas_store = CommentStore('Reports/ideas.json', 'ideas')
blacklist_store = CommentStore('Reports/discarded.json', 'blacklist')
deleted_store = CommentStore('Reports/deleted.json', 'deleted')

# In routes:
@app.route('/api/comment/keep', methods=['POST'])
def api_keep_comment():
    data = request.get_json()
    comment = data.get('comment', {})
    ideas_store.add(comment)
    return jsonify({'success': True})
```

### Benefits

- ✅ Centralized comment persistence logic
- ✅ Consistent CRUD operations
- ✅ Thread-safe operations
- ✅ Easier to test
- ✅ Prevents duplicate comments
- ✅ Easier to add new features (bulk operations, search, etc.)

---

## 🎯 Priority 8: Event-Driven Architecture

**Impact**: 🟢 Low | **Effort**: 🟡 Medium | **Estimated Time**: 2-3 hours

### Problem

Current architecture uses direct function calls and global state mutations:

```javascript
// dashboard.js
async function aggToIdeas(evt, commentId) {
  // Direct mutation of global state
  const comment = _aggComments.find(c => c.id === commentId);
  _postAction('/api/comment/keep', comment);
  _addToListIfLoaded(_ideasComments, _ideasLoaded, comment);
  _aggRemove(commentId, row, () => renderAggPage(_aggPage));
}
```

**Issues:**
- Tight coupling between comment lists
- Hard to trace side effects
- Difficult to add new behaviors without modifying existing functions

### Proposed Solution: Event Emitter

```javascript
// js/event-bus.js
class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType).push(callback);
  }

  off(eventType, callback) {
    const list = this.listeners.get(eventType);
    if (list) {
      const idx = list.indexOf(callback);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  emit(eventType, data) {
    const list = this.listeners.get(eventType) || [];
    list.forEach(cb => cb(data));
  }
}

export const eventBus = new EventBus();

// Usage:
eventBus.on('comment:kept', (comment) => {
  console.log('Comment kept:', comment);
  // Update UI, sync stores, etc.
});

eventBus.emit('comment:kept', { id: '123', text: '...' });
```

### Benefits

- ✅ Loose coupling between components
- ✅ Easier to add new behaviors
- ✅ Centralized event handling
- ✅ Better testability

---

## 🎯 Priority 9: API Endpoint Organization

**Impact**: 🟡 Medium | **Effort**: 🟡 Medium | **Estimated Time**: 3-4 hours

### Problem

`server.py` mixes concerns:
- Comment persistence logic
- Report discovery logic
- Analysis job management
- HTTP routing

All in a single 500+ line file.

### Proposed Solution: Modular API Routes

```
Scripts/
├── server.py              (Flask app, main routes)
├── api/
│   ├── __init__.py
│   ├── reports.py         (GET /api/reports, /api/report/<path>)
│   ├── comments.py        (POST/DELETE /api/comment/*, /api/ideas, /api/blacklist, /api/deleted)
│   ├── analysis.py        (POST /api/analyze, /api/progress, /api/quota)
│   └── jobs.py            (GET /api/job/<job_id>)
└── models/
    ├── __init__.py
    ├── comment_store.py   (CommentStore class)
    ├── job_manager.py     (JobManager class)
    └── report_scanner.py  (Report discovery)
```

### Example: `api/comments.py`

```python
# Scripts/api/comments.py
from flask import Blueprint, jsonify, request
from ..comment_store import CommentStore

comments_bp = Blueprint('comments', __name__, url_prefix='/api')

ideas_store = CommentStore('Reports/ideas.json', 'ideas')
blacklist_store = CommentStore('Reports/discarded.json', 'blacklist')
deleted_store = CommentStore('Reports/deleted.json', 'deleted')

@comments_bp.route('/comment/keep', methods=['POST'])
def keep_comment():
    data = request.get_json()
    comment = data.get('comment')
    ideas_store.add(comment)
    return jsonify({'success': True})

@comments_bp.route('/comment/discard', methods=['POST'])
def discard_comment():
    data = request.get_json()
    comment = data.get('comment')
    blacklist_store.add(comment)
    return jsonify({'success': True})

@comments_bp.route('/ideas', methods=['GET'])
def get_ideas():
    return jsonify(ideas_store.load())
```

### Usage in `server.py`

```python
# Scripts/server.py
from flask import Flask
from api.comments import comments_bp
from api.reports import reports_bp
from api.analysis import analysis_bp

app = Flask(__name__)
app.register_blueprint(comments_bp)
app.register_blueprint(reports_bp)
app.register_blueprint(analysis_bp)
```

### Benefits

- ✅ Better separation of concerns
- ✅ Easier to test individual endpoints
- ✅ Easier to add new endpoints
- ✅ More maintainable code structure
- ✅ Reusable API blueprints

---

## 🎯 Priority 10: Table Builder Component

**Impact**: 🟢 Low | **Effort**: 🟡 Medium | **Estimated Time**: 2-3 hours

### Problem

Table HTML is built via template strings in JavaScript, scattered across functions.

### Proposed Solution: TableBuilder Class

```javascript
// js/table-builder.js
class TableBuilder {
  constructor(config) {
    this.columns = config.columns || [];
    this.actionButtons = config.actionButtons || [];
    this.sortable = config.sortable !== false;
  }

  buildHeader() {
    const headers = this.columns.map(col => `
      <th data-colname="${col.id}" ${this.sortable && !col.nosort ? 'class="sortable"' : ''}>
        ${col.label}
      </th>
    `).join('');

    return `<thead><tr>${headers}</tr></thead>`;
  }

  buildRow(data, context = {}) {
    const cells = this.columns.map(col => `
      <td data-colname="${col.id}" class="col-${col.id}">
        ${col.render ? col.render(data[col.id], data, context) : this._escape(data[col.id])}
      </td>
    `).join('');

    const actions = this.actionButtons.map(btn => `
      <button class="btn-action ${btn.className}"
              title="${btn.title}"
              onclick="${btn.onclick}">
        ${btn.icon || btn.label}
      </button>
    `).join('');

    return `<tr><td class="col-actions">${actions}</td>${cells}</tr>`;
  }

  buildRows(data, context = {}) {
    return data.map(item => this.buildRow(item, context)).join('');
  }

  buildTable(rows) {
    return `
      <div class="table-wrap">
        <table>
          ${this.buildHeader()}
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  _escape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
```

### Usage

```javascript
const tableBuilder = new TableBuilder({
  columns: [
    { id: 'text', label: 'Comment', render: (v) => escapeHtml(v) },
    { id: 'like_count', label: 'Likes', render: (v) => formatNumber(v) },
    { id: 'author', label: 'Author' },
  ],
  actionButtons: [
    { className: 'btn-keep', icon: '♥', onclick: 'actionKeep(event, this)' },
    { className: 'btn-discard', icon: '✕', onclick: 'actionDiscard(event, this)' },
  ],
});

const html = tableBuilder.buildTable(
  tableBuilder.buildRows(comments)
);
```

### Benefits

- ✅ Reusable table generation
- ✅ Consistent HTML structure
- ✅ Easier to customize columns
- ✅ Better separation of HTML generation from logic

---

## 📊 Summary: Impact vs. Effort

| Priority | Opportunity | Impact | Effort | Est. Time | Status |
|----------|------------|--------|--------|-----------|--------|
| 1 | Table Deduplication | 🔴 High | 🟢 Low | 2-4h | 🔵 Ready |
| 2 | Shared Utilities | 🟡 Med | 🟢 Low | 1-2h | 🔵 Ready |
| 3 | CSS Consolidation | 🟡 Med | 🟡 Med | 3-4h | 🔵 Ready |
| 4 | Multi-Page Split | 🟡 Med | 🔴 High | 8-12h | 📋 Plan |
| 5 | Panel Manager | 🟢 Low | 🟢 Low | 1-2h | 🟢 Optional |
| 6 | Config Extraction | 🟢 Low | 🟢 Low | 1-2h | 🟢 Optional |
| 7 | Comment Store | 🟡 Med | 🟡 Med | 3-4h | 🔵 Ready |
| 8 | Event-Driven | 🟢 Low | 🟡 Med | 2-3h | 🟢 Optional |
| 9 | API Organization | 🟡 Med | 🟡 Med | 3-4h | 🟢 Optional |
| 10 | Table Builder | 🟢 Low | 🟡 Med | 2-3h | 🟢 Optional |

---

## 🚀 Recommended Refactoring Path

### Phase 1: Quick Wins (Low effort, high impact) — 6-8 hours
1. ✅ Extract `js/utils.js` (Priority 2) — 1-2h
2. ✅ Create `js/table-manager.js` (Priority 1) — 2-4h
3. ✅ Consolidate CSS (Priority 3) — 3-4h

**Result**: 600+ lines of duplicate code eliminated, better code organization

### Phase 2: Structural Improvements — 4-6 hours
4. Create `js/config.js` (Priority 6) — 1-2h
5. Create `CommentStore` class (Priority 7) — 3-4h

**Result**: Cleaner separation of concerns, easier to maintain and extend

### Phase 3: Architecture Redesign (Optional, high effort) — 12-16 hours
6. Split into multi-page app (Priority 4) — 8-12h
7. Implement event-driven architecture (Priority 8) — 2-3h
8. Organize API routes (Priority 9) — 3-4h

**Result**: Better scalability, easier navigation, improved performance

---

## ✅ Implementation Checklist

**Phase 1 Implementation**
- [ ] Create `js/utils.js` with shared functions
- [ ] Update `dashboard.js` to use shared utilities
- [ ] Update `report.js` to use shared utilities
- [ ] Create `js/table-manager.js` class
- [ ] Replace table rendering logic with TableManager
- [ ] Create modular CSS files (tables, buttons, pagination, forms, animations)
- [ ] Update `index.html` and `report.html` to include new CSS files
- [ ] Test all table functionality (sort, paginate, column visibility)

**Phase 2 Implementation**
- [ ] Create `js/config.js`
- [ ] Update `js/` files to import from config
- [ ] Create `Scripts/comment_store.py`
- [ ] Update `server.py` to use CommentStore
- [ ] Test all comment operations (add, remove, move)

**Phase 3 Implementation** (Optional)
- [ ] Create `aggregate.html`, `ideas.html`, `blacklist.html`, `deleted.html`
- [ ] Create page-specific JS files
- [ ] Update `server.py` with new routes
- [ ] Implement event bus
- [ ] Refactor API routes into separate modules

---

## 📝 Notes

- All refactoring should be **backwards compatible** with existing functionality
- **Test thoroughly** after each phase
- Consider **creating a feature branch** for multi-page refactoring
- **Update documentation** as needed
- **Performance should improve** due to smaller JS files and better code organization

