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
import shutil
import sys
import threading
import uuid
from datetime import datetime

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
from create_report import find_repeated_phrases
from comment_store import CommentStore
from get_comments import get_comments

# ── App setup ─────────────────────────────────────────────────────────────────

app = Flask(__name__)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(PROJECT_ROOT, "Reports")

# JSON stores for persistence
BLACKLIST_PATH = os.path.join(PROJECT_ROOT, "Reports", "blacklist.parquet")
SAVED_PATH     = os.path.join(PROJECT_ROOT, "Reports", "saved.parquet")
DELETED_PATH   = os.path.join(PROJECT_ROOT, "Reports", "deleted.parquet")
_store_lock = threading.RLock()

# Initialize CommentStore instances
saved_store = CommentStore(SAVED_PATH, _store_lock)
blacklist_store = CommentStore(BLACKLIST_PATH, _store_lock)
deleted_store = CommentStore(DELETED_PATH, _store_lock)

# Job registry: job_id → {queue, status, report_path, title, filter_settings}
_jobs: dict = {}
_jobs_lock = threading.Lock()

# Valid boolean keys that can be forwarded from the frontend to filter_low_value()
_FILTER_BOOL_KEYS = frozenset({
    "min_chars", "min_alpha", "min_words",
    "emoji_only", "url_only", "timestamp_only",
    "repeat_char", "blacklist_match", "english_only",
    "sentiment_filter", "dedup",
})

# Numeric filter keys: name → (type, min, max, default)
_FILTER_NUM_KEYS: dict = {
    "sentiment_threshold": (float, -1.0, 0.0, -0.5),
    "dedup_threshold":     (int,   50,   100,  85),
}


# ── Analysis worker ───────────────────────────────────────────────────────────

def _send(q: queue.Queue, data: dict) -> None:
    q.put(json.dumps(data, ensure_ascii=False))


def _run_analysis(url: str, job_id: str) -> None:
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

        _send(q, {"msg": f"Saved {len(df_raw):,} comments to disk."})

        # Build blacklist text set for fast O(1) matching (may be 10k+ items)
        blacklist_texts: set = set()
        if filter_kwargs.get("blacklist_match", True):
            blacklist_texts = {
                c.get("text", "").lower().strip()
                for c in blacklist_store.all()
                if c.get("text")
            }

        # Auto-blacklist low-value comments using per-job filter settings
        df_filtered = filter_low_value(df_raw, blacklist_texts=blacklist_texts, **filter_kwargs)
        df_low = df_raw[~df_raw["id"].isin(df_filtered["id"])]
        report_path = f"{channel_slug}/{slug}"
        if not df_low.empty:
            df_low["author"] = df_low.get("author", pd.Series(dtype=str)).fillna("").astype(str)
            df_low["text"]   = df_low.get("text",   pd.Series(dtype=str)).fillna("").astype(str)
            for _, row in df_low.iterrows():
                cid = row.get("id")
                if cid:
                    blacklist_store.add({
                        "id": str(cid),
                        "author": str(row.get("author", "")),
                        "text": str(row.get("text", "")),
                        "like_count": int(row.get("like_count", 0)),
                        "_reportPath": report_path,
                    })
            _send(q, {"msg": f"Auto-blacklisted {len(df_low):,} low-value comments."})

        video_info["created_at"] = datetime.now().isoformat()
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(video_info, f, ensure_ascii=False)

        with _jobs_lock:
            _jobs[job_id]["status"] = "done"
            _jobs[job_id]["report_path"] = report_path
            _jobs[job_id]["title"] = video_info.get("title", "")

        _send(q, {
            "done": True,
            "report_path": report_path,
            "title": video_info.get("title", ""),
            "total": len(df_raw),
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
                    count = len(pd.read_parquet(latest, columns=["id"]))
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
            })
        except Exception:
            continue

    results.sort(key=lambda x: x.get("created_at", x.get("date", "")), reverse=True)
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
    df = df_raw.copy()

    # Filter any legacy classified comments still in parquet
    classified_ids = set()
    for store in (saved_store, blacklist_store, deleted_store):
        for c in store.all():
            classified_ids.add(c.get("id"))
    total_blacklisted = sum(
        1 for c in blacklist_store.all() if c.get("_reportPath") == report_path
    )
    if classified_ids and "id" in df.columns:
        df = df[~df["id"].isin(classified_ids)]

    df = df.sort_values("like_count", ascending=False).reset_index(drop=True)

    # Count saved/deleted comments from stores
    total_saved = sum(1 for i in saved_store.all() if i.get("_reportPath") == report_path)
    total_deleted = sum(1 for c in deleted_store.all() if c.get("_reportPath") == report_path)

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
    parquet_path = matches[0]
    df = pd.read_parquet(parquet_path)
    if "id" in df.columns and comment_id in df["id"].values:
        df = df[df["id"] != comment_id]
        df.to_parquet(parquet_path, index=False)


def _move_exclusive(comment: dict, dest_store: CommentStore) -> None:
    """Enforce single ownership: remove from all stores + parquet, then add to dest."""
    cid = comment.get("id")
    report_path = comment.get("_reportPath", "")
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
    """Remove all comments from the blacklist."""
    blacklist_store.clear()
    return jsonify({"success": True})


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

    folder = os.path.join(REPORTS_DIR, report_path)
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
                            dest_store.add({
                                "id": str(cid),
                                "author": str(row.get("author", "")),
                                "text": str(row.get("text", "")),
                                "like_count": int(row.get("like_count", 0)),
                                "_reportPath": report_path,
                            })
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


@app.get("/api/counts")
def api_counts():
    """Return comment counts for each store and aggregate total (for nav badges)."""
    aggregate_total = 0
    for parquet_path in glob.glob(os.path.join(REPORTS_DIR, "**", "*.parquet"), recursive=True):
        # Skip the root-level store parquets (saved/blacklist/deleted)
        if os.path.dirname(parquet_path) == REPORTS_DIR:
            continue
        try:
            aggregate_total += pq.read_metadata(parquet_path).num_rows
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
    print()
    print("=" * 50)
    print("  ytc-analyzer  ->  http://localhost:5000")
    print("=" * 50)
    print()
    app.run(host="0.0.0.0", port=5000, threaded=True, debug=False)
