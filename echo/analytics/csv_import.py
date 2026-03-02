"""Mode B: CSV import from X Analytics / Creator Studio exports.

Parses the CSV, matches rows to existing replies by tweet ID or text,
and updates metric columns.
"""

from __future__ import annotations

from pathlib import Path

import asyncpg
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

UPDATE_REPLY_METRICS = """
    UPDATE echo.replies SET
        impressions      = COALESCE($1, impressions),
        likes            = COALESCE($2, likes),
        retweets         = COALESCE($3, retweets),
        replies_count    = COALESCE($4, replies_count),
        profile_clicks   = COALESCE($5, profile_clicks),
        metrics_updated_at = NOW()
    WHERE id = $6
"""

MATCH_BY_ID = "SELECT id FROM echo.replies WHERE reply_id = $1"

MATCH_BY_TEXT = """
    SELECT id FROM echo.replies
    WHERE reply_text = $1 OR reply_text LIKE $2
    LIMIT 1
"""

RECORD_IMPORT = """
    INSERT INTO echo.analytics_imports
        (filename, rows_imported, rows_unmatched, date_range_start, date_range_end)
    VALUES ($1, $2, $3, $4, $5)
"""


def safe_int(val) -> int | None:
    """Coerce a value to int, returning None on failure."""
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


async def import_csv(
    conn: asyncpg.Connection,
    filepath: str,
) -> dict:
    """Import an X Analytics CSV and match rows to existing replies.

    Args:
        conn: Active asyncpg connection.
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

        # Try exact match by tweet ID
        reply = await conn.fetchrow(MATCH_BY_ID, tweet_id) if tweet_id else None

        # Fallback: fuzzy match by text content
        if not reply and text:
            like_prefix = f"%{text[:50]}%"
            reply = await conn.fetchrow(MATCH_BY_TEXT, text, like_prefix)

        if reply:
            await conn.execute(
                UPDATE_REPLY_METRICS,
                safe_int(row.get("impressions")),
                safe_int(row.get("likes")),
                safe_int(row.get("retweets")),
                safe_int(row.get("replies")),
                safe_int(row.get("profile_clicks")),
                reply["id"],
            )
            matched += 1
        else:
            unmatched += 1

    # Determine date range
    date_start = None
    date_end = None
    if "posted_at" in df.columns:
        timestamps = pd.to_datetime(df["posted_at"], errors="coerce").dropna()
        if not timestamps.empty:
            date_start = timestamps.min().to_pydatetime()
            date_end = timestamps.max().to_pydatetime()

    await conn.execute(
        RECORD_IMPORT,
        str(path.name),
        matched,
        unmatched,
        date_start,
        date_end,
    )

    return {"matched": matched, "unmatched": unmatched, "total": len(df)}
