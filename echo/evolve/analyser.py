"""Phase 2: Compute engagement stats and label top/poor performers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from echo.evolve.collector import ReplyRecord


def engagement_score(r: ReplyRecord) -> float:
    """Weighted engagement score normalised per 1000 impressions."""
    return (
        r.likes * 1.0
        + r.retweets * 2.5
        + r.bookmarks * 2.0
        + r.profile_clicks * 3.0
    ) / max(r.impressions, 1) * 1000


@dataclass
class StrategyStats:
    total: int = 0
    wins: int = 0
    win_rate: float = 0.0
    avg_score: float = 0.0
    scores: list[float] = field(default_factory=list)


@dataclass
class AnalysisResult:
    total_replies: int
    strategy_stats: dict[str, StrategyStats]
    top_performers: list[ReplyRecord]
    poor_performers: list[ReplyRecord]
    avg_engagement_score: float
    date: date


def analyse(replies: list[ReplyRecord]) -> AnalysisResult:
    """Analyse reply window: label top/poor performers, compute strategy win rates."""
    # Score every reply
    scored = [(r, engagement_score(r)) for r in replies]
    scores = [s for _, s in scored]

    # Percentile thresholds
    sorted_scores = sorted(scores)
    n = len(sorted_scores)
    p20 = sorted_scores[int(n * 0.2)] if n >= 5 else 0.0
    p80 = sorted_scores[int(n * 0.8)] if n >= 5 else float("inf")

    top_performers: list[ReplyRecord] = []
    poor_performers: list[ReplyRecord] = []

    # Per-strategy accumulators
    strategy_map: dict[str, StrategyStats] = {}

    for reply, score in scored:
        is_top = score >= p80
        is_poor = score <= p20

        if is_top:
            top_performers.append(reply)
        elif is_poor:
            poor_performers.append(reply)

        # Accumulate strategy stats
        strat = reply.strategy or "unknown"
        if strat not in strategy_map:
            strategy_map[strat] = StrategyStats()
        stats = strategy_map[strat]
        stats.total += 1
        stats.scores.append(score)
        if is_top:
            stats.wins += 1

    # Compute per-strategy averages and win rates
    for stats in strategy_map.values():
        stats.win_rate = stats.wins / max(stats.total, 1)
        stats.avg_score = sum(stats.scores) / max(len(stats.scores), 1)

    avg_score = sum(scores) / max(len(scores), 1)

    return AnalysisResult(
        total_replies=len(replies),
        strategy_stats=strategy_map,
        top_performers=top_performers,
        poor_performers=poor_performers,
        avg_engagement_score=avg_score,
        date=date.today(),
    )
