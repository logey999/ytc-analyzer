# Claude Batches API — Comment Topic Scoring

Rate 1000 filtered comments 1–10 on video topic potential for a given category (e.g. Cooking),
plus a confidence %, using Claude Haiku 4.5 via the Anthropic Batches API.

---

## Why Batches API

- Results are not needed immediately — scoring can happen in the background after the report is generated
- 50% discount vs standard API pricing
- One batch submission covers all 1000 comments; a single `batch_id` tracks the whole job
- Results available for 29 days; safe to poll at any interval

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
    "comment_count": 1000,
    "chunk_size": 100
  }
}
```

Once results are written, `status` flips to `"ended"` and polling stops.

### Parquet — add two columns

| Column | Type | Description |
|---|---|---|
| `topic_rating` | int (1–10) | How strong a video topic idea this comment represents |
| `topic_confidence` | int (0–100) | Model's certainty in that rating |

No batch ID is stored per comment. Ordering handles the mapping (see Section 3).

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

Submit **one batch** containing **10 requests of 100 comments each**.
You get back a single `batch_id` immediately.

Each request has a `custom_id` that encodes its chunk position:

```
custom_id "chunk-0"  →  comments[0..99]
custom_id "chunk-1"  →  comments[100..199]
...
custom_id "chunk-9"  →  comments[900..999]
```

When results arrive, `chunk-3` array index 42 = parquet row 342. No per-comment metadata needed.

### Single request shape (inside the batch payload)

```json
{
  "custom_id": "chunk-0",
  "params": {
    "model": "claude-haiku-4-5-20251001",
    "max_tokens": 1024,
    "system": "<system prompt above>",
    "messages": [
      {
        "role": "user",
        "content": "Comments:\n1. I always burn garlic before the onions soften. Any tips?\n2. Would love a video on knife sharpening...\n..."
      }
    ]
  }
}
```

Each request returns:
```json
[{"rating": 8, "confidence": 90}, {"rating": 3, "confidence": 75}, ...]
```

---

## 4. Implementation Flow

### Step A — After report generation (immediate)

```
1. Generate HTML report
2. Filter junk comments → ~1000 quality comments
3. Chunk into 10 lists of 100, assign chunk-0 … chunk-9
4. POST /v1/messages/batches  →  receive batch_id
5. Write batch_id + metadata into _info.json (status: "in_progress")
6. Return to user — report is ready, scoring is pending
```

### Step B — Background polling (every 15 minutes)

```
1. Scan all _info.json files
2. Filter where claude_batch.status == "in_progress"
3. For each → GET /v1/messages/batches/{batch_id}
4. If status == "ended":
     a. Fetch full results
     b. For each chunk-N result, map array index → parquet row
     c. Write topic_rating + topic_confidence columns to parquet
     d. Update _info.json: status → "ended"
5. If status still "in_progress" → leave, check again next interval
```

15-minute polling is safe — status checks return a small JSON with no token cost and are not subject to rate limiting.

---

## 5. Token & Cost Estimate

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

| | Tokens | Rate | Cost |
|---|---|---|---|
| Input | ~51,800 | $0.50 / MTok | $0.026 |
| Output | ~12,200 | $2.50 / MTok | $0.031 |
| **Total** | | | **~$0.057** |

**~6 cents per 1000-comment report.**

Standard Haiku 4.5 rates for reference: $1.00 / MTok input · $5.00 / MTok output (~$0.11 without the batch discount).
