#!/usr/bin/env python3
"""
server.py — Flask web server for ytc-analyzer dashboard.

Usage:
    python Scripts/server.py

Opens at http://localhost:5000
"""

import glob
import json
import logging
import os
import queue
import shutil
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

import pandas as pd
import pyarrow.parquet as pq
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
from comment_store import CommentStore
from get_comments import get_comments
import batch_scorer

# ── App setup ─────────────────────────────────────────────────────────────────

app = Flask(__name__)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(PROJECT_ROOT, "Reports")
_ENV_PATH = os.path.join(PROJECT_ROOT, ".env")
_ENV_ALLOWED_KEYS = frozenset({"YOUTUBE_API_KEY", "ANTHROPIC_API_KEY"})

# JSON stores for persistence
BLACKLIST_PATH = os.path.join(PROJECT_ROOT, "Reports", "blacklist.parquet")
SAVED_PATH     = os.path.join(PROJECT_ROOT, "Reports", "saved.parquet")
DELETED_PATH   = os.path.join(PROJECT_ROOT, "Reports", "deleted.parquet")
_store_lock = threading.RLock()

# Initialize CommentStore instances
saved_store = CommentStore(SAVED_PATH, _store_lock)
blacklist_store = CommentStore(BLACKLIST_PATH, _store_lock)
deleted_store = CommentStore(DELETED_PATH, _store_lock)

# Job registry: job_id → {queue, status, report_path, title, filter_settings, finished_at}
_jobs: dict = {}
_jobs_lock = threading.Lock()
_JOB_TTL = 3600  # keep finished jobs for 1 hour
_MAX_CONCURRENT_JOBS = 4
_job_semaphore = threading.Semaphore(_MAX_CONCURRENT_JOBS)


def _cleanup_stale_jobs() -> None:
    """Remove finished jobs older than _JOB_TTL seconds."""
    now = time.time()
    with _jobs_lock:
        stale = [
            jid for jid, j in _jobs.items()
            if j.get("finished_at") and now - j["finished_at"] > _JOB_TTL
        ]
        for jid in stale:
            del _jobs[jid]

# Valid boolean keys that can be forwarded from the frontend to filter_low_value()
_FILTER_BOOL_KEYS = frozenset({
    "min_chars", "min_alpha", "min_words",
    "emoji_only", "url_only", "timestamp_only",
    "repeat_char", "blacklist_match", "english_only",
    "sentiment_filter", "dedup",
})

# Numeric filter keys: name → (type, min, max, default)
_FILTER_NUM_KEYS: dict = {
    "min_chars_threshold": (int,   1,    50,   20),
    "min_words_threshold": (int,   1,    10,   3),
    "sentiment_threshold": (float, -1.0, 0.0, -0.8),
    "english_confidence":  (float, 0.0,  1.0,  0.5),
    "dedup_threshold":     (int,   50,   100,  85),
}


# ── Analysis worker ───────────────────────────────────────────────────────────

def _send(q: queue.Queue, data: dict) -> None:
    q.put(json.dumps(data, ensure_ascii=False))


def _run_analysis(url: str, job_id: str) -> None:
    _job_semaphore.acquire()
    try:
        _run_analysis_inner(url, job_id)
    finally:
        _job_semaphore.release()


