#!/usr/bin/env python3
"""
analyze_video.py — Master script for YouTube video comment analysis.

Workflow:
    1. Ask user for a YouTube URL.
    2. Create a subfolder named after the video ID.
    3. Fetch comments (or reuse an existing Parquet file).
    4. Filter out low-value comments.
    5. Sort by like count and generate a self-contained HTML report.
"""

import glob
import json
import os
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


def filter_low_value(df: pd.DataFrame) -> pd.DataFrame:
    """Remove empty, near-empty, and non-alphabetic comments."""
    df = df.copy()
    df["text"] = df["text"].fillna("").astype(str).str.strip()
    df = df[df["text"].str.len() >= 3]
    df = df[df["text"].str.count(r"[a-zA-Z]") >= 2]
    return df


def _find_latest_parquet(folder: str, video_id: str):
    matches = glob.glob(os.path.join(folder, f"{video_id}_comments_*.parquet"))
    return max(matches) if matches else None


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

    # Set up folder structure before fetching
    video_id = extract_video_id(url)
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    reports_dir = os.path.join(project_root, "Reports")
    folder = os.path.join(reports_dir, video_id)
    os.makedirs(folder, exist_ok=True)

    info_path = os.path.join(folder, f"{video_id}_info.json")
    existing = _find_latest_parquet(folder, video_id)

    use_existing = False
    if existing and os.path.exists(info_path):
        existing_name = os.path.basename(existing)
        row_count = len(pd.read_parquet(existing, columns=["id"]))
        print(f"\n  Found existing comments: {existing_name} ({row_count:,} comments)")
        print("  [1] Use existing file")
        print("  [2] Fetch fresh comments from YouTube")
        choice = input("  Choice [1]: ").strip()
        use_existing = (choice != "2")

    # Step 2 — Fetch or load comments
    if not use_existing:
        print("\n[1/4] Fetching video info and comments…")
        try:
            video_info, df_raw = get_comments(url)
        except Exception as exc:
            print(f"\n  Error: {exc}")
            sys.exit(1)

        df_raw["like_count"] = (
            pd.to_numeric(df_raw["like_count"], errors="coerce").fillna(0).astype(int)
        )
        df_raw["datetime"] = pd.to_datetime(df_raw["timestamp"], unit="s", errors="coerce")

        date_str = datetime.now().strftime("%Y-%m-%d")
        parquet_path = os.path.join(folder, f"{video_id}_comments_{date_str}.parquet")
        df_raw.to_parquet(parquet_path, index=False)
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(video_info, f, ensure_ascii=False)
        print(f"[2/4] Comments saved to: {parquet_path}")
    else:
        print("\n[1/4] Loading existing comments…")
        with open(info_path, "r", encoding="utf-8") as f:
            video_info = json.load(f)
        df_raw = pd.read_parquet(existing)
        print(f"[2/4] Loaded: {os.path.basename(existing)}")

    # Step 3 — Filter and sort
    df_filtered = filter_low_value(df_raw)
    df_sorted = df_filtered.sort_values("like_count", ascending=False).reset_index(drop=True)

    removed = len(df_raw) - len(df_filtered)
    print(f"[3/4] Filtered: {len(df_raw):,} → {len(df_filtered):,} comments "
          f"(removed {removed:,} low-value)")

    # Step 4 — Generate report
    date_str = datetime.now().strftime("%Y-%m-%d")
    report_path = os.path.join(folder, f"{video_id}_report_{date_str}.html")
    print("[4/4] Generating report…")
    generate_report(video_info, df_sorted, report_path)

    print()
    print("=" * 60)
    print(f"  Done!  Report: {report_path}")
    print("  Open in any browser to view the analysis.")
    print("=" * 60)
    print()


if __name__ == "__main__":
    main()
