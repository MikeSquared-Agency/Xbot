"""Strategy definitions and weight loading for reply generation."""

from __future__ import annotations

from dataclasses import dataclass


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


async def get_strategy_weights() -> dict[str, float]:
    """Get current strategy win rates for ordering.

    Falls back to equal weights if no scores exist yet.
    """
    try:
        from echo.db.store import get_global_store

        store = get_global_store()
        scores = await store.get_latest_strategy_scores()
        if scores:
            return scores
    except Exception:
        pass
    return dict(DEFAULT_WEIGHTS)


def order_strategies_by_weight(weights: dict[str, float]) -> list[str]:
    """Return strategy names ordered by win rate, highest first."""
    all_strategies = list(STRATEGIES.keys())
    return sorted(all_strategies, key=lambda s: weights.get(s, 0.0), reverse=True)
