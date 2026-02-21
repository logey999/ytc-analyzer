"""
create_report.py — Generate HTML reports for YouTube comment analysis.

This module handles all report generation logic, including:
- Chart generation and encoding
- HTML structure and layout
- Styling via external CSS
"""

import base64
import io
import os
import re
from collections import Counter
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import pandas as pd
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

# ── Stop words (common English words to exclude from word/phrase counts) ─────
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


# ── Helpers ──────────────────────────────────────────────────────────────────

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


# ── Analysis helpers ──────────────────────────────────────────────────────────

def top_words(df: pd.DataFrame, n: int = 10) -> list[tuple[str, int]]:
    words = []
    for text in df["text"]:
        tokens = re.findall(r"[a-z']+", text.lower())
        words.extend(t for t in tokens if t not in STOP_WORDS and len(t) > 2)
    return Counter(words).most_common(n)


def top_ngrams(df: pd.DataFrame, ng: int = 2, n: int = 10) -> list[tuple[tuple, int]]:
    ngrams = []
    for text in df["text"]:
        tokens = [
            t for t in re.findall(r"[a-z']+", text.lower())
            if t not in STOP_WORDS and len(t) > 2
        ]
        ngrams.extend(zip(*[tokens[i:] for i in range(ng)]))
    return Counter(ngrams).most_common(n)


def sentiment_label(score: float) -> str:
    if score >= 0.05:
        return "Positive"
    if score <= -0.05:
        return "Negative"
    return "Neutral"


# ── Chart generators ─────────────────────────────────────────────────────────

def make_bar_chart(labels: list, values: list, title: str, color: str = "#4a90d9") -> str:
    if not labels:
        return ""
    fig, ax = plt.subplots(figsize=(9, max(3, len(labels) * 0.45)))
    y = range(len(labels))
    ax.barh(list(y), values, color=color)
    ax.set_yticks(list(y))
    ax.set_yticklabels(labels, fontsize=10)
    ax.invert_yaxis()
    ax.set_title(title, fontsize=13, pad=10)
    ax.set_xlabel("Count")
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    return fig_to_b64(fig)


def make_timeline_chart(df: pd.DataFrame) -> str:
    df2 = df.dropna(subset=["datetime"]).copy()
    if df2.empty or len(df2) < 2:
        return ""
    df2["month"] = df2["datetime"].dt.to_period("M").dt.to_timestamp()
    counts = df2.groupby("month").size().reset_index(name="count")
    if len(counts) < 2:
        return ""
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(counts["month"], counts["count"], marker="o", linewidth=2, color="#4a90d9")
    ax.fill_between(counts["month"], counts["count"], alpha=0.15, color="#4a90d9")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    fig.autofmt_xdate()
    ax.set_title("Comments Over Time", fontsize=13, pad=10)
    ax.set_ylabel("Comment Count")
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    return fig_to_b64(fig)


def make_sentiment_chart(counts: Counter) -> str:
    if not counts:
        return ""
    COLORS = {"Positive": "#4caf50", "Neutral": "#9e9e9e", "Negative": "#f44336"}
    labels = list(counts.keys())
    values = list(counts.values())
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.pie(
        values, labels=labels, autopct="%1.1f%%",
        colors=[COLORS.get(l, "#999") for l in labels],
        startangle=90, textprops={"fontsize": 12},
    )
    ax.set_title("Comment Sentiment", fontsize=13, pad=10)
    fig.tight_layout()
    return fig_to_b64(fig)


def make_likes_distribution_chart(df: pd.DataFrame) -> str:
    likes = df["like_count"]
    if likes.empty or likes.max() == 0:
        return ""
    fig, ax = plt.subplots(figsize=(8, 3.5))
    # Use log-scale bins so the long tail is visible
    upper = likes.quantile(0.99)
    subset = likes[likes <= upper]
    ax.hist(subset, bins=40, color="#7b68ee", edgecolor="white", linewidth=0.5)
    ax.set_title("Like Count Distribution (top 99%)", fontsize=13, pad=10)
    ax.set_xlabel("Likes per Comment")
    ax.set_ylabel("Number of Comments")
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    return fig_to_b64(fig)


