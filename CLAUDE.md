# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**YouTube Comments Analyzer** — A Python toolkit that fetches YouTube video comments via the **YouTube Data API v3** and generates a focused HTML report with repeated phrase analysis and top liked comments.

## Project Structure

```
.
├── Scripts/
│   ├── analyze_video.py      (Stage 2) Orchestration & CLI entry point
│   ├── get_comments.py       (Stage 1) Comment fetching
│   ├── create_report.py      (Stage 3) Report generation (self-contained HTML)
│   ├── server.py             Flask web server (dashboard entry point)
│   ├── comment_store.py      CommentStore class — Parquet-based persistence for keep/discarded/deleted
│   └── api_reports.py        Example Blueprint organization (not yet wired into server.py)
├── Reports/                  Output folder (created automatically)
│   ├── keep.parquet          Persisted "keep" comments (cross-report)
│   ├── discarded.parquet     Persisted discarded comments
│   └── deleted.parquet       Persisted deleted comments
├── css/
│   ├── report.css            Shared dark-theme base styles
│   ├── dashboard.css         Dashboard-specific layout
│   ├── report-page.css       Report viewer page
│   ├── tables.css            All table styles (shared across pages)
│   ├── buttons.css           Button styles
│   ├── pagination.css        Pagination controls
│   ├── animations.css        Spinner, row removal, fade-in
│   ├── forms.css             Input/form styles
│   └── filter-settings.css   Filter panel styles
├── js/
│   ├── utils.js              Shared helpers (esc, escAttr, animateRowOut, _sortCmp, etc.)
│   ├── config.js             Centralized CONFIG object (page sizes, column defs, API paths)
│   ├── event-bus.js          Pub/sub event emitter for cross-component communication
│   ├── table-manager.js      Unified TableManager class used by all comment table pages
│   ├── dashboard.js          Dashboard page logic (job submission, report list)
│   ├── report.js             Report viewer logic (phrases chart, top comments, nav)
│   ├── aggregate.js          Aggregate page (all comments across reports)
│   ├── keep.js               Keep page
│   ├── blacklist.js          Blacklist/discard page
│   ├── deleted.js            Deleted comments page
│   └── filter-settings.js    Filter settings panel
├── index.html                Dashboard — URL entry, job queue, report list
├── report.html               Report viewer — video info, tabs, Chart.js phrases chart
├── aggregate.html            Aggregate comments across reports
├── keep.html                 Saved/kept comments
├── blacklist.html            Discarded/blacklisted comments
├── deleted.html              Deleted comments
├── .env.example              Template for API key configuration
├── requirements.txt
└── CLAUDE.md
```

## Architecture

The project follows a **modular three-stage pipeline**:

### Stage 1: Comment Fetching (`Scripts/get_comments.py`)
- Uses **YouTube Data API v3** (`google-api-python-client`) to fetch video metadata and all comments
- API key loaded from `YOUTUBE_API_KEY` environment variable (via `.env` file with `python-dotenv`)
- If no API key is found, prints setup instructions and exits
- Extracts: video ID, title, channel, views, likes, duration, description
- Returns `(video_info dict, DataFrame)` — no file I/O; caller handles persistence
- DataFrame columns: `id`, `author`, `text`, `like_count`, `timestamp`, `parent` (reply tracking)
- Handles pagination through `commentThreads.list` and fetches extra replies via `comments.list` when `totalReplyCount > 5`
- Retries with exponential backoff on 429/500/503 errors

### Stage 2: Orchestration (`Scripts/analyze_video.py`) — Main Entry Point
- **Master script** that orchestrates the entire workflow
- Prompts user for YouTube URL
- Extracts video ID; scans `Reports/**/*_info.json` for an existing match
- Fresh path: calls `get_comments()`, creates `Reports/{channel_slug}/{video_slug}/`, saves `.parquet` + `_info.json`
- Reuse path: loads `.parquet` + `_info.json` directly (no network call)
- Filters low-value comments (empty, <3 chars, no letters)
- Sorts comments by like count
- Calls `create_report()` to generate HTML

### Stage 3: Report Generation (`Scripts/create_report.py`)
- Takes video info dict and filtered DataFrame
- Finds repeated phrases (3+ words, 2+ occurrences) via `find_repeated_phrases()`
- Generates one matplotlib chart: repeated phrases bar chart (dark-themed)
- Converts chart to base64-encoded PNG image
- Creates self-contained HTML file with embedded image and CSS styling
- Loads CSS from `../css/report.css` (relative to Scripts folder)
- Report sections: Video Info, Repeated Phrases, Top 100 Most Liked Comments

### Web Dashboard (`Scripts/server.py`)
- **Flask web server** running on `http://localhost:5000`
- Provides a browser-based interface for analyzing videos
- **Two main pages:**
  - `index.html` — Dashboard with URL input, job queue, and list of all reports
  - `report.html` — Report viewer with navigation between reports and interactive data display
