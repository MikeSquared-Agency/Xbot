"""Phase 1: Fetch 7-day reply metrics for evolve analysis."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import asyncpg


@dataclass
class ReplyRecord:
    id: str
    reply_id: str | None
    reply_text: str
    strategy: str | None
    posted_at: datetime
    impressions: int
    likes: int
    retweets: int
    bookmarks: int
    profile_clicks: int
    was_edited: bool
    time_to_reply_seconds: int | None
    voice_profile_version: str | None


FETCH_REPLY_WINDOW = """
    SELECT
        r.id,
        r.reply_id,
        r.reply_text,
        r.strategy,
        r.posted_at,
        COALESCE(r.impressions, 0) AS impressions,
        COALESCE(r.likes, 0) AS likes,
        COALESCE(r.retweets, 0) AS retweets,
        COALESCE(r.bookmarks, 0) AS bookmarks,
        COALESCE(r.profile_clicks, 0) AS profile_clicks,
        r.was_edited,
        r.time_to_reply_seconds,
        r.voice_profile_version
    FROM echo.replies r
    WHERE r.posted_at >= NOW() - INTERVAL '7 days'
      AND r.impressions IS NOT NULL
      AND r.impressions > 0
    ORDER BY r.posted_at DESC
"""


async def collect_reply_window(conn: asyncpg.Connection) -> list[ReplyRecord]:
    """Fetch all replies from the last 7 days that have impression data."""
    rows = await conn.fetch(FETCH_REPLY_WINDOW)
    return [
        ReplyRecord(
            id=str(row["id"]),
            reply_id=row["reply_id"],
            reply_text=row["reply_text"],
            strategy=row["strategy"],
            posted_at=row["posted_at"],
            impressions=row["impressions"],
            likes=row["likes"],
            retweets=row["retweets"],
            bookmarks=row["bookmarks"],
            profile_clicks=row["profile_clicks"],
            was_edited=row["was_edited"],
            time_to_reply_seconds=row["time_to_reply_seconds"],
            voice_profile_version=row["voice_profile_version"],
        )
        for row in rows
    ]
