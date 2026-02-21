#!/usr/bin/env python3
"""
analyze_video.py — Master script for YouTube video comment analysis.

Workflow:
    1. Ask user for a YouTube URL.
    2. Create a subfolder named after the video.
    3. Fetch all comments via get_comments → save comments_DATE.csv.
    4. Filter out low-value comments.
    5. Sort by like count.
    6. Generate a self-contained report.html with charts and tables.
"""

import os
import re
import sys
from datetime import datetime
from urllib.parse import parse_qs, urlparse

import pandas as pd

from get_comments import get_comments
from create_report import generate_report

# ── Helpers ──────────────────────────────────────────────────────────────────

def extract_video_id(url: str) -> str:
    parsed = urlparse(url)
    if parsed.hostname in ("youtu.be",):
        return parsed.path.lstrip("/").split("?")[0]
    qs = parse_qs(parsed.query)
    return qs.get("v", ["video"])[0]


def sanitize_dirname(name: str) -> str:
    return re.sub(r"[^\w\-_. ]", "_", name)[:60].strip()


def filter_low_value(df: pd.DataFrame) -> pd.DataFrame:
    """Remove empty, near-empty, and non-alphabetic comments."""
    df = df.copy()
    df["text"] = df["text"].fillna("").astype(str).str.strip()
    df = df[df["text"].str.len() >= 3]
    df = df[df["text"].str.count(r"[a-zA-Z]") >= 2]
    return df


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print()
    print("=" * 60)
    print("  YouTube Video Analyzer")
    print("=" * 60)
    print()

    # Step 1 — Get URL from user
    url = input("Enter YouTube video URL: ").strip()
    if not url:
        print("No URL provided. Exiting.")
        sys.exit(1)

    # Step 2 — Fetch comments (saved to CWD temporarily)
    print()
    print("[1/5] Fetching video info and comments…")
    try:
        video_info, csv_path = get_comments(url)
    except Exception as exc:
        print(f"\n  Error: {exc}")
        sys.exit(1)

    # Step 3 — Create subfolder in Reports and move CSV into it
    video_id   = extract_video_id(url)
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    reports_dir = os.path.join(project_root, "Reports")
    folder     = os.path.join(reports_dir, video_id)
    os.makedirs(folder, exist_ok=True)

    date_str  = datetime.now().strftime("%Y-%m-%d")
    final_csv = os.path.join(folder, f"{video_id}_comments_{date_str}.csv")
    os.replace(csv_path, final_csv)

    print(f"[2/5] Subfolder created: {folder}/")
    print(f"[3/5] Comments saved to: {final_csv}")

    # Step 4 — Load, filter, sort
    df = pd.read_csv(final_csv)
    df["like_count"] = (
        pd.to_numeric(df["like_count"], errors="coerce").fillna(0).astype(int)
    )
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="s", errors="coerce")

    df_filtered = filter_low_value(df)
    df_sorted   = df_filtered.sort_values("like_count", ascending=False).reset_index(drop=True)

    removed = len(df) - len(df_filtered)
    print(f"[4/5] Filtered: {len(df):,} → {len(df_filtered):,} comments "
          f"(removed {removed:,} low-value)")

    # Step 5 — Generate report
    report_path = os.path.join(folder, f"{video_id}_report_{date_str}.html")
    print("[5/5] Generating report…")
    generate_report(video_info, df_sorted, report_path)

    print()
    print("=" * 60)
    print(f"  Done!  Report: {report_path}")
    print("  Open in any browser to view the analysis.")
    print("=" * 60)
    print()


if __name__ == "__main__":
    main()
