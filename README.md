# YouTube Comments Analyzer

A lightweight Python script that extracts YouTube video comments into a CSV file using `yt-dlp`.

## Requirements

- Python 3.x
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)

Install yt-dlp:

```bash
pip install yt-dlp
```

## Usage

1. Open `youtube_comments.py` and replace `VIDEO_ID` in the URL with the actual YouTube video ID:

```python
"https://www.youtube.com/watch?v=VIDEO_ID"
```

2. Run the script:

```bash
python youtube_comments.py
```

3. A `comments.csv` file will be created in the current directory.

## Output

The CSV file contains the following columns:

| Column | Description |
|---|---|
| `author` | Display name of the comment author |
| `text` | Full text of the comment |
| `like_count` | Number of likes on the comment |
| `timestamp` | Unix timestamp of when the comment was posted |

## How It Works

1. `yt-dlp` is invoked as a subprocess with `--write-comments` and `--dump-json` flags to fetch video metadata and comments without downloading the video.
2. The JSON output is parsed to extract the `comments` array.
3. Each comment's `author`, `text`, `like_count`, and `timestamp` fields are written to `comments.csv` using Python's built-in `csv` module.

## Analysis Ideas

Once you have `comments.csv`, you can perform analyses such as:

- **Sentiment analysis** — classify comments as positive, negative, or neutral using libraries like `TextBlob` or `VADER`.
- **Top commenters** — find the most active authors by grouping on the `author` column.
- **Most liked comments** — sort by `like_count` to surface the highest-engagement comments.
- **Comment frequency over time** — convert `timestamp` to a datetime and plot comment volume over time.
- **Word cloud** — generate a word cloud from the `text` column to visualize common topics.
- **Keyword search** — filter rows where `text` contains a specific word or phrase.

## Example (pandas)

```python
import pandas as pd

df = pd.read_csv("comments.csv")

# Top 10 most liked comments
print(df.nlargest(10, "like_count")[["author", "like_count", "text"]])

# Comment count per author
print(df["author"].value_counts().head(10))
```
