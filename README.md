# YouTube Comments Analyzer

A Python toolkit that fetches YouTube video comments and generates a rich HTML analysis report.

## Project Structure

```
.
├── Scripts/
│   ├── analyze_video.py      Master script — run this to analyse a video end-to-end
│   ├── get_comments.py       Fetches comments via yt-dlp, returns a DataFrame
│   └── create_report.py      Generates HTML report with charts and analysis
├── Reports/                  Output folder for all generated reports
├── css/
│   └── report.css           Styling for HTML reports
├── requirements.txt         Python dependencies
└── README.md               This file
```

## Main Scripts

| File | Purpose |
|---|---|
| `Scripts/analyze_video.py` | **Master script** — run this to analyse a video end-to-end |
| `Scripts/get_comments.py` | Fetches comments via `yt-dlp`, returns a DataFrame |
| `Scripts/create_report.py` | Generates the HTML report from comment data and video info |

## Requirements

- Python 3.10+
- Git
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- pandas, pyarrow, matplotlib, vaderSentiment

## Windows Setup & Deployment

### Step 1: Install Python

1. Download Python 3.10 or later from [python.org](https://www.python.org/downloads/)
2. Run the installer and **check the box** "Add Python to PATH"
3. Verify installation in Command Prompt:
   ```cmd
   python --version
   ```

### Step 2: Install Git

1. Download Git from [git-scm.com](https://git-scm.com/)
2. Run the installer with default settings
3. Verify installation in Command Prompt:
   ```cmd
   git --version
   ```

### Step 3: Clone the Project

1. Copy the repository URL from GitHub
2. Open Command Prompt (cmd)
3. Navigate to your projects folder:
   ```cmd
   cd C:\Users\YourUsername\Documents\Projects
   ```
4. Clone the repository:
   ```cmd
   git clone <paste-the-github-url-here>
   cd <project-folder-name>
   ```

### Step 4: Create and Activate Virtual Environment

1. Create a virtual environment:
   ```cmd
   python -m venv myenv
   ```
2. Activate the virtual environment:
   ```cmd
   myenv\Scripts\activate
   ```
   ✅ You'll see `(myenv)` appear at the start of your command prompt line

### Step 5: Install Dependencies

With the virtual environment activated, run:
```cmd
pip install -r requirements.txt
```

This installs:
- yt-dlp (for fetching YouTube data)
- pandas (for data processing)
- pyarrow (for Parquet file support)
- matplotlib (for charts)
- vaderSentiment (for sentiment analysis)

### Step 6: Run the Analyzer

With the virtual environment still activated, run:
```cmd
python Scripts/analyze_video.py
```

The script will prompt you for a YouTube video URL and generate a full report.

### Troubleshooting

| Issue | Solution |
|---|---|
| `python` command not found | Reinstall Python and check "Add Python to PATH" during installation |
| `virtualenv not found` | Use `python -m venv myenv` instead |
| `pip` command not found | The virtual environment may not be activated. Run `myenv\Scripts\activate` |
| `ModuleNotFoundError` | Make sure the virtual environment is activated before running the script |

## Usage

### Full analysis (recommended)

```bash
python Scripts/analyze_video.py
```

The script will prompt you for a YouTube URL and then:

1. Check `Reports/<video_id>/` for an existing Parquet comments file
2. If found, offer to reuse it or fetch fresh comments from YouTube
3. Save comments to `Reports/<video_id>/<video_id>_comments_YYYY-MM-DD.parquet`
4. Filter out low-value comments (empty / non-alphabetic)
5. Sort by like count
6. Generate a self-contained `Reports/<video_id>/<video_id>_report_YYYY-MM-DD.html`

Open the HTML file in any web browser to view the full analysis report.

### Fetch comments only

```bash
python Scripts/get_comments.py <youtube_url>
```

## Report Generation

The `create_report.py` module handles all report generation and is automatically called by `analyze_video.py`. It:

- **Analyzes sentiment** using VADER sentiment analysis on each comment
- **Extracts word frequencies** with common stop words filtered out
- **Generates charts** for visualization:
  - Top 10 words
  - Top 10 two-word phrases (bigrams)
  - Top 10 three-word phrases (trigrams)
  - Comment timeline (comments per month)
  - Sentiment distribution (pie chart)
  - Like count distribution (histogram)
  - Most active commenters (top 10)
- **Creates a self-contained HTML report** with all charts embedded as base64 images
- **Includes a ranked table** of the top 100 most-liked comments

The report is styled with an external CSS file (`css/report.css`) and includes:
- Video metadata (title, channel, views, likes, duration)
- Comment statistics (averages, sentiment breakdown)
- Interactive and visual data representations

## Output structure

All reports are saved in the `Reports/` folder:

```
Reports/
└── <video_id>/
    ├── <video_id>_comments_YYYY-MM-DD.parquet   # raw comment data
    ├── <video_id>_info.json                     # video metadata sidecar
    └── <video_id>_report_YYYY-MM-DD.html        # full analysis report
```

Example:
```
Reports/
└── t_cmP3hZQzQ/
    ├── t_cmP3hZQzQ_comments_2026-02-21.parquet
    ├── t_cmP3hZQzQ_info.json
    └── t_cmP3hZQzQ_report_2026-02-21.html
```

## Report contents

- **Video info** — title, channel, views, likes, duration, description
- **Comment statistics** — count, average/median/max likes, sentiment breakdown
- **Sentiment & activity** — pie chart + comments-over-time line graph
- **Top 10 words** — most common single words (stop words removed)
- **Top 10 two-word phrases** — most common bigrams
- **Top 10 three-word phrases** — most common trigrams
- **Like count distribution** — histogram of likes per comment
- **Most active commenters** — top 10 by comment count
- **Top 100 liked comments** — ranked table

## Parquet columns

| Column | Description |
|---|---|
| `id` | Comment ID |
| `author` | Display name of the commenter |
| `text` | Full comment text |
| `like_count` | Number of likes on the comment |
| `timestamp` | Unix timestamp of the comment |
| `parent` | `root` for top-level comments; reply parent ID otherwise |
| `datetime` | Parsed UTC datetime (derived from `timestamp`) |
