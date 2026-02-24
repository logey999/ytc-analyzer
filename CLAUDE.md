# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

**Setup:**
```bash
python -m venv ytc-env
source ytc-env/Scripts/activate  # Windows: ytc-env\Scripts\activate
pip install -r requirements.txt
```

**Run the server:**
```bash
cd Scripts
python server.py
# Open http://localhost:5000
```

No test suite exists in this project.

## Project Overview

**YouTube Comments Analyzer** — Fetches YouTube video comments via the YouTube Data API v3 and generates HTML reports with all comments and Claude AI scoring for video topic potential. Accessed via Flask web dashboard (`server.py`).

## File Structure

```
Scripts/
  analyze_video.py    Stage 2: Orchestration (called by server.py)
  get_comments.py     Stage 1: Comment fetching (YouTube Data API v3)
  create_report.py    Stage 3: HTML report generation
  server.py           Flask web server (port 5000)
  comment_store.py    CommentStore — Parquet-based persistence (saved/blacklist/deleted)
  batch_scorer.py     AI scoring — submits comments to Anthropic Batches API; polls & writes results
  api_reports.py      Blueprint skeleton (not wired into server.py yet)

Reports/              Auto-created output folder
  saved.parquet       Cross-report saved comments
  blacklist.parquet   Blacklisted comments
  deleted.parquet     Deleted comments

css/
  report.css          Shared dark-theme base styles
  dashboard.css       Dashboard layout
  report-page.css     Report viewer page
  tables.css          Table styles (shared)
  buttons.css         Button styles
  pagination.css      Pagination controls
  animations.css      Spinner, row removal, fade-in
  forms.css           Input/form styles
  filter-settings.css Filter panel styles

js/
  utils.js            Shared helpers: esc(), escAttr(), animateRowOut(), _sortCmp()
  config.js           CONFIG object: page sizes, column defs, API paths
  event-bus.js        Pub/sub emitter for cross-component communication
  table-manager.js    TableManager class used by all comment table pages
  dashboard.js        Dashboard page (job submission, report list)
  report.js           Report viewer (all comments table, AI score button, nav)
  aggregate.js        Aggregate view (all comments across reports)
  saved.js            Saved comments page
  blacklist.js        Blacklist page
  deleted.js          Deleted comments page
  filter-settings.js  Filter settings panel

index.html            Dashboard — URL entry, job queue, report list
report.html           Report viewer — video info, all comments table, AI score button
aggregate.html        All comments across reports
saved.html            Saved/kept comments
blacklist.html        Discarded/blacklisted comments
deleted.html          Deleted comments
```

## Architecture

### Stage 1 — Comment Fetching (`get_comments.py`)
- Returns `(video_info: dict, df: DataFrame, units_used: int)` — no file I/O
- `video_info` keys: `video_id`, `title`, `channel`, `channel_id`, `views`, `likes`, `upload_date`, `duration`, `description`, `thumbnail`, `comment_count`
- DataFrame columns: `id`, `author`, `author_channel_id`, `text`, `like_count`, `timestamp`, `parent`
- `parent` is `"root"` for top-level comments; reply parent ID otherwise
- Fetches replies via `comments.list` when `totalReplyCount > 5`
- Retries with exponential backoff on 429/500/503

### Stage 2 — Orchestration (`analyze_video.py`)
- Called by `server.py`; not a user-facing entry point
- Extracts video ID → scans `Reports/**/*_info.json` for existing match
- Reuse path: loads `.parquet` + `_info.json` (no network call)
- Fresh path: calls `get_comments()`, saves `.parquet` + `_info.json`
- Calls `filter_low_value()` then `generate_report()`

### Stage 3 — Report Generation (`create_report.py`)
- `generate_report(video_info, df, output_path)` — writes self-contained HTML
- CSS inlined from `../css/report.css`; falls back gracefully if missing
- Shows all comments JS-paginated (200 per page), sorted by likes
- `topic_rating` (1–10) and `topic_confidence` (0–100) columns shown when AI scoring is active

