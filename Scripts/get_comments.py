"""
get_comments.py — Fetch YouTube video comments and metadata using YouTube Data API v3.

Usage as a module:
    from get_comments import get_comments
    video_info, df = get_comments("https://youtu.be/...")

Usage from the command line:
    python get_comments.py <youtube_url>

Requires YOUTUBE_API_KEY environment variable (or .env file in project root).
"""

import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import parse_qs, urlparse

import pandas as pd
from dotenv import load_dotenv
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Load .env from project root (one level up from Scripts/)
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))


def _get_api_key() -> str:
    """Return the YouTube API key or raise RuntimeError with setup instructions."""
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not key:
        msg = (
            "YOUTUBE_API_KEY not found. "
            "Create a .env file in the project root with: YOUTUBE_API_KEY=your_key_here"
        )
        print(f"\n  ERROR: {msg}\n")
        raise RuntimeError(msg)
    return key


def _extract_video_id(url: str) -> str:
    """Extract the video ID from a YouTube URL."""
    parsed = urlparse(url)
    if parsed.hostname in ("youtu.be",):
        return parsed.path.lstrip("/").split("?")[0]
    qs = parse_qs(parsed.query)
    vid = qs.get("v", [None])[0]
    if not vid:
        raise ValueError(f"Could not extract video ID from URL: {url!r}")
    return vid


def _parse_iso8601_duration(duration: str) -> int:
    """Convert ISO 8601 duration (e.g. 'PT15M33S') to total seconds."""
    match = re.match(
        r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration or ""
    )
    if not match:
        return 0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


def _build_youtube_client():
    """Create an authenticated YouTube Data API client."""
    api_key = _get_api_key()
    return build("youtube", "v3", developerKey=api_key)


def _api_request_with_retry(request, max_retries=3):
    """Execute an API request with exponential backoff on transient errors."""
    for attempt in range(max_retries + 1):
        try:
            return request.execute()
        except HttpError as e:
            status = e.resp.status
            if status == 403:
                reason = ""
                if e.error_details:
                    reason = e.error_details[0].get("reason", "")
                if reason == "commentsDisabled":
                    raise
                if reason == "quotaExceeded" or "quota" in str(e).lower():
                    raise
                raise
            if status in (429, 500, 503) and attempt < max_retries:
                wait = 2 ** attempt
                print(f"  API error {status}, retrying in {wait}s...")
                time.sleep(wait)
                continue
            raise


def _fetch_video_info(youtube, video_id: str) -> dict:
    """Fetch video metadata and return in the standard video_info shape."""
    request = youtube.videos().list(
        part="snippet,statistics,contentDetails",
        id=video_id,
    )
    response = _api_request_with_retry(request)

    items = response.get("items", [])
    if not items:
        raise ValueError(f"Video not found: {video_id}")

    item = items[0]
    snippet = item["snippet"]
    stats = item.get("statistics", {})
    content = item.get("contentDetails", {})

    # Normalize upload_date to YYYYMMDD
    published = snippet.get("publishedAt", "")
    upload_date = published[:10].replace("-", "") if published else ""

    # Get best available thumbnail
    thumbs = snippet.get("thumbnails", {})
    thumbnail = (
        thumbs.get("high", {}).get("url")
        or thumbs.get("medium", {}).get("url")
        or thumbs.get("default", {}).get("url")
        or ""
    )

    return {
        "id": video_id,
        "title": snippet.get("title", ""),
        "channel": snippet.get("channelTitle", ""),
        "channel_id": snippet.get("channelId", ""),
        "view_count": int(stats.get("viewCount", 0)),
        "like_count": int(stats.get("likeCount", 0)),
        "upload_date": upload_date,
        "description": snippet.get("description", ""),
        "duration": _parse_iso8601_duration(content.get("duration", "")),
        "thumbnail": thumbnail,
        "webpage_url": f"https://www.youtube.com/watch?v={video_id}",
        "comment_count": int(stats.get("commentCount", 0)),
    }


