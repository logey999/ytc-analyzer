#!/usr/bin/env python3
"""
batch_scorer.py — AI-powered comment topic scoring via the Anthropic Batches API.

Submits filtered comments to Claude Haiku 4.5 for video topic potential rating
(1–10 score + confidence %).  Results are written back to the report's Parquet file.

Usage (from server.py):
    from batch_scorer import submit_batch, check_batch_status, fetch_and_apply_results
"""

import json
import logging
import os

import pandas as pd

# ── Constants ──────────────────────────────────────────────────────────────────

CHUNK_SIZE = 50
_MODEL = "claude-haiku-4-5-20251001"

_SYSTEM_PROMPT_TEMPLATE = """\
Rate each YouTube comment on how well it suggests a new, original video idea for this creator.

Creator's niche/keywords: {keywords}

CRITICAL: A comment MUST relate to the creator's niche to score above 3. "I want more" or "make this longer" is NOT a video idea — it's praise. A comment about music nostalgia is off-topic for a cooking channel, no matter how enthusiastic.

Rating 1-10:
9-10  Specific, actionable video idea within the niche you could film tomorrow
7-8   Clear topic or angle within the niche that needs minor fleshing out
4-6   Vague but on-niche interest area or request
2-3   Generic praise, reactions, jokes, personal stories (no video idea)
1     Off-topic: comment is unrelated to the creator's niche

Confidence 1-10 (how certain YOU are about the rating above):
9-10  Obvious classification
6-8   Reasonable people would agree
3-5   Borderline, could argue either way
1-2   Genuinely ambiguous

Return JSON array in input order: [{{"rating":N,"confidence":N}}, ...]"""


def _build_system_prompt(keywords: list) -> str:
    """Build system prompt with the given keywords injected."""
    kw_str = ", ".join(keywords) if keywords else "general topics"
    return _SYSTEM_PROMPT_TEMPLATE.format(keywords=kw_str)


# ── Internal helpers ───────────────────────────────────────────────────────────

def _get_client():
    """Return an Anthropic client, loading ANTHROPIC_API_KEY from .env if present."""
    try:
        import anthropic  # noqa: PLC0415
    except ImportError as exc:
        raise RuntimeError(
            "anthropic package not installed. Run: pip install anthropic"
        ) from exc

    try:
        from dotenv import load_dotenv  # noqa: PLC0415
        load_dotenv()
    except ImportError:
        pass

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Anthropic API key not set. Open Settings (gear icon in the dashboard) "
            "and enter your Anthropic API key to enable AI scoring."
        )
    return anthropic.Anthropic(api_key=api_key)


# ── Public API ─────────────────────────────────────────────────────────────────

def submit_batch(df: pd.DataFrame, keywords: list = None) -> tuple:
    """Submit a batch scoring job for the given DataFrame.

    Args:
        df: Filtered comments DataFrame with 'id' and 'text' columns.
        keywords: List of keyword strings defining what to score for.
                  Defaults to ['video ideas'] if empty/None.

    Returns:
        (batch_id, comment_ids)

    Raises:
        RuntimeError: If ANTHROPIC_API_KEY is missing or 'anthropic' is not installed.
    """
    import anthropic  # noqa: PLC0415
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming  # noqa: PLC0415
    from anthropic.types.messages.batch_create_params import Request as BatchRequest  # noqa: PLC0415

    client = _get_client()

    texts = df["text"].fillna("").astype(str).tolist()
    comment_ids = df["id"].astype(str).tolist()

    prompt = _build_system_prompt(keywords or [])

    requests = []
    for chunk_start in range(0, len(texts), CHUNK_SIZE):
        chunk = texts[chunk_start : chunk_start + CHUNK_SIZE]
        chunk_idx = chunk_start // CHUNK_SIZE
        numbered = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(chunk))
        requests.append(
            BatchRequest(
                custom_id=f"chunk-{chunk_idx}",
                params=MessageCreateParamsNonStreaming(
                    model=_MODEL,
                    max_tokens=4096,
                    system=prompt,
                    messages=[{
                        "role": "user",
                        "content": f"Comments:\n{numbered}",
                    }],
                ),
            )
        )

    batch = client.messages.batches.create(requests=requests)
    return batch.id, comment_ids


