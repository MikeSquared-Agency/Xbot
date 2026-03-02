from __future__ import annotations

from datetime import datetime, timezone

from echo.scout.extraction import RawTweet

MAX_AGE_MINUTES = 240  # 4 hours

DEFAULT_ANTI_SIGNALS = [
    "crypto",
    "airdrop",
    "giveaway",
    "nft",
    "web3",
    "whitelist",
    "presale",
    "dm me",
    "follow back",
]


def passes_hard_filters(
    tweet: RawTweet,
    anti_signals: list[str] | None = None,
) -> bool:
    """Fast, cheap checks that eliminate noise before scoring."""

    if not tweet.author_verified:
        return False

    if tweet.is_quote_tweet:
        return False

    age_minutes = (datetime.now(timezone.utc) - tweet.created_at).total_seconds() / 60
    if age_minutes > MAX_AGE_MINUTES:
        return False

    signals = anti_signals if anti_signals is not None else DEFAULT_ANTI_SIGNALS
    content_lower = tweet.content.lower()
    if any(kw.lower() in content_lower for kw in signals):
        return False

    if tweet.is_reply:
        return False

    if tweet.is_retweet:
        return False

    return True
