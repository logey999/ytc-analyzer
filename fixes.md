# Code Review: ytc-analyzer

## Overall Assessment

This is a well-structured project with clear separation of concerns (stages 1-3, stores, web server). The architecture is sound — Parquet for persistence, SSE for progress, and single-ownership comment model are all good choices. That said, there are several bugs, security gaps, and reliability issues worth addressing.

---

## BUGS

### 1. `extract_video_id` silently returns `"video"` for invalid URLs
`Scripts/analyze_video.py:87`
```python
return qs.get("v", ["video"])[0]
```
If the URL has no `v` query parameter, this returns the string `"video"` instead of raising an error. The version in `get_comments.py:49-51` correctly raises `ValueError`. This means submitting a non-YouTube URL (e.g. `https://example.com`) would create a report folder named `video/` and attempt to fetch comments for video ID `"video"`.

### 2. `filter_low_value` return type doesn't match annotation
`Scripts/analyze_video.py:162` — The function signature implies returning `pd.DataFrame`, but line 281 returns `(df, reasons)`. The standalone `main()` at line 373 correctly destructures, but the type annotation is misleading.

### 3. `_fetch_all_replies` unit counting is wrong
`Scripts/get_comments.py:204-207` — When reply count > 5, `_fetch_all_replies` is called which may paginate through multiple API pages, but the caller only counts 1 unit (`units += 1`). Each page costs 1 unit, so `units_used` underreports actual quota consumption.

### 4. `_from_df` mutates its input DataFrame
`Scripts/comment_store.py:50-53`:
```python
def _from_df(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
    ...
    for col in _INT_COLS:
        if col in df.columns:
            df[col] = df[col].astype(int)  # modifies caller's df
```
This silently mutates the DataFrame passed in. Should use `df = df.copy()` or operate on the dict output instead.

### 5. `_move_exclusive` has a transient "no store" window
`Scripts/server.py:502-510` — Each `store.remove(cid)` acquires and releases the lock independently, then `dest_store.add(comment)` does the same. Between the remove and the add, the comment exists in no store. If another thread reads during that gap, the comment is invisible. The entire operation should be done under a single lock hold.

### 6. Duplicate `extract_video_id` implementations
There are two: `get_comments.py:_extract_video_id` (correct — raises on failure) and `analyze_video.py:extract_video_id` (buggy — returns `"video"`). The server imports from `analyze_video.py`, so it uses the buggy one.

---

## SECURITY

### 7. `escAttr()` missing `&` escaping
`js/utils.js:110-112`:
```javascript
function escAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```
Unlike `esc()` which correctly escapes `&` first, `escAttr()` does not. If an attribute value contains `&`, it won't be escaped. This is used for comment IDs, paths, and thumbnail URLs. Low practical risk since these values are typically alphanumeric, but it's an incomplete escaping function.

### 8. `.env` file writing via unauthenticated API
`Scripts/server.py:1011-1062` — `POST /api/env-keys` writes API keys to disk and sets them in `os.environ`. There's no authentication. Anyone with network access to port 5000 can overwrite the API keys. The newline injection check is good, but the endpoint itself should be restricted (or the server should only bind to localhost, which it does via `0.0.0.0` — meaning it's accessible on all interfaces).

### 9. Path traversal risk in report endpoints
`Scripts/server.py:417-419`:
```python
def api_report_data(report_path: str):
    folder = os.path.join(REPORTS_DIR, report_path)
```
Flask's `<path:report_path>` accepts values like `../../etc/passwd`. While `os.path.join` and the subsequent `*_info.json` glob limit exploitation, there's no explicit check that the resolved path stays within `REPORTS_DIR`. Adding `os.path.realpath(folder).startswith(os.path.realpath(REPORTS_DIR))` would be defensive.

### 10. `server.py` binds to `0.0.0.0`
`Scripts/server.py:1110` — The server listens on all interfaces, making it accessible from the network. For a local tool, `127.0.0.1` would be safer.

---

## RELIABILITY

### 11. `_jobs` dict grows unbounded (memory leak)
`Scripts/server.py:63` — Job entries (including their `Queue` objects) are never cleaned up. Each analysis adds an entry that persists for the lifetime of the server process. On a long-running server this wastes memory.

