"""
get_comments.py — Fetch YouTube video comments and metadata using yt-dlp.

Usage as a module:
    from get_comments import get_comments
    video_info, csv_path = get_comments("https://youtu.be/...", output_dir=".")

Usage from the command line:
    python get_comments.py <youtube_url> [output_dir]
"""

import csv
import json
import os
import subprocess
import sys
from datetime import datetime


def get_comments(url: str, output_dir: str = ".") -> tuple[dict, str]:
    """
    Fetch all comments and metadata for a YouTube video.

    Args:
        url:        Full YouTube video URL.
        output_dir: Directory where the CSV will be saved (created if needed).

    Returns:
        (video_info, csv_path)
        video_info — dict with title, channel, view_count, etc.
        csv_path   — absolute path to the saved comments_YYYY-MM-DD.csv file.
    """
    os.makedirs(output_dir, exist_ok=True)

    print("  Calling yt-dlp (this may take a while for videos with many comments)…")
    result = subprocess.run(
        [
            "yt-dlp",
            "--write-comments",
            "--skip-download",
            "-o", "%(id)s",
            "--dump-json",
            url,
        ],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"yt-dlp exited with code {result.returncode}:\n{result.stderr.strip()}"
        )

    # yt-dlp may emit multiple JSON lines; use the last non-empty one.
    lines = [l for l in result.stdout.splitlines() if l.strip()]
    if not lines:
        raise RuntimeError("yt-dlp returned no JSON output.")
    data = json.loads(lines[-1])

    video_info = {
        "id":            data.get("id"),
        "title":         data.get("title"),
        "channel":       data.get("uploader"),
        "view_count":    data.get("view_count"),
        "like_count":    data.get("like_count"),
        "upload_date":   data.get("upload_date"),
        "description":   data.get("description", ""),
        "duration":      data.get("duration"),
        "thumbnail":     data.get("thumbnail"),
        "webpage_url":   data.get("webpage_url", url),
        "comment_count": data.get("comment_count"),
    }

    comments = data.get("comments", [])

    date_str = datetime.now().strftime("%Y-%m-%d")
    csv_path = os.path.join(output_dir, f"comments_{date_str}.csv")

    fieldnames = ["id", "author", "text", "like_count", "timestamp", "parent"]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for c in comments:
            writer.writerow({
                "id":         c.get("id", ""),
                "author":     c.get("author", ""),
                "text":       c.get("text", ""),
                "like_count": c.get("like_count", 0),
                "timestamp":  c.get("timestamp", ""),
                "parent":     c.get("parent", "root"),
            })

    return video_info, os.path.abspath(csv_path)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python get_comments.py <youtube_url> [output_dir]")
        sys.exit(1)

    _url = sys.argv[1]
    _output_dir = sys.argv[2] if len(sys.argv) > 2 else "."

    _info, _csv = get_comments(_url, _output_dir)
    print(f"Title:    {_info['title']}")
    print(f"Channel:  {_info['channel']}")
    print(f"Comments: saved to {_csv}")
