from __future__ import annotations

import os
from datetime import datetime, timezone

import asyncpg

from echo.context.brief_generator import generate_brief
from echo.context.cache import needs_refresh
from echo.context.engagement import compute_avg_engagement, compute_posting_frequency

DATABASE_URL = os.environ.get("DATABASE_URL", "")


async def _get_author(conn: asyncpg.Connection, handle: str) -> dict | None:
    row = await conn.fetchrow(
        "SELECT * FROM echo.authors WHERE handle = $1", handle
    )
    return dict(row) if row else None


async def _upsert_author(conn: asyncpg.Connection, data: dict) -> None:
    await conn.execute(
        """
        INSERT INTO echo.authors (
            handle, display_name, bio, followers, following, verified,
            website, join_date, avg_engagement_rate, posting_frequency,
            enrichment_brief, enrichment_updated, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (handle) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            bio = EXCLUDED.bio,
            followers = EXCLUDED.followers,
            following = EXCLUDED.following,
            verified = EXCLUDED.verified,
            website = EXCLUDED.website,
            join_date = EXCLUDED.join_date,
            avg_engagement_rate = EXCLUDED.avg_engagement_rate,
            posting_frequency = EXCLUDED.posting_frequency,
            enrichment_brief = EXCLUDED.enrichment_brief,
            enrichment_updated = EXCLUDED.enrichment_updated,
            updated_at = EXCLUDED.updated_at
        """,
        data["handle"],
        data.get("display_name"),
        data.get("bio"),
        data.get("followers", 0),
        data.get("following", 0),
        data.get("verified", False),
        data.get("website"),
        data.get("join_date"),
        data.get("avg_engagement_rate", 0.0),
        data.get("posting_frequency", 0.0),
        data.get("enrichment_brief"),
        data.get("enrichment_updated"),
        data.get("updated_at"),
    )


async def enrich_author(handle: str, xbot_call) -> str:
    """Get or create enrichment for an author.

    Args:
        handle: The X/Twitter handle (without @).
        xbot_call: Async callable matching xbot.call(tool_name, params) -> result.

    Returns:
        The enrichment brief string.
    """
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # 1. Check cache
        author = await _get_author(conn, handle)
        if author and not needs_refresh(author):
            return author["enrichment_brief"]

        # 2. Scrape profile
        profile = await xbot_call("x:get-author-profile", {"handle": handle})

        # 3. Scrape recent tweets
        recent_tweets = await xbot_call(
            "x:get-author-timeline", {"handle": handle, "count": 5}
        )

        # 4. Interaction history from existing record
        interaction = None
        if author and author.get("times_replied_to", 0) > 0:
            interaction = {
                "times_replied_to": author["times_replied_to"],
                "last_replied_at": author.get("last_replied_at"),
            }

        # 5. Generate enrichment brief via Claude Sonnet
        brief = await generate_brief(profile, recent_tweets, interaction)

        # 6. Compute engagement metrics
        avg_engagement = compute_avg_engagement(
            recent_tweets, profile.get("followers", 0)
        )
        posting_freq = compute_posting_frequency(recent_tweets)

        # 7. Upsert to echo.authors
        now = datetime.now(timezone.utc)
        await _upsert_author(conn, {
            "handle": handle,
            "display_name": profile.get("display_name"),
            "bio": profile.get("bio"),
            "followers": profile.get("followers", 0),
            "following": profile.get("following", 0),
            "verified": profile.get("verified", False),
            "website": profile.get("website"),
            "join_date": profile.get("join_date"),
            "avg_engagement_rate": avg_engagement,
            "posting_frequency": posting_freq,
            "enrichment_brief": brief,
            "enrichment_updated": now,
            "updated_at": now,
        })

        return brief
    finally:
        await conn.close()
