from __future__ import annotations

from rich.console import Console

from echo.cli.rendering import render_digest, render_history, render_status


async def handle_status(console: Console, store) -> None:
    stats = await store.get_session_stats()
    render_status(console, stats)


async def handle_history(console: Console, store) -> None:
    replies = await store.get_today_replies()
    render_history(console, replies)


async def handle_digest(console: Console, store) -> None:
    digest = await store.get_latest_digest()
    render_digest(console, digest)