def _run_analysis_inner(url: str, job_id: str) -> None:
    with _jobs_lock:
        q = _jobs[job_id]["queue"]
        raw_settings = _jobs[job_id].get("filter_settings") or {}

    # Build safe kwargs — only known bool keys, coerce to bool
    filter_kwargs = {k: bool(v) for k, v in raw_settings.items() if k in _FILTER_BOOL_KEYS}

    # Add validated numeric settings (clamp to allowed range)
    for key, (typ, lo, hi, _default) in _FILTER_NUM_KEYS.items():
        if key in raw_settings:
            try:
                val = typ(raw_settings[key])
                filter_kwargs[key] = max(lo, min(hi, val))
            except (TypeError, ValueError):
                pass

    try:
        video_id = extract_video_id(url)

        def on_progress(msg: str, pct=None) -> None:
            data: dict = {"msg": msg, "phase": "fetch"}
            if pct is not None:
                data["pct"] = pct
            _send(q, data)

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

        # Guard against slug collisions (e.g. channel with many similarly-titled videos).
        # If the target folder already exists and belongs to a different video, append
        # the first 8 chars of the video ID to make it unique.
        candidate_info = os.path.join(folder, f"{slug}_info.json")
        if os.path.exists(candidate_info):
            try:
                with open(candidate_info, "r", encoding="utf-8") as _f:
                    _existing = json.load(_f)
                if _existing.get("id") != video_id:
                    slug = f"{slug}_{video_id[:8]}"
                    folder = os.path.join(REPORTS_DIR, channel_slug, slug)
            except Exception:
                pass

        os.makedirs(folder, exist_ok=True)

        date_str = datetime.now().strftime("%Y-%m-%d")
        info_path = os.path.join(folder, f"{slug}_info.json")
        parquet_path = os.path.join(folder, f"{slug}_comments_{date_str}.parquet")

        # Build blacklist text set for fast O(1) matching (may be 10k+ items)
        blacklist_texts: set = set()
        if filter_kwargs.get("blacklist_match", True):
            blacklist_texts = {
                c.get("text", "").lower().strip()
                for c in blacklist_store.all()
                if c.get("text")
            }

        # Filter low-value comments; get reasons dict {comment_id -> rule label}
        df_filtered, reasons = filter_low_value(df_raw, blacklist_texts=blacklist_texts, **filter_kwargs)

        # Save only the filtered (pending) comments to the parquet
        df_filtered.to_parquet(parquet_path, index=False)
        _send(q, {"msg": f"Saved {len(df_filtered):,} comments to disk.", "phase": "classify", "pct": 10})

        # Auto-blacklist low-value comments using per-job filter settings
        df_low = df_raw[~df_raw["id"].isin(df_filtered["id"])]
        report_path = f"{channel_slug}/{slug}"
        if not df_low.empty:
            df_low = df_low.copy()
            df_low["author"] = df_low.get("author", pd.Series(dtype=str)).fillna("").astype(str)
            df_low["text"]   = df_low.get("text",   pd.Series(dtype=str)).fillna("").astype(str)
            _send(q, {"msg": f"Classifying {len(df_low):,} low-value comments…", "phase": "classify", "pct": 20})
            batch = [
                {
                    "id": str(row.get("id")),
                    "author": str(row.get("author", "")),
                    "text": str(row.get("text", "")),
                    "like_count": int(row.get("like_count", 0)),
                    "_reportPath": report_path,
                    "reason": reasons.get(str(row.get("id")), "Low Value"),
                }
                for _, row in df_low.iterrows()
                if row.get("id")
            ]
            blacklist_store.add_many(batch)
            _send(q, {"msg": f"Auto-blacklisted {len(df_low):,} low-value comments.", "phase": "classify", "pct": 90})

        video_info["created_at"] = datetime.now(timezone.utc).isoformat()
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(video_info, f, ensure_ascii=False)

        with _jobs_lock:
            _jobs[job_id]["status"] = "done"
            _jobs[job_id]["report_path"] = report_path
            _jobs[job_id]["title"] = video_info.get("title", "")
            _jobs[job_id]["finished_at"] = time.time()

        _send(q, {
            "done": True,
            "report_path": report_path,
            "title": video_info.get("title", ""),
            "total": len(df_raw),
            "phase": "classify",
            "pct": 100,
        })

    except Exception as exc:
        with _jobs_lock:
            _jobs[job_id]["status"] = "error"
            _jobs[job_id]["finished_at"] = time.time()
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


@app.get("/aggregate")
def route_aggregate():
    return send_file(os.path.join(PROJECT_ROOT, "aggregate.html"))


@app.get("/saved")
def route_saved():
    return send_file(os.path.join(PROJECT_ROOT, "saved.html"))


@app.get("/blacklist")
def route_blacklist():
    return send_file(os.path.join(PROJECT_ROOT, "blacklist.html"))


