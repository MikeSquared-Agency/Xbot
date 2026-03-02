"""Echo Orchestrator — main process that ties everything together.

Handles startup (session auth, config load), runs the 10-minute
Scout → Score → Compose poll loop, feeds candidates through
Context → Compose → CLI, and schedules the daily Evolve run.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from rich.console import Console

from echo.xbot_process import XbotProcess

console = Console()

# Default local config path (fallback when Supabase config unavailable)
LOCAL_CONFIG_PATH = Path(__file__).parent.parent / "echo_config.json"


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

async def load_config() -> dict[str, Any]:
    """Load config from Supabase, falling back to local JSON."""
    try:
        from echo.database import Database

        db_url = os.environ.get("DATABASE_URL", "")
        if db_url:
            db = await Database.connect(db_url)
            try:
                rows = await db.query(
                    "SELECT value FROM echo.config ORDER BY updated_at DESC LIMIT 1"
                )
                if rows:
                    console.print("[green]✓ Config loaded from Supabase[/]")
                    return json.loads(rows[0]["value"]) if isinstance(rows[0]["value"], str) else rows[0]["value"]
            finally:
                await db.close()
    except Exception:
        pass

    # Fallback: local JSON
    if LOCAL_CONFIG_PATH.exists():
        config = json.loads(LOCAL_CONFIG_PATH.read_text())
        console.print("[yellow]⚠ Config loaded from local file[/]")
        return config

    console.print("[yellow]⚠ No config found — using defaults[/]")
    return _default_config()


def _default_config() -> dict[str, Any]:
    return {
        "database_url": os.environ.get("DATABASE_URL", ""),
        "nats_url": os.environ.get("NATS_URL", "nats://localhost:4222"),
        "xbot_path": os.environ.get(
            "XBOT_PATH",
            str(Path(__file__).parent.parent / "ami-browser"),
        ),
        "poll_interval": 600,
        "evolve_hour": 23,
        "virality_threshold": 30,
        "max_candidates_per_cycle": 5,
        "tweet_expiry_hours": 4,
        "session_check_interval": 1800,
    }


# ---------------------------------------------------------------------------
# Startup sequence
# ---------------------------------------------------------------------------

async def startup() -> Orchestrator:
    """Run once on launch. Returns a fully-initialized Orchestrator."""

    # 1. Load config
    config = await load_config()

    # 2. Connect to Supabase / Postgres
    from echo.database import Database

    db = await Database.connect(config.get("database_url", os.environ.get("DATABASE_URL", "")))
    console.print("[green]✓ Database connected[/]")

    # 3. Start Xbot MCP server (subprocess)
    xbot_path = config.get("xbot_path", str(Path(__file__).parent.parent / "ami-browser"))
    xbot = await XbotProcess.start(xbot_path)
    console.print("[green]✓ Xbot MCP server started[/]")

    # 4. Check X session
    session_result = await xbot.call("x:check-session", {})
    if not session_result.authenticated:
        console.print("[bold yellow]⚠ X session expired. Browser opening for login...[/]")
        await xbot.call("browser:open", {"url": "https://x.com/login"})
        console.print("[dim]Log in to X in the browser, then press Enter here...[/dim]")
        await asyncio.get_event_loop().run_in_executor(None, input)
        await xbot.call("browser:save-session", {})
        console.print("[green]✓ Session saved[/]")
    else:
        console.print("[green]✓ X session active[/]")

    # 5. Verify voice profile exists
    from echo import voice

    profile = await voice.get_active_profile()
    if not profile:
        console.print("[yellow]No voice profile found. Running bootstrap...[/]")
        await voice.bootstrap_voice_profile()
        console.print("[green]✓ Voice profile v1 created[/]")

    # 6. Load model weights
    from echo import scorer

    weights = await scorer.load_weights()
    if not weights:
        await scorer.seed_default_weights()
        console.print("[green]✓ Default scoring weights seeded[/]")

    # 7. Connect to NATS (Hermes)
    nats = await _connect_nats(config.get("nats_url", "nats://localhost:4222"))

    # 8. Build CLI (runs concurrently)
    from echo.cli import EchoCLI

    cli = EchoCLI(db, nats, None)  # composer passed as None; orchestrator sets it

    return Orchestrator(config, db, xbot, nats, cli)


async def _connect_nats(url: str) -> Any:
    """Connect to NATS. Returns the client or None if unavailable."""
    try:
        import nats as nats_lib

        nc = await nats_lib.connect(url)
        console.print("[green]✓ NATS connected[/]")
        return nc
    except Exception as exc:
        console.print(f"[yellow]⚠ NATS unavailable ({exc}) — running without messaging[/]")
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_next_occurrence(target_hour: int) -> datetime:
    """Return the next datetime for the given hour (local time)."""
    now = datetime.now()
    target = now.replace(hour=target_hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class Orchestrator:
    """Main orchestration loop for Echo."""

    def __init__(
        self,
        config: dict[str, Any],
        db: Any,
        xbot: XbotProcess,
        nats: Any,
        cli: Any,
    ) -> None:
        self.config = config
        self.db = db
        self.xbot = xbot
        self.nats = nats
        self.cli = cli
        self.poll_interval: int = config.get("poll_interval", 600)

    # ------------------------------------------------------------------
    # Main entry
    # ------------------------------------------------------------------

    async def run(self) -> None:
        """Run poll loop, CLI, session health, and evolve scheduler concurrently."""
        await asyncio.gather(
            self.poll_loop(),
            self.cli.run(),
            self.session_health_loop(),
            self.daily_evolve_scheduler(),
        )

    # ------------------------------------------------------------------
    # Poll loop: Scout → Score → Compose
    # ------------------------------------------------------------------

    async def poll_loop(self) -> None:
        """Every N minutes: Scout → Score → expire → Compose for top candidates."""
        while True:
            try:
                await self.run_poll_cycle()
            except Exception as exc:
                console.print(f"[red]Poll cycle error: {exc}[/]")

            await asyncio.sleep(self.poll_interval)

    async def run_poll_cycle(self) -> None:
        """Single poll cycle."""
        from echo import scout, scorer, context as context_agent, compose

        # 1. Scout — discover new tweets
        new_count = await scout.poll_cycle()
        if new_count:
            console.print(f"[cyan]Scout found {new_count} new tweets[/]")

        # 2. Score — score all queued tweets
        await scorer.score_tweets()

        # 3. Expire stale tweets
        await self.expire_stale_tweets()

        # 4. Compose — generate replies for top unprocessed candidates
        threshold = self.config.get("virality_threshold", 30)
        limit = self.config.get("max_candidates_per_cycle", 5)

        top_candidates = await self.db.query(
            """
            SELECT * FROM echo.tweets
            WHERE status = 'queued'
              AND virality_score >= $1
              AND virality_score IS NOT NULL
            ORDER BY virality_score DESC
            LIMIT $2
            """,
            threshold,
            limit,
        )

        for candidate in top_candidates:
            tweet_id = candidate["tweet_id"] if isinstance(candidate, dict) else candidate.tweet_id

            # Skip if already has generated replies
            existing = await self.db.query(
                "SELECT COUNT(*) AS count FROM echo.replies WHERE tweet_id = $1",
                tweet_id,
            )
            count = existing[0]["count"] if existing else 0
            if count > 0:
                continue

            # Context enrich
            author = candidate["author_handle"] if isinstance(candidate, dict) else candidate.author_handle
            await context_agent.enrich_author(author)

            # Compose replies
            await compose.generate_replies(tweet_id)

    async def expire_stale_tweets(self) -> None:
        """Mark tweets older than the configured expiry window as expired."""
        hours = self.config.get("tweet_expiry_hours", 4)
        await self.db.execute(
            f"""
            UPDATE echo.tweets
            SET status = 'expired'
            WHERE status = 'queued'
              AND tweet_created_at < NOW() - INTERVAL '{hours} hours'
            """
        )

    # ------------------------------------------------------------------
    # Session health
    # ------------------------------------------------------------------

    async def session_health_loop(self) -> None:
        """Check X session periodically."""
        interval = self.config.get("session_check_interval", 1800)
        while True:
            await asyncio.sleep(interval)
            try:
                result = await self.xbot.call("x:check-session", {})
                if not result.authenticated:
                    console.print(
                        "\n[bold red]⚠ X session expired! "
                        "Please re-authenticate in the browser.[/]\n"
                    )
                    await self.xbot.call("browser:open", {"url": "https://x.com/login"})
                    await asyncio.get_event_loop().run_in_executor(
                        None, input, "Press Enter after logging in..."
                    )
                    await self.xbot.call("browser:save-session", {})
                    console.print("[green]✓ Session re-authenticated[/]")
            except Exception:
                pass  # Non-critical, will catch on next check

    # ------------------------------------------------------------------
    # Daily Evolve scheduler
    # ------------------------------------------------------------------

    async def daily_evolve_scheduler(self) -> None:
        """Run Evolve engine once per day at the configured hour."""
        from echo import evolve

        while True:
            target_hour = self.config.get("evolve_hour", 23)
            next_run = _get_next_occurrence(target_hour)
            wait_seconds = (next_run - datetime.now()).total_seconds()
            await asyncio.sleep(max(wait_seconds, 0))

            try:
                console.print("\n[cyan]Running daily Evolve cycle...[/]")
                await evolve.run_daily()
                console.print("[green]✓ Evolve cycle complete[/]\n")
            except Exception as exc:
                console.print(f"[red]Evolve error: {exc}[/]")

    # ------------------------------------------------------------------
    # Graceful shutdown
    # ------------------------------------------------------------------

    async def cleanup(self) -> None:
        """Clean shutdown: revert presented tweets, stop subprocesses."""
        try:
            await self.db.execute(
                """
                UPDATE echo.tweets SET status = 'queued'
                WHERE status = 'presented'
                """
            )
        except Exception:
            pass

        await self.xbot.stop()

        if self.nats is not None:
            try:
                await self.nats.close()
            except Exception:
                pass

        try:
            await self.db.close()
        except Exception:
            pass

        console.print("[dim]Echo shut down cleanly.[/]")
