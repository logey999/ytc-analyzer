# YouTube Comments Analyzer

A Python toolkit that fetches YouTube video comments via the **YouTube Data API v3** and generates a rich HTML analysis report. Access the tool via CLI or interactive web dashboard.

## Quick Start

### CLI (Command-Line)
```bash
python Scripts/analyze_video.py
```

### Web Dashboard
```bash
python Scripts/server.py
# Opens http://localhost:5000
```

For detailed setup and configuration, see [CLAUDE.md](./CLAUDE.md).

## Project Structure

```
.
├── Scripts/
│   ├── analyze_video.py      Orchestration & CLI entry point
│   ├── get_comments.py       Comment fetching (YouTube Data API v3)
│   ├── create_report.py      Report generation (self-contained HTML)
│   └── server.py             Flask web server & dashboard
├── Reports/                  Output folder (generated automatically)
├── css/
│   ├── report.css           Base styles for reports and web pages
│   ├── dashboard.css        Dashboard-specific styling
│   └── report-page.css      Report page styling
├── js/
│   ├── dashboard.js         Dashboard frontend logic
│   └── report.js            Report viewer frontend logic
├── index.html               Dashboard homepage
├── report.html              Report viewer page
├── requirements.txt         Python dependencies
├── .env.example             API key template
└── CLAUDE.md               Developer documentation
```

## Key Features

- **Official YouTube Data API v3** — More reliable than web scraping
- **Async job queue** — Analyze multiple videos concurrently via web dashboard
- **Report caching** — Reuse previously analyzed videos without re-fetching
- **Repeated phrase detection** — Find most common phrases in comments
- **Sentiment analysis** — Classify comments as positive, neutral, or negative
- **Interactive reports** — Browse previous reports with prev/next navigation
- **Self-contained HTML** — Download reports as standalone files with embedded images

## Requirements

- Python 3.10+
- YouTube Data API v3 key (free tier: 10,000 units/day)
- Dependencies: `google-api-python-client`, `python-dotenv`, `pandas`, `pyarrow`, `matplotlib`, `vaderSentiment`, `flask`

## Setup Instructions

### Prerequisites

- Python 3.10 or later
- Git
- YouTube Data API v3 key (get one free from [Google Cloud Console](https://console.cloud.google.com/apis/credentials))

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/logey999/ytc-analyzer.git
   cd ytc-analyzer
   ```

2. **Create and activate a virtual environment:**
   ```bash
   # Create
   python -m venv myenv

   # Activate (Windows)
   myenv\Scripts\activate

   # Activate (macOS/Linux)
   source myenv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure your API key:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your YouTube Data API v3 key:
   ```
   YOUTUBE_API_KEY=your-api-key-here
   ```

5. **Run the tool:**

   **CLI option:**
   ```bash
   python Scripts/analyze_video.py
   ```

   **Web dashboard option:**
   ```bash
   python Scripts/server.py
   # Then open http://localhost:5000 in your browser
   ```

### Get a YouTube Data API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project (or select existing)
3. Enable the **YouTube Data API v3**
4. Create an **API Key** credential
5. Copy the key and paste it into `.env`

**Quota info:** Free tier provides 10,000 units/day. A typical video analysis uses ~50-100 units.

## Usage

### Web Dashboard (Recommended)

```bash
python Scripts/server.py
```

Then open `http://localhost:5000` in your browser.

**Features:**
- Submit YouTube URLs for analysis
- Track multiple jobs in a queue
- Browse previously generated reports
- Navigate between reports with prev/next buttons
- View report details: repeated phrases, top comments, statistics

### Command-Line Interface

```bash
python Scripts/analyze_video.py
```

**Workflow:**
1. Prompts for a YouTube URL
2. Checks for existing reports; offers to reuse or fetch fresh
3. Fetches comments via YouTube Data API v3
4. Filters low-value comments
5. Generates HTML report with analysis
6. Opens report in your browser

**Reuse detection:** If you've already analyzed a video, re-running the script will detect it and ask if you want to reuse the cached data (no API call needed).

### Advanced: Fetch Comments Only

```bash
python Scripts/get_comments.py "https://youtube.com/watch?v=VIDEO_ID"
```

This returns raw comment data without generating a report.

## Report Contents

Each generated report includes:

- **Video metadata** — Title, channel, views, likes, duration, description
- **Comment statistics** — Total comments, average likes, sentiment breakdown
- **Repeated phrases chart** — Bar chart showing most frequently repeated 3+ word phrases
- **Top 100 liked comments** — Ranked table sorted by like count
- **Sentiment analysis** — Comments classified as positive, neutral, or negative (VADER)

## Output Directory Structure

Reports are organized hierarchically for easy browsing:

```
Reports/
└── {channel_slug}/
    └── {video_slug}/
        ├── {video_slug}_comments_YYYY-MM-DD.parquet   # Raw comment data
        ├── {video_slug}_info.json                     # Video metadata
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

**Naming notes:**
- Channel folder: Channel name, slugified (lowercase, non-alphanumeric → `_`)
- Video folder: First 10 characters of slugified video title
- Date: `YYYY-MM-DD` format appended to parquet and report files
- Multiple analyses of the same video create dated versions (no overwrites)

## Data Format

### Parquet File Columns

When comments are fetched and saved, they're stored in Parquet format with these columns:

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | Unique comment ID |
| `author` | string | Display name of the commenter |
| `text` | string | Full comment text |
| `like_count` | int | Number of likes on the comment |
| `timestamp` | int | Unix timestamp of the comment |
| `parent` | string | `root` for top-level comments; reply parent ID otherwise |

### Metadata (JSON)

Each video folder includes a `{video_slug}_info.json` sidecar with:
- `video_id` — YouTube video ID
- `title` — Video title
- `channel` — Channel name
- `view_count` — Total views
- `like_count` — Total likes
- `duration` — Video duration in seconds
- `description` — Full video description
- `thumbnail` — Thumbnail URL

## Architecture & Implementation

For detailed architecture, data flow, implementation details, and development guidance, see [CLAUDE.md](./CLAUDE.md).
