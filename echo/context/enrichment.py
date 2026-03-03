from __future__ import annotations

from datetime import datetime, timezone

from echo.context.brief_generator import generate_brief
from echo.context.cache import needs_refresh
from echo.context.engagement import compute_avg_engagement, compute_posting_frequency


async def enrich_author(handle: str, xbot_call=None) -> str:
    """Get or create enrichment for an author.

    Args:
        handle: The X/Twitter handle (without @).
        xbot_call: Async callable matching xbot.call(tool_name, params) -> result.

    Returns:
        The enrichment brief string.
    """
    from echo.db.store import get_global_store

    store = get_global_store()

    # 1. Check cache
    author = await store.get_author(handle)
    if author and not needs_refresh(author):
        return author.get("enrichment_brief", "")

    if xbot_call is None:
        # If no xbot_call provided, return whatever we have
        if author and author.get("enrichment_brief"):
            return author["enrichment_brief"]
        return f"@{handle} (no enrichment data available)"

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

    # 7. Upsert to Cortex
    now = datetime.now(timezone.utc).isoformat()
    await store.upsert_author({
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
