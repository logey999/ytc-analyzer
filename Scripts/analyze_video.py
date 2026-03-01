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

# lingua: accurate language detection, especially on short text
try:
    from lingua import Language as _Language, LanguageDetectorBuilder as _LDB
    _lingua_detector = _LDB.from_all_languages().with_preloaded_language_models().build()
    _LINGUA_AVAILABLE = True
except ImportError:
    _lingua_detector = None  # type: ignore[assignment]
    _LINGUA_AVAILABLE = False

# rapidfuzz: fast fuzzy string matching for near-duplicate detection
try:
    from rapidfuzz import fuzz as _fuzz
    _RAPIDFUZZ_AVAILABLE = True
except ImportError:
    _fuzz = None  # type: ignore[assignment]
    _RAPIDFUZZ_AVAILABLE = False

# vaderSentiment: rule-based sentiment analysis (compound score −1 to +1)
try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer as _SIA
    _VADER_AVAILABLE = True
    _vader = _SIA()
except ImportError:
    _SIA = None  # type: ignore[assignment]
    _VADER_AVAILABLE = False
    _vader = None

# ---------------------------------------------------------------------------
# Pre-compiled patterns
# ---------------------------------------------------------------------------

_URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
# Matches bare timestamps like "2:34" or "1:23:45" (entire comment)
_TIMESTAMP_RE = re.compile(r"^(\d+:)?\d{1,2}:\d{2}$")
# Five or more identical consecutive characters ("lolololol", "!!!!!")
_REPEAT_CHAR_RE = re.compile(r"([a-zA-Z0-9])\1{4,}")

from get_comments import get_comments, _extract_video_id as extract_video_id
from create_report import generate_report


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


def _near_dedup_remove_all(df: pd.DataFrame, threshold: int) -> pd.DataFrame:
    """
    Find all groups of near-duplicate comments and remove EVERY member of any
    group with 2+ comments. Uses union-find to correctly cluster transitive matches.
    O(n²) — fast in practice via rapidfuzz C backend.
    """
    from collections import Counter
    texts = df["text"].tolist()
    n = len(texts)
    parent = list(range(n))

    def _find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def _union(x: int, y: int) -> None:
        px, py = _find(x), _find(y)
        if px != py:
            parent[px] = py

    for i in range(n):
        for j in range(i + 1, n):
            if _fuzz.ratio(texts[i], texts[j]) >= threshold:
                _union(i, j)

    group_sizes = Counter(_find(i) for i in range(n))
    keep_mask = [group_sizes[_find(i)] == 1 for i in range(n)]
    return df.iloc[[i for i, keep in enumerate(keep_mask) if keep]]


