"""Daily follower count snapshots for delta tracking.

Scrapes the authenticated user's follower count once per day and stores
the count plus the day-over-day delta.
"""

from __future__ import annotations

from datetime import date

import asyncpg
from rich.console import Console

console = Console()

UPSERT_SNAPSHOT = """
    INSERT INTO echo.follower_snapshots (date, follower_count, delta)
    VALUES ($1, $2, $3)
    ON CONFLICT (date) DO UPDATE SET
        follower_count = EXCLUDED.follower_count,
        delta = EXCLUDED.delta
"""

YESTERDAY_COUNT = """
    SELECT follower_count FROM echo.follower_snapshots
    WHERE date = CURRENT_DATE - 1
"""


async def snapshot_follower_count(
    conn: asyncpg.Connection,
    xbot_call,
    handle: str,
) -> dict:
    """Scrape and store today's follower count.

    Args:
        conn: Active asyncpg connection.
        xbot_call: Async callable matching ``xbot.call(tool_name, args)``.
        handle: The X profile handle to look up.

    Returns:
        Dict with ``follower_count`` and ``delta``.
    """
    profile = await xbot_call(
        "x:get-author-profile",
        {"handle": handle},
    )

    follower_count = profile.get("followers", 0)

    yesterday = await conn.fetchrow(YESTERDAY_COUNT)
    previous = yesterday["follower_count"] if yesterday else follower_count
    delta = follower_count - previous

    today = date.today()
    await conn.execute(UPSERT_SNAPSHOT, today, follower_count, delta)

    console.print(
        f"[dim]Followers: {follower_count:,} (Δ {delta:+,})[/]"
    )

    return {"follower_count": follower_count, "delta": delta}
