# YouTube Comments Analyzer

Fetch and analyze YouTube video comments. Score them with Claude AI to surface video topic ideas, filter low-quality comments, and manage what to keep or discard.

## Features

- **AI topic scoring** — Rates every comment 1–10 on video topic potential using Claude (Anthropic Batches API)
- **Comment filtering** — Removes low-quality comments (spam, duplicates, emoji-only, etc.)
- **Cross-report comment management** — Save, blacklist, or delete comments across all reports
- **Async job queue** — Analyze multiple videos concurrently
- **Report caching** — Reuse previously fetched data without hitting the API again
- **Self-contained HTML reports** — Download reports as standalone files

## Requirements

- Python 3.10+
- YouTube Data API v3 key (free tier: 10,000 units/day)
- Anthropic API key (optional — required for AI topic scoring)

API keys are entered directly in the dashboard — no config files needed.

## Setup

1. **Clone and install:**
   ```bash
   git clone https://github.com/logey999/ytc-analyzer.git
   cd ytc-analyzer
   python -m venv ytc-env
   source ytc-env/bin/activate  # Windows: ytc-env\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Start the dashboard:**
   ```bash
   python Scripts/server.py
   ```
   Open `http://localhost:5000`, enter your API key(s) in the settings panel, paste a YouTube URL, and submit.

Get a YouTube key at [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — enable the **YouTube Data API v3**.