### Web Dashboard (`server.py`)
- Flask on `http://localhost:5000`; serves HTML pages and REST API
- Async job queue (threading); SSE stream at `GET /api/progress/<job_id>`
- Single `_store_lock` (RLock) guards all CommentStore access
- Filter settings sent from frontend in job payload → passed to `filter_low_value()`
- Low-value comments removed during analysis are auto-added to blacklist store

**Backend API endpoints:**
```
POST   /api/analyze                  Submit URL; returns {job_id} or {existing:{...}}
GET    /api/progress/<job_id>        SSE stream of job progress
GET    /api/reports                  List all reports with metadata
GET    /api/report-data/<path>       Report data: video_info, comments
DELETE /api/report/<path>            Delete report folder; bulk-moves comments
GET    /api/counts                   Nav badge counts (saved, blacklist, deleted, aggregate)
POST   /api/comment/save             Move comment → Saved
GET    /api/saved                    List saved comments
DELETE /api/saved/<comment_id>       Remove from Saved
POST   /api/comment/blacklist        Move comment → Blacklist
GET    /api/blacklist                List blacklisted comments
DELETE /api/blacklist/<comment_id>   Remove from Blacklist
DELETE /api/blacklist                Clear entire Blacklist
POST   /api/comment/delete           Move comment → Deleted
GET    /api/deleted                  List deleted comments
DELETE /api/deleted/<comment_id>     Remove from Deleted
GET    /css/<file>                   Serve CSS assets
GET    /js/<file>                    Serve JS assets

# AI scoring (Anthropic Batches API)
POST   /api/ai-score/<path>          Submit batch scoring for one report (idempotent)
GET    /api/ai-score/<path>          Return claude_batch block from _info.json
POST   /api/ai-score-aggregate       Submit batch scoring for all unscored comments
GET    /api/ai-score-aggregate       Return counts: eligible/pending/scored across all reports
POST   /api/ai-score-poll            Trigger immediate poll of all in-progress batches (synchronous)
```

## Data Flow

```
YouTube URL
    ↓
extract_video_id()
    ↓
_find_existing_report() → scan Reports/**/*_info.json
    ├─ found → prompt reuse or fresh
    └─ not found → fetch fresh
    ↓
get_comments() → (video_info, DataFrame, units_used)
    ↓
Reports/{channel_slug}/{video_slug}/
  {video_slug}_comments_YYYY-MM-DD.parquet
  {video_slug}_info.json
    ↓
filter_low_value(df)
    ↓
generate_report() → {video_slug}_report_YYYY-MM-DD.html
```

## Output Naming Convention

```
Reports/{channel_slug}/{video_slug}/{video_slug}_{type}_YYYY-MM-DD.{ext}
```
- `channel_slug`: channel name lowercased, non-alphanumeric → `_`
- `video_slug`: first 10 chars of slugified video title; if another video already occupies that folder, the first 8 chars of the video ID are appended (`{slug}_{video_id[:8]}`) to avoid collisions
- Types: `comments` (`.parquet`), `report` (`.html`)
- `_info.json` has no date suffix (one per video folder)
- Re-running the same video creates new dated files; no overwrites

## Key Implementation Details

### Comment Filtering (`filter_low_value`)
Filters ordered cheapest → most expensive; all default `True`:
- `min_chars` — drop < `min_chars_threshold` chars (default 3)
- `min_alpha` — drop < 2 alphabetic chars
- `min_words` — drop < `min_words_threshold` words (default 3)
- `emoji_only` — drop if non-emoji content is empty (requires `emoji`)
- `url_only` — drop if non-URL content is empty
- `timestamp_only` — drop bare timestamps (`"2:34"`, `"1:23:45"`)
- `repeat_char` — drop 5+ identical consecutive chars
- `blacklist_match` — drop if matches existing blacklist text (requires `blacklist_texts` set)
- `english_only` — drop non-English (requires `langdetect`)
- `sentiment_filter` — drop comments with VADER compound score ≤ `sentiment_threshold` (default −0.5; requires `vaderSentiment`)
- `dedup` — remove exact and near-duplicates; `dedup_threshold` default 85% (requires `rapidfuzz`)

