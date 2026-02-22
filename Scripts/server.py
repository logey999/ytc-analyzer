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
from comment_store import CommentStore
from get_comments import get_comments

# ── App setup ─────────────────────────────────────────────────────────────────

app = Flask(__name__)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(PROJECT_ROOT, "Reports")

# JSON stores for persistence
DISCARDED_PATH = os.path.join(PROJECT_ROOT, "Reports", "discarded.parquet")
KEEP_PATH      = os.path.join(PROJECT_ROOT, "Reports", "keep.parquet")
DELETED_PATH   = os.path.join(PROJECT_ROOT, "Reports", "deleted.parquet")
_store_lock = threading.RLock()

# Initialize CommentStore instances
keep_store = CommentStore(KEEP_PATH, _store_lock)
blacklist_store = CommentStore(DISCARDED_PATH, _store_lock)
deleted_store = CommentStore(DELETED_PATH, _store_lock)

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


# ── Analysis worker ───────────────────────────────────────────────────────────

def _send(q: queue.Queue, data: dict) -> None:
    q.put(json.dumps(data, ensure_ascii=False))


def _run_analysis(url: str, job_id: str, filters: dict | None = None) -> None:
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

        _send(q, {"msg": f"Saved {len(df_raw):,} comments to disk."})

        f = filters or {}
        df_filtered = filter_low_value(
            df_raw,
            min_chars=f.get("min_chars", True),
            min_alpha=f.get("min_alpha", True),
            min_words=f.get("min_words", True),
        )
        filtered_out = len(df_raw) - len(df_filtered)

        video_info["filtered_out"] = filtered_out
        video_info["created_at"] = datetime.now().isoformat()
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(video_info, f, ensure_ascii=False)

        report_path = f"{channel_slug}/{slug}"

        with _jobs_lock:
            _jobs[job_id]["status"] = "done"
            _jobs[job_id]["report_path"] = report_path
            _jobs[job_id]["title"] = video_info.get("title", "")

        _send(q, {
            "done": True,
            "report_path": report_path,
            "title": video_info.get("title", ""),
            "filtered_out": filtered_out,
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


@app.get("/keep")
def route_keep():
    return send_file(os.path.join(PROJECT_ROOT, "keep.html"))


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

def _parse_filters(data: dict) -> dict:
    f = data.get("filters") or {}
    return {
        "min_chars": bool(f.get("minChars", True)),
        "min_alpha": bool(f.get("minAlpha", True)),
        "min_words": bool(f.get("minWords", True)),
    }


@app.post("/api/analyze")
def api_analyze():
    data = request.get_json(force=True, silent=True) or {}
    url = (data.get("url") or "").strip()
    force = bool(data.get("force", False))
    filters = _parse_filters(data)

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

    t = threading.Thread(target=_run_analysis, args=(url, job_id, filters), daemon=True)
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
    # Build per-report classification counts in one pass over each store
    kept_by      = {}
    blacklist_by = {}
    deleted_by   = {}
    for c in keep_store.all():
        p = c.get("_reportPath", ""); kept_by[p] = kept_by.get(p, 0) + 1
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
                "filtered_out": info.get("filtered_out", 0),
                "kept_count": kept_by.get(rel_folder, 0),
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
    def _qbool(key: str, default: bool = True) -> bool:
        v = request.args.get(key)
        if v is None:
            return default
        return v.lower() not in ("0", "false", "no")
    filters = {
        "min_chars": _qbool("minChars"),
        "min_alpha": _qbool("minAlpha"),
        "min_words": _qbool("minWords"),
    }
    df = filter_low_value(df_raw, **filters)

    # Filter any legacy classified comments still in parquet
    classified_ids = set()
    for store in (keep_store, blacklist_store, deleted_store):
        for c in store.all():
            classified_ids.add(c.get("id"))
    total_discarded = sum(
        1 for c in blacklist_store.all() if c.get("_reportPath") == report_path
    )
    if classified_ids and "id" in df.columns:
        df = df[~df["id"].isin(classified_ids)]

    df = df.sort_values("like_count", ascending=False).reset_index(drop=True)

    # Count kept/deleted comments from stores
    kept = keep_store.all()
    total_kept = sum(1 for i in kept if i.get("_reportPath") == report_path)
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
        "discarded_count": total_discarded,
        "kept_count": total_kept,
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
    for store in (keep_store, blacklist_store, deleted_store):
        store.remove(cid)
    if report_path:
        _remove_from_parquet(cid, report_path)
    dest_store.add(comment)


# ── API: comment actions (discard, keep, delete) ──────────────────────────────

@app.post("/api/comment/discard")
def api_comment_discard():
    """Discard a comment (move to blacklist). Accepts full comment object."""
    data = request.get_json(force=True, silent=True) or {}
    comment = data.get("comment")

    if not isinstance(comment, dict) or not comment.get("id"):
        return jsonify({"error": "comment object with id required"}), 400

    _move_exclusive(comment, blacklist_store)
    return jsonify({"success": True})


@app.get("/api/blacklist")
def api_blacklist():
    """Fetch all discarded comments (blacklist)."""
    return jsonify(blacklist_store.all())


@app.delete("/api/blacklist/<comment_id>")
def api_blacklist_delete(comment_id: str):
    """Remove a comment from the blacklist."""
    blacklist_store.remove(comment_id)
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


@app.post("/api/comment/keep")
def api_comment_keep():
    """Keep (save) a comment to the Keep collection."""
    data = request.get_json(force=True, silent=True) or {}
    comment = data.get("comment")

    if not isinstance(comment, dict) or not comment.get("id"):
        return jsonify({"error": "comment object with id required"}), 400

    _move_exclusive(comment, keep_store)
    return jsonify({"success": True})


@app.get("/api/keep")
def api_keep():
    """Fetch all kept comments from the Keep collection."""
    return jsonify(keep_store.all())


@app.delete("/api/keep/<comment_id>")
def api_keep_delete(comment_id: str):
    """Remove a comment from the Keep collection."""
    keep_store.remove(comment_id)
    return jsonify({"success": True})


@app.get("/api/counts")
def api_counts():
    """Return comment counts for each store and aggregate total (for nav badges)."""
    import pyarrow.parquet as pq
    aggregate_total = 0
    for parquet_path in glob.glob(os.path.join(REPORTS_DIR, "**", "*.parquet"), recursive=True):
        # Skip the root-level store parquets (keep/blacklist/deleted)
        if os.path.dirname(parquet_path) == REPORTS_DIR:
            continue
        try:
            aggregate_total += pq.read_metadata(parquet_path).num_rows
        except Exception:
            pass
    return jsonify({
        "keep": len(keep_store.all()),
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
