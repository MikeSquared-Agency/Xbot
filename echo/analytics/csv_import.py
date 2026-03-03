"""Mode B: CSV import from X Analytics / Creator Studio exports.

Parses the CSV, matches rows to existing replies by reply ID or text,
and updates metric fields on the Cortex node.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from rich.console import Console

console = Console()

# X Analytics column name → internal name
COLUMN_MAP = {
    "Tweet id": "tweet_id",
    "Tweet text": "text",
    "impressions": "impressions",
    "retweets": "retweets",
    "replies": "replies",
    "likes": "likes",
    "user profile clicks": "profile_clicks",
    "engagement rate": "engagement_rate",
    "time": "posted_at",
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

    df = pd.read_csv(filepath)
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
