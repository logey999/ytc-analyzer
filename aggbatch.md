# Aggregate-Screen Batch AI Scoring — Plan

## Current architecture summary

- **Per-report flow**: POST `/api/ai-score/<path>` → calls `batch_scorer.submit_batch(df)` with the full parquet DataFrame → writes a `claude_batch` block to that report's `_info.json` → background poller (`_poll_all_batches`) finds `"in_progress"` batches every 15 min and calls `fetch_and_apply_results()` which writes scores back to the parquet
- **Sentinel values**: unscored comments have `topic_rating = -1`, `topic_confidence = -1` in parquet
- **Idempotency**: current endpoint skips re-submission if status is already `"in_progress"` or `"ended"`
- **Aggregate page**: merges all comments from all reports client-side; score columns already pass through the `/api/report-data/<path>` endpoint and render `"Pend."` for `-1`

---

## Design decisions

**What to skip:**
- Reports with `claude_batch.status == "in_progress"` → skip the entire report (results pending, can't know which comments are already covered)
- Individual comments where `topic_rating != -1` → already scored, even if the report is `"ended"` or never batched

**Submission strategy — per-report batches (not one mega-batch):**
Submitting a separate batch per eligible report reuses every existing piece of infrastructure: the polling daemon, `fetch_and_apply_results()`, per-report `_info.json` tracking, and the per-report score columns in parquet. No new data structures. The existing daemon automatically picks up all newly submitted in-progress batches on its next cycle.

The key difference from the per-report endpoint: we submit only the **unscored subset** of comments (`topic_rating == -1`) for reports that are `"ended"` or have no batch yet, rather than the entire parquet. `submit_batch(df)` already accepts any DataFrame so this is just pre-filtering.

---

## Changes required

### 1. Backend — new endpoint `GET /api/ai-score-aggregate`

Scans all reports and returns a breakdown for the confirmation modal:
```json
{
  "eligible_count": 847,
  "eligible_reports": 5,
  "pending_count": 312,
  "pending_reports": 2,
  "scored_count": 1204
}
```
Logic:
- Load every `*_info.json`
- Reports with `status == "in_progress"` → add their `comment_count` to `pending_count`
- All others: load parquet, count rows where `topic_rating == -1` (or column missing) → `eligible_count`; count rows where `topic_rating >= 1` → `scored_count`

### 2. Backend — new endpoint `POST /api/ai-score-aggregate`

For each report NOT in `"in_progress"`:
- Load parquet, filter to unscored rows only
- If 0 unscored rows → skip
- Call `batch_scorer.submit_batch(filtered_df)`
- Write `claude_batch` block to `_info.json` (same structure as per-report, overwrites any previous `"ended"` block since we're scoring a new subset)
- Return `{ batches_submitted: N, comments_submitted: M }`

No changes to the polling daemon — it already scans all `_info.json` files for `"in_progress"` batches.

### 3. Frontend — `aggregate.html`

Add a toolbar above the table (or in the `<header>`) containing an "AI Score All" button — similar position to the per-report button in `report.html`.

### 4. Frontend — `aggregate.js`

- On "AI Score All" click: `GET /api/ai-score-aggregate` → populate and show a confirmation modal displaying:
  - "**X comments** across **Y reports** will be sent for scoring"
  - "**Z comments** already scored — will be skipped"
  - "**W comments** in **N reports** currently pending — will be skipped"
  - Confirm / Cancel buttons
- On confirm: `POST /api/ai-score-aggregate` → update button state to "Scoring…" (disabled)
- Start a 30-second poll against `GET /api/ai-score-aggregate`: when `pending_count` drops to 0, reload the page to show updated scores
- Add `topic_rating` and `topic_confidence` columns to the aggregate column config (currently absent from `CONFIG.columns.aggregate`) — show them when any data contains scores

### 5. `batch_scorer.py`

No changes needed. `submit_batch(df)` already accepts any DataFrame; the aggregate endpoint pre-filters before calling it.

---

## What does NOT change

- `batch_scorer.py` — no changes needed
- `_poll_all_batches()` — already scans all `_info.json` files globally; picks up aggregate-triggered batches automatically
- `fetch_and_apply_results()` — unchanged; correctly skips comment IDs no longer in parquet
- Report page AI score button — unchanged; per-report scoring still works independently
- `comment_store.py`, saved/blacklist/deleted pages — unaffected

---

## Modal UX sketch

```
┌─────────────────────────────────────────────────────┐
│  AI Score — All Reports                             │
├─────────────────────────────────────────────────────┤
│  847 comments across 5 reports will be submitted    │
│  for AI scoring.                                    │
│                                                     │
│  Already scored:   1,204 comments   (skipped)       │
│  Pending batches:    312 comments   (skipped)        │
│                     across 2 reports                │
│                                                     │
│  Scoring uses the Anthropic Batches API.            │
│  Results are written back automatically when ready. │
│                                                     │
│            [ Cancel ]   [ Score 847 Comments ]      │
└─────────────────────────────────────────────────────┘
```

---

## Edge cases covered

| Scenario | Handling |
|---|---|
| Report batch `in_progress` | Entire report skipped; comment count shown in modal as "pending" |
| Report batch `ended`, all scored | `topic_rating != -1` for all rows → 0 eligible → report skipped silently |
| Report batch `ended`, re-fetched parquet adds new comments | New unscored rows (`-1`) → eligible → new batch submitted for just those rows |
| No `ANTHROPIC_API_KEY` | POST returns `{ error: "..." }` → modal shows error, button returns to ready state |
| 0 eligible comments total | Modal shows "Nothing to score" state; submit button disabled |
| User clicks twice | Second GET shows pending counts rising; submit idempotency at report level (skip `in_progress`) |
