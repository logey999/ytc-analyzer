// ── Global Configuration ──────────────────────────────────────────────────────

const CONFIG = {
  // UI constants
  ui: {
    pageSize: 100,
    maxJobs: 10,
  },

  // API endpoints
  api: {
    reports: '/api/reports',
    reportData: '/api/report-data',
    ideas: '/api/ideas',
    blacklist: '/api/blacklist',
    deleted: '/api/deleted',
    quota: '/api/quota',
    analyze: '/api/analyze',
    progress: '/api/progress',
    commentKeep: '/api/comment/keep',
    commentDiscard: '/api/comment/discard',
    commentDelete: '/api/comment/delete',
  },

  // Panel names
  panels: ['reports', 'aggregate', 'ideas', 'blacklist', 'deleted'],

  // Local storage keys
  storage: {
    colPrefPrefix: 'ytca_cols_',
  },

  // Column definitions for each view
  columns: {
    // Report page columns
    report: [
      { id: 'text', label: 'Comment' },
      { id: 'like_count', label: 'Likes' },
      { id: 'author', label: 'Author' },
    ],
    // Aggregate view columns
    aggregate: [
      { id: 'text', label: 'Comment' },
      { id: 'like_count', label: 'Likes' },
      { id: 'author', label: 'Author' },
      { id: 'video', label: 'Video' },
    ],
  },
};
