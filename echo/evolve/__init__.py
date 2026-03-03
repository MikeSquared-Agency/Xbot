"""Echo Evolve — self-improving loop that runs nightly.

Collects reply metrics, analyses performance, generates a digest of
winning patterns via Claude, and updates strategy weights + voice profile.
"""

from __future__ import annotations

from rich.console import Console

from echo.evolve.analyser import analyse
from echo.evolve.collector import collect_reply_window
from echo.evolve.digest import generate_digest
from echo.evolve.store import store_digest
from echo.evolve.voice_evolver import get_thirty_day_avg, maybe_evolve_voice
from echo.evolve.weight_updater import update_strategy_weights

console = Console()


async def run_daily() -> None:
    """Main evolve entrypoint called by Orchestrator.daily_evolve_scheduler()."""
    from echo.db.store import get_global_store

    store = get_global_store()

    # Phase 1: Collect
    console.print("[cyan]Evolve: collecting reply metrics...[/]")
    replies = await collect_reply_window(store)
    if len(replies) < 5:
        console.print(
            f"[yellow]Evolve: insufficient data ({len(replies)} replies), skipping[/]"
        )
        return

    # Phase 2: Analyse
    console.print(f"[cyan]Evolve: analysing {len(replies)} replies...[/]")
    analysis = analyse(replies)

    # Phase 3: Digest via Claude
    digest = None
    try:
        console.print("[cyan]Evolve: generating digest with Claude...[/]")
        digest = await generate_digest(analysis)
    except Exception as exc:
        console.print(f"[yellow]Evolve: digest generation failed ({exc}), continuing with raw stats[/]")

    # Phase 4a: Update strategy weights (always runs, even if digest failed)
    console.print("[cyan]Evolve: updating strategy weights...[/]")
    await update_strategy_weights(store, analysis.strategy_stats)

    # Phase 4b: Maybe evolve voice profile
    try:
        thirty_day_avg = await get_thirty_day_avg(store)
        evolved = await maybe_evolve_voice(store, analysis, thirty_day_avg)
        if evolved:
            console.print("[green]Evolve: voice profile updated[/]")
    except Exception as exc:
        console.print(f"[yellow]Evolve: voice evolution skipped ({exc})[/]")

    # Phase 5: Store digest (only if digest was generated)
    if digest:
        await store_digest(store, analysis, digest)

    console.print(
        f"[green]Evolve complete: {analysis.total_replies} replies, "
        f"avg score {analysis.avg_engagement_score:.2f}[/]"
    )