def check_batch_status(batch_id: str) -> dict:
    """Check the Anthropic processing status of a batch.

    Returns a dict:
        {
            "processing_status": "in_progress" | "ended" | ...,
            "request_counts": {
                "processing": N, "succeeded": N,
                "errored": N, "canceled": N, "expired": N
            }
        }
    """
    client = _get_client()
    batch = client.messages.batches.retrieve(batch_id)
    return {
        "processing_status": batch.processing_status,
        "request_counts": {
            "processing": batch.request_counts.processing,
            "succeeded": batch.request_counts.succeeded,
            "errored": batch.request_counts.errored,
            "canceled": batch.request_counts.canceled,
            "expired": batch.request_counts.expired,
        },
    }


def fetch_and_apply_results(
    batch_id: str, comment_ids: list, parquet_path: str,
    saved_store=None,
) -> tuple:
    """Fetch results from an ended batch and write scores to the Parquet file.

    Maps each result back to its comment by ID (using the submission-order
    comment_ids list).  This is safe even if parquet rows were deleted between
    batch submission and now — only rows still present in the file are updated.

    If saved_store is provided, comments that were moved to Saved between
    batch submission and now will also receive their scores.

    Args:
        batch_id:     Anthropic batch ID.
        comment_ids:  Ordered list stored in _info.json at submission time.
        parquet_path: Path to the report's Parquet file (read → score → write).
        saved_store:  Optional CommentStore for saved comments.

    Returns:
        (scored_in_report, scored_in_saved) — counts of comments scored.
    """
    client = _get_client()

    df = pd.read_parquet(parquet_path)

    # Initialise columns to sentinel -1 if absent
    if "topic_rating" not in df.columns:
        df["topic_rating"] = -1
    if "topic_confidence" not in df.columns:
        df["topic_confidence"] = -1
    df["topic_rating"] = pd.to_numeric(df["topic_rating"], errors="coerce").fillna(-1).astype(int)
    df["topic_confidence"] = pd.to_numeric(df["topic_confidence"], errors="coerce").fillna(-1).astype(int)

    id_to_idx = {cid: i for i, cid in enumerate(df["id"].astype(str).tolist())}

    # Build a map of saved comment IDs for cross-store scoring
    saved_map = {}
    if saved_store:
        for c in saved_store.all():
            saved_map[str(c.get("id", ""))] = c

    scored = 0
    scored_saved = 0
    # Collect saved updates to apply in bulk after parsing
    saved_updates = {}

    for result in client.messages.batches.results(batch_id):
        if result.result.type != "succeeded":
            logging.warning("Batch %s chunk %s: result type=%s", batch_id, result.custom_id, result.result.type)
            continue

        # Decode chunk index from custom_id, e.g. "chunk-3" → 3
        try:
            chunk_idx = int(result.custom_id.split("-")[1])
        except (IndexError, ValueError):
            logging.warning("Batch %s: unrecognised custom_id %r", batch_id, result.custom_id)
            continue

        start = chunk_idx * CHUNK_SIZE

        msg = result.result.message
        if msg.stop_reason == "max_tokens":
            logging.warning(
                "Batch %s chunk %s: output truncated (max_tokens). Chunk skipped — increase max_tokens.",
                batch_id, result.custom_id,
            )
            continue

        try:
            content = msg.content[0].text
            # Strip optional markdown fences (```json...``` or ```...```)
            stripped = content.strip()
            if stripped.startswith("```"):
                stripped = stripped.split("\n", 1)[-1]
                stripped = stripped.rsplit("```", 1)[0]
            ratings = json.loads(stripped)
        except Exception as exc:
            logging.warning("Batch %s chunk %s: failed to parse ratings: %s", batch_id, result.custom_id, exc)
            continue

        for i, rating_obj in enumerate(ratings):
            global_idx = start + i
            if global_idx >= len(comment_ids):
                continue
            cid = comment_ids[global_idx]
            row_idx = id_to_idx.get(cid)
            if row_idx is not None:
                df.at[row_idx, "topic_rating"] = int(rating_obj.get("rating", -1))
                df.at[row_idx, "topic_confidence"] = int(rating_obj.get("confidence", -1))
                scored += 1
            elif cid in saved_map:
                saved_updates[cid] = (
                    int(rating_obj.get("rating", -1)),
                    int(rating_obj.get("confidence", -1)),
                )

    df.to_parquet(parquet_path, index=False)

    # Apply scores to saved comments
    if saved_updates and saved_store:
        with saved_store.lock:
            data = saved_store._get_data()
            changed = False
            for c in data:
                upd = saved_updates.get(str(c.get("id", "")))
                if upd:
                    c["topic_rating"] = upd[0]
                    c["topic_confidence"] = upd[1]
                    scored_saved += 1
                    changed = True
            if changed:
                saved_store._save_and_cache(data)

    return scored, scored_saved
