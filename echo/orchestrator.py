"""Echo Orchestrator — main process that ties everything together.

Handles startup (session auth, config load), runs the 10-minute
Scout → Score → Compose poll loop, feeds candidates through
Context → Compose → CLI, and schedules the daily Evolve run.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from rich.console import Console

from echo.xbot_process import XbotProcess

console = Console()

# Default local config path (fallback when Cortex config unavailable)
LOCAL_CONFIG_PATH = Path(__file__).parent.parent / "echo_config.json"


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

async def load_config(store) -> dict[str, Any]:
    """Load config from Cortex, falling back to local JSON."""
    try:
        config = await store.get_config()
        if config:
            console.print("[green]✓ Config loaded from Cortex[/]")
            return config
    except Exception:
        pass

    # Fallback: local JSON
    if LOCAL_CONFIG_PATH.exists():
        config = json.loads(LOCAL_CONFIG_PATH.read_text())
        console.print("[yellow]⚠ Config loaded from local file[/]")
        # Persist to Cortex for next time
        try:
            await store.save_config(config)
        except Exception:
            pass
        return config

    console.print("[yellow]⚠ No config found — using defaults[/]")
    return _default_config()


def _default_config() -> dict[str, Any]:
    return {
        "cortex_url": os.environ.get("CORTEX_HTTP", "http://localhost:9091"),
        "xbot_path": os.environ.get(
            "XBOT_PATH",
            str(Path(__file__).parent.parent / "xbot-browser"),
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

    # 1. Connect to Cortex
    from echo.db.store import EchoStore, set_global_store

    store = await EchoStore.connect()
    set_global_store(store)
    console.print("[green]✓ Cortex connected[/]")

    # 2. Load config
    config = await load_config(store)

    # 3. Start Xbot MCP server (subprocess)
    xbot_path = config.get("xbot_path", str(Path(__file__).parent.parent / "xbot-browser"))
    xbot = await XbotProcess.start(xbot_path)
    console.print("[green]✓ Xbot MCP server started[/]")

    # 4. Check X session
    session_result = await xbot.call("x:check-session", {})
    if not session_result.authenticated:
        console.print("[bold yellow]⚠ X session expired. Browser opening for login...[/]")
        # x:check-session already navigated to x.com, opening the browser.
        # Navigate to login page so the user can authenticate.
        await xbot.call("browser_navigate", {"url": "https://x.com/i/flow/login"})
        console.print("[dim]Log in to X in the browser, then press Enter here...[/dim]")
        await asyncio.get_event_loop().run_in_executor(None, input)
        console.print("[green]✓ Session saved[/]")
    else:
        console.print("[green]✓ X session active[/]")

    # 5. Verify voice profile exists
    from echo import voice

    profile = await voice.get_active_profile()
    if not profile:
        try:
            console.print("[yellow]No voice profile found. Running bootstrap...[/]")
            await voice.bootstrap_voice_profile()
            console.print("[green]✓ Voice profile v1 created[/]")
        except Exception as exc:
            console.print(f"[red]Voice bootstrap failed (non-fatal): {exc}[/]")
            console.print("[dim]You can retry later with: python -m echo.voice.bootstrap[/]")

    # 6. Load model weights
    from echo import scorer

    weights = await scorer.load_weights()
    if not weights:
        await scorer.seed_default_weights()
        console.print("[green]✓ Default scoring weights seeded[/]")

    # 7. Build CLI (runs concurrently)
    from echo.cli import EchoCLI

    cli = EchoCLI(store, xbot=xbot)

    return Orchestrator(config, store, xbot, cli)


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
        store: Any,
        xbot: XbotProcess,
        cli: Any,
    ) -> None:
        self.config = config
        self.store = store
        self.xbot = xbot
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
        from echo import scorer, context as context_agent, compose

        # 1. Score — score all queued tweets
        await scorer.score_tweets()

        # 3. Expire stale tweets
        await self.expire_stale_tweets()

        # 4. Compose — generate replies for top unprocessed candidates
        threshold = self.config.get("virality_threshold", 30)
        limit = self.config.get("max_candidates_per_cycle", 5)

        top_candidates = await self.store.get_top_candidates(threshold, limit)

        for candidate in top_candidates:
            tweet_id = candidate.get("tweet_id", "")

            # Skip if already has generated replies
            count = await self.store.count_replies_for_tweet(tweet_id)
            if count > 0:
                continue

            # Context enrich
            author = candidate.get("author_handle", "")
            await context_agent.enrich_author(author)

            # Compose replies
            await compose.generate_replies(tweet_id)

    async def expire_stale_tweets(self) -> None:
        """Mark tweets older than the configured expiry window as expired."""
        hours = self.config.get("tweet_expiry_hours", 4)
        await self.store.expire_stale_tweets(hours)

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
                    await self.xbot.call("browser_navigate", {"url": "https://x.com/i/flow/login"})
                    await asyncio.get_event_loop().run_in_executor(
                        None, input, "Press Enter after logging in..."
                    )
                    console.print("[green]✓ Session re-authenticated[/]")
            except Exception:
                pass  # Non-critical, will catch on next check

    # ------------------------------------------------------------------
    # Daily Evolve scheduler
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Analytics pull
    # ------------------------------------------------------------------

    async def pull_analytics(self) -> dict | None:
        """Pull X Analytics CSV via xbot and import metrics into Cortex."""
        from echo.analytics import import_csv_text

        try:
            result = await self.xbot.call("x:pull-analytics", {"days": 1})

            # Extract CSV text from MCP response
            csv_text = None
            if hasattr(result, "content"):
                for item in result.content:
                    if getattr(item, "type", None) == "text":
                        csv_text = item.text
                        break
            elif isinstance(result, dict) and result.get("content"):
                for item in result["content"]:
                    if item.get("type") == "text":
                        csv_text = item.get("text")
                        break

            if not csv_text:
                console.print("[yellow]⚠ No CSV data returned from x:pull-analytics[/]")
                return None

            stats = await import_csv_text(self.store, csv_text)
            console.print(
                f"[green]✓ Analytics imported: "
                f"{stats['matched']} reply updates, "
                f"{stats.get('stored', 0)} posts stored, "
                f"{stats.get('skipped', 0)} unchanged, "
                f"{stats['total']} total[/]"
            )
            return stats
        except Exception as exc:
            console.print(f"[red]Analytics pull error: {exc}[/]")
            return None

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

                # Pull fresh analytics after evolve
                await self.pull_analytics()
            except Exception as exc:
                console.print(f"[red]Evolve error: {exc}[/]")

    # ------------------------------------------------------------------
    # Graceful shutdown
    # ------------------------------------------------------------------

    async def cleanup(self) -> None:
        """Clean shutdown: revert presented tweets, stop subprocesses."""
        try:
            await self.store.revert_presented_tweets()
        except Exception:
            pass

        await self.xbot.stop()

        try:
            await self.store.close()
        except Exception:
            pass

        console.print("[dim]Echo shut down cleanly.[/]")
