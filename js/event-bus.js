// ── Event Bus: Simple pub/sub for cross-component communication ────────────────
//
// Allows comment action events to trigger updates across different tables
// within the same session. Primarily useful for updates to tab counts and
// removing comments from other tables when moved.

const eventBus = {
  _listeners: {},

  /**
   * Subscribe to an event
   * @param {string} event - Event name (e.g., 'comment:kept')
   * @param {function} callback - Function to call when event fires
   */
  on(event, callback) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(callback);
  },

  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {function} callback - The callback to remove
   */
  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  },

  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {object} data - Data to pass to subscribers
   */
  emit(event, data) {
    if (!this._listeners[event]) return;
    this._listeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (e) {
        console.error(`Error in event handler for ${event}:`, e);
      }
    });
  },
};

// ── Event types ────────────────────────────────────────────────────────────────
//
// comment:kept      - Comment moved to Keep { commentId, reportPath }
// comment:discarded - Comment moved to Blacklist { commentId, reportPath }
// comment:deleted   - Comment moved to Deleted { commentId, reportPath }
// comment:restored  - Comment moved back (from blacklist/deleted) { commentId, reportPath }
//
// Usage:
//   eventBus.emit('comment:kept', { commentId: '123', reportPath: 'path' });
//   eventBus.on('comment:kept', (data) => {
//     console.log('Comment kept:', data.commentId);
//   });
