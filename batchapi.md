# Claude Batches API — Comment Topic Scoring

Rate filtered comments 1–10 on video topic potential for a given category (e.g. Cooking),
plus a confidence %, using Claude Haiku 4.5 via the Anthropic Batches API.

---

## Why Batches API

- Results are not needed immediately — scoring runs in the background after the report is ready
- 50% discount vs standard API pricing
- One batch submission covers all comments; a single `batch_id` tracks the whole job
- Results available for 29 days; safe to poll at any interval

---

## Prerequisites

Add your Anthropic API key to `.env`:

```
ANTHROPIC_API_KEY=your_key_here
```

The `anthropic` Python package must be installed:

```bash
pip install anthropic
```

---

## 1. Data Model Changes

### `_info.json` — add a `claude_batch` block

```json
{
  "video_id": "t_cmP3hZQzQ",
  "title": "...",
  "claude_batch": {
    "batch_id": "msgbatch_01abc...",
    "submitted_at": "2026-02-22T14:30:00Z",
    "status": "in_progress",
    "comment_count": 847,
    "chunk_size": 100,
    "comment_ids": ["Ug4xABC...", "Ug4xDEF...", "..."]
  }
}
```

`comment_ids` preserves the exact submission order so results can be mapped back by comment
ID — not by array index — even if parquet rows are deleted between submission and result
collection (e.g. because a user blacklisted or deleted a comment).

**Status states:**

| `status` value | Meaning |
|---|---|
| *(absent / null)* | Scoring never requested |
| `"in_progress"` | Batch submitted; results not yet available |
| `"ended"` | Results written to parquet |
| `"error"` | Submission or result-collection failed |

Once results are written, `status` flips to `"ended"` and polling stops.

### Parquet — add two columns

| Column | Type | Sentinel | Description |
|---|---|---|---|
| `topic_rating` | int (1–10) | `-1` = not yet scored | How strong a video topic idea this comment represents |
| `topic_confidence` | int (0–100) | `-1` = not yet scored | Model's certainty in that rating |

---

## 2. System Prompt

Tailor to the channel category. Example for Cooking:

```
You analyse comments on a Cooking YouTube channel to identify video topic potential.

Rate each comment 1-10:
  8-10  Clear actionable question or topic (technique, recipe, ingredient problem)
  4-7   Vague interest or partial topic signal
  1-3   General praise, off-topic, or no usable topic idea

Confidence: how certain you are given the clarity of the comment.

Return a JSON array in the same order as the input:
[{"rating": N, "confidence": N}, ...]
```

---

## 3. Request Structure

Submit **one batch** containing **ceil(N/100) requests of up to 100 comments each**.
A report with 847 comments produces 9 requests (8 × 100 + 1 × 47).

Each request has a `custom_id` that encodes its chunk position:

```
custom_id "chunk-0"  →  comment_ids[0..99]
custom_id "chunk-1"  →  comment_ids[100..199]
...
```

When results arrive, `chunk-3` array index 42 → `comment_ids[342]`. Look up that ID in the
parquet to write the score.

### SDK imports

```python
import anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request as BatchRequest
```

### Single request shape (inside the batch payload)

```python
BatchRequest(
    custom_id="chunk-0",
    params=MessageCreateParamsNonStreaming(
        model="claude-haiku-4-5",
        max_tokens=1024,
        system="<system prompt above>",
        messages=[{
            "role": "user",
            "content": "Comments:\n1. I always burn garlic before the onions soften. Any tips?\n2. Would love a video on knife sharpening...\n..."
        }]
    )
)
```

Each request returns:
```json
[{"rating": 8, "confidence": 90}, {"rating": 3, "confidence": 75}, ...]
```

---

## 4. Implementation Flow

### Step A — User-triggered (after report is ready)

Scoring is **not** started automatically. After a report loads, the report page shows a
**"Run AI Scoring"** button in the video strip. Clicking it:

```
1. POST /api/ai-score/<channel>/<video>
2. Server loads the filtered parquet → extracts comment texts and IDs in parquet order
3. Chunks into ceil(N/100) lists of up to 100 each; assigns chunk-0 … chunk-N
4. POST /v1/messages/batches  →  receives batch_id
5. Writes batch_id + comment_ids + metadata into _info.json (status: "in_progress")
6. Returns {status: "in_progress"} to the client
7. UI button changes to "Scoring in progress…"
8. topic_rating / topic_confidence columns appear in the comment table, showing "Pending"
9. Frontend polls GET /api/ai-score/<path> every 30 s for status changes
```

### Step B — Background polling (every 15 minutes)

```
1. Scan all _info.json files
2. Filter where claude_batch.status == "in_progress"
3. For each → GET /v1/messages/batches/{batch_id}
4. If processing_status == "ended":
     a. Iterate results via client.messages.batches.results(batch_id)
     b. For each chunk-N result:
          - Parse JSON array from result.result.message.content[0].text
          - For each (i, rating_obj) in enumerate(array):
              global_idx = chunk_idx * CHUNK_SIZE + i
              cid = comment_ids[global_idx]
              write topic_rating + topic_confidence to parquet row matching cid
     c. Update _info.json: status → "ended"
5. If still "in_progress" → leave, check again next interval
6. On any exception → set status → "error", log the message
```

15-minute polling is safe — status checks return a small JSON with no token cost and are
not subject to rate limiting.

---

## 5. New API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/ai-score/<path>` | Submit a batch for the report at `<path>`; idempotent if already submitted |
| `GET` | `/api/ai-score/<path>` | Return current `claude_batch` block from `_info.json` |

`POST /api/ai-score/<path>` response:

```json
{ "status": "in_progress", "submitted_at": "2026-02-22T14:30:00Z", "comment_count": 847 }
```

If `ANTHROPIC_API_KEY` is missing or the `anthropic` package is not installed, returns:

```json
{ "error": "ANTHROPIC_API_KEY not set. Add it to your .env file." }
```

---

## 6. Token & Cost Estimate

**Assumptions:** 1000 comments, 3 sentences each (~50 tokens/comment avg), 10 requests of 100.

### Token breakdown

| Component | Calculation | Tokens |
|---|---|---|
| System prompt | 80 tok × 10 requests | 800 |
| Comment text | 50 tok × 1000 | 50,000 |
| Numbering + formatting | ~100 tok × 10 requests | 1,000 |
| **Total input** | | **~51,800** |
| Output per comment | 12 tok × 1000 | 12,000 |
| JSON array formatting | ~20 tok × 10 requests | 200 |
| **Total output** | | **~12,200** |

### Cost — Claude Haiku 4.5 with Batches API (50% discount)

| | Tokens | Batch rate | Cost |
|---|---|---|---|
| Input | ~51,800 | $0.50 / MTok | $0.026 |
| Output | ~12,200 | $2.50 / MTok | $0.031 |
| **Total** | | | **~$0.057** |

**~6 cents per 1000-comment report.**

Standard Haiku 4.5 rates for reference: $1.00 / MTok input · $5.00 / MTok output (~$0.11 without the batch discount).
