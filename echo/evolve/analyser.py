"""Phase 2: Compute engagement stats and label top/poor performers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from echo.evolve.collector import PostRecord, ReplyRecord


# X algorithm weights (from open-sourced recommendation code).
# Replies that spark conversation are 13.5x a like; reposts 20x.
# Bookmarks ~10x (estimated). Likes are baseline 1x.
W_REPLY = 13.5
W_REPOST = 20.0
W_BOOKMARK = 10.0
W_LIKE = 1.0


def engagement_score(r: ReplyRecord) -> float:
    """Weighted engagement score normalised per 1000 impressions.

    Uses X's actual algorithm weights: replies 13.5x, reposts 20x,
    bookmarks 10x, likes 1x baseline.
    """
    return (
        r.likes * W_LIKE
        + r.retweets * W_REPOST
        + r.bookmarks * W_BOOKMARK
        + r.replies_count * W_REPLY
    ) / max(r.impressions, 1) * 1000


def post_engagement_score(p: PostRecord) -> float:
    """Weighted engagement score for original posts, per 1000 impressions."""
    return (
        p.likes * W_LIKE
        + p.retweets * W_REPOST
        + p.bookmarks * W_BOOKMARK
    ) / max(p.impressions, 1) * 1000


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


@dataclass
class PostAnalysisResult:
    total_posts: int
    top_posts: list[PostRecord]
    poor_posts: list[PostRecord]
    avg_engagement_score: float
    date: date


def impact_score(r: ReplyRecord) -> float:
    """Absolute engagement impact (not rate-based). Used for ranking top performers."""
    return (
        r.likes * W_LIKE
        + r.retweets * W_REPOST
        + r.bookmarks * W_BOOKMARK
        + r.replies_count * W_REPLY
    )


# Minimum impressions to be eligible for top/poor performer lists.
# Below this threshold, engagement rates are statistically meaningless.
MIN_IMPRESSIONS_FOR_RANKING = 100


def analyse(replies: list[ReplyRecord]) -> AnalysisResult:
    """Analyse reply window: label top/poor performers, compute strategy win rates."""
    # Score every reply
    scored = [(r, engagement_score(r)) for r in replies]
    scores = [s for _, s in scored]

    # Percentile thresholds (computed on all replies for strategy stats)
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

        # Only add to top/poor lists if above impression floor
        if reply.impressions >= MIN_IMPRESSIONS_FOR_RANKING:
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

    # Sort top performers by absolute impact (not rate) so the best
    # replies surface first regardless of impression count
    top_performers.sort(key=impact_score, reverse=True)

    avg_score = sum(scores) / max(len(scores), 1)

    return AnalysisResult(
        total_replies=len(replies),
        strategy_stats=strategy_map,
        top_performers=top_performers,
        poor_performers=poor_performers,
        avg_engagement_score=avg_score,
        date=date.today(),
    )


def analyse_posts(posts: list[PostRecord]) -> PostAnalysisResult:
    """Analyse original posts: label top/poor by engagement score."""
    if not posts:
        return PostAnalysisResult(
            total_posts=0,
            top_posts=[],
            poor_posts=[],
            avg_engagement_score=0.0,
            date=date.today(),
        )

    scored = [(p, post_engagement_score(p)) for p in posts]
    scores = [s for _, s in scored]

    sorted_scores = sorted(scores)
    n = len(sorted_scores)
    p20 = sorted_scores[int(n * 0.2)] if n >= 3 else 0.0
    p80 = sorted_scores[int(n * 0.8)] if n >= 3 else float("inf")

    top_posts: list[PostRecord] = []
    poor_posts: list[PostRecord] = []

    for post, score in scored:
        if score >= p80:
            top_posts.append(post)
        elif score <= p20:
            poor_posts.append(post)

    avg_score = sum(scores) / max(len(scores), 1)

    return PostAnalysisResult(
        total_posts=len(posts),
        top_posts=top_posts,
        poor_posts=poor_posts,
        avg_engagement_score=avg_score,
        date=date.today(),
    )
