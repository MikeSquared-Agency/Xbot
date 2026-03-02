"""Main generate_replies flow for the Compose Agent."""

from __future__ import annotations

import json
import os

import anthropic
import asyncpg

from echo.compose import GeneratedReply, Tweet
from echo.compose.prompt import build_compose_prompt
from echo.compose.strategies import get_strategy_weights, order_strategies_by_weight
from echo.compose.validation import validate_replies

DATABASE_URL = os.environ.get("DATABASE_URL", "")
COMPOSE_MODEL = os.environ.get("COMPOSE_MODEL", "claude-opus-4-20250514")


async def get_tweet(db_url: str, tweet_id: str) -> Tweet:
    """Load a tweet record from the database."""
    conn = await asyncpg.connect(db_url)
    try:
        row = await conn.fetchrow(
            "SELECT tweet_id, author_handle, content, virality_score "
            "FROM echo.tweets WHERE tweet_id = $1",
            tweet_id,
        )
        if not row:
            raise ValueError(f"Tweet {tweet_id} not found")
        return Tweet(
            tweet_id=row["tweet_id"],
            author_handle=row["author_handle"],
            content=row["content"],
            score=row["virality_score"],
        )
    finally:
        await conn.close()


async def get_author_brief(db_url: str, author_handle: str) -> str:
    """Load cached author enrichment brief from echo.authors.

    In production this calls the Context Agent (SPEC-05) to enrich.
    Here we check the cache first, and fall back to a placeholder.
    """
    conn = await asyncpg.connect(db_url)
    try:
        row = await conn.fetchrow(
            "SELECT enrichment_brief FROM echo.authors WHERE handle = $1",
            author_handle,
        )
        if row and row["enrichment_brief"]:
            return row["enrichment_brief"]
        return f"@{author_handle} (no enrichment data available)"
    finally:
        await conn.close()


async def get_active_voice_profile(db_url: str) -> dict:
    """Load the currently active voice profile."""
    conn = await asyncpg.connect(db_url)
    try:
        row = await conn.fetchrow(
            "SELECT profile_json FROM echo.voice_profiles WHERE is_active = true LIMIT 1"
        )
        if not row:
            return {"name": "default", "style": "concise, technical, opinionated"}
        return row["profile_json"]
    finally:
        await conn.close()


async def get_winning_patterns(db_url: str) -> dict | None:
    """Load the latest winning patterns from the Evolve engine."""
    conn = await asyncpg.connect(db_url)
    try:
        row = await conn.fetchrow(
            """
            SELECT digest_json->'winning_patterns' AS patterns
            FROM echo.daily_digests
            WHERE digest_json->'winning_patterns' IS NOT NULL
            ORDER BY date DESC LIMIT 1
            """
        )
        if row and row["patterns"]:
            val = row["patterns"]
            if isinstance(val, str):
                return json.loads(val)
            return val
        return None
    finally:
        await conn.close()


async def get_recent_own_tweets(db_url: str, limit: int = 10) -> list[str]:
    """Load recent tweets by the user for voice consistency.

    Uses replied tweets (from echo.replies) as a proxy for the user's own voice.
    Falls back to an empty list if none exist.
    """
    conn = await asyncpg.connect(db_url)
    try:
        rows = await conn.fetch(
            """
            SELECT reply_text FROM echo.replies
            ORDER BY posted_at DESC NULLS LAST
            LIMIT $1
            """,
            limit,
        )
        return [row["reply_text"] for row in rows]
    finally:
        await conn.close()


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

    client = anthropic.AsyncAnthropic()
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


async def store_replies(
    db_url: str, tweet_id: str, replies: list[GeneratedReply]
) -> None:
    """Persist generated replies to echo.replies."""
    conn = await asyncpg.connect(db_url)
    try:
        await conn.executemany(
            """
            INSERT INTO echo.replies (tweet_id, reply_text, strategy, original_text)
            VALUES ($1, $2, $3, $4)
            """,
            [(tweet_id, r.text, r.strategy, None) for r in replies],
        )
    finally:
        await conn.close()


async def generate_replies(
    tweet_id: str, db_url: str | None = None
) -> list[GeneratedReply]:
    """Generate 5 strategy-diverse replies for a candidate tweet.

    This is the main entry point for the Compose Agent.
    """
    url = db_url or DATABASE_URL

    # 1. Load tweet
    tweet = await get_tweet(url, tweet_id)

    # 2. Enrich author (cache-first)
    brief = await get_author_brief(url, tweet.author_handle)

    # 3. Load active voice profile
    profile = await get_active_voice_profile(url)

    # 4. Load recent winning patterns (from Evolve)
    patterns = await get_winning_patterns(url)

    # 5. Load recent own tweets for voice consistency
    recent_own = await get_recent_own_tweets(url)

    # 6. Load strategy weights and determine ordering
    weights = await get_strategy_weights(url)
    strategy_order = order_strategies_by_weight(weights)

    # 7. Generate via Claude
    replies = await call_compose_llm(
        tweet, brief, profile, strategy_order, recent_own, patterns
    )

    # 8. Validate
    replies = validate_replies(replies)

    # 9. Persist
    await store_replies(url, tweet_id, replies)

    return replies