- **Key Features:**
  - Async job queue: Multiple videos can be analyzed concurrently; jobs tracked in UI
  - Report caching: Scans existing reports and offers to reuse cached data
  - Live progress updates: WebSocket-like polling for job status
  - Report list: Shows all generated reports with thumbnails, metadata, and quick links
  - Report navigation: Prev/Next buttons to browse between generated reports
  - Cross-report comment management: Keep, discard, and delete comments across all reports
  - Filter settings panel: Configurable column visibility and display options
- **Multi-page Architecture:**
  - `index.html` / `dashboard.js` — Job submission and report list
  - `report.html` / `report.js` — Report viewer with phrases chart and top comments
  - `aggregate.html` / `aggregate.js` — All comments aggregated across reports
  - `keep.html` / `keep.js` — Saved/kept comments
  - `blacklist.html` / `blacklist.js` — Discarded comments
  - `deleted.html` / `deleted.js` — Deleted comments
- **Shared Frontend Modules** (loaded by all pages):
  - `js/utils.js` — `esc()`, `escAttr()`, `animateRowOut()`, `_sortCmp()`
  - `js/config.js` — `CONFIG` object: page sizes, column definitions, API paths
  - `js/event-bus.js` — Pub/sub emitter for cross-component communication
  - `js/table-manager.js` — `TableManager` class used by all comment table pages
  - Chart.js for visualization (loaded via CDN)
- **Comment Persistence (`CommentStore`):**
  - `Scripts/comment_store.py` — Manages keep/discarded/deleted Parquet files
  - Stored at `Reports/keep.parquet`, `Reports/discarded.parquet`, `Reports/deleted.parquet`
  - Server uses a single `_store_lock` (RLock) for thread safety
- **Backend Endpoints:**
  - `POST /api/analyze` — Submit a YouTube URL for analysis
  - `GET /api/reports` — Fetch list of all generated reports with metadata
  - `GET /api/report/<path>` — Fetch a specific report's data (JSON)
  - `GET /api/job/<job_id>` — Poll job status and progress
  - `GET /api/keep`, `POST /api/keep`, `DELETE /api/keep` — Keep list CRUD
  - `GET /api/discarded`, `POST /api/discard`, `DELETE /api/discard` — Discard list CRUD
  - `GET /api/deleted`, `POST /api/delete`, `DELETE /api/delete` — Deleted list CRUD
  - `GET /css/<file>`, `GET /js/<file>` — Serve static assets
  - `GET /report/<path>` — Serve generated HTML report files

## Data Flow

```
YouTube URL
    ↓
extract_video_id() → "t_cmP3hZQzQ"
    ↓
_find_existing_report() → scan Reports/**/*_info.json for matching id
    ├─ found → prompt user: reuse or fetch fresh
    └─ not found → fetch fresh
    ↓
get_comments(url) [if fresh]
    └→ YouTube Data API v3: videos.list + commentThreads.list
    └→ returns (video_info, DataFrame)
    ↓
build folder: Reports/{channel_slug}/{video_slug}/   e.g. Reports/linus_tech_tips/we_finally/
save to {folder}/{video_slug}_comments_YYYY-MM-DD.parquet
save to {folder}/{video_slug}_info.json
    ↓
filter_low_value() → removes empty/low-quality comments
    ↓
generate_report(video_info, df, output_path)
    └→ saves to {folder}/{video_slug}_report_YYYY-MM-DD.html
```

## Output Structure & Naming Convention

All reports are organized in the `Reports/` folder with **strict naming convention**:

```
Reports/
└── {channel_slug}/
    └── {video_slug}/
        ├── {video_slug}_comments_YYYY-MM-DD.parquet   # Comments (Parquet)
        ├── {video_slug}_info.json                     # Video metadata sidecar
        └── {video_slug}_report_YYYY-MM-DD.html        # HTML report
```

**Example:**
```
Reports/
└── linus_tech_tips/
    └── we_finally/
        ├── we_finally_comments_2026-02-21.parquet
        ├── we_finally_info.json
        └── we_finally_report_2026-02-21.html
```

**Key Points:**
- Channel parent folder: channel name slugified (lowercase, non-alphanumeric → `_`)
- Video subfolder: first 10 characters of the slugified video title
- All files share the same `{video_slug}_` prefix
- Type descriptor: `_comments_` or `_report_`
- Date in `YYYY-MM-DD` format at end
- Reuse detection: scans all `*_info.json` files to match by video ID
- Re-running on the same video creates a new date-stamped Parquet alongside existing ones

## Usage

The project offers **two main entry points**:

### Option 1: Command-Line Interface (CLI)
For scripting or one-off analysis.

```bash
python Scripts/analyze_video.py
```
- Prompts for YouTube URL
- Scans for existing reports; offers to reuse or fetch fresh
- Saves Parquet, metadata, and HTML report to `Reports/{channel}/{video}/`
- Opens the HTML report in your browser

