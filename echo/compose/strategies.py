"""Strategy definitions and weight loading for reply generation."""

from __future__ import annotations

from dataclasses import dataclass

import asyncpg


@dataclass(frozen=True)
class Strategy:
    name: str
    icon: str
    description: str
    best_when: str


STRATEGIES: dict[str, Strategy] = {
    "contrarian": Strategy(
        name="contrarian",
        icon="\U0001f525",
        description="Disagree with a specific, reasoned counter-take",
        best_when="When the original tweet makes a strong claim",
    ),
    "experience": Strategy(
        name="experience",
        icon="\U0001f6e0\ufe0f",
        description='"We built X and found..." — personal experience',
        best_when="When the topic overlaps with your work",
    ),
    "additive": Strategy(
        name="additive",
        icon="\u2795",
        description="Build on their point with a missing piece",
        best_when="When the tweet is good but incomplete",
    ),
    "question": Strategy(
        name="question",
        icon="\u2753",
        description="Ask a specific, thought-provoking question",
        best_when="When the tweet opens a bigger discussion",
    ),
    "pattern_interrupt": Strategy(
        name="pattern_interrupt",
        icon="\U0001f3af",
        description="Unexpected reframing or analogy",
        best_when="When you can connect it to something non-obvious",
    ),
}

DEFAULT_WEIGHTS: dict[str, float] = {name: 0.20 for name in STRATEGIES}


async def get_strategy_weights(db_url: str) -> dict[str, float]:
    """Get current strategy win rates for ordering.

    Falls back to equal weights if no scores exist yet.
    """
    conn = await asyncpg.connect(db_url)
    try:
        rows = await conn.fetch(
            """
            SELECT strategy, rolling_7d_win_rate
            FROM echo.strategy_scores
            WHERE date = (SELECT MAX(date) FROM echo.strategy_scores)
            """
        )
        if not rows:
            return dict(DEFAULT_WEIGHTS)
        return {row["strategy"]: row["rolling_7d_win_rate"] for row in rows}
    finally:
        await conn.close()


def order_strategies_by_weight(weights: dict[str, float]) -> list[str]:
    """Return strategy names ordered by win rate, highest first."""
    all_strategies = list(STRATEGIES.keys())
    return sorted(all_strategies, key=lambda s: weights.get(s, 0.0), reverse=True)