def make_top_authors_chart(df: pd.DataFrame, n: int = 10) -> str:
    counts = df["author"].value_counts().head(n)
    if counts.empty:
        return ""
    fig, ax = plt.subplots(figsize=(9, max(3, n * 0.42)))
    y = range(len(counts))
    ax.barh(list(y), counts.values, color="#48b0a8")
    ax.set_yticks(list(y))
    ax.set_yticklabels([esc(a) for a in counts.index], fontsize=10)
    ax.invert_yaxis()
    ax.set_title(f"Top {n} Most Active Commenters", fontsize=13, pad=10)
    ax.set_xlabel("Comment Count")
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    return fig_to_b64(fig)


# ── HTML report ───────────────────────────────────────────────────────────────

def img_tag(b64: str, cls: str = "chart-img") -> str:
    if not b64:
        return "<p class='no-data'>Not enough data to generate this chart.</p>"
    return f'<img src="data:image/png;base64,{b64}" class="{cls}" alt="">'


def _load_css() -> str:
    """Load CSS from external file."""
    css_path = os.path.join(os.path.dirname(__file__), "css", "report.css")
    try:
        with open(css_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        # Fallback: return empty string if CSS file not found
        # This allows the code to work even if CSS is missing
        return ""


def generate_report(video_info: dict, df: pd.DataFrame, output_path: str) -> None:
    """Build and write the self-contained HTML report."""

    # ── Sentiment ────────────────────────────────────────────────────────────
    analyzer = SentimentIntensityAnalyzer()
    df = df.copy()
    df["compound"] = df["text"].apply(lambda t: analyzer.polarity_scores(t)["compound"])
    df["sentiment"] = df["compound"].apply(sentiment_label)
    sentiment_counts = Counter(df["sentiment"])

    # ── Word / phrase frequencies ────────────────────────────────────────────
    words   = top_words(df)
    bigrams = top_ngrams(df, ng=2)
    trigrams = top_ngrams(df, ng=3)

    # ── Charts ───────────────────────────────────────────────────────────────
    word_chart      = make_bar_chart([w for w, _ in words],
                                     [c for _, c in words],
                                     "Top 10 Words", "#4a90d9")
    bigram_chart    = make_bar_chart([" ".join(p) for p, _ in bigrams],
                                     [c for _, c in bigrams],
                                     "Top 10 Two-Word Phrases", "#7b68ee")
    trigram_chart   = make_bar_chart([" ".join(p) for p, _ in trigrams],
                                     [c for _, c in trigrams],
                                     "Top 10 Three-Word Phrases", "#e07b54")
    timeline_chart  = make_timeline_chart(df)
    sentiment_chart = make_sentiment_chart(sentiment_counts)
    likes_chart     = make_likes_distribution_chart(df)
    authors_chart   = make_top_authors_chart(df)

    # ── Summary stats ────────────────────────────────────────────────────────
    total        = len(df)
    avg_likes    = df["like_count"].mean()
    median_likes = df["like_count"].median()
    max_likes    = df["like_count"].max()
    pct_positive = sentiment_counts.get("Positive", 0) / total * 100 if total else 0

    # ── Top 100 comments table ───────────────────────────────────────────────
    top100 = df.nlargest(100, "like_count")[["author", "like_count", "text"]].reset_index(drop=True)
    comment_rows = "\n".join(
        f"""<tr>
          <td class="rank">{i + 1}</td>
          <td class="col-author">{esc(row.author)}</td>
          <td class="col-likes">{fmt(row.like_count)}</td>
          <td class="col-text">{esc(row.text)}</td>
        </tr>"""
        for i, row in top100.iterrows()
    )

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
  <h1>&#9654; YouTube Comment Analysis</h1>
  <span class="subtitle">Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}</span>
</header>

