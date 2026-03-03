"""Daily follower count snapshots for delta tracking.

Scrapes the authenticated user's follower count once per day and stores
the count plus the day-over-day delta.
"""

from __future__ import annotations

from datetime import date

from rich.console import Console

console = Console()


async def snapshot_follower_count(
    store,
    xbot_call,
    handle: str,
) -> dict:
    """Scrape and store today's follower count.

    Args:
        store: EchoStore instance.
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

    # For delta, we'd need to look at previous snapshot.
    # For now, store as a Cortex node and compute delta from previous.
    today = date.today().isoformat()
    previous_count = follower_count  # default if no previous

    # Try to find yesterday's snapshot
    nodes = await store.cortex.get_nodes(kind="follower_snapshot", limit=10)
    yesterday = (date.today().toordinal() - 1)
    for node in nodes:
        from echo.db.store import _parse_body
        data = _parse_body(node)
        if data.get("date") == date.fromordinal(yesterday).isoformat():
            previous_count = data.get("follower_count", follower_count)
            break

    delta = follower_count - previous_count

    # Upsert today's snapshot
    found = False
    for node in nodes:
        if node.get("title") == today:
            await store.cortex.update_node(
                node["id"],
                body={"date": today, "follower_count": follower_count, "delta": delta},
            )
            found = True
            break

    if not found:
        await store.cortex.create_node(
            kind="follower_snapshot",
            title=today,
            body={"date": today, "follower_count": follower_count, "delta": delta},
            tags=["follower-snapshot"],
        )

    console.print(
        f"[dim]Followers: {follower_count:,} (Δ {delta:+,})[/]"
    )

    return {"follower_count": follower_count, "delta": delta}
