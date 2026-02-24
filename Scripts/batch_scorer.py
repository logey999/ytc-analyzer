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

_SYSTEM_PROMPT = """\
You analyse comments on a YouTube video to identify video topic potential.

Rate each comment 1-10:
  8-10  Clear actionable question or topic idea the creator could make a video about
  4-7   Vague interest or partial topic signal
  1-3   General praise, reaction, off-topic, or no usable topic idea

Confidence: how certain you are given the clarity of the comment (0-100).

Return a JSON array in the same order as the input:
[{"rating": N, "confidence": N}, ...]"""


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

def submit_batch(df: pd.DataFrame, system_prompt: str = None) -> tuple:
    """Submit a batch scoring job for the given DataFrame.

    Args:
        df: Filtered comments DataFrame with 'id' and 'text' columns.
            The row order determines chunk assignment; preserve it from
            the parquet so result mapping stays consistent.

    Returns:
        (batch_id, comment_ids)
            batch_id     — Anthropic batch ID string (e.g. "msgbatch_01abc…")
            comment_ids  — list of comment ID strings in submission order;
                           store this in _info.json so results can be mapped
                           back by ID even if parquet rows are later deleted.

    Raises:
        RuntimeError: If ANTHROPIC_API_KEY is missing or 'anthropic' is not installed.
    """
    import anthropic  # noqa: PLC0415
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming  # noqa: PLC0415
    from anthropic.types.messages.batch_create_params import Request as BatchRequest  # noqa: PLC0415

    client = _get_client()

    texts = df["text"].fillna("").astype(str).tolist()
    comment_ids = df["id"].astype(str).tolist()

    prompt = (system_prompt.strip() if system_prompt and system_prompt.strip() else None) or _SYSTEM_PROMPT

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
    batch_id: str, comment_ids: list, parquet_path: str
) -> int:
    """Fetch results from an ended batch and write scores to the Parquet file.

    Maps each result back to its comment by ID (using the submission-order
    comment_ids list).  This is safe even if parquet rows were deleted between
    batch submission and now — only rows still present in the file are updated.

    Args:
        batch_id:     Anthropic batch ID.
        comment_ids:  Ordered list stored in _info.json at submission time.
        parquet_path: Path to the report's Parquet file (read → score → write).

    Returns:
        Number of comments successfully scored.
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
    scored = 0

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
            if row_idx is None:
                continue  # Row was deleted after submission

            df.at[row_idx, "topic_rating"] = int(rating_obj.get("rating", -1))
            df.at[row_idx, "topic_confidence"] = int(rating_obj.get("confidence", -1))
            scored += 1

    df.to_parquet(parquet_path, index=False)
    return scored