def _fetch_all_comments(youtube, video_id: str, on_progress=None) -> tuple[list[dict], int]:
    """Paginate through all comments (top-level + replies) for a video.

    Returns (all_comments, units_used)
    """
    all_comments = []
    page_token = None
    units = 0

    while True:
        request = youtube.commentThreads().list(
            part="snippet,replies",
            videoId=video_id,
            maxResults=100,
            pageToken=page_token,
            textFormat="plainText",
        )

        try:
            response = _api_request_with_retry(request)
            units += 1  # commentThreads.list costs 1 unit
        except HttpError as e:
            if e.resp.status == 403:
                reason = ""
                if e.error_details:
                    reason = e.error_details[0].get("reason", "")
                if reason == "commentsDisabled":
                    print("  Comments are disabled for this video.")
                    return [], units
                if reason == "quotaExceeded" or "quota" in str(e).lower():
                    print("  YouTube API quota exceeded. Quota resets at midnight Pacific Time.")
                    print("  Please try again later.")
                    return [], units
            raise

        for item in response.get("items", []):
            # Top-level comment
            top = item["snippet"]["topLevelComment"]
            top_snippet = top["snippet"]
            published = top_snippet.get("publishedAt", "")
            timestamp = _iso_to_unix(published)

            all_comments.append({
                "id": top["id"],
                "author": top_snippet.get("authorDisplayName", ""),
                "author_channel_id": top_snippet.get("authorChannelId", {}).get("value", ""),
                "text": top_snippet.get("textDisplay", ""),
                "like_count": top_snippet.get("likeCount", 0),
                "timestamp": timestamp,
                "parent": "root",
            })

            # Replies included in the thread
            reply_count = item["snippet"].get("totalReplyCount", 0)
            replies_in_thread = item.get("replies", {}).get("comments", [])

            if reply_count > 5 and len(replies_in_thread) < reply_count:
                # Fetch all replies via comments.list
                _fetch_all_replies(youtube, top["id"], all_comments)
                units += 1  # comments.list costs 1 unit per request
            else:
                for reply in replies_in_thread:
                    r_snippet = reply["snippet"]
                    r_published = r_snippet.get("publishedAt", "")
                    all_comments.append({
                        "id": reply["id"],
                        "author": r_snippet.get("authorDisplayName", ""),
                        "author_channel_id": r_snippet.get("authorChannelId", {}).get("value", ""),
                        "text": r_snippet.get("textDisplay", ""),
                        "like_count": r_snippet.get("likeCount", 0),
                        "timestamp": _iso_to_unix(r_published),
                        "parent": top["id"],
                    })

        if on_progress:
            on_progress(f"Fetched {len(all_comments):,} comments...")
        else:
            print(f"  Fetched {len(all_comments):,} comments...")

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return all_comments, units


def _fetch_all_replies(youtube, parent_id: str, all_comments: list) -> None:
    """Fetch all replies for a comment thread when there are more than 5."""
    page_token = None
    while True:
        request = youtube.comments().list(
            part="snippet",
            parentId=parent_id,
            maxResults=100,
            pageToken=page_token,
            textFormat="plainText",
        )
        response = _api_request_with_retry(request)

        for reply in response.get("items", []):
            r_snippet = reply["snippet"]
            r_published = r_snippet.get("publishedAt", "")
            all_comments.append({
                "id": reply["id"],
                "author": r_snippet.get("authorDisplayName", ""),
                "author_channel_id": r_snippet.get("authorChannelId", {}).get("value", ""),
                "text": r_snippet.get("textDisplay", ""),
                "like_count": r_snippet.get("likeCount", 0),
                "timestamp": _iso_to_unix(r_published),
                "parent": parent_id,
            })

        page_token = response.get("nextPageToken")
        if not page_token:
            break


def _iso_to_unix(iso_str: str) -> int:
    """Convert ISO 8601 timestamp to unix seconds."""
    if not iso_str:
        return 0
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return int(dt.timestamp())
    except (ValueError, OSError):
        return 0


def get_comments(url: str, on_progress=None) -> tuple[dict, pd.DataFrame, int]:
    """
    Fetch all comments and metadata for a YouTube video.

    Args:
        url: Full YouTube video URL.
        on_progress: Optional callback(msg: str) for progress updates.

    Returns:
        (video_info, df, units_used)
        video_info   — dict with title, channel, view_count, etc.
        df           — DataFrame with columns: id, author, text, like_count, timestamp, parent
        units_used   — YouTube API units consumed (approximate)
    """
    video_id = _extract_video_id(url)
    youtube = _build_youtube_client()

    if on_progress:
        on_progress("Fetching video metadata...")
    else:
        print("  Fetching video metadata...")
    video_info = _fetch_video_info(youtube, video_id)
    if on_progress:
        on_progress(f"Video: {video_info.get('title', '')}")

    if on_progress:
        on_progress("Fetching comments...")
    else:
        print("  Fetching comments...")
    comments, units = _fetch_all_comments(youtube, video_id, on_progress=on_progress)

    df = pd.DataFrame(comments) if comments else pd.DataFrame(
        columns=["id", "author", "text", "like_count", "timestamp", "parent"]
    )
    return video_info, df, units


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python get_comments.py <youtube_url>")
        sys.exit(1)

    _url = sys.argv[1]
    _info, _df = get_comments(_url)
    print(f"Title:    {_info['title']}")
    print(f"Channel:  {_info['channel']}")
    print(f"Comments: {len(_df):,}")