@app.get("/deleted")
def route_deleted():
    return send_file(os.path.join(PROJECT_ROOT, "deleted.html"))


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
    filter_settings = data.get("filter_settings") or {}

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
                    count = pq.read_metadata(parquet).num_rows
                except Exception:
                    count = 0
                date_str = (
                    os.path.basename(parquet)
                    .split("_comments_")[-1]
                    .replace(".parquet", "")
                )
                return jsonify({
                    "existing": {
                        "path": os.path.relpath(existing_folder, REPORTS_DIR).replace("\\", "/"),
                        "title": video_info.get("title", ""),
                        "comment_count": count,
                        "date": date_str,
                    }
                })

    # Clean up old finished jobs before adding new ones
    _cleanup_stale_jobs()

    # Start a fresh fetch job
    job_id = str(uuid.uuid4())
    q: queue.Queue = queue.Queue()
    with _jobs_lock:
        _jobs[job_id] = {
            "queue": q,
            "status": "running",
            "report_path": None,
            "title": "",
            "filter_settings": filter_settings,
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
    # Read all stores once up-front and bucket counts by report path.
    # This avoids scanning parquet files N times (once per report).
    saved_by     = {}
    blacklist_by = {}
    deleted_by   = {}
    for c in saved_store.all():
        p = c.get("_reportPath", ""); saved_by[p] = saved_by.get(p, 0) + 1
    for c in blacklist_store.all():
        p = c.get("_reportPath", ""); blacklist_by[p] = blacklist_by.get(p, 0) + 1
    for c in deleted_store.all():
        p = c.get("_reportPath", ""); deleted_by[p] = deleted_by.get(p, 0) + 1

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
                    count = pq.read_metadata(latest).num_rows
                except Exception:
                    count = 0
            else:
                date_str = ""
                count = 0

            # created_at: prefer stored ISO timestamp, fall back to parquet mtime
            created_at = info.get("created_at", "")
            if not created_at and parquets:
                mtime = os.path.getmtime(max(parquets))
                created_at = datetime.fromtimestamp(mtime).isoformat()

            rel_folder = os.path.relpath(folder, REPORTS_DIR).replace("\\", "/")
            cb = info.get("claude_batch")
            results.append({
                "path": rel_folder,
                "title": info.get("title", ""),
                "channel": info.get("channel", ""),
                "thumbnail": info.get("thumbnail", ""),
                "date": date_str,
                "created_at": created_at,
                "comment_count": count,
                "view_count": info.get("view_count", 0),
                "saved_count": saved_by.get(rel_folder, 0),
                "blacklist_count": blacklist_by.get(rel_folder, 0),
                "deleted_count": deleted_by.get(rel_folder, 0),
                "ai_score_status": cb.get("status") if cb else None,
            })
        except Exception:
            continue

    results.sort(key=lambda x: x.get("created_at", x.get("date", "")), reverse=True)
    return jsonify(results)


# ── API: report data (video_info + comments) ─────────────────────────────────

def _safe_report_folder(report_path: str):
    """Resolve report_path under REPORTS_DIR; return None if it escapes."""
    folder = os.path.realpath(os.path.join(REPORTS_DIR, report_path))
    if not folder.startswith(os.path.realpath(REPORTS_DIR) + os.sep):
        return None
    return folder


@app.get("/api/report-data/<path:report_path>")
def api_report_data(report_path: str):
    folder = _safe_report_folder(report_path)
    if folder is None:
        return jsonify({"error": "invalid path"}), 400

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
    df = df_raw.copy()

    # Read each store once and compute all needed values
    classified_ids = set()
    total_saved = 0
    total_blacklisted = 0
    total_deleted = 0
    for c in saved_store.all():
        classified_ids.add(c.get("id"))
        if c.get("_reportPath") == report_path:
            total_saved += 1
    for c in blacklist_store.all():
        classified_ids.add(c.get("id"))
        if c.get("_reportPath") == report_path:
            total_blacklisted += 1
    for c in deleted_store.all():
        classified_ids.add(c.get("id"))
        if c.get("_reportPath") == report_path:
            total_deleted += 1

    if classified_ids and "id" in df.columns:
        df = df[~df["id"].isin(classified_ids)]

    df = df.sort_values("like_count", ascending=False).reset_index(drop=True)

    cols = ["id", "author", "like_count", "text"]
    if "author_channel_id" in df.columns:
        cols.append("author_channel_id")
    for score_col in ("topic_rating", "topic_confidence"):
        if score_col in df.columns:
            cols.append(score_col)
    comments_df = df[cols].copy()
    comments_df["like_count"] = comments_df["like_count"].astype(int)
    comments_df["author"] = comments_df["author"].fillna("").astype(str)
    comments_df["text"] = comments_df["text"].fillna("").astype(str)
    if "author_channel_id" in comments_df.columns:
        comments_df["author_channel_id"] = comments_df["author_channel_id"].fillna("").astype(str)
    for score_col in ("topic_rating", "topic_confidence"):
        if score_col in comments_df.columns:
            comments_df[score_col] = (
                pd.to_numeric(comments_df[score_col], errors="coerce").fillna(-1).astype(int)
            )

    return jsonify({
        "video_info": video_info,
        "comments": comments_df.to_dict(orient="records"),
        "blacklist_count": total_blacklisted,
        "saved_count": total_saved,
        "deleted_count": total_deleted,
    })


# ── Comment ownership helpers ─────────────────────────────────────────────────

def _remove_from_parquet(comment_id: str, report_path: str) -> None:
    """Remove a comment row from the parquet file for the given report."""
    parts = report_path.split("/")
    if len(parts) != 2:
        return
    channel_slug, video_slug = parts
    folder = os.path.join(PROJECT_ROOT, "Reports", channel_slug, video_slug)
    matches = glob.glob(os.path.join(folder, f"{video_slug}_comments_*.parquet"))
    if not matches:
        return
    parquet_path = max(matches)
    df = pd.read_parquet(parquet_path)
    if "id" in df.columns and comment_id in df["id"].values:
        df = df[df["id"] != comment_id]
        df.to_parquet(parquet_path, index=False)


def _move_exclusive(comment: dict, dest_store: CommentStore) -> None:
    """Enforce single ownership: remove from all stores + parquet, then add to dest."""
    cid = comment.get("id")
    report_path = comment.get("_reportPath", "")
    with _store_lock:
        for store in (saved_store, blacklist_store, deleted_store):
            store.remove(cid)
        if report_path:
            _remove_from_parquet(cid, report_path)
        dest_store.add(comment)


# ── API: comment actions (blacklist, save, delete) ────────────────────────────

@app.post("/api/comment/blacklist")
def api_comment_blacklist():
    """Add a comment to the blacklist. Accepts full comment object."""
    data = request.get_json(force=True, silent=True) or {}
    comment = data.get("comment")

    if not isinstance(comment, dict) or not comment.get("id"):
        return jsonify({"error": "comment object with id required"}), 400

    comment.setdefault("reason", "User")
    _move_exclusive(comment, blacklist_store)
    return jsonify({"success": True})


@app.get("/api/blacklist")
def api_blacklist():
    """Fetch all blacklisted comments."""
    return jsonify(blacklist_store.all())


@app.delete("/api/blacklist/<comment_id>")
def api_blacklist_delete(comment_id: str):
    """Remove a comment from the blacklist."""
    blacklist_store.remove(comment_id)
    return jsonify({"success": True})


@app.delete("/api/blacklist")
def api_blacklist_clear():
    """Move all blacklisted comments to the Deleted bin."""
    with _store_lock:
        comments = blacklist_store.all()
        for c in comments:
            deleted_store.add(c)
        blacklist_store.clear()
    return jsonify({"success": True, "count": len(comments)})


@app.post("/api/comment/delete")
def api_comment_delete():
    """Send a comment to the Deleted bin."""
    data = request.get_json(force=True, silent=True) or {}
    comment = data.get("comment")

    if not isinstance(comment, dict) or not comment.get("id"):
        return jsonify({"error": "comment object with id required"}), 400

    _move_exclusive(comment, deleted_store)
    return jsonify({"success": True})


@app.get("/api/deleted")
def api_deleted():
    """Fetch all comments in the Deleted bin."""
    return jsonify(deleted_store.all())


@app.delete("/api/deleted/<comment_id>")
def api_deleted_delete(comment_id: str):
    """Permanently remove a comment from the Deleted bin."""
    deleted_store.remove(comment_id)
    return jsonify({"success": True})


@app.delete("/api/deleted")
def api_deleted_clear():
    """Remove all comments from the Deleted bin."""
    deleted_store.clear()
    return jsonify({"success": True})


@app.post("/api/comment/save")
def api_comment_save():
    """Save a comment to the Saved collection."""
    data = request.get_json(force=True, silent=True) or {}
    comment = data.get("comment")

    if not isinstance(comment, dict) or not comment.get("id"):
        return jsonify({"error": "comment object with id required"}), 400

    _move_exclusive(comment, saved_store)
    return jsonify({"success": True})


@app.get("/api/saved")
def api_saved():
    """Fetch all saved comments from the Saved collection."""
    return jsonify(saved_store.all())


@app.delete("/api/saved/<comment_id>")
def api_saved_delete(comment_id: str):
    """Remove a comment from the Saved collection."""
    saved_store.remove(comment_id)
    return jsonify({"success": True})


@app.post("/api/saved/delete-all")
def api_saved_delete_all():
    """Move all saved comments to the Deleted bin."""
    with _store_lock:
        comments = saved_store.all()
        for c in comments:
            deleted_store.add(c)
        saved_store.clear()
    return jsonify({"success": True, "count": len(comments)})


@app.delete("/api/report/<path:report_path>")
def api_report_delete(report_path: str):
    """Delete a report and bulk-classify its unclassified comments.

    Body JSON:
        { "disposition": "blacklist" | "deleted" }

    Already-classified comments (saved/blacklist/deleted) are left untouched.
    All remaining parquet comments are moved to the chosen store, then the
    report folder is removed from disk.
    """
    data = request.get_json(force=True, silent=True) or {}
    disposition = data.get("disposition", "deleted")
    if disposition not in ("blacklist", "deleted"):
        return jsonify({"error": "disposition must be 'blacklist' or 'deleted'"}), 400

    folder = _safe_report_folder(report_path)
    if folder is None:
        return jsonify({"error": "invalid path"}), 400
    if not os.path.isdir(folder):
        return jsonify({"error": "report not found"}), 404

    dest_store = deleted_store if disposition == "deleted" else blacklist_store

    with _store_lock:
        # Collect IDs already in any store (skip them)
        classified_ids = set()
        for store in (saved_store, blacklist_store, deleted_store):
            for c in store.all():
                classified_ids.add(c.get("id"))

        # Load parquet comments and move unclassified ones to dest_store
        parquets = glob.glob(os.path.join(folder, "*_comments_*.parquet"))
        if parquets:
            latest = max(parquets)
            try:
                df = pd.read_parquet(latest)
                if "id" in df.columns:
                    df["like_count"] = (
                        pd.to_numeric(df["like_count"], errors="coerce")
                        .fillna(0)
                        .astype(int)
                    )
                    df["author"] = df.get("author", pd.Series(dtype=str)).fillna("").astype(str)
                    df["text"]   = df.get("text",   pd.Series(dtype=str)).fillna("").astype(str)
                    for _, row in df.iterrows():
                        cid = row.get("id")
                        if cid and cid not in classified_ids:
                            entry = {
                                "id": str(cid),
                                "author": str(row.get("author", "")),
                                "text": str(row.get("text", "")),
                                "like_count": int(row.get("like_count", 0)),
                                "_reportPath": report_path,
                            }
                            if disposition == "blacklist":
                                entry["reason"] = "Report Deleted"
                            dest_store.add(entry)
            except Exception:
                pass  # Best-effort; still delete the folder below

        # Remove report folder from disk
        shutil.rmtree(folder, ignore_errors=True)

        # Clean up empty channel folder
        channel_folder = os.path.dirname(folder)
        try:
            if channel_folder != REPORTS_DIR and not os.listdir(channel_folder):
                os.rmdir(channel_folder)
        except Exception:
            pass

    return jsonify({"success": True})


@app.get("/api/ai-score/<path:report_path>")
def api_ai_score_status(report_path: str):
    """Return the current claude_batch block from _info.json for a report."""
    folder = _safe_report_folder(report_path)
    if folder is None:
        return jsonify({"error": "invalid path"}), 400
    info_files = glob.glob(os.path.join(folder, "*_info.json"))
    if not info_files:
        return jsonify({"error": "report not found"}), 404
    with open(info_files[0], "r", encoding="utf-8") as f:
        info = json.load(f)
    return jsonify({"claude_batch": info.get("claude_batch")})


@app.post("/api/ai-score/<path:report_path>")
def api_ai_score_submit(report_path: str):
    """Submit a Batches API scoring job for the given report.

    Idempotent: if a batch is already in_progress or ended, returns the
    current claude_batch block without re-submitting.
    """
    folder = _safe_report_folder(report_path)
    if folder is None:
        return jsonify({"error": "invalid path"}), 400
    info_files = glob.glob(os.path.join(folder, "*_info.json"))
    if not info_files:
        return jsonify({"error": "report not found"}), 404

    info_path = info_files[0]

    # Read info and check status under lock to prevent race with poll daemon
    with _info_json_lock:
        with open(info_path, "r", encoding="utf-8") as f:
            info = json.load(f)

        existing = info.get("claude_batch")
        # Block re-submission only if a batch is already running
        if existing and existing.get("status") == "in_progress":
            return jsonify({"claude_batch": existing})

    slug = _video_slug(info.get("title", "unknown"))
    parquet = _find_latest_parquet(folder, slug)
    if not parquet:
        return jsonify({"error": "no parquet data found"}), 404

    try:
        df = pd.read_parquet(parquet)
        df["like_count"] = pd.to_numeric(df["like_count"], errors="coerce").fillna(0).astype(int)
    except Exception as exc:
        return jsonify({"error": f"could not load parquet: {exc}"}), 500

    # If previously marked ended but unscored rows remain, allow re-submission for those rows
    if existing and existing.get("status") == "ended":
        if "topic_rating" in df.columns:
            ratings = pd.to_numeric(df["topic_rating"], errors="coerce").fillna(-1)
            df = df[ratings < 1].copy()
        if df.empty:
            return jsonify({"claude_batch": existing})  # Truly all done

    keywords = (request.get_json(silent=True) or {}).get("keywords") or None
    try:
        batch_id, comment_ids = batch_scorer.submit_batch(df, keywords=keywords)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"batch submission failed: {exc}"}), 500

    submitted_at = datetime.now(timezone.utc).isoformat()
    claude_batch = {
        "batch_id": batch_id,
        "submitted_at": submitted_at,
        "status": "in_progress",
        "comment_count": len(df),
        "chunk_size": batch_scorer.CHUNK_SIZE,
        "comment_ids": comment_ids,
        "retry_count": 0,
        "keywords": keywords,
    }

    # Write back under lock to prevent clobbering concurrent poll writes
    with _info_json_lock:
        with open(info_path, "r", encoding="utf-8") as f:
            info = json.load(f)
        info["claude_batch"] = claude_batch
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=False)

    return jsonify({"claude_batch": claude_batch})


