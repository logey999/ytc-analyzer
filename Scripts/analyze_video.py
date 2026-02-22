#!/usr/bin/env python3
"""
analyze_video.py — Master script for YouTube video comment analysis.

Workflow:
    1. Ask user for a YouTube URL.
    2. Create a subfolder: Reports/{channel}/{video_title_slug}/
    3. Fetch comments (or reuse an existing Parquet file).
    4. Filter out low-value comments.
    5. Sort by like count and generate a self-contained HTML report.
"""

import glob
import json
import os
import re
import sys
from datetime import datetime
from urllib.parse import parse_qs, urlparse

import pandas as pd

from get_comments import get_comments
from create_report import generate_report

def extract_video_id(url: str) -> str:
    parsed = urlparse(url)
    if parsed.hostname in ("youtu.be",):
        return parsed.path.lstrip("/").split("?")[0]
    qs = parse_qs(parsed.query)
    return qs.get("v", ["video"])[0]


def _slugify(text: str, max_len: int = None) -> str:
    """Convert text to a safe folder/file name slug."""
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    if max_len:
        slug = slug[:max_len].rstrip("_")
    return slug or "unknown"


def _video_slug(title: str) -> str:
    """First 10 characters of the slugified video title."""
    return _slugify(title, max_len=10)


def _channel_slug(channel: str) -> str:
    return _slugify(channel)


def filter_low_value(
    df: pd.DataFrame,
    min_chars: bool = True,
    min_alpha: bool = True,
    min_words: bool = True,
) -> pd.DataFrame:
    """Remove empty, near-empty, and non-alphabetic comments."""
    df = df.copy()
    df["text"] = df["text"].fillna("").astype(str).str.strip()
    if min_chars:
        df = df[df["text"].str.len() >= 3]
    if min_alpha:
        df = df[df["text"].str.count(r"[a-zA-Z]") >= 2]
    if min_words:
        df = df[df["text"].str.split().str.len() >= 3]
    return df


def _find_existing_report(reports_dir: str, video_id: str):
    """
    Scan all subfolders under reports_dir for an info.json whose 'id' matches
    video_id. Returns (folder, info_path, video_info_dict) or (None, None, None).
    """
    for info_path in glob.glob(
        os.path.join(reports_dir, "**", "*_info.json"), recursive=True
    ):
        try:
            with open(info_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("id") == video_id:
                return os.path.dirname(info_path), info_path, data
        except Exception:
            continue
    return None, None, None


def _find_latest_parquet(folder: str, slug: str):
    matches = glob.glob(os.path.join(folder, f"{slug}_comments_*.parquet"))
    return max(matches) if matches else None


def main() -> None:
    print()
    print("=" * 60)
    print("  YouTube Video Analyzer")
    print("=" * 60)
    print()

    url = input("Enter YouTube video URL: ").strip()
    if not url:
        print("No URL provided. Exiting.")
        sys.exit(1)

    video_id = extract_video_id(url)
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    reports_dir = os.path.join(project_root, "Reports")

    existing_folder, info_path, video_info = _find_existing_report(reports_dir, video_id)

    use_existing = False
    if existing_folder and info_path:
        slug = _video_slug(video_info.get("title", video_id))
        existing = _find_latest_parquet(existing_folder, slug)
        if existing:
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
            video_info, df_raw, _ = get_comments(url)
        except Exception as exc:
            print(f"\n  Error: {exc}")
            sys.exit(1)

        df_raw["like_count"] = (
            pd.to_numeric(df_raw["like_count"], errors="coerce").fillna(0).astype(int)
        )
        df_raw["datetime"] = pd.to_datetime(df_raw["timestamp"], unit="s", utc=True, errors="coerce")

        # Build folder: Reports/{channel_slug}/{video_slug}/
        channel_slug = _channel_slug(video_info.get("channel") or "unknown")
        slug = _video_slug(video_info.get("title") or video_id)
        folder = os.path.join(reports_dir, channel_slug, slug)
        os.makedirs(folder, exist_ok=True)

        date_str = datetime.now().strftime("%Y-%m-%d")
        info_path = os.path.join(folder, f"{slug}_info.json")
        parquet_path = os.path.join(folder, f"{slug}_comments_{date_str}.parquet")
        df_raw.to_parquet(parquet_path, index=False)
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(video_info, f, ensure_ascii=False)
        print(f"[2/4] Comments saved to: {parquet_path}")
    else:
        print("\n[1/4] Loading existing comments…")
        slug = _video_slug(video_info.get("title", video_id))
        existing = _find_latest_parquet(existing_folder, slug)
        folder = existing_folder
        df_raw = pd.read_parquet(existing)
        print(f"[2/4] Loaded: {os.path.basename(existing)}")

    df_filtered = filter_low_value(df_raw)
    df_sorted = df_filtered.sort_values("like_count", ascending=False).reset_index(drop=True)

    removed = len(df_raw) - len(df_filtered)
    print(f"[3/4] Filtered: {len(df_raw):,} → {len(df_filtered):,} comments "
          f"(removed {removed:,} low-value)")

    date_str = datetime.now().strftime("%Y-%m-%d")
    report_path = os.path.join(folder, f"{slug}_report_{date_str}.html")
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
