#!/usr/bin/env python3
"""
server.py — Flask web server for ytc-analyzer dashboard.

Usage:
    python Scripts/server.py

Opens at http://localhost:5000
"""

import glob
import json
import os
import queue
import sys
import threading
import uuid
from datetime import datetime

import pandas as pd
from flask import Flask, Response, jsonify, request, send_file, send_from_directory

# Add Scripts/ to sys.path so sibling modules can be imported
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from analyze_video import (
    _channel_slug,
    _find_existing_report,
    _find_latest_parquet,
    _video_slug,
    extract_video_id,
    filter_low_value,
)
from create_report import find_repeated_phrases
from get_comments import get_comments

# ── App setup ─────────────────────────────────────────────────────────────────

app = Flask(__name__)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(PROJECT_ROOT, "Reports")

# JSON stores for persistence
DISCARDED_PATH = os.path.join(PROJECT_ROOT, "Reports", "discarded.json")
IDEAS_PATH     = os.path.join(PROJECT_ROOT, "Reports", "ideas.json")
DELETED_PATH   = os.path.join(PROJECT_ROOT, "Reports", "deleted.json")
QUOTA_PATH     = os.path.join(PROJECT_ROOT, "Reports", "quota.json")
_store_lock = threading.Lock()

# Job registry: job_id → {queue, status, report_path, title}
_jobs: dict = {}
_jobs_lock = threading.Lock()


def _load_json_store(path, default):
    """Load JSON store file, returning default if not found or invalid."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _save_json_store(path, data):
    """Atomically save JSON store file (write to temp, then move)."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def _add_quota(n: int) -> None:
    """Add n units to the quota counter."""
    with _store_lock:
        quota = _load_json_store(QUOTA_PATH, {"date": "", "used": 0})
        today = datetime.now().strftime("%Y-%m-%d")
        if quota.get("date") != today:
            quota = {"date": today, "used": 0}
        quota["used"] = quota.get("used", 0) + n
        _save_json_store(QUOTA_PATH, quota)


# ── Analysis worker ───────────────────────────────────────────────────────────

def _send(q: queue.Queue, data: dict) -> None:
    q.put(json.dumps(data, ensure_ascii=False))


def _run_analysis(url: str, job_id: str) -> None:
    with _jobs_lock:
        q = _jobs[job_id]["queue"]

    try:
        video_id = extract_video_id(url)

        def on_progress(msg: str) -> None:
            _send(q, {"msg": msg})

        video_info, df_raw, units_used = get_comments(url, on_progress=on_progress)

        df_raw["like_count"] = (
            pd.to_numeric(df_raw["like_count"], errors="coerce").fillna(0).astype(int)
        )
        df_raw["datetime"] = pd.to_datetime(
            df_raw["timestamp"], unit="s", utc=True, errors="coerce"
        )

        channel_slug = _channel_slug(video_info.get("channel") or "unknown")
        slug = _video_slug(video_info.get("title") or video_id)
        folder = os.path.join(REPORTS_DIR, channel_slug, slug)
        os.makedirs(folder, exist_ok=True)

        date_str = datetime.now().strftime("%Y-%m-%d")
        info_path = os.path.join(folder, f"{slug}_info.json")
        parquet_path = os.path.join(folder, f"{slug}_comments_{date_str}.parquet")

        df_raw.to_parquet(parquet_path, index=False)
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(video_info, f, ensure_ascii=False)

        _send(q, {"msg": f"Saved {len(df_raw):,} comments to disk."})

        # Track API quota usage
        _add_quota(units_used)

        report_path = f"{channel_slug}/{slug}"

        with _jobs_lock:
            _jobs[job_id]["status"] = "done"
            _jobs[job_id]["report_path"] = report_path
            _jobs[job_id]["title"] = video_info.get("title", "")

        _send(q, {
            "done": True,
            "report_path": report_path,
            "title": video_info.get("title", ""),
        })

    except Exception as exc:
        with _jobs_lock:
            _jobs[job_id]["status"] = "error"
        _send(q, {"error": str(exc)})

    finally:
        q.put(None)  # sentinel to end SSE stream


# ── Static routes ─────────────────────────────────────────────────────────────

@app.get("/")
def route_index():
    return send_file(os.path.join(PROJECT_ROOT, "index.html"))


@app.get("/report")
def route_report():
    return send_file(os.path.join(PROJECT_ROOT, "report.html"))


@app.get("/css/<path:filename>")
def route_css(filename):
    return send_from_directory(os.path.join(PROJECT_ROOT, "css"), filename)


@app.get("/js/<path:filename>")
def route_js(filename):
    return send_from_directory(os.path.join(PROJECT_ROOT, "js"), filename)


# ── API: start / check analysis ───────────────────────────────────────────────