# ── API: aggregate AI scoring ──────────────────────────────────────────────────

@app.get("/api/ai-score-aggregate")
def api_ai_score_aggregate_status():
    """Return a breakdown of scored/eligible/pending comments across all reports."""
    eligible_count = 0
    eligible_reports = 0
    pending_count = 0
    pending_reports = 0
    scored_count = 0

    pattern = os.path.join(REPORTS_DIR, "**", "*_info.json")
    for info_path in glob.glob(pattern, recursive=True):
        try:
            with open(info_path, "r", encoding="utf-8") as f:
                info = json.load(f)

            cb = info.get("claude_batch")
            if cb and cb.get("status") == "in_progress":
                pending_count += cb.get("comment_count", 0)
                pending_reports += 1
                continue

            folder = os.path.dirname(info_path)
            slug = _video_slug(info.get("title", "unknown"))
            parquet = _find_latest_parquet(folder, slug)
            if not parquet:
                continue

            df = pd.read_parquet(parquet)
            if "topic_rating" not in df.columns:
                unscored = len(df)
                scored = 0
            else:
                ratings = pd.to_numeric(df["topic_rating"], errors="coerce").fillna(-1)
                unscored = int((ratings < 1).sum())
                scored = int((ratings >= 1).sum())

            if unscored > 0:
                eligible_count += unscored
                eligible_reports += 1
            scored_count += scored
        except Exception:
            continue

    return jsonify({
        "eligible_count": eligible_count,
        "eligible_reports": eligible_reports,
        "pending_count": pending_count,
        "pending_reports": pending_reports,
        "scored_count": scored_count,
    })


