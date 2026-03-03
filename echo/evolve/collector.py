"""Phase 1: Fetch 7-day reply metrics for evolve analysis."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


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


async def collect_reply_window(store) -> list[ReplyRecord]:
    """Fetch all replies from the last 7 days that have impression data."""
    replies = await store.get_reply_window(days=7)
    records = []
    for r in replies:
        posted = r.get("posted_at")
        if isinstance(posted, str):
            try:
                posted = datetime.fromisoformat(posted)
            except (ValueError, TypeError):
                continue

        records.append(
            ReplyRecord(
                id=r.get("_node_id", ""),
                reply_id=r.get("reply_id"),
                reply_text=r.get("reply_text", ""),
                strategy=r.get("strategy"),
                posted_at=posted,
                impressions=r.get("impressions", 0),
                likes=r.get("likes", 0),
                retweets=r.get("retweets", 0),
                bookmarks=r.get("bookmarks", 0),
                profile_clicks=r.get("profile_clicks", 0),
                was_edited=r.get("was_edited", False),
                time_to_reply_seconds=r.get("time_to_reply_seconds"),
                voice_profile_version=r.get("voice_profile_version"),
            )
        )
    return records