@app.post("/api/analyze")
def api_analyze():
    data = request.get_json(force=True, silent=True) or {}
    url = (data.get("url") or "").strip()
    force = bool(data.get("force", False))

    if not url:
        return jsonify({"error": "url is required"}), 400

    try:
        video_id = extract_video_id(url)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

    # Check for existing cached data (unless force=true)
    if not force:
        existing_folder, _info_path, video_info = _find_existing_report(REPORTS_DIR, video_id)
        if existing_folder and video_info:
            slug = _video_slug(video_info.get("title", video_id))
            parquet = _find_latest_parquet(existing_folder, slug)
            if parquet:
                try:
                    count = len(pd.read_parquet(parquet, columns=["id"]))
                except Exception:
                    count = 0
                date_str = (
                    os.path.basename(parquet)
                    .split("_comments_")[-1]
                    .replace(".parquet", "")
                )
                ch_slug = _channel_slug(video_info.get("channel") or "unknown")
                return jsonify({
                    "existing": {
                        "path": f"{ch_slug}/{slug}",
                        "title": video_info.get("title", ""),
                        "comment_count": count,
                        "date": date_str,
                    }
                })

    # Start a fresh fetch job
    job_id = str(uuid.uuid4())
    q: queue.Queue = queue.Queue()
    with _jobs_lock:
        _jobs[job_id] = {
            "queue": q,
            "status": "running",
            "report_path": None,
            "title": "",
        }

    t = threading.Thread(target=_run_analysis, args=(url, job_id), daemon=True)
    t.start()

    return jsonify({"job_id": job_id})


# ── API: SSE progress stream ──────────────────────────────────────────────────

