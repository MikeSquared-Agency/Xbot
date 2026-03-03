from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from echo.db.store import EchoStore

from echo.scout.extraction import RawTweet


async def filter_already_seen(
    store: EchoStore,
    tweets: list[RawTweet],
) -> list[RawTweet]:
    """Filter out tweets that already exist in Cortex."""
    if not tweets:
        return []

    tweet_ids = [t.tweet_id for t in tweets]
    existing = await store.get_tweet_ids(tweet_ids)

    return [t for t in tweets if t.tweet_id not in existing]