def filter_low_value(
    df: pd.DataFrame,
    # ── vectorized string checks (fastest) ───────────────────────────────
    min_chars: bool = True,
    min_chars_threshold: int = 20,
    min_alpha: bool = True,
    min_words: bool = True,
    min_words_threshold: int = 3,
    # ── set-lookup against external store (fast O(n+m)) ──────────────────
    blacklist_match: bool = True,
    blacklist_texts: set = None,   # pre-built set of lowercased blacklisted texts
    # ── per-row regex checks ──────────────────────────────────────────────
    emoji_only: bool = True,
    url_only: bool = True,
    timestamp_only: bool = True,
    repeat_char: bool = True,
    # ── per-row ML inference (slow) ───────────────────────────────────────
    english_only: bool = True,
    english_confidence: float = 0.5,
    sentiment_filter: bool = True,
    sentiment_threshold: float = -0.8,  # VADER compound ≤ threshold → blacklist
    # ── pairwise comparison (slowest, O(n²)) ─────────────────────────────
    dedup: bool = True,
    dedup_threshold: int = 85,
) -> tuple[pd.DataFrame, dict]:
    """
    Remove empty, near-empty, and low-value comments.
    Filters are ordered cheapest → most expensive to minimise rows processed
    by later stages.

        min_chars          — drop comments shorter than 3 characters
        min_alpha          — drop comments with fewer than 2 letters
        min_words          — drop comments with fewer than 3 words
        emoji_only         — drop comments whose non-emoji content is empty/trivial
        url_only           — drop comments whose non-URL content is empty/trivial
        timestamp_only     — drop bare timestamps ("2:34", "1:23:45")
        repeat_char        — drop comments with 5+ identical consecutive characters
        blacklist_match    — drop comments matching existing blacklist (requires: blacklist_texts set)
        english_only       — drop non-English comments (requires: lingua-language-detector)
        english_confidence — minimum confidence for English (0.0–1.0); default 0.5
        sentiment_filter   — drop comments with VADER compound score ≤ sentiment_threshold
        sentiment_threshold — VADER compound cutoff (−1 to 0); default −0.5 (requires: vaderSentiment)
        dedup              — drop ALL copies of any exact or near-duplicate comment
        dedup_threshold    — similarity % (0-100) for near-dup detection (requires: rapidfuzz)
    """
    df = df.copy()
    df["text"] = df["text"].fillna("").astype(str).str.strip()

    reasons: dict = {}  # comment_id -> filter rule that removed it

    def _apply(mask: "pd.Series", label: str) -> None:
        """Drop rows where mask is False; record reason for newly removed rows."""
        removed = df[~mask]["id"].astype(str)
        for cid in removed:
            reasons.setdefault(cid, label)

    # ── 1. vectorized string length/content checks (O(n), no per-row call) ─
    if min_chars:
        mask = df["text"].str.len() >= min_chars_threshold
        _apply(mask, "Too Short")
        df = df[mask]
    if min_alpha:
        mask = df["text"].str.count(r"[a-zA-Z]") >= 2
        _apply(mask, "No Alpha")
        df = df[mask]
    if min_words:
        mask = df["text"].str.split().str.len() >= min_words_threshold
        _apply(mask, "Too Few Words")
        df = df[mask]

    # ── 2. set-lookup against blacklist (O(n+m), vectorized isin) ──────────
    if blacklist_match and blacklist_texts:
        norm = df["text"].str.lower().str.strip()
        mask = ~norm.isin(blacklist_texts)
        _apply(mask, "Blacklisted")
        df = df[mask]

    # ── 3. per-row regex checks ────────────────────────────────────────────
    if emoji_only:
        stripped = df["text"].apply(_strip_emoji).str.strip()
        mask = stripped.str.len() >= 2
        _apply(mask, "Emoji Only")
        df = df[mask]

    if url_only:
        stripped = df["text"].apply(lambda t: _URL_RE.sub("", t)).str.strip()
        mask = stripped.str.len() >= 2
        _apply(mask, "URL Only")
        df = df[mask]

    if timestamp_only:
        mask = ~df["text"].apply(lambda t: bool(_TIMESTAMP_RE.fullmatch(t)))
        _apply(mask, "Timestamp")
        df = df[mask]

    if repeat_char:
        mask = ~df["text"].apply(lambda t: bool(_REPEAT_CHAR_RE.search(t)))
        _apply(mask, "Repeated Chars")
        df = df[mask]

    # ── 4. per-row language detection (slow — runs after cheap filters) ────
    if english_only:
        if _LINGUA_AVAILABLE:
            min_conf = float(english_confidence)
            def _is_english(text: str) -> bool:
                try:
                    conf = _lingua_detector.compute_language_confidence_of(text, _Language.ENGLISH)
                    return conf >= min_conf
                except Exception:
                    return True  # keep on detection failure
            mask = df["text"].apply(_is_english)
            _apply(mask, "Non-English")
            df = df[mask]
        else:
            print("  [warn] english_only requires 'lingua-language-detector': pip install lingua-language-detector")

    # ── 5. per-row sentiment analysis (slow — VADER rule-based) ──────────
    if sentiment_filter:
        if _VADER_AVAILABLE:
            threshold = float(sentiment_threshold)
            mask = df["text"].apply(
                lambda t: _vader.polarity_scores(t)["compound"] > threshold
            )
            _apply(mask, "Negative Sentiment")
            df = df[mask]
        else:
            print("  [warn] sentiment_filter requires 'vaderSentiment': pip install vaderSentiment")

    # ── 6. pairwise near-dup removal (O(n²) — must run last) ─────────────
    if dedup:
        # Exact duplicates (case-insensitive) — remove ALL copies, keep none
        norm = df["text"].str.lower().str.strip()
        mask = ~norm.duplicated(keep=False)
        _apply(mask, "Duplicate")
        df = df[mask]
        # Near-duplicates via rapidfuzz — remove ALL members of every dup group
        if _RAPIDFUZZ_AVAILABLE and dedup_threshold < 100:
            df_before = df.reset_index(drop=True)
            df = _near_dedup_remove_all(df_before, dedup_threshold)
            kept_ids = set(df["id"].astype(str))
            for cid in df_before["id"].astype(str):
                if cid not in kept_ids:
                    reasons.setdefault(cid, "Duplicate")
        elif not _RAPIDFUZZ_AVAILABLE and dedup_threshold < 100:
            print("  [warn] near-dup dedup requires 'rapidfuzz': pip install rapidfuzz")

    return df.reset_index(drop=True), reasons


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

    df_filtered, _ = filter_low_value(df_raw)
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
