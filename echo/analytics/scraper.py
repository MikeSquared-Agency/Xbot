"""Mode A: Automated metric scraping via Xbot MCP tools.

Piggybacks on the existing poll cycle to scrape metrics for posted replies
at T+1h, T+6h, and T+24h windows.
"""

from __future__ import annotations

from rich.console import Console

console = Console()


async def scrape_reply_metrics(
    store,
    xbot_call,
) -> int:
    """Scrape metrics for posted replies at T+1h, T+6h, T+24h.

    Args:
        store: EchoStore instance.
        xbot_call: Async callable matching ``xbot.call(tool_name, args)``
            — expected to return a dict with metric keys.

    Returns:
        Number of replies successfully scraped.
    """
    replies = await store.get_replies_due_for_scrape(limit=10)

    if not replies:
        return 0

    scraped = 0
    for reply in replies:
        try:
            metrics = await xbot_call(
                "x:get-reply-metrics",
                {"reply_url": reply.get("reply_url", "")},
            )

            impressions = metrics.get("impressions", 0)
            likes = metrics.get("likes", 0)
            retweets = metrics.get("retweets", 0)
            replies_count = metrics.get("replies", 0)
            bookmarks = metrics.get("bookmarks", 0)
            profile_clicks = metrics.get("profile_clicks", 0)

            await store.update_reply_metrics(
                reply["_node_id"],
                {
                    "impressions": impressions,
                    "likes": likes,
                    "retweets": retweets,
                    "replies_count": replies_count,
                    "bookmarks": bookmarks,
                    "profile_clicks": profile_clicks,
                },
            )

            scraped += 1
        except Exception as e:
            console.print(
                f"[dim red]Failed to scrape metrics for {reply.get('reply_id', '?')}: {e}[/]"
            )

    return scraped
