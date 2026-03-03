"""Mode B: CSV import from X Analytics / Creator Studio exports.

Parses the CSV, matches rows to existing replies by reply ID or text,
and updates metric fields on the Cortex node.
"""

from __future__ import annotations

import io
from pathlib import Path

import pandas as pd
from rich.console import Console

console = Console()

# X Analytics column name → internal name
# Supports both old ("Tweet id") and current ("Post id") CSV formats.
COLUMN_MAP = {
    "Tweet id": "tweet_id",
    "Post id": "tweet_id",
    "Tweet text": "text",
    "Post text": "text",
    "Impressions": "impressions",
    "impressions": "impressions",
    "Likes": "likes",
    "likes": "likes",
    "Replies": "replies",
    "replies": "replies",
    "Reposts": "retweets",
    "retweets": "retweets",
    "Shares": "shares",
    "Bookmarks": "bookmarks",
    "Engagements": "engagements",
    "New follows": "new_follows",
    "Profile visits": "profile_clicks",
    "user profile clicks": "profile_clicks",
    "Detail Expands": "detail_expands",
    "URL Clicks": "url_clicks",
    "engagement rate": "engagement_rate",
    "Date": "posted_at",
    "time": "posted_at",
    "Post Link": "post_url",
}


def safe_int(val) -> int | None:
    """Coerce a value to int, returning None on failure."""
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


async def import_csv(
    store,
    filepath: str,
) -> dict:
    """Import an X Analytics CSV and match rows to existing replies.

    Args:
        store: EchoStore instance.
        filepath: Path to the CSV file.

    Returns:
        Dict with ``matched``, ``unmatched``, and ``total`` counts.
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"CSV file not found: {filepath}")

    id_cols = {"Post id": str, "Tweet id": str}
    df = pd.read_csv(filepath, dtype=id_cols)
    df = df.rename(
        columns={k: v for k, v in COLUMN_MAP.items() if k in df.columns}
    )

    matched = 0
    unmatched = 0

    for _, row in df.iterrows():
        tweet_id = str(row.get("tweet_id", "")).strip()
        text = str(row.get("text", "")).strip()

        # Try exact match by tweet/reply ID
        reply = await store.find_reply_by_reply_id(tweet_id) if tweet_id else None

        # Fallback: fuzzy match by text content
        if not reply and text:
            reply = await store.find_reply_by_text(text)

        if reply and reply.get("_node_id"):
            metrics = {
                "impressions": safe_int(row.get("impressions")),
                "likes": safe_int(row.get("likes")),
                "retweets": safe_int(row.get("retweets")),
                "replies_count": safe_int(row.get("replies")),
                "profile_clicks": safe_int(row.get("profile_clicks")),
            }
            # Filter out None values
            metrics = {k: v for k, v in metrics.items() if v is not None}
            await store.update_reply_metrics(reply["_node_id"], metrics)
            matched += 1
        else:
            unmatched += 1

    return {"matched": matched, "unmatched": unmatched, "total": len(df)}


def _build_metrics(row: pd.Series) -> dict:
    """Extract metric dict from a CSV row, filtering out Nones."""
    metrics = {
        "impressions": safe_int(row.get("impressions")),
        "likes": safe_int(row.get("likes")),
        "retweets": safe_int(row.get("retweets")),
        "replies_count": safe_int(row.get("replies")),
        "profile_clicks": safe_int(row.get("profile_clicks")),
        "bookmarks": safe_int(row.get("bookmarks")),
        "engagements": safe_int(row.get("engagements")),
    }
    return {k: v for k, v in metrics.items() if v is not None}


def _metrics_unchanged(existing: dict, new_metrics: dict) -> bool:
    """Return True if the reply already has identical metric values."""
    for key, val in new_metrics.items():
        if safe_int(existing.get(key)) != val:
            return False
    return True


async def import_csv_text(
    store,
    csv_text: str,
) -> dict:
    """Import X Analytics data from a raw CSV string.

    Same logic as import_csv() but accepts CSV text directly
    (e.g. from the x:pull-analytics MCP tool). Deduplicates by
    skipping rows where the stored metrics already match.

    Args:
        store: EchoStore instance.
        csv_text: Raw CSV content as a string.

    Returns:
        Dict with ``matched``, ``unmatched``, ``skipped``, and ``total`` counts.
    """
    # Force ID columns to be read as strings (not floats)
    id_cols = {"Post id": str, "Tweet id": str}
    df = pd.read_csv(io.StringIO(csv_text), dtype=id_cols)
    df = df.rename(
        columns={k: v for k, v in COLUMN_MAP.items() if k in df.columns}
    )

    matched = 0
    stored = 0
    skipped = 0

    for _, row in df.iterrows():
        tweet_id = str(row.get("tweet_id", "")).strip()
        text = str(row.get("text", "")).strip()
        metrics = _build_metrics(row)

        # Try matching to an existing Echo reply node first
        reply = await store.find_reply_by_reply_id(tweet_id) if tweet_id else None
        if not reply and text:
            reply = await store.find_reply_by_text(text)

        if reply and reply.get("_node_id"):
            if _metrics_unchanged(reply, metrics):
                skipped += 1
                continue
            await store.update_reply_metrics(reply["_node_id"], metrics)
            matched += 1
            continue

        # Not an Echo reply — check if we already have a post analytics node
        existing_post = await store.find_post_by_id(tweet_id) if tweet_id else None
        if existing_post:
            if _metrics_unchanged(existing_post, metrics):
                skipped += 1
                continue

        # Upsert post analytics node (create or update)
        if tweet_id:
            post_data = dict(metrics)
            post_data["text"] = text
            posted_at = str(row.get("posted_at", "")).strip()
            if posted_at:
                post_data["posted_at"] = posted_at
            post_url = str(row.get("post_url", "")).strip()
            if post_url:
                post_data["post_url"] = post_url
            await store.upsert_post_analytics(tweet_id, post_data)
            stored += 1

    return {
        "matched": matched,
        "stored": stored,
        "skipped": skipped,
        "total": len(df),
    }