### Option 2: Web Dashboard
For interactive browsing, job management, and report comparison.

```bash
python Scripts/server.py
```
- Opens `http://localhost:5000` in your browser
- Submit videos for analysis via URL input
- Browse job queue and all generated reports
- Navigate between reports with prev/next buttons
- View repeated phrases, top comments, and metadata

## Setup & Development

```bash
# Create virtual environment
python -m venv ytc-env

# Activate (Windows)
ytc-env\Scripts\activate

# Activate (macOS/Linux)
source ytc-env/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set up API key
cp .env.example .env
# Edit .env and add your YouTube Data API v3 key
```

## API Key Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a project (or select an existing one)
3. Enable the **YouTube Data API v3**
4. Create an API key
5. Copy `.env.example` to `.env` and paste your key
   - **Note:** `.env` is excluded from git (see `.gitignore`)
6. **Quota:** Free tier provides 10,000 units/day (~100 `commentThreads.list` calls)

## Advanced Usage

### Fetch Comments Only
```bash
python Scripts/get_comments.py "https://youtube.com/watch?v=VIDEO_ID"
```
Returns raw comment data without generating a report.

### Generate Report from Existing Comments
If you already have a Parquet file, you can regenerate the report:
```bash
python Scripts/analyze_video.py
# When prompted, select "reuse" to skip API calls
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `google-api-python-client` | YouTube Data API v3 client |
| `python-dotenv` | Load API key from `.env` file |
| `pandas` | DataFrame manipulation and filtering |
| `pyarrow` | Parquet file read/write support |
| `matplotlib` | Generate charts as PNG images |
| `vaderSentiment` | Sentiment analysis (Positive/Neutral/Negative) |

## Important Implementation Details

### API Key Management
- Stored in `.env` file (excluded from git via `.gitignore`)
- Loaded via `python-dotenv` at module import time
- If missing, prints setup instructions and exits

### API Error Handling
- `commentsDisabled` (403): Clear message, returns empty DataFrame
- `quotaExceeded` (403): Tells user to wait until midnight Pacific
- Transient errors (429/500/503): Retries with exponential backoff (up to 3 retries)

### Video ID Extraction (`extract_video_id`)
- Handles both `youtu.be/VIDEO_ID` and `youtube.com?v=VIDEO_ID` formats
- Returns just the ID (e.g., `t_cmP3hZQzQ`)
- Fallback to `"video"` if extraction fails

### Reuse Prompt (`analyze_video.main`)
- Looks for `{video_id}_comments_*.parquet` in the video folder
- Also requires `{video_id}_info.json` to be present
- If both exist, shows row count and prompts `[1] reuse / [2] fresh`
- Default (Enter) is reuse; only `"2"` triggers a fresh fetch

### Comment Filtering (`filter_low_value`)
- Removes comments with <3 characters
- Requires at least 2 alphabetic characters
- Strips whitespace before validation

### Sentiment Analysis (VADER)
- Compound score calculated for each comment
- Classification:
  - **Positive**: compound score ≥ 0.05
  - **Negative**: compound score ≤ -0.05
  - **Neutral**: otherwise

### Word/Phrase Extraction (`tokenize_all`)
- Single pass over `df["text"]` — builds word, bigram, and trigram lists simultaneously
- Stop-word filtering (common English words excluded)
- Minimum word length: 3 characters
- Tokenization via regex: `[a-z']+`
- Case-insensitive processing
- Returns top 10 for words, bigrams, and trigrams

### XSS Prevention
- All user-generated content rendered in HTML goes through `esc()` (HTML entity escaping)
- `webpage_url` validated to start with `https://` before being used in an href

### CSS Styling
- External CSS file: `css/report.css` (3.4 KB)
- HTML report loads this during generation
- Fallback to no styling if CSS file missing

## Architecture Decisions

- **YouTube Data API v3**: Official, stable API with 10,000 free units/day. Replaced `yt-dlp` which was unreliable due to YouTube's bot detection and A/B testing
- **Single-file reports**: HTML reports are self-contained with embedded base64 images (no external dependencies after generation)
- **Parquet format**: Chosen over CSV for typed columns, smaller file size, and faster re-loads
- **Modular design**: Each stage can theoretically be called independently if needed
- **Stop-word filtering**: Required for meaningful word frequency analysis (excludes "the", "and", etc.)
- **VADER sentiment**: Lightweight, no fine-tuning required, works well for social media text

## Future Enhancement Considerations

If extending this project:
- Comments module handles reply threads (parent ID tracking) but UI doesn't visualize reply structure
- API calls are synchronous (could be async for multiple videos)
- Chart generation is CPU-bound and could benefit from caching or async processing
- Top-level modules could be refactored into a package with `__init__.py`
- Quota management could track daily usage to warn before hitting limits
