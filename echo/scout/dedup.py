from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import asyncpg

from echo.scout.extraction import RawTweet


async def filter_already_seen(
    pool: asyncpg.Pool,
    tweets: list[RawTweet],
) -> list[RawTweet]:
    """Filter out tweets that already exist in echo.tweets."""
    if not tweets:
        return []

    tweet_ids = [t.tweet_id for t in tweets]

    rows = await pool.fetch(
        "SELECT tweet_id FROM echo.tweets WHERE tweet_id = ANY($1::text[])",
        tweet_ids,
    )
    existing = {row["tweet_id"] for row in rows}

    return [t for t in tweets if t.tweet_id not in existing]