@app.get("/api/progress/<job_id>")
def api_progress(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        return jsonify({"error": "unknown job"}), 404

    def generate():
        q = job["queue"]
        while True:
            try:
                item = q.get(timeout=30)
            except queue.Empty:
                yield f"data: {json.dumps({'ping': True})}\n\n"
                continue
            if item is None:
                break
            yield f"data: {item}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── API: list all reports ─────────────────────────────────────────────────────

@app.get("/api/reports")
def api_reports():
    results = []
    pattern = os.path.join(REPORTS_DIR, "**", "*_info.json")
    for info_path in glob.glob(pattern, recursive=True):
        try:
            with open(info_path, "r", encoding="utf-8") as f:
                info = json.load(f)

            folder = os.path.dirname(info_path)
            slug = _video_slug(info.get("title", info.get("id", "unknown")))
            parquets = glob.glob(os.path.join(folder, f"{slug}_comments_*.parquet"))

            if parquets:
                latest = max(parquets)
                date_str = (
                    os.path.basename(latest)
                    .split("_comments_")[-1]
                    .replace(".parquet", "")
                )
                try:
                    count = len(pd.read_parquet(latest, columns=["id"]))
                except Exception:
                    count = 0
            else:
                date_str = ""
                count = 0

            rel_folder = os.path.relpath(folder, REPORTS_DIR).replace("\\", "/")
            results.append({
                "path": rel_folder,
                "title": info.get("title", ""),
                "channel": info.get("channel", ""),
                "thumbnail": info.get("thumbnail", ""),
                "date": date_str,
                "comment_count": count,
                "view_count": info.get("view_count", 0),
            })
        except Exception:
            continue

    results.sort(key=lambda x: x.get("date", ""), reverse=True)
    return jsonify(results)


# ── API: report data (video_info + comments + phrases) ───────────────────────

@app.get("/api/report-data/<path:report_path>")
def api_report_data(report_path: str):
    folder = os.path.join(REPORTS_DIR, report_path)

    info_files = glob.glob(os.path.join(folder, "*_info.json"))
    if not info_files:
        return jsonify({"error": "report not found"}), 404

    with open(info_files[0], "r", encoding="utf-8") as f:
        video_info = json.load(f)

    slug = _video_slug(video_info.get("title", "unknown"))
    parquet = _find_latest_parquet(folder, slug)
    if not parquet:
        return jsonify({"error": "no parquet data found"}), 404

    df_raw = pd.read_parquet(parquet)
    df_raw["like_count"] = (
        pd.to_numeric(df_raw["like_count"], errors="coerce").fillna(0).astype(int)
    )
    df = filter_low_value(df_raw)

    # Load and filter out discarded comments
    discarded = _load_json_store(DISCARDED_PATH, [])
    if isinstance(discarded, list):
        discard_ids = {c.get("id") for c in discarded if c.get("_reportPath") == report_path}
    else:
        # Legacy dict format fallback
        discard_ids = set(discarded.get(report_path, []))
    total_discarded = len(discard_ids)
    if discard_ids and "id" in df.columns:
        df = df[~df["id"].isin(discard_ids)]

    df = df.sort_values("like_count", ascending=False).reset_index(drop=True)

    # Count kept comments from ideas store
    ideas = _load_json_store(IDEAS_PATH, [])
    total_kept = sum(1 for i in ideas if i.get("_reportPath") == report_path)

    phrases = find_repeated_phrases(df)

    cols = ["id", "author", "like_count", "text"]
    if "author_channel_id" in df.columns:
        cols.append("author_channel_id")
    comments_df = df[cols].copy()
    comments_df["like_count"] = comments_df["like_count"].astype(int)
    comments_df["author"] = comments_df["author"].fillna("").astype(str)
    comments_df["text"] = comments_df["text"].fillna("").astype(str)
    if "author_channel_id" in comments_df.columns:
        comments_df["author_channel_id"] = comments_df["author_channel_id"].fillna("").astype(str)

    return jsonify({
        "video_info": video_info,
        "comments": comments_df.to_dict(orient="records"),
        "phrases": phrases,
        "discarded_count": total_discarded,
        "kept_count": total_kept,
    })


# ── API: comment actions (discard, keep, ideas) ────────────────────────────────

@app.post("/api/comment/discard")
def api_comment_discard():
    """Discard a comment (move to blacklist). Accepts full comment object."""
    data = request.get_json(force=True, silent=True) or {}
    comment = data.get("comment")

    if not isinstance(comment, dict) or not comment.get("id"):
        return jsonify({"error": "comment object with id required"}), 400

    with _store_lock:
        discarded = _load_json_store(DISCARDED_PATH, [])
        # Handle legacy dict format
        if isinstance(discarded, dict):
            discarded = []
        existing_ids = {c.get("id") for c in discarded}
        if comment["id"] not in existing_ids:
            discarded.append(comment)
            _save_json_store(DISCARDED_PATH, discarded)

    return jsonify({"success": True})


@app.get("/api/blacklist")
def api_blacklist():
    """Fetch all discarded comments (blacklist)."""
    with _store_lock:
        discarded = _load_json_store(DISCARDED_PATH, [])
        if isinstance(discarded, dict):
            discarded = []
    return jsonify(discarded)


@app.delete("/api/blacklist/<comment_id>")
def api_blacklist_delete(comment_id: str):
    """Remove a comment from the blacklist."""
    with _store_lock:
        discarded = _load_json_store(DISCARDED_PATH, [])
        if isinstance(discarded, dict):
            discarded = []
        discarded = [c for c in discarded if c.get("id") != comment_id]
        _save_json_store(DISCARDED_PATH, discarded)

    return jsonify({"success": True})


@app.post("/api/comment/delete")
def api_comment_delete():
    """Send a comment to the Deleted bin."""
    data = request.get_json(force=True, silent=True) or {}
    comment = data.get("comment")

    if not isinstance(comment, dict) or not comment.get("id"):
        return jsonify({"error": "comment object with id required"}), 400

    with _store_lock:
        deleted = _load_json_store(DELETED_PATH, [])
        existing_ids = {c.get("id") for c in deleted}
        if comment["id"] not in existing_ids:
            deleted.append(comment)
            _save_json_store(DELETED_PATH, deleted)

    return jsonify({"success": True})


@app.get("/api/deleted")
def api_deleted():
    """Fetch all comments in the Deleted bin."""
    with _store_lock:
        deleted = _load_json_store(DELETED_PATH, [])
    return jsonify(deleted)


@app.delete("/api/deleted/<comment_id>")
def api_deleted_delete(comment_id: str):
    """Permanently remove a comment from the Deleted bin."""
    with _store_lock:
        deleted = _load_json_store(DELETED_PATH, [])
        deleted = [c for c in deleted if c.get("id") != comment_id]
        _save_json_store(DELETED_PATH, deleted)

    return jsonify({"success": True})


@app.post("/api/comment/keep")
def api_comment_keep():
    """Keep (save) a comment to the Ideas collection."""
    data = request.get_json(force=True, silent=True) or {}
    comment = data.get("comment")

    if not isinstance(comment, dict) or not comment.get("id"):
        return jsonify({"error": "comment object with id required"}), 400

    with _store_lock:
        ideas = _load_json_store(IDEAS_PATH, [])
        # Deduplicate by id
        existing_ids = set(i.get("id") for i in ideas)
        if comment.get("id") not in existing_ids:
            ideas.append(comment)
            _save_json_store(IDEAS_PATH, ideas)

    return jsonify({"success": True})


@app.get("/api/ideas")
def api_ideas():
    """Fetch all kept comments from the Ideas collection."""
    with _store_lock:
        ideas = _load_json_store(IDEAS_PATH, [])
    return jsonify(ideas)


@app.delete("/api/ideas/<comment_id>")
def api_ideas_delete(comment_id: str):
    """Remove a comment from the Ideas collection."""
    with _store_lock:
        ideas = _load_json_store(IDEAS_PATH, [])
        ideas = [i for i in ideas if i.get("id") != comment_id]
        _save_json_store(IDEAS_PATH, ideas)

    return jsonify({"success": True})


@app.get("/api/quota")
def api_quota():
    """Get API quota usage for today."""
    with _store_lock:
        quota = _load_json_store(QUOTA_PATH, {"date": "", "used": 0})

    today = datetime.now().strftime("%Y-%m-%d")
    if quota.get("date") != today:
        return jsonify({"used": 0, "remaining": 10000, "limit": 10000})

    used = quota.get("used", 0)
    return jsonify({"used": used, "remaining": max(0, 10000 - used), "limit": 10000})


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    os.makedirs(REPORTS_DIR, exist_ok=True)
    print()
    print("=" * 50)
    print("  ytc-analyzer  →  http://localhost:5000")
    print("=" * 50)
    print()
    app.run(host="0.0.0.0", port=5000, threaded=True, debug=False)
