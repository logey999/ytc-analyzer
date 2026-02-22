"""
API Blueprint: Report-related endpoints

Routes:
  GET /api/reports - List all generated reports
  GET /api/report-data/<path> - Get report data (video info, comments, phrases)
"""

from flask import Blueprint, jsonify, send_file, send_from_directory
import os
import json

# This would be passed by the main app
bp = Blueprint('api_reports', __name__, url_prefix='/api')


def register_routes(app, projects_root, filter_low_value, find_repeated_phrases, keep_store, blacklist_store):
    """
    Register report routes with the app.

    Args:
        app: Flask app instance
        projects_root: Root directory path
        filter_low_value: Function to filter low-value comments
        find_repeated_phrases: Function to find repeated phrases
        keep_store: CommentStore for ideas
        blacklist_store: CommentStore for blacklist
    """

    @app.get("/api/reports")
    def api_reports():
        """Fetch list of all generated reports."""
        reports_dir = os.path.join(projects_root, "Reports")
        reports = []

        if not os.path.isdir(reports_dir):
            return jsonify([])

        for channel_dir in sorted(os.listdir(reports_dir), reverse=True):
            channel_path = os.path.join(reports_dir, channel_dir)
            if not os.path.isdir(channel_path):
                continue

            for video_dir in sorted(os.listdir(channel_path), reverse=True):
                video_path = os.path.join(channel_path, video_dir)
                if not os.path.isdir(video_path):
                    continue

                # Load video info (sidecar)
                info_path = os.path.join(
                    video_path, video_dir + "_info.json"
                )
                if not os.path.isfile(info_path):
                    continue

                try:
                    with open(info_path, "r", encoding="utf-8") as f:
                        info = json.load(f)
                    reports.append({
                        "path": os.path.join(
                            "Reports", channel_dir, video_dir, video_dir + "_info.json"
                        ),
                        "channel": info.get("channel", "Unknown"),
                        "title": info.get("title", video_dir),
                        "thumbnail": info.get("thumbnail", ""),
                        "date": info.get("date", ""),
                        "view_count": info.get("view_count", 0),
                        "comment_count": info.get("comment_count", 0),
                    })
                except (json.JSONDecodeError, KeyError, IOError):
                    continue

        return jsonify(reports)

    # Note: /api/report-data endpoint would be registered similarly
    # This is a simplified example of how to organize endpoints as blueprints
