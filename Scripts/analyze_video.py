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

# ---------------------------------------------------------------------------
# Optional dependencies — features degrade gracefully if not installed
# ---------------------------------------------------------------------------

# emoji library: accurate Unicode emoji stripping
# Fallback: broad regex covering the most common emoji blocks
try:
    import emoji as _emoji_mod
    def _strip_emoji(text: str) -> str:
        return _emoji_mod.replace_emoji(text, replace="")
except ImportError:
    _EMOJI_FALLBACK_RE = re.compile(
        "[\U0001F300-\U0001FFFF"
        "\U00002600-\U000027FF"
        "\U0000FE00-\U0000FE0F]",
        flags=re.UNICODE,
    )
    def _strip_emoji(text: str) -> str:
        return _EMOJI_FALLBACK_RE.sub("", text)

# langdetect: language identification
try:
    from langdetect import detect as _lang_detect
    _LANGDETECT_AVAILABLE = True
except ImportError:
    _lang_detect = None  # type: ignore[assignment]
    _LANGDETECT_AVAILABLE = False

# rapidfuzz: fast fuzzy string matching for near-duplicate detection
try:
    from rapidfuzz import fuzz as _fuzz
    _RAPIDFUZZ_AVAILABLE = True
except ImportError:
    _fuzz = None  # type: ignore[assignment]
    _RAPIDFUZZ_AVAILABLE = False

# ---------------------------------------------------------------------------
# Pre-compiled patterns
# ---------------------------------------------------------------------------

_URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
# Matches bare timestamps like "2:34" or "1:23:45" (entire comment)
_TIMESTAMP_RE = re.compile(r"^(\d+:)?\d{1,2}:\d{2}$")
# Five or more identical consecutive characters ("lolololol", "!!!!!")
_REPEAT_CHAR_RE = re.compile(r"(.)\1{4,}")

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


def _near_dedup(df: pd.DataFrame, threshold: int) -> pd.DataFrame:
    """
    Remove near-duplicate comments using fuzzy ratio comparison.
    Assumes df is already sorted highest-liked first so the best version is kept.
    O(n²) — fast in practice for typical comment set sizes via rapidfuzz C backend.
    """
    texts = df["text"].tolist()
    keep_mask = [True] * len(texts)
    for i in range(len(texts)):
        if not keep_mask[i]:
            continue
        for j in range(i + 1, len(texts)):
            if not keep_mask[j]:
                continue
            if _fuzz.ratio(texts[i], texts[j]) >= threshold:
                keep_mask[j] = False
    return df.iloc[[i for i, keep in enumerate(keep_mask) if keep]]


def filter_low_value(
    df: pd.DataFrame,
    # ── existing toggles ──────────────────────────────────────────────────
    min_chars: bool = True,
    min_alpha: bool = True,
    min_words: bool = True,
    # ── new toggles ───────────────────────────────────────────────────────
    emoji_only: bool = True,
    url_only: bool = True,
    timestamp_only: bool = True,
    repeat_char: bool = True,
    english_only: bool = False,
    dedup: bool = True,
    dedup_threshold: int = 85,
) -> pd.DataFrame:
    """
    Remove empty, near-empty, and low-value comments.

    Toggle flags (all True = most aggressive filtering):
        min_chars       — drop comments shorter than 3 characters
        min_alpha       — drop comments with fewer than 2 letters
        min_words       — drop comments with fewer than 3 words
        emoji_only      — drop comments whose non-emoji content is empty/trivial
        url_only        — drop comments whose non-URL content is empty/trivial
        timestamp_only  — drop bare timestamps ("2:34", "1:23:45")
        repeat_char     — drop comments with 5+ identical consecutive characters
        english_only    — drop non-English comments (requires: langdetect)
        dedup           — drop exact and near-duplicate comments
        dedup_threshold — similarity % (0-100) for near-dup detection (requires: rapidfuzz)
    """
    df = df.copy()
    df["text"] = df["text"].fillna("").astype(str).str.strip()

    # ── cheap character-level filters first ───────────────────────────────
    if min_chars:
        df = df[df["text"].str.len() >= 3]
    if min_alpha:
        df = df[df["text"].str.count(r"[a-zA-Z]") >= 2]
    if min_words:
        df = df[df["text"].str.split().str.len() >= 3]

    # ── emoji-only: keep comment only if non-emoji content is non-trivial ─
    if emoji_only:
        stripped = df["text"].apply(_strip_emoji).str.strip()
        df = df[stripped.str.len() >= 2]

    # ── url-only: keep comment only if non-URL content is non-trivial ─────
    if url_only:
        stripped = df["text"].apply(lambda t: _URL_RE.sub("", t)).str.strip()
        df = df[stripped.str.len() >= 2]

    # ── timestamp-only: drop bare "2:34" / "1:23:45" comments ────────────
    if timestamp_only:
        df = df[~df["text"].apply(lambda t: bool(_TIMESTAMP_RE.fullmatch(t)))]

    # ── repeat character: drop "lolololol", "!!!!!" etc. ─────────────────
    if repeat_char:
        df = df[~df["text"].apply(lambda t: bool(_REPEAT_CHAR_RE.search(t)))]

    # ── english-only (slower — language detection per comment) ────────────
    if english_only:
        if _LANGDETECT_AVAILABLE:
            def _is_english(text: str) -> bool:
                try:
                    return _lang_detect(text) == "en"
                except Exception:
                    return True  # keep on detection failure
            df = df[df["text"].apply(_is_english)]
        else:
            print("  [warn] english_only requires 'langdetect': pip install langdetect")

    # ── dedup: exact then near-duplicate removal (slowest — runs last) ────
    if dedup:
        # Sort so the highest-liked copy is always kept
        if "like_count" in df.columns:
            df = df.sort_values("like_count", ascending=False)
        # Exact duplicates (case-insensitive)
        norm = df["text"].str.lower().str.strip()
        df = df[~norm.duplicated(keep="first")]
        # Near-duplicates via rapidfuzz
        if _RAPIDFUZZ_AVAILABLE and dedup_threshold < 100:
            df = _near_dedup(df.reset_index(drop=True), dedup_threshold)
        elif not _RAPIDFUZZ_AVAILABLE and dedup_threshold < 100:
            print("  [warn] near-dup dedup requires 'rapidfuzz': pip install rapidfuzz")

    return df.reset_index(drop=True)


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
