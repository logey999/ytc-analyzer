"""
create_report.py — Generate HTML reports for YouTube comment analysis.

This module handles all report generation logic, including:
- Chart generation and encoding
- HTML structure and layout
- Styling via external CSS
"""

import base64
import io
import json
import os
import re
from collections import Counter
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

# ── Stop words (common English words to exclude from phrase counts) ────────────
STOP_WORDS = set("""
a about above after again against all also am an and any are arent as at
be because been before being below between both but by cant cannot could
couldnt did didnt do does doesnt doing dont down during each even few for
from further get got had hadnt has hasnt have havent having he hed hell
hes her here heres hers herself him himself his how hows i id ill im ive
if in into is isnt it its itself just lets me more most mustnt my myself
no nor not of off on once only or other ought our ours ourselves out over
own really same shant she shed shell shes should shouldnt so some still
such than that thats the their theirs them themselves then there theres
these they theyd theyll theyre theyve this those through to too under
until up very was wasnt we wed well were weve were werent what whats when
whens where wheres which while who whos whom why whys will with wont would
wouldnt you youd youll youre youve your yours yourself yourselves s t u r
""".split())

_BG       = "#18181c"
_BG_2     = "#1a1a1e"
_TEXT     = "#e8e8ed"
_TEXT_DIM = "#606070"
_GRID     = "#2a2a32"
_BLUE     = "#5ba4f5"
_TEAL     = "#2dd4bf"


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


def fig_to_b64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=120)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()


# ── Analysis ──────────────────────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z']+", text.lower())
            if t not in STOP_WORDS and len(t) > 2]


def find_repeated_phrases(df: pd.DataFrame, min_n: int = 3, max_n: int = 8, top_n: int = 15) -> list[tuple[str, int]]:
    """
    Find all phrases of min_n+ words that appear more than once.
    Returns top_n results, preferring longer phrases, deduplicated so
    sub-phrases aren't shown if a longer phrase containing them qualifies.
    """
    all_ngrams: Counter = Counter()

    for text in df["text"]:
        tokens = _tokenize(text)
        n_tokens = len(tokens)
        for n in range(min_n, min(max_n + 1, n_tokens + 1)):
            for i in range(n_tokens - n + 1):
                all_ngrams[" ".join(tokens[i:i + n])] += 1

    # Keep only phrases appearing more than once
    repeated = {p: c for p, c in all_ngrams.items() if c > 1}

    # Sort: longer phrases first, then by count, so longer ones win dedup
    candidates = sorted(repeated.items(), key=lambda x: (-len(x[0].split()), -x[1]))

    result = []
    suppressed: set[str] = set()

    for phrase, count in candidates:
        if phrase in suppressed:
            continue
        result.append((phrase, count))
        # Suppress sub-phrases that this phrase already covers
        words = phrase.split()
        for n in range(min_n, len(words)):
            for i in range(len(words) - n + 1):
                sub = " ".join(words[i:i + n])
                if repeated.get(sub, 0) <= count:
                    suppressed.add(sub)

    result.sort(key=lambda x: -x[1])
    return result[:top_n]


# ── Chart generators ─────────────────────────────────────────────────────────

def _apply_dark_style(fig, ax_list):
    fig.patch.set_facecolor(_BG)
    for ax in ax_list:
        ax.set_facecolor(_BG_2)
        ax.tick_params(colors=_TEXT_DIM, labelsize=9)
        ax.xaxis.label.set_color(_TEXT_DIM)
        ax.yaxis.label.set_color(_TEXT_DIM)
        ax.title.set_color(_TEXT)
        ax.title.set_fontsize(12)
        for spine in ax.spines.values():
            spine.set_visible(False)
        ax.grid(axis="x", color=_GRID, linewidth=0.6, alpha=0.8)
        ax.set_axisbelow(True)