<div class="container">

  <!-- ── VIDEO INFO ────────────────────────────────────────────────────── -->
  <div class="card">
    <div class="card-title">Video Info</div>
    <p style="font-size:1.1rem;font-weight:700;margin-bottom:8px">{esc(video_info.get('title', ''))}</p>
    <p style="color:var(--muted);font-size:.9rem;margin-bottom:16px">
      <strong>Channel:</strong> {esc(video_info.get('channel', 'N/A'))}
      &nbsp;&bull;&nbsp;
      <strong>Uploaded:</strong> {esc(upload_date or 'N/A')}
      &nbsp;&bull;&nbsp;
      <strong>Duration:</strong> {seconds_to_hms(video_info.get('duration'))}
      &nbsp;&bull;&nbsp;
      <a href="{esc(video_info.get('webpage_url', ''))}" target="_blank" rel="noopener">Watch on YouTube &#8599;</a>
    </p>
    <div class="metric-grid">
      <div class="metric"><div class="label">Views</div>
        <div class="value">{fmt(video_info.get('view_count'))}</div></div>
      <div class="metric"><div class="label">Video Likes</div>
        <div class="value">{fmt(video_info.get('like_count'))}</div></div>
      <div class="metric"><div class="label">Total Comments</div>
        <div class="value">{fmt(video_info.get('comment_count'))}</div></div>
      <div class="metric"><div class="label">Analysed</div>
        <div class="value">{fmt(total)}</div></div>
    </div>
    <div class="desc">{esc((video_info.get('description') or '')[:1000])}</div>
  </div>

  <!-- ── COMMENT STATISTICS ────────────────────────────────────────────── -->
  <div class="card">
    <div class="card-title">Comment Statistics</div>
    <div class="metric-grid">
      <div class="metric"><div class="label">Avg Likes / Comment</div>
        <div class="value">{avg_likes:.1f}</div></div>
      <div class="metric"><div class="label">Median Likes</div>
        <div class="value">{median_likes:.0f}</div></div>
      <div class="metric"><div class="label">Max Likes</div>
        <div class="value">{fmt(max_likes)}</div></div>
      <div class="metric"><div class="label">% Positive</div>
        <div class="value pos">{pct_positive:.0f}%</div></div>
      <div class="metric"><div class="label">Positive</div>
        <div class="value pos">{fmt(sentiment_counts.get('Positive', 0))}</div></div>
      <div class="metric"><div class="label">Neutral</div>
        <div class="value neu">{fmt(sentiment_counts.get('Neutral', 0))}</div></div>
      <div class="metric"><div class="label">Negative</div>
        <div class="value neg">{fmt(sentiment_counts.get('Negative', 0))}</div></div>
    </div>
  </div>

  <!-- ── SENTIMENT & TIMELINE ──────────────────────────────────────────── -->
  <div class="card">
    <div class="card-title">Sentiment &amp; Activity Over Time</div>
    <div class="two-col">
      <div>{img_tag(sentiment_chart)}</div>
      <div>{img_tag(timeline_chart)}</div>
    </div>
  </div>

  <!-- ── WORD & PHRASE FREQUENCIES ────────────────────────────────────── -->
  <div class="card">
    <div class="card-title">Most Common Words &amp; Phrases</div>
    <div class="two-col" style="margin-bottom:20px">
      <div>{img_tag(word_chart)}</div>
      <div>{img_tag(bigram_chart)}</div>
    </div>
    {img_tag(trigram_chart)}
  </div>

  <!-- ── LIKE DISTRIBUTION ──────────────────────────────────────────────── -->
  <div class="card">
    <div class="card-title">Like Count Distribution</div>
    {img_tag(likes_chart)}
  </div>

  <!-- ── TOP COMMENTERS ────────────────────────────────────────────────── -->
  <div class="card">
    <div class="card-title">Most Active Commenters</div>
    {img_tag(authors_chart)}
  </div>

  <!-- ── TOP 100 LIKED COMMENTS ────────────────────────────────────────── -->
  <div class="card">
    <div class="card-title">Top 100 Most Liked Comments</div>
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Author</th>
            <th>Likes</th>
            <th>Comment</th>
          </tr>
        </thead>
        <tbody>
{comment_rows}
        </tbody>
      </table>
    </div>
  </div>

</div><!-- /container -->

<footer>
  Generated by <strong>analyze_video.py</strong>
  &nbsp;&bull;&nbsp;
  {datetime.now().strftime('%Y-%m-%d')}
</footer>

</body>
</html>"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
