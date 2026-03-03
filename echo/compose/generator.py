"""Main generate_replies flow for the Compose Agent."""

from __future__ import annotations

import json
import os

from echo.auth import get_client
from echo.compose import GeneratedReply, Tweet
from echo.compose.prompt import build_compose_prompt
from echo.compose.strategies import get_strategy_weights, order_strategies_by_weight
from echo.compose.validation import validate_replies

COMPOSE_MODEL = os.environ.get("COMPOSE_MODEL", "claude-opus-4-20250514")


async def get_tweet(tweet_id: str) -> Tweet:
    """Load a tweet record from Cortex."""
    from echo.db.store import get_global_store

    store = get_global_store()
    data = await store.get_tweet(tweet_id)
    if not data:
        raise ValueError(f"Tweet {tweet_id} not found")
    return Tweet(
        tweet_id=data.get("tweet_id", tweet_id),
        author_handle=data.get("author_handle", ""),
        content=data.get("content", ""),
        score=data.get("virality_score"),
    )


async def get_author_brief(author_handle: str) -> str:
    """Load cached author enrichment brief from Cortex."""
    from echo.db.store import get_global_store

    store = get_global_store()
    brief = await store.get_author_brief(author_handle)
    if brief:
        return brief
    return f"@{author_handle} (no enrichment data available)"


async def get_active_voice_profile() -> dict:
    """Load the currently active voice profile."""
    from echo.db.store import get_global_store

    store = get_global_store()
    profile = await store.get_active_voice_profile()
    if not profile:
        return {"name": "default", "style": "concise, technical, opinionated"}
    return profile


async def get_winning_patterns() -> dict | None:
    """Load the latest winning patterns from the Evolve engine."""
    from echo.db.store import get_global_store

    store = get_global_store()
    return await store.get_winning_patterns()


async def get_recent_own_tweets(limit: int = 10) -> list[str]:
    """Load recent replies for voice consistency."""
    from echo.db.store import get_global_store

    store = get_global_store()
    replies = await store.get_recent_replies(limit)
    return [r.get("reply_text", "") for r in replies if r.get("reply_text")]


async def call_compose_llm(
    tweet: Tweet,
    author_brief: str,
    profile: dict,
    strategy_order: list[str],
    recent_own_tweets: list[str],
    winning_patterns: dict | None,
) -> list[GeneratedReply]:
    """Call Claude to generate 5 strategy-diverse replies."""
    prompt = build_compose_prompt(
        tweet_author=tweet.author_handle,
        tweet_content=tweet.content,
        author_brief=author_brief,
        profile=profile,
        strategy_order=strategy_order,
        recent_own_tweets=recent_own_tweets,
        winning_patterns=winning_patterns,
    )

    client = get_client()
    message = await client.messages.create(
        model=COMPOSE_MODEL,
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )

    raw_text = message.content[0].text.strip()
    # Strip markdown fences if present
    if raw_text.startswith("```"):
        raw_text = raw_text.split("\n", 1)[1]
        if raw_text.endswith("```"):
            raw_text = raw_text[: raw_text.rfind("```")]

    raw = json.loads(raw_text)

    return [
        GeneratedReply(
            strategy=r["strategy"],
            text=r["text"],
            reasoning=r["reasoning"],
        )
        for r in raw
    ]


async def store_replies(tweet_id: str, replies: list[GeneratedReply]) -> None:
    """Persist generated replies to Cortex."""
    from echo.db.store import get_global_store

    store = get_global_store()
    await store.insert_replies_batch(
        tweet_id,
        [{"reply_text": r.text, "strategy": r.strategy} for r in replies],
    )


async def generate_replies(tweet_id: str) -> list[GeneratedReply]:
    """Generate 5 strategy-diverse replies for a candidate tweet.

    This is the main entry point for the Compose Agent.
    """
    # 1. Load tweet
    tweet = await get_tweet(tweet_id)

    # 2. Enrich author (cache-first)
    brief = await get_author_brief(tweet.author_handle)

    # 3. Load active voice profile
    profile = await get_active_voice_profile()

    # 4. Load recent winning patterns (from Evolve)
    patterns = await get_winning_patterns()

    # 5. Load recent own tweets for voice consistency
    recent_own = await get_recent_own_tweets()

    # 6. Load strategy weights and determine ordering
    weights = await get_strategy_weights()
    strategy_order = order_strategies_by_weight(weights)

    # 7. Generate via Claude
    replies = await call_compose_llm(
        tweet, brief, profile, strategy_order, recent_own, patterns
    )

    # 8. Validate
    replies = validate_replies(replies)

    # 9. Persist
    await store_replies(tweet_id, replies)

    return replies
