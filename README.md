# YouTube Comments Analyzer

A Python toolkit that fetches YouTube video comments and generates a rich HTML analysis report.

## Files

| File | Purpose |
|---|---|
| `analyze_video.py` | **Master script** — run this to analyse a video end-to-end |
| `get_comments.py` | Fetches comments via `yt-dlp` and saves `comments_DATE.csv` |
| `requirements.txt` | Python dependencies |

## Requirements

- Python 3.10+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- pandas, matplotlib, vaderSentiment

Install all dependencies:

```bash
pip install -r requirements.txt
```

## Usage

### Full analysis (recommended)

```bash
python analyze_video.py
```

The script will prompt you for a YouTube URL and then:

1. Create a subfolder named after the video
2. Download all comments → `comments_YYYY-MM-DD.csv`
3. Filter out low-value comments (empty / non-alphabetic)
4. Sort by like count
5. Generate a self-contained `report.html`

### Fetch comments only

```bash
python get_comments.py <youtube_url> [output_dir]
```

## Output structure

```
<video_id>_<video_title>/
├── comments_2024-06-01.csv   # raw comment data
└── report.html               # full analysis report
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

## CSV columns

| Column | Description |
|---|---|
| `id` | Comment ID |
| `author` | Display name of the commenter |
| `text` | Full comment text |
| `like_count` | Number of likes on the comment |
| `timestamp` | Unix timestamp of the comment |
| `parent` | `root` for top-level comments; reply parent ID otherwise |
