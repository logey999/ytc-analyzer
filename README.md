# YouTube Comments Analyzer

Fetch and analyze YouTube video comments. Generates reports with top liked comments, repeated phrase detection, and comment filtering. Run via CLI or an interactive web dashboard.

## Features

- **Repeated phrase detection** — Finds the most common multi-word phrases across all comments
- **Top liked comments** — Ranked table of the 100 most-liked comments
- **AI topic scoring** — Rates every comment 1–10 on video topic potential using Claude (Anthropic Batches API)
- **Comment filtering** — Removes low-quality comments (spam, duplicates, emoji-only, etc.)
- **Cross-report comment management** — Save, blacklist, or delete comments across all reports
- **Async job queue** — Analyze multiple videos concurrently via the web dashboard
- **Report caching** — Reuse previously fetched data without hitting the API again
- **Self-contained HTML reports** — Download reports as standalone files

## Requirements

- Python 3.10+
- YouTube Data API v3 key (free tier: 10,000 units/day)
- Anthropic API key (optional — required for AI topic scoring)

## Setup

1. **Clone and install:**
   ```bash
   git clone https://github.com/logey999/ytc-analyzer.git
   cd ytc-analyzer
   python -m venv ytc-env
   source ytc-env/bin/activate  # Windows: ytc-env\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Add your API key(s):**
   ```bash
   cp .env.example .env
   # Edit .env and set YOUTUBE_API_KEY=your-key-here
   # Optional: set ANTHROPIC_API_KEY=your-key-here for AI scoring
   ```
   Get a YouTube key at [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — enable the **YouTube Data API v3**.

## Usage

### Web Dashboard (recommended)
```bash
python Scripts/server.py
```
Open `http://localhost:5000`, paste a YouTube URL, and submit. Browse and navigate all generated reports from the dashboard.

### CLI
```bash
python Scripts/analyze_video.py
```
Prompts for a URL, fetches comments, filters them, and opens an HTML report in your browser. Re-running on the same video offers to reuse cached data.