@app.post("/api/ai-score-aggregate")
def api_ai_score_aggregate_submit():
    """Submit batch scoring for all unscored comments across all reports.

    Skips reports where a batch is already in_progress.
    For each eligible report, submits only unscored rows (topic_rating == -1).
    Returns { batches_submitted, comments_submitted }.
    """
    batches_submitted = 0
    comments_submitted = 0
    keywords = (request.get_json(silent=True) or {}).get("keywords") or None

    pattern = os.path.join(REPORTS_DIR, "**", "*_info.json")
    for info_path in glob.glob(pattern, recursive=True):
        try:
            with open(info_path, "r", encoding="utf-8") as f:
                info = json.load(f)

            cb = info.get("claude_batch")
            if cb and cb.get("status") == "in_progress":
                continue  # already pending — skip

            folder = os.path.dirname(info_path)
            slug = _video_slug(info.get("title", "unknown"))
            parquet = _find_latest_parquet(folder, slug)
            if not parquet:
                continue

            df = pd.read_parquet(parquet)
            df["like_count"] = pd.to_numeric(df["like_count"], errors="coerce").fillna(0).astype(int)

            if "topic_rating" in df.columns:
                ratings = pd.to_numeric(df["topic_rating"], errors="coerce").fillna(-1)
                df_unscored = df[ratings < 1].copy()
            else:
                df_unscored = df.copy()

            if df_unscored.empty:
                continue

            try:
                batch_id, comment_ids = batch_scorer.submit_batch(df_unscored, keywords=keywords)
            except RuntimeError as exc:
                # API key missing — affects all reports, abort early
                return jsonify({"error": str(exc)}), 400
            except Exception as exc:
                logging.warning("Aggregate scoring: skipping %s: %s", info_path, exc)
                continue  # skip this report, continue with others

            submitted_at = datetime.now(timezone.utc).isoformat()
            info["claude_batch"] = {
                "batch_id": batch_id,
                "submitted_at": submitted_at,
                "status": "in_progress",
                "comment_count": len(df_unscored),
                "chunk_size": batch_scorer.CHUNK_SIZE,
                "comment_ids": comment_ids,
                "retry_count": 0,
                "keywords": keywords,
            }
            with open(info_path, "w", encoding="utf-8") as f:
                json.dump(info, f, ensure_ascii=False)

            batches_submitted += 1
            comments_submitted += len(df_unscored)

        except Exception:
            continue

    return jsonify({"batches_submitted": batches_submitted, "comments_submitted": comments_submitted})


