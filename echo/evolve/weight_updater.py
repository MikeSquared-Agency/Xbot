"""Phase 4a: Update strategy win rates in Cortex."""

from __future__ import annotations

from datetime import date

from echo.evolve.analyser import StrategyStats


async def update_strategy_weights(
    store,
    strategy_stats: dict[str, StrategyStats],
) -> None:
    """Upsert today's strategy win rates."""
    today = date.today()
    for strategy_name, stats in strategy_stats.items():
        await store.upsert_strategy_score(
            today,
            strategy_name,
            stats.total,
            stats.wins,
            stats.win_rate,
        )
