"""Phase 1: Fetch reply and post metrics for evolve analysis."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


def _parse_date(val) -> datetime | None:
    """Parse a date string, handling both ISO and X Analytics formats."""
    if isinstance(val, datetime):
        return val
    if not isinstance(val, str):
        return None
    # Try ISO first
    try:
        return datetime.fromisoformat(val)
    except (ValueError, TypeError):
        pass
    # Fallback: X Analytics format "Mon, Mar 2, 2026"
    try:
        return datetime.strptime(val.strip(), "%a, %b %d, %Y")
    except (ValueError, TypeError):
        return None


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
    reply_target: str | None = None
    replies_count: int = 0


@dataclass
class PostRecord:
    id: str
    post_id: str
    text: str
    posted_at: datetime | None
    impressions: int
    likes: int
    retweets: int
    bookmarks: int
    profile_clicks: int
    engagements: int


async def collect_reply_window(store, days: int | None = 7) -> list[ReplyRecord]:
    """Fetch replies with impression data. days=None returns all."""
    replies = await store.get_reply_window(days=days)
    records = []
    for r in replies:
        posted = _parse_date(r.get("posted_at"))
        if posted is None:
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
                reply_target=r.get("reply_target"),
                replies_count=r.get("replies_count", 0),
            )
        )
    return records


async def collect_post_window(store, days: int | None = None) -> list[PostRecord]:
    """Fetch original post nodes with impression data. days=None returns all."""
    posts = await store.get_post_window(days=days)
    records = []
    for p in posts:
        posted = _parse_date(p.get("posted_at"))
        records.append(
            PostRecord(
                id=p.get("_node_id", ""),
                post_id=p.get("post_id", ""),
                text=p.get("text", ""),
                posted_at=posted,
                impressions=p.get("impressions", 0),
                likes=p.get("likes", 0),
                retweets=p.get("retweets", 0),
                bookmarks=p.get("bookmarks", 0),
                profile_clicks=p.get("profile_clicks", 0),
                engagements=p.get("engagements", 0),
            )
        )
    return records
