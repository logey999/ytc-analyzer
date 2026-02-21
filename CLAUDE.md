# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**YouTube Comments Analyzer** — A Python toolkit that fetches YouTube video comments via `yt-dlp` and generates a rich HTML analysis report with sentiment analysis, word/phrase frequency charts, and comment statistics.

## Project Structure

```
.
├── Scripts/
│   ├── analyze_video.py      (Stage 2) Orchestration & main entry point
│   ├── get_comments.py       (Stage 1) Comment fetching
│   └── create_report.py      (Stage 3) Report generation
├── Reports/                  Output folder (created automatically)
├── css/
│   └── report.css           Styling for HTML reports
├── requirements.txt
└── CLAUDE.md
```

## Architecture

The project follows a **modular three-stage pipeline**:

### Stage 1: Comment Fetching (`Scripts/get_comments.py`)
- Uses `yt-dlp` to download video metadata and all comments from a YouTube video
- Validates URL against allowed YouTube prefixes before calling yt-dlp (raises `ValueError` otherwise)
- Extracts: video ID, title, channel, views, likes, duration, description
- Returns `(video_info dict, DataFrame)` — no file I/O; caller handles persistence
- DataFrame columns: `id`, `author`, `text`, `like_count`, `timestamp`, `parent` (reply tracking)

### Stage 2: Orchestration (`Scripts/analyze_video.py`) — Main Entry Point
- **Master script** that orchestrates the entire workflow
- Prompts user for YouTube URL
- Extracts video ID from URL, creates subfolder `Reports/{video_id}/`
- Checks for an existing Parquet file + `_info.json` sidecar; offers reuse prompt
- Fresh path: calls `get_comments()`, saves `.parquet` + `_info.json`
- Reuse path: loads `.parquet` + `_info.json` directly (no network call)
- Filters low-value comments (empty, <3 chars, no letters)
- Sorts comments by like count
- Calls `create_report()` to generate HTML

### Stage 3: Report Generation (`Scripts/create_report.py`)
- Takes video info dict and filtered DataFrame
- Performs sentiment analysis on each comment using VADER (vaderSentiment)
- Extracts word/bigram/trigram frequencies in a single pass via `tokenize_all()`
- Generates matplotlib charts:
  - Top 10 words (single word frequency)
  - Top 10 bigrams (two-word phrases)
  - Top 10 trigrams (three-word phrases)
  - Timeline chart (comments per month)
  - Sentiment pie chart (Positive/Neutral/Negative)
  - Like distribution histogram
  - Top 10 commenters by activity
- Converts charts to base64-encoded PNG images
- Creates self-contained HTML file with embedded images and CSS styling
- Loads CSS from `../css/report.css` (relative to Scripts folder)

## Data Flow

```
YouTube URL
    ↓
extract_video_id() → "t_cmP3hZQzQ"
    ↓
_find_latest_parquet() → existing file?
    ├─ yes → prompt user: reuse or fetch fresh
    └─ no  → fetch fresh
    ↓
get_comments(url) [if fresh]
    └→ returns (video_info, DataFrame)
    ↓
save to Reports/t_cmP3hZQzQ/t_cmP3hZQzQ_comments_YYYY-MM-DD.parquet
save to Reports/t_cmP3hZQzQ/t_cmP3hZQzQ_info.json
    ↓
filter_low_value() → removes empty/low-quality comments
    ↓
generate_report(video_info, df, output_path)
    └→ saves to Reports/t_cmP3hZQzQ/t_cmP3hZQzQ_report_YYYY-MM-DD.html
```

## Output Structure & Naming Convention

All reports are organized in the `Reports/` folder with **strict naming convention**:

```
Reports/
└── {video_id}/
    ├── {video_id}_comments_YYYY-MM-DD.parquet   # Comments (Parquet)
    ├── {video_id}_info.json                     # Video metadata sidecar
    └── {video_id}_report_YYYY-MM-DD.html        # HTML report
```

**Example:**
```
Reports/
└── t_cmP3hZQzQ/
    ├── t_cmP3hZQzQ_comments_2026-02-21.parquet
    ├── t_cmP3hZQzQ_info.json
    └── t_cmP3hZQzQ_report_2026-02-21.html
```

**Key Points:**
- Subfolders use **video ID only** (extracted from YouTube URL)
- Files always include `{video_id}_` prefix
- Type descriptor: `_comments_` or `_report_`
- Date in `YYYY-MM-DD` format at end
- Re-running on the same video creates a new date-stamped Parquet alongside existing ones

## Common Commands

### Run the Full Analysis
```bash
python Scripts/analyze_video.py
```
Prompts for YouTube URL. If a Parquet file already exists, offers to reuse it or fetch fresh.

### Setup & Development
```bash
# Create virtual environment
python -m venv myenv

# Activate (Windows)
myenv\Scripts\activate

# Activate (macOS/Linux)
source myenv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Verify yt-dlp is available
yt-dlp --version
```

### Fetch Comments Only
```bash
python Scripts/get_comments.py "https://youtube.com/watch?v=VIDEO_ID"
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `yt-dlp` | Download YouTube video metadata and comments |
| `pandas` | DataFrame manipulation and filtering |
| `pyarrow` | Parquet file read/write support |
| `matplotlib` | Generate charts as PNG images |
| `vaderSentiment` | Sentiment analysis (Positive/Neutral/Negative) |

## Important Implementation Details

### URL Validation (`get_comments`)
- Checked against `ALLOWED_PREFIXES` before yt-dlp is called
- Raises `ValueError` for non-YouTube URLs

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

## Recent Changes (2026-02-21)

1. **Parquet migration**: Comments now saved as `.parquet` instead of `.csv` (requires `pyarrow`)
2. **Video metadata sidecar**: `_info.json` saved alongside each Parquet file
3. **Reuse prompt**: Re-running on a previously analysed video offers offline re-analysis
4. **URL validation**: `get_comments` rejects non-YouTube URLs before calling yt-dlp
5. **Single-pass tokenization**: `tokenize_all()` replaces the three separate tokenization loops
6. **Rank index fix**: Comment table ranks now correctly start at 1
7. **Matplotlib XSS fix**: Top commenters chart uses raw names (no HTML entities)
8. **webpage_url XSS fix**: href validated to `https://` before rendering

## Architecture Decisions

- **Single-file reports**: HTML reports are self-contained with embedded base64 images (no external dependencies after generation)
- **Parquet format**: Chosen over CSV for typed columns, smaller file size, and faster re-loads
- **Modular design**: Each stage can theoretically be called independently if needed
- **Stop-word filtering**: Required for meaningful word frequency analysis (excludes "the", "and", etc.)
- **VADER sentiment**: Lightweight, no fine-tuning required, works well for social media text

## Future Enhancement Considerations

If extending this project:
- Comments module handles reply threads (parent ID tracking) but UI doesn't visualize reply structure
- yt-dlp subprocess execution is synchronous (could be async for multiple videos)
- Chart generation is CPU-bound and could benefit from caching or async processing
- Top-level modules could be refactored into a package with `__init__.py`
