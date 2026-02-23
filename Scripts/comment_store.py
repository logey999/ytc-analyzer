"""
CommentStore: Unified abstraction for persisting comment data to Parquet files.

Handles loading, saving, and manipulating comment lists with:
- Atomic write operations (write to temp file, then move)
- Thread-safe operations via lock
- Deduplication by comment ID
- Simple CRUD operations
- One-time migration from legacy JSON files
"""

import os
import threading
from typing import Any, Dict, List, Optional

import pandas as pd


# Columns that should be stored as integers when present
_INT_COLS = {"like_count"}


class CommentStore:
    """Manages persistence and manipulation of comment lists (Parquet-backed)."""

    def __init__(self, path: str, lock: Optional[threading.Lock] = None):
        """
        Args:
            path: Full path to the Parquet file (e.g., 'Reports/saved.parquet')
            lock: Optional threading.RLock for thread-safe operations
        """
        self.path = path
        self.lock = lock or threading.RLock()

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _to_df(self, data: List[Dict[str, Any]]) -> pd.DataFrame:
        if not data:
            return pd.DataFrame()
        df = pd.DataFrame(data)
        for col in _INT_COLS:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)
        return df

    def _from_df(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        if df.empty:
            return []
        # Restore int columns to native int so JSON serialisation works
        for col in _INT_COLS:
            if col in df.columns:
                df[col] = df[col].astype(int)
        return df.to_dict(orient="records")

    # ── Public API ─────────────────────────────────────────────────────────────

    def load(self) -> List[Dict[str, Any]]:
        """Load comments from parquet. Returns empty list if file doesn't exist."""
        with self.lock:
            if not os.path.exists(self.path):
                return []
            try:
                df = pd.read_parquet(self.path)
                return self._from_df(df)
            except Exception:
                return []

    def save(self, data: List[Dict[str, Any]]) -> None:
        """Atomically save comments to parquet."""
        if not isinstance(data, list):
            raise ValueError("Data must be a list")

        with self.lock:
            df = self._to_df(data)
            tmp = self.path + ".tmp"
            try:
                os.makedirs(os.path.dirname(self.path), exist_ok=True)
                df.to_parquet(tmp, index=False)
                os.replace(tmp, self.path)
            except Exception:
                if os.path.exists(tmp):
                    try:
                        os.remove(tmp)
                    except Exception:
                        pass
                raise

    def add_many(self, comments: List[Dict[str, Any]]) -> int:
        """Bulk-add comments, skipping duplicates by ID. Returns count added."""
        if not comments:
            return 0
        with self.lock:
            data = self.load()
            existing_ids = {c.get("id") for c in data}
            new = [c for c in comments if c.get("id") not in existing_ids]
            if not new:
                return 0
            data = new + data  # prepend so newest appear first
            self.save(data)
            return len(new)

    def add(self, comment: Dict[str, Any]) -> bool:
        """Add a comment if it doesn't already exist (by ID). Returns True if added."""
        if not isinstance(comment, dict) or "id" not in comment:
            raise ValueError("Comment must be a dict with 'id' key")

        with self.lock:
            data = self.load()
            if any(c.get("id") == comment["id"] for c in data):
                return False
            data.insert(0, comment)
            self.save(data)
            return True

    def remove(self, comment_id: str) -> bool:
        """Remove a comment by ID. Returns True if removed."""
        with self.lock:
            data = self.load()
            filtered = [c for c in data if c.get("id") != comment_id]
            if len(filtered) == len(data):
                return False
            self.save(filtered)
            return True

    def get(self, comment_id: str) -> Optional[Dict[str, Any]]:
        """Get a comment by ID, or None if not found."""
        with self.lock:
            for c in self.load():
                if c.get("id") == comment_id:
                    return c
            return None

    def move_to(self, comment_id: str, destination: "CommentStore") -> bool:
        """Move a comment from this store to another. Returns True if moved."""
        comment = self.get(comment_id)
        if not comment:
            return False
        self.remove(comment_id)
        destination.add(comment)
        return True

    def clear(self) -> None:
        """Remove all comments."""
        with self.lock:
            self.save([])

    def count(self) -> int:
        """Return the number of stored comments."""
        with self.lock:
            return len(self.load())

    def all(self) -> List[Dict[str, Any]]:
        """Return all comments as a list of dicts."""
        with self.lock:
            return self.load()
