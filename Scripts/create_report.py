"""
create_report.py — Generate HTML reports for YouTube comment analysis.

This module handles all report generation logic, including:
- HTML structure and layout
- Styling via external CSS
"""

import json
import os
import re
from collections import Counter
from datetime import datetime

import pandas as pd


def esc(text) -> str:
    """HTML-escape a value."""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def fmt(n) -> str:
    try:
        return f"{int(n):,}"
    except Exception:
        return str(n) if n else "N/A"


def seconds_to_hms(seconds) -> str:
    try:
        seconds = int(seconds)
        h, rem = divmod(seconds, 3600)
        m, s = divmod(rem, 60)
        return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
    except Exception:
        return "N/A"


def _load_css() -> str:
    css_path = os.path.join(os.path.dirname(__file__), "..", "css", "report.css")
    try:
        with open(css_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


def _serialize_all_comments(df: pd.DataFrame) -> str:
    """Serialize all comments to a compact JSON array for JS rendering."""
    cols = df[["author", "like_count", "text"]].copy()
    cols["like_count"] = cols["like_count"].fillna(0).astype(int)
    cols["author"] = cols["author"].fillna("").astype(str)
    cols["text"] = cols["text"].fillna("").astype(str)
    records = cols.to_dict(orient="records")
    return json.dumps(records, ensure_ascii=False, separators=(",", ":"))


def generate_report(video_info: dict, df: pd.DataFrame, output_path: str) -> None:
    """Build and write the self-contained HTML report."""

    channel = str(video_info.get("channel") or "")

    # ── Summary stats ────────────────────────────────────────────────────────
    total = len(df)

    # ── Comment data ─────────────────────────────────────────────────────────
    all_comments_json = _serialize_all_comments(df)

    # ── webpage_url validation (XSS guard) ───────────────────────────────────
    webpage_url = video_info.get('webpage_url', '') or ''
    if not webpage_url.startswith('https://'):
        webpage_url = ''

    # ── Upload date formatting ────────────────────────────────────────────────
    upload_date = str(video_info.get("upload_date", "") or "")
    if len(upload_date) == 8 and upload_date.isdigit():
        upload_date = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"

    # ── Load CSS ──────────────────────────────────────────────────────────────
    css = _load_css()

    # ── HTML ──────────────────────────────────────────────────────────────────
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Comment Analysis — {esc(video_info.get('title', ''))}</title>
<style>
{css}
</style>
</head>
<body>

<header>
  <div class="header-icon">&#9654;</div>
  <div class="header-text">
    <h1>YouTube Comment Analysis</h1>
    <span class="subtitle">Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}</span>
  </div>
</header>

<div class="container">

  <!-- ── VIDEO INFO ────────────────────────────────────────────────────── -->
  <div class="card">
    <div class="card-title">Video Info</div>
    <p class="video-title">{esc(video_info.get('title', ''))}</p>
    <div class="video-meta">
      <span><strong>Channel:</strong> {esc(channel or 'N/A')}</span>
      <span class="meta-sep">&bull;</span>
      <span><strong>Uploaded:</strong> {esc(upload_date or 'N/A')}</span>
      <span class="meta-sep">&bull;</span>
      <span><strong>Duration:</strong> {seconds_to_hms(video_info.get('duration'))}</span>
      <span class="meta-sep">&bull;</span>
      <span><strong>Views:</strong> {fmt(video_info.get('view_count'))}</span>
      <span class="meta-sep">&bull;</span>
      <span><strong>Likes:</strong> {fmt(video_info.get('like_count'))}</span>
      <span class="meta-sep">&bull;</span>
      <span><strong>Comments analysed:</strong> {fmt(total)}</span>
      {f'<a href="{esc(webpage_url)}" class="yt-link" target="_blank" rel="noopener">Watch on YouTube &#8599;</a>' if webpage_url else ''}
    </div>
    <div class="desc">{esc((video_info.get('description') or '')[:1000])}</div>
  </div>

  <!-- ── ALL COMMENTS ───────────────────────────────────────────────────── -->
  <div class="card">
    <div class="pagination-bar">
      <button class="pg-btn" id="pg-prev" onclick="changePage(-1)">&#8592; Prev</button>
      <span class="pg-info" id="pg-info"></span>
      <button class="pg-btn" id="pg-next" onclick="changePage(1)">Next &#8594;</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Author</th><th>Likes</th><th>Comment</th>
          </tr>
        </thead>
        <tbody id="all-tbody"></tbody>
      </table>
    </div>
    <div class="pagination-bar">
      <button class="pg-btn" id="pg-prev2" onclick="changePage(-1)">&#8592; Prev</button>
      <span class="pg-info" id="pg-info2"></span>
      <button class="pg-btn" id="pg-next2" onclick="changePage(1)">Next &#8594;</button>
    </div>
  </div><!-- /card -->

</div><!-- /container -->

<footer>
  Generated by <strong>ytc-analyzer</strong>
  &nbsp;&bull;&nbsp;
  {datetime.now().strftime('%Y-%m-%d')}
</footer>

<script>
// ── All comments pagination ────────────────────────────────────────────────
const CREATOR = {json.dumps(channel)};
const PAGE_SIZE = 200;
const ALL = {all_comments_json};
let currentPage = 0;

function esc(s) {{
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}}

function fmt(n) {{
  return Number(n).toLocaleString();
}}

function renderPage(page) {{
  const total = ALL.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  currentPage = Math.max(0, Math.min(page, totalPages - 1));

  const start = currentPage * PAGE_SIZE;
  const slice = ALL.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('all-tbody');
  const rows = slice.map((c, i) => {{
    const rank = start + i + 1;
    const isCreator = CREATOR && c.author.trim() === CREATOR.trim();
    const authorCls = isCreator ? 'col-author creator' : 'col-author';
    return `<tr>`
      + `<td class="rank">${{rank}}</td>`
      + `<td class="${{authorCls}}">${{esc(c.author)}}</td>`
      + `<td class="col-likes">${{fmt(c.like_count)}}</td>`
      + `<td class="col-text">${{esc(c.text)}}</td>`
      + `</tr>`;
  }});
  tbody.innerHTML = rows.join('');

  const info = `Page ${{currentPage + 1}} of ${{totalPages}} &nbsp;·&nbsp; ${{total.toLocaleString()}} comments`;
  document.getElementById('pg-info').innerHTML = info;
  document.getElementById('pg-info2').innerHTML = info;
  document.getElementById('pg-prev').disabled = currentPage === 0;
  document.getElementById('pg-prev2').disabled = currentPage === 0;
  document.getElementById('pg-next').disabled = currentPage >= totalPages - 1;
  document.getElementById('pg-next2').disabled = currentPage >= totalPages - 1;

  // Scroll to top of card when changing pages
  document.getElementById('all-tbody').closest('.card').scrollIntoView({{behavior: 'smooth', block: 'start'}});
}}

function changePage(delta) {{
  renderPage(currentPage + delta);
}}

renderPage(0);
</script>

</body>
</html>"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
