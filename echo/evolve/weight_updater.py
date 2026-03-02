"""Phase 4a: Update strategy win rates in echo.strategy_scores."""

from __future__ import annotations

from datetime import date

import asyncpg

from echo.evolve.analyser import StrategyStats


async def update_strategy_weights(
    conn: asyncpg.Connection,
    strategy_stats: dict[str, StrategyStats],
) -> None:
    """Upsert today's strategy win rates into echo.strategy_scores."""
    today = date.today()
    for strategy_name, stats in strategy_stats.items():
        await conn.execute(
            """
            INSERT INTO echo.strategy_scores
                (date, strategy, total_replies, wins, rolling_7d_win_rate)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (date, strategy) DO UPDATE SET
                total_replies = EXCLUDED.total_replies,
                wins = EXCLUDED.wins,
                rolling_7d_win_rate = EXCLUDED.rolling_7d_win_rate
            """,
            today,
            strategy_name,
            stats.total,
            stats.wins,
            stats.win_rate,
        )
