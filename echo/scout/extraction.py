from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import dateutil.parser


@dataclass
class RawTweet:
    tweet_id: str
    tweet_url: str
    author_handle: str
    author_name: str
    author_verified: bool
    content: str
    created_at: datetime
    is_quote_tweet: bool
    is_reply: bool
    is_retweet: bool
    is_thread: bool
    has_media: bool
    likes: int
    retweets: int
    replies: int
    author_followers: int | None = None
    bookmarks: int | None = None
    views: int | None = None
    source: str = ""


def parse_x_timestamp(raw: str) -> datetime:
    """Parse X's relative or absolute timestamp into a UTC datetime.

    Formats:
      - "Ns"  → N seconds ago
      - "Nm"  → N minutes ago
      - "Nh"  → N hours ago
      - "Mar 1" → this year, that date
      - "Mar 1, 2025" → specific date
    """
    now = datetime.now(timezone.utc)
    stripped = raw.strip()

    if stripped.endswith("s") and stripped[:-1].isdigit():
        return now - timedelta(seconds=int(stripped[:-1]))
    if stripped.endswith("m") and stripped[:-1].isdigit():
        return now - timedelta(minutes=int(stripped[:-1]))
    if stripped.endswith("h") and stripped[:-1].isdigit():
        return now - timedelta(hours=int(stripped[:-1]))

    # Absolute date — dateutil handles "Mar 1" and "Mar 1, 2025"
    parsed = dateutil.parser.parse(stripped)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def raw_tweet_from_dict(data: dict) -> RawTweet:
    """Build a RawTweet from the dict returned by Xbot tools."""
    created_at = data.get("created_at")
    if isinstance(created_at, str):
        created_at = parse_x_timestamp(created_at)
    elif not isinstance(created_at, datetime):
        created_at = datetime.now(timezone.utc)

    return RawTweet(
        tweet_id=str(data["tweet_id"]),
        tweet_url=data["tweet_url"],
        author_handle=data["author_handle"],
        author_name=data["author_name"],
        author_verified=bool(data.get("author_verified", False)),
        author_followers=data.get("author_followers"),
        content=data.get("content", ""),
        created_at=created_at,
        is_quote_tweet=bool(data.get("is_quote_tweet", False)),
        is_reply=bool(data.get("is_reply", False)),
        is_retweet=bool(data.get("is_retweet", False)),
        is_thread=bool(data.get("is_thread", False)),
        has_media=bool(data.get("has_media", False)),
        likes=int(data.get("likes", 0)),
        retweets=int(data.get("retweets", 0)),
        replies=int(data.get("replies", 0)),
        bookmarks=data.get("bookmarks"),
        views=data.get("views"),
    )
