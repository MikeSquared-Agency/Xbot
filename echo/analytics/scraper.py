"""Mode A: Automated metric scraping via Xbot MCP tools.

Piggybacks on the existing poll cycle to scrape metrics for posted replies
at T+1h, T+6h, and T+24h windows.
"""

from __future__ import annotations

import asyncpg
from rich.console import Console

console = Console()

# SQL to find replies that are due for metric collection at the three windows.
REPLIES_DUE_QUERY = """
    SELECT r.reply_id, r.reply_url, r.posted_at, r.metrics_updated_at
    FROM echo.replies r
    WHERE r.posted_at IS NOT NULL
      AND r.reply_url IS NOT NULL
      AND (
        -- Never scraped yet and >1hr old  (T+1h window)
        (r.metrics_updated_at IS NULL
         AND r.posted_at < NOW() - INTERVAL '1 hour')
        OR
        -- Last scraped >5hrs ago and posted <24hrs ago  (T+6h window)
        (r.metrics_updated_at < NOW() - INTERVAL '5 hours'
         AND r.posted_at > NOW() - INTERVAL '24 hours')
        OR
        -- Last scraped >20hrs ago and posted <48hrs ago  (T+24h window)
        (r.metrics_updated_at < NOW() - INTERVAL '20 hours'
         AND r.posted_at > NOW() - INTERVAL '48 hours')
      )
    ORDER BY r.posted_at DESC
    LIMIT 10
"""

INSERT_METRIC_SNAPSHOT = """
    INSERT INTO echo.reply_metrics
        (reply_id, impressions, likes, retweets, replies, bookmarks, profile_clicks)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
"""

UPDATE_REPLY_LATEST = """
    UPDATE echo.replies SET
        impressions      = $1,
        likes            = $2,
        retweets         = $3,
        replies_count    = $4,
        bookmarks        = $5,
        profile_clicks   = $6,
        metrics_updated_at = NOW()
    WHERE reply_id = $7
"""


async def scrape_reply_metrics(
    conn: asyncpg.Connection,
    xbot_call,
) -> int:
    """Scrape metrics for posted replies at T+1h, T+6h, T+24h.

    Args:
        conn: Active asyncpg connection.
        xbot_call: Async callable matching ``xbot.call(tool_name, args)``
            — expected to return a dict with metric keys.

    Returns:
        Number of replies successfully scraped.
    """
    replies = await conn.fetch(REPLIES_DUE_QUERY)

    if not replies:
        return 0

    scraped = 0
    for reply in replies:
        try:
            metrics = await xbot_call(
                "x:get-reply-metrics",
                {"reply_url": reply["reply_url"]},
            )

            impressions = metrics.get("impressions", 0)
            likes = metrics.get("likes", 0)
            retweets = metrics.get("retweets", 0)
            replies_count = metrics.get("replies", 0)
            bookmarks = metrics.get("bookmarks", 0)
            profile_clicks = metrics.get("profile_clicks", 0)

            # Time-series snapshot
            await conn.execute(
                INSERT_METRIC_SNAPSHOT,
                reply["reply_id"],
                impressions,
                likes,
                retweets,
                replies_count,
                bookmarks,
                profile_clicks,
            )

            # Latest values on the reply row
            await conn.execute(
                UPDATE_REPLY_LATEST,
                impressions,
                likes,
                retweets,
                replies_count,
                bookmarks,
                profile_clicks,
                reply["reply_id"],
            )

            scraped += 1
        except Exception as e:
            console.print(
                f"[dim red]Failed to scrape metrics for {reply['reply_id']}: {e}[/]"
            )

    return scraped
