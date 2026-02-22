"""
CommentStore: Unified abstraction for persisting comment data to JSON files.

Handles loading, saving, and manipulating comment lists with:
- Atomic write operations (write to temp file, then move)
- Thread-safe operations via lock
- Deduplication by comment ID
- Simple CRUD operations
"""

import json
import os
import threading
from typing import List, Dict, Optional, Any


class CommentStore:
    """Manages persistence and manipulation of comment lists."""

    def __init__(self, path: str, lock: Optional[threading.Lock] = None):
        """
        Initialize a CommentStore.

        Args:
            path: Full path to the JSON file (e.g., 'data/ideas.json')
            lock: Optional threading.Lock for thread-safe operations
                 (if None, a new lock is created)
        """
        self.path = path
        self.lock = lock or threading.RLock()
        self._cache = None

    def load(self) -> List[Dict[str, Any]]:
        """
        Load comments from file. Returns empty list if file doesn't exist.

        Returns:
            List of comment dictionaries
        """
        with self.lock:
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if not isinstance(data, list):
                        return []
                    self._cache = data
                    return data
            except (FileNotFoundError, json.JSONDecodeError):
                self._cache = []
                return []

    def save(self, data: List[Dict[str, Any]]) -> None:
        """
        Atomically save comments to file.

        Args:
            data: List of comment dictionaries to save
        """
        if not isinstance(data, list):
            raise ValueError("Data must be a list")

        with self.lock:
            # Atomic write: write to temp file, then move
            tmp_path = self.path + ".tmp"
            try:
                with open(tmp_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                os.replace(tmp_path, self.path)
                self._cache = data
            except Exception:
                # Clean up temp file on error
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass
                raise

    def add(self, comment: Dict[str, Any]) -> bool:
        """
        Add a comment if it doesn't already exist (by ID).

        Args:
            comment: Comment dictionary (must have 'id' key)

        Returns:
            True if added, False if already exists
        """
        if not isinstance(comment, dict) or "id" not in comment:
            raise ValueError("Comment must be a dict with 'id' key")

        with self.lock:
            data = self.load()
            comment_id = comment["id"]

            # Check if already exists
            if any(c.get("id") == comment_id for c in data):
                return False

            # Add and save
            data.insert(0, comment)  # Insert at beginning (most recent first)
            self.save(data)
            return True

    def remove(self, comment_id: str) -> bool:
        """
        Remove a comment by ID.

        Args:
            comment_id: The comment's ID

        Returns:
            True if removed, False if not found
        """
        with self.lock:
            data = self.load()
            original_len = len(data)
            data = [c for c in data if c.get("id") != comment_id]

            if len(data) < original_len:
                self.save(data)
                return True
            return False

    def get(self, comment_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a comment by ID.

        Args:
            comment_id: The comment's ID

        Returns:
            The comment dictionary, or None if not found
        """
        with self.lock:
            data = self.load()
            for comment in data:
                if comment.get("id") == comment_id:
                    return comment
            return None

    def move_to(
        self, comment_id: str, destination: "CommentStore"
    ) -> bool:
        """
        Move a comment from this store to another store.

        Args:
            comment_id: The comment's ID
            destination: Target CommentStore instance

        Returns:
            True if moved, False if not found in source
        """
        # Get and remove from source
        comment = self.get(comment_id)
        if not comment:
            return False

        self.remove(comment_id)

        # Add to destination
        destination.add(comment)
        return True

    def clear(self) -> None:
        """Clear all comments (empty the file)."""
        with self.lock:
            self.save([])

    def count(self) -> int:
        """
        Get the number of comments.

        Returns:
            Number of comments in the store
        """
        with self.lock:
            return len(self.load())

    def all(self) -> List[Dict[str, Any]]:
        """
        Get all comments.

        Returns:
            List of all comment dictionaries
        """
        with self.lock:
            return self.load()