# ── API: manual poll trigger ──────────────────────────────────────────────────

@app.post("/api/ai-score-poll")
def api_ai_score_poll():
    """Trigger an immediate poll of all in-progress batches. Runs synchronously."""
    try:
        _poll_all_batches()
        return jsonify({"ok": True})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ── Background batch poller ────────────────────────────────────────────────────

_POLL_INTERVAL = 15 * 60  # 15 minutes
_poll_lock = threading.Lock()
_info_json_lock = threading.Lock()  # guards read-modify-write of _info.json files


def _poll_all_batches() -> None:
    """Check all in-progress batch jobs and collect results for ended ones."""
    if not _poll_lock.acquire(blocking=False):
        return  # another poll is already running
    try:
        _poll_all_batches_inner()
    finally:
        _poll_lock.release()


def _poll_all_batches_inner() -> None:
    pattern = os.path.join(REPORTS_DIR, "**", "*_info.json")
    for info_path in glob.glob(pattern, recursive=True):
        try:
            with _info_json_lock:
                with open(info_path, "r", encoding="utf-8") as f:
                    info = json.load(f)

            cb = info.get("claude_batch")
            if not cb or cb.get("status") != "in_progress":
                continue

            batch_id = cb.get("batch_id")
            comment_ids = cb.get("comment_ids", [])
            if not batch_id:
                continue

            status_info = batch_scorer.check_batch_status(batch_id)
            if status_info.get("processing_status") != "ended":
                continue

            # Results ready — find the parquet and apply scores
            folder = os.path.dirname(info_path)
            slug = _video_slug(info.get("title", "unknown"))
            parquet = _find_latest_parquet(folder, slug)
            if parquet:
                batch_scorer.fetch_and_apply_results(batch_id, comment_ids, parquet)

            # Check if any comments remain unscored after applying results
            unscored_df = None
            if parquet:
                try:
                    df = pd.read_parquet(parquet)
                    if "topic_rating" in df.columns:
                        ratings = pd.to_numeric(df["topic_rating"], errors="coerce").fillna(-1)
                        unscored_df = df[ratings < 1].copy()
                    else:
                        unscored_df = df.copy()
                    if unscored_df.empty:
                        unscored_df = None
                except Exception:
                    unscored_df = None

            retry_count = cb.get("retry_count", 0)
            stored_keywords = cb.get("keywords")
            if unscored_df is not None and retry_count == 0:
                # Auto-retry once for unscored comments
                try:
                    new_batch_id, new_comment_ids = batch_scorer.submit_batch(unscored_df, keywords=stored_keywords)
                    new_claude_batch = {
                        "batch_id": new_batch_id,
                        "submitted_at": datetime.now(timezone.utc).isoformat(),
                        "status": "in_progress",
                        "comment_count": len(unscored_df),
                        "chunk_size": batch_scorer.CHUNK_SIZE,
                        "comment_ids": new_comment_ids,
                        "retry_count": 1,
                        "keywords": stored_keywords,
                    }
                    logging.warning(
                        "Batch %s had %d unscored comments; auto-retrying as %s",
                        batch_id, len(unscored_df), new_batch_id,
                    )
                except Exception as retry_exc:
                    logging.warning("Auto-retry batch submission failed: %s", retry_exc)
                    new_claude_batch = dict(cb, status="partial_failure", unscored_count=len(unscored_df))
            elif unscored_df is not None and retry_count >= 1:
                # Retry also left unscored comments — mark partial failure
                new_claude_batch = dict(cb, status="partial_failure", unscored_count=len(unscored_df))
                logging.warning(
                    "Batch %s retry still left %d unscored; marking partial_failure",
                    batch_id, len(unscored_df),
                )
            else:
                new_claude_batch = dict(cb, status="ended")

            with _info_json_lock:
                with open(info_path, "r", encoding="utf-8") as f:
                    info = json.load(f)
                info["claude_batch"] = new_claude_batch
                with open(info_path, "w", encoding="utf-8") as f:
                    json.dump(info, f, ensure_ascii=False)

        except Exception as exc:
            logging.warning("Batch poll error for %s: %s", info_path, exc)
            try:
                with _info_json_lock:
                    with open(info_path, "r", encoding="utf-8") as f:
                        info = json.load(f)
                    if info.get("claude_batch", {}).get("status") == "in_progress":
                        info["claude_batch"]["status"] = "error"
                        info["claude_batch"]["error"] = str(exc)
                        with open(info_path, "w", encoding="utf-8") as f:
                            json.dump(info, f, ensure_ascii=False)
            except Exception:
                pass