def make_bar_chart(labels: list, values: list, title: str, color: str = _BLUE) -> str:
    if not labels:
        return ""
    fig, ax = plt.subplots(figsize=(10, max(3, len(labels) * 0.52)))
    y = range(len(labels))
    ax.barh(list(y), values, color=color, height=0.6, zorder=3, alpha=0.88)
    ax.set_yticks(list(y))
    ax.set_yticklabels(labels, fontsize=9.5, color=_TEXT)
    ax.invert_yaxis()
    ax.set_title(title, pad=12)
    ax.set_xlabel("Occurrences")
    _apply_dark_style(fig, [ax])
    fig.tight_layout(pad=1.5)
    return fig_to_b64(fig)


# ── HTML report ───────────────────────────────────────────────────────────────

def img_tag(b64: str, cls: str = "chart-img") -> str:
    if not b64:
        return "<p class='no-data'>Not enough data to generate this chart.</p>"
    return f'<img src="data:image/png;base64,{b64}" class="{cls}" alt="">'


def _load_css() -> str:
    css_path = os.path.join(os.path.dirname(__file__), "..", "css", "report.css")
    try:
        with open(css_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


def _build_top100_rows(df: pd.DataFrame, channel: str) -> str:
    top100 = df.nlargest(100, "like_count")[["author", "like_count", "text"]].reset_index(drop=True)
    rows = []
    for rank, row in enumerate(top100.itertuples(index=False), start=1):
        is_creator = str(row.author).strip() == channel.strip() and channel.strip()
        author_cls = "col-author creator" if is_creator else "col-author"
        rows.append(
            f'<tr>'
            f'<td class="rank">{rank}</td>'
            f'<td class="{author_cls}">{esc(row.author)}</td>'
            f'<td class="col-likes">{fmt(row.like_count)}</td>'
            f'<td class="col-text">{esc(row.text)}</td>'
            f'</tr>'
        )
    return "\n".join(rows)


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

    # ── Repeated phrases ─────────────────────────────────────────────────────
    phrases = find_repeated_phrases(df)
    phrase_chart = make_bar_chart(
        [p for p, _ in phrases],
        [c for _, c in phrases],
        "Repeated Phrases (3+ words, 2+ occurrences)",
        color=_TEAL,
    )

    # ── Summary stats ────────────────────────────────────────────────────────
    total = len(df)

    # ── Comment data ─────────────────────────────────────────────────────────
    top100_rows = _build_top100_rows(df, channel)
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

  <!-- ── SECTIONS ──────────────────────────────────────────────────────── -->
  <div class="card">

    <!-- Tab selector -->
    <div class="section-tabs">
      <button class="tab active" onclick="showTab('top100')">Top 100 Liked</button>
      <button class="tab" onclick="showTab('all')">All Comments</button>
      <button class="tab" onclick="showTab('phrases')">Repeated Phrases</button>
    </div>

    <!-- Pane: Top 100 -->
    <div id="pane-top100" class="tab-pane">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Author</th><th>Likes</th><th>Comment</th>
            </tr>
          </thead>
          <tbody>
{top100_rows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Pane: All Comments (JS-rendered, paginated) -->
    <div id="pane-all" class="tab-pane" style="display:none">
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
    </div>

    <!-- Pane: Repeated Phrases -->
    <div id="pane-phrases" class="tab-pane" style="display:none">
      {img_tag(phrase_chart)}
    </div>

  </div><!-- /card -->

</div><!-- /container -->

<footer>
  Generated by <strong>ytc-analyzer</strong>
  &nbsp;&bull;&nbsp;
  {datetime.now().strftime('%Y-%m-%d')}
</footer>

<script>
// ── Tab switching ──────────────────────────────────────────────────────────
function showTab(id) {{
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.getElementById('pane-' + id).style.display = '';
  event.currentTarget.classList.add('active');
  if (id === 'all' && !allRendered) renderPage(0);
}}

// ── All comments pagination ────────────────────────────────────────────────
const CREATOR = {json.dumps(channel)};
const PAGE_SIZE = 200;
const ALL = {all_comments_json};
let currentPage = 0;
let allRendered = false;

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

  allRendered = true;
  // Scroll to top of pane when changing pages
  document.getElementById('pane-all').scrollIntoView({{behavior: 'smooth', block: 'start'}});
}}

function changePage(delta) {{
  renderPage(currentPage + delta);
}}
</script>

</body>
</html>"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
