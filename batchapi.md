# Claude Batches API — Comment Scoring Plan

## Workflow

1. Generate report, filter junk comments
2. Submit batch to Claude Batches API → get a `batch_id` back immediately
3. Store `batch_id` alongside the report
4. Poll later (or on next report view) → write ratings into the parquet/report

## Request Structure

**Option B — 10 requests, 100 comments each (recommended)**

- System prompt only repeated 10×
- Must parse a JSON array of 100 items per result
- If one request fails, retry 100 comments

Each request asks Claude Haiku 4.5 to return:
```json
[{"rating": 7, "confidence": 80}, ...]
```
- `rating`: 1–10 how likely the comment is a good video topic for category X
- `confidence`: 0–100% certainty of that rating

## Token Estimate (1000 comments, 10 requests of 100)

| Component | Tokens |
|---|---|
| System prompt (65 tok × 10 requests) | 650 |
| Comment text (45 tok avg × 1000) | 45,000 |
| Formatting overhead | ~650 |
| **Total input** | **~46,300** |
| Output (12 tok × 1000) | 12,000 |
| JSON array formatting | ~400 |
| **Total output** | **~12,400** |

## Cost — Claude Haiku 4.5 with Batches API (50% discount)

| | Tokens | Rate | Cost |
|---|---|---|---|
| Input | ~46,300 | $0.50/MTok | $0.023 |
| Output | ~12,400 | $2.50/MTok | $0.031 |
| **Total** | | | **~$0.054** |

~5 cents per 1000-comment report.

Standard (non-batch) Haiku 4.5 rates for reference: $1.00/MTok input, $5.00/MTok output (~$0.11 per run).