def _batch_poll_worker() -> None:
    """Daemon thread: poll in-progress batches every 15 minutes."""
    # Poll immediately on startup so completed batches are picked up after a restart
    _poll_all_batches()
    while True:
        time.sleep(_POLL_INTERVAL)
        _poll_all_batches()


def _start_poller() -> None:
    """Start the background batch poller thread (call once from main)."""
    t = threading.Thread(target=_batch_poll_worker, daemon=True, name="batch-poller")
    t.start()


@app.get("/api/env-keys")
def api_env_keys_get():
    """Return masked API key info (last 4 chars only — never the full key)."""
    result = {}
    for key in _ENV_ALLOWED_KEYS:
        val = os.environ.get(key, "")
        if len(val) >= 4:
            result[key] = f"···{val[-4:]}"
        elif val:
            result[key] = "···"
        else:
            result[key] = None
    return jsonify(result)


@app.post("/api/env-keys")
def api_env_keys_post():
    """Write provided API keys to .env and reload them into the running process."""
    data = request.get_json(force=True, silent=True) or {}

    updates: dict[str, str] = {}
    for key in _ENV_ALLOWED_KEYS:
        val = data.get(key)
        if val is None:
            continue
        val = str(val).strip()
        if not val:
            continue
        # Prevent newline injection into .env
        if "\n" in val or "\r" in val:
            return jsonify({"error": f"Invalid value for {key}"}), 400
        updates[key] = val

    if not updates:
        return jsonify({"ok": True, "updated": []})

    # Read existing .env (may not exist yet)
    env_lines: list[str] = []
    if os.path.exists(_ENV_PATH):
        with open(_ENV_PATH, "r", encoding="utf-8") as f:
            env_lines = f.readlines()

    # Update in-place or append
    written: set[str] = set()
    new_lines: list[str] = []
    for line in env_lines:
        matched = False
        for key, val in updates.items():
            if line.strip().startswith(f"{key}="):
                new_lines.append(f"{key}={val}\n")
                written.add(key)
                matched = True
                break
        if not matched:
            new_lines.append(line)
    for key, val in updates.items():
        if key not in written:
            new_lines.append(f"{key}={val}\n")

    with open(_ENV_PATH, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

    # Reload into current process so server picks up the new values immediately
    for key, val in updates.items():
        os.environ[key] = val

    return jsonify({"ok": True, "updated": list(updates.keys())})


@app.get("/api/counts")
def api_counts():
    """Return comment counts for each store and aggregate total (for nav badges)."""
    classified_ids = set()
    for store in (saved_store, blacklist_store, deleted_store):
        for c in store.all():
            cid = c.get("id")
            if cid:
                classified_ids.add(cid)

    aggregate_total = 0
    for info_path in glob.glob(os.path.join(REPORTS_DIR, "**", "*_info.json"), recursive=True):
        try:
            with open(info_path, "r", encoding="utf-8") as f:
                info = json.load(f)
            folder = os.path.dirname(info_path)
            slug = _video_slug(info.get("title", "unknown"))
            parquet = _find_latest_parquet(folder, slug)
            if not parquet:
                continue
            if classified_ids:
                df_ids = pd.read_parquet(parquet, columns=["id"])
                aggregate_total += int((~df_ids["id"].isin(classified_ids)).sum())
            else:
                aggregate_total += pq.read_metadata(parquet).num_rows
        except Exception:
            pass

    return jsonify({
        "saved": len(saved_store.all()),
        "blacklist": len(blacklist_store.all()),
        "deleted": len(deleted_store.all()),
        "aggregate": aggregate_total,
    })


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    os.makedirs(REPORTS_DIR, exist_ok=True)
    _start_poller()
    print()
    print("=" * 50)
    print("  ytc-analyzer  ->  http://localhost:5000")
    print("=" * 50)
    print()
    app.run(host="127.0.0.1", port=5000, threaded=True, debug=False)