### 12. `_poll_all_batches` race between daemon and manual trigger
`Scripts/server.py:889-979` — The poll daemon thread and `POST /api/ai-score-poll` both call `_poll_all_batches()` without synchronization. Two concurrent invocations can read the same `_info.json`, both see `in_progress`, both fetch results and write back — potentially corrupting the file or double-counting.

### 13. Poller thread starts at import time
`Scripts/server.py:992-993`:
```python
_poller_thread = threading.Thread(target=_batch_poll_worker, daemon=True, name="batch-poller")
_poller_thread.start()
```
This runs as a module-level side effect. Importing `server` for any reason (tests, linting, REPL) immediately starts a background thread that reads files and makes API calls.

### 14. No thread pool / concurrency limit for analysis jobs
`Scripts/server.py:310-311` — Each `/api/analyze` call spawns an unbounded thread. There's no limit. A user (or attacker) could submit hundreds of URLs and exhaust system resources.

### 15. `api_report_data` iterates stores 4+ times per request
`Scripts/server.py:441-454` — For a single report data request, the code iterates `saved_store.all()`, `blacklist_store.all()`, and `deleted_store.all()` twice each (once for `classified_ids`, once for per-report counts). Each `.all()` call reads and parses the entire Parquet file from disk. This is O(3 * store_size * 2) per request.

### 16. SSE stream holds queue reference forever on client disconnect
`Scripts/server.py:325-341` — If the client disconnects mid-stream, the generator function's `while True` loop keeps trying to read from the queue. Flask doesn't notify the generator of client disconnection, so it runs until the sentinel `None` arrives. The job thread keeps pushing to the queue even though nobody is consuming.

---

## CODE QUALITY

### 17. `CommentStore` does full load+save for every single operation
`Scripts/comment_store.py:102-113` — `add()` calls `load()` (reads entire Parquet), inserts one item, then `save()` (writes entire Parquet). For a blacklist with 10k+ items, every single add/remove does a full file round-trip. An in-memory cache with periodic flush would be more efficient.

### 18. `api_reports` scans all Parquet files on every call
`Scripts/server.py:346-412` — Listing reports reads every `_info.json` file, every `.parquet` file (to get row counts via `pd.read_parquet`), and all three stores. On a dashboard with many reports, this endpoint will be slow.

### 19. `api_counts` reads all Parquet files too
`Scripts/server.py:1065-1098` — Same pattern. The nav badge endpoint reads every store and every parquet, making it expensive to call on every page load.

### 20. Inline `onclick` handlers throughout JS
Multiple files use `onclick="fn('${value}')"` patterns in template strings. This is fragile (values must be manually escaped for the attribute context) and makes the code harder to maintain. Event delegation with `data-` attributes would be more robust.

### 21. Polling timers not cleaned up on page navigation
`js/report.js` and `js/aggregate.js` — `setInterval` timers for AI score polling continue running if the user navigates away from the page. No `beforeunload` cleanup.

### 22. `api_reports.py` blueprint is dead code
`Scripts/api_reports.py` — The file exists with a duplicate (and stale) implementation of `/api/reports` that's never wired into the app. As noted in CLAUDE.md, this is intentionally unwired, but it should either be completed or removed to avoid confusion.

---

## SUMMARY

| Category | Count | Most Critical |
|----------|-------|---------------|
| Bugs | 6 | #1 (silent bad video ID), #5 (comment disappears between stores) |
| Security | 4 | #8 (unauthenticated key writing), #10 (0.0.0.0 binding) |
| Reliability | 6 | #11 (memory leak), #12 (poll race condition) |
| Code Quality | 6 | #17 (store performance), #20 (inline onclick) |

The highest-impact fixes would be:
1. Fix `extract_video_id` to raise on invalid URLs (bug #1 + #6)
2. Add path traversal guard on report endpoints (security #9)
3. Bind to `127.0.0.1` instead of `0.0.0.0` (security #10)
4. Add a lock around `_poll_all_batches` (reliability #12)
5. Clean up stale jobs from `_jobs` dict (reliability #11)
