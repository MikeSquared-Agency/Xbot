from __future__ import annotations

from rich.console import Console

from echo.db.database import Database
from echo.cli.rendering import render_digest, render_history, render_status


async def handle_status(console: Console, db: Database) -> None:
    stats = await db.get_session_stats()
    render_status(console, stats)


async def handle_history(console: Console, db: Database) -> None:
    replies = await db.get_today_replies()
    render_history(console, replies)


async def handle_digest(console: Console, db: Database) -> None:
    digest = await db.get_latest_digest()
    render_digest(console, digest)
