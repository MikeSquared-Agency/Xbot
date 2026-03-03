from datetime import datetime, timezone

from echo.scorer.author import score_author
from echo.scorer.content import score_content
from echo.scorer.momentum import score_momentum
from echo.scorer.recency import recency_decay
from echo.scorer.weights import get_active_weights


def get_tier(score: float) -> str:
    """Map a virality score to a priority tier."""
    if score >= 70:
        return "red"
    elif score >= 50:
        return "yellow"
    elif score >= 30:
        return "green"
    else:
        return "discard"


async def score_single_tweet(
    tweet: dict,
    metric_snapshots: list[dict],
    author: dict | None,
    weights: dict,
    niche_embedding: list[float] | None = None,
) -> dict:
    """Score a single tweet and return the score breakdown."""
    now = datetime.now(timezone.utc)

    author_s = score_author(tweet, author, weights)
    content_s = score_content(tweet, niche_embedding, weights)
    momentum_s = score_momentum(tweet, metric_snapshots, weights)

    raw_score = (
        author_s * weights.get("author_weight", 0.30)
        + content_s * weights.get("content_weight", 0.40)
        + momentum_s * weights.get("momentum_weight", 0.30)
    )

    # Watchlist bonus
    if tweet.get("source") == "watchlist":
        raw_score += weights.get("watchlist_bonus", 15)

    # Recency decay
    tweet_created = tweet.get("tweet_created_at")
    if tweet_created:
        if isinstance(tweet_created, str):
            tweet_created = datetime.fromisoformat(tweet_created)
        age_minutes = (now - tweet_created).total_seconds() / 60
    else:
        age_minutes = 0

    half_life = weights.get("recency_half_life_minutes", 120)
    multiplier = recency_decay(age_minutes, half_life)
    final_score = min(raw_score * multiplier, 100)

    return {
        "virality_score": round(final_score, 2),
        "author_score": round(author_s, 2),
        "content_score": round(content_s, 2),
        "momentum_score": round(momentum_s, 2),
        "recency_multiplier": round(multiplier, 4),
        "tier": get_tier(final_score),
    }


async def score_tweets(niche_embedding: list[float] | None = None) -> int:
    """Score all queued tweets. Called after each Scout poll cycle.

    Returns the number of tweets scored.
    """
    from echo.db.store import get_global_store

    store = get_global_store()
    weights = await get_active_weights()
    tweets = await store.get_queued_tweets_with_metrics()

    # Cache authors to avoid repeated lookups within a batch
    author_cache: dict[str, dict | None] = {}

    scored = 0
    for tweet in tweets:
        handle = tweet.get("author_handle", "")
        if handle not in author_cache:
            author_cache[handle] = await store.get_author(handle)

        author = author_cache[handle]
        metric_snapshots = tweet.get("_metric_snapshots", [])

        result = await score_single_tweet(
            tweet, metric_snapshots, author, weights, niche_embedding
        )

        # Determine new status
        new_status = "expired" if result["tier"] == "discard" else tweet.get("status", "queued")
        result["status"] = new_status

        tweet_id = tweet.get("tweet_id", "")
        await store.update_tweet_scores(tweet_id, result)
        scored += 1

    return scored
