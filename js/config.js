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
    saved: '/api/saved',
    blacklist: '/api/blacklist',
    deleted: '/api/deleted',
    analyze: '/api/analyze',
    progress: '/api/progress',
    commentSave: '/api/comment/save',
    commentBlacklist: '/api/comment/blacklist',
    commentDelete: '/api/comment/delete',
    aiScore: '/api/ai-score',
    aiScoreAggregate: '/api/ai-score-aggregate',
  },

  // Panel names
  panels: ['reports', 'aggregate', 'saved', 'blacklist', 'deleted'],

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
      { id: 'topic_rating', label: 'Score' },
      { id: 'topic_confidence', label: 'Conf%' },
      { id: 'author', label: 'Author' },
      { id: 'video', label: 'Video' },
    ],
    // Blacklist view columns (includes reason)
    blacklist: [
      { id: 'text', label: 'Comment' },
      { id: 'reason', label: 'Reason' },
      { id: 'like_count', label: 'Likes' },
      { id: 'author', label: 'Author' },
      { id: 'video', label: 'Video' },
      
    ],
  },
};