### CommentStore (`comment_store.py`)
- Single-ownership: `_move_exclusive()` removes from all stores before adding to destination
- Stored as Parquet at `Reports/{saved,blacklist,deleted}.parquet`
- Thread-safe via `_store_lock` (RLock) in `server.py`

### AI Scoring (`batch_scorer.py`)
Rates comments 1–10 on **video topic potential** using `claude-haiku-4-5-20251001` via the Anthropic Batches API (50% discount vs standard API).

- `submit_batch(df, system_prompt=None)` — chunks comments into groups of `CHUNK_SIZE` (50), submits to `/v1/messages/batches`, returns `(batch_id, comment_ids)`; accepts optional custom prompt
- `check_batch_status(batch_id)` — returns `processing_status` string; no token cost
- `fetch_and_apply_results(batch_id, comment_ids, parquet_path)` — streams results, maps back to rows by ID, writes `topic_rating` and `topic_confidence` columns to Parquet

**Parquet columns added:** `topic_rating` (int 1–10, -1 = unscored), `topic_confidence` (int 0–100, -1 = unscored)

**Metadata written to `_info.json`:**
```json
{
  "claude_batch": {
    "batch_id": "msgbatch_01abc...",
    "submitted_at": "2026-02-22T14:30:00Z",
    "status": "in_progress" | "ended" | "error" | "partial_failure",
    "comment_count": 847,
    "chunk_size": 50,
    "comment_ids": ["Ug4xABC...", "..."],
    "retry_count": 0
  }
}
```

**Auto-retry:** After a batch ends, the poll daemon checks for still-unscored rows. If any exist and `retry_count == 0`, it automatically submits a new batch for those rows and sets `retry_count: 1`. If the retry submission fails, status is set to `"partial_failure"`.

**Re-submission logic:** `POST /api/ai-score/<path>` blocks re-submission only if a batch is `"in_progress"`. If status is `"ended"` but unscored rows remain, re-submission is allowed for those rows. Accepts optional `{"prompt": "..."}` in the request body to use a custom system prompt.

**Background polling daemon** (`_batch_poll_worker` in `server.py`): daemon thread started at server launch; scans all `_info.json` files every 15 minutes; collects results for any `"in_progress"` batch that has `processing_status == "ended"`; auto-retries once for unscored rows; updates status in `_info.json`.

**Manual poll trigger:** `POST /api/ai-score-poll` — runs `_poll_all_batches()` synchronously; useful for testing without waiting 15 minutes.

**Frontend integration:**
- `report.js`: "✨ AI Score" button in video strip; polls `GET /api/ai-score/<path>` every 30s; live icon updates reflect batch status; score columns shown in All Comments table when scoring is active
- `aggregate.js`: "✨ AI Score All" button with confirmation modal; polls `GET /api/ai-score-aggregate` every 30s; score columns auto-shown when any comments are scored
- API keys are provided via the dashboard settings panel (not `.env`); returns `{"error": "..."}` and degrades gracefully if missing

### Security
- All user content in HTML goes through `esc()` (HTML entity escaping)
- `webpage_url` validated to start with `https://` before use in href

## Architecture Decisions

- **YouTube Data API v3** over `yt-dlp`: official, stable, 10,000 free units/day
- **Parquet** over CSV: typed columns, smaller files, faster reloads
- **Self-contained HTML reports**: inlined CSS, no external deps
- **Single-ownership comment model**: enforces one store per comment
- **SSE for progress**: avoids polling; stream closes when job completes
- **`api_reports.py`**: Blueprint skeleton not yet wired into `server.py`
- **`vaderSentiment`**: used by `sentiment_filter` in `filter_low_value` to drop strongly negative comments
