from datetime import datetime, timezone


def score_momentum(tweet: dict, metric_snapshots: list[dict], weights: dict) -> float:
    """Momentum scoring from metric time-series snapshots.

    Signals:
        - Early velocity (engagement per minute)
        - Reply-to-like ratio
        - Quote tweet / retweet ratio
        - Bookmark count
    """
    score = 0.0
    now = datetime.now(timezone.utc)

    # Early velocity
    if len(metric_snapshots) >= 2:
        latest = metric_snapshots[-1]
        earliest = metric_snapshots[0]

        latest_at = latest["scraped_at"]
        earliest_at = earliest["scraped_at"]
        if isinstance(latest_at, str):
            latest_at = datetime.fromisoformat(latest_at)
        if isinstance(earliest_at, str):
            earliest_at = datetime.fromisoformat(earliest_at)

        time_delta_min = (latest_at - earliest_at).total_seconds() / 60

        if time_delta_min > 0:
            engagement_delta = (
                (latest.get("likes", 0) - earliest.get("likes", 0))
                + (latest.get("retweets", 0) - earliest.get("retweets", 0)) * 2
                + (latest.get("replies", 0) - earliest.get("replies", 0)) * 1.5
            )
            velocity = engagement_delta / time_delta_min
            velocity_score = min(velocity * 10, 100)
            score += max(velocity_score, 0) * (weights.get("early_velocity_w", 12) / 100)
    else:
        # Single snapshot — use absolute metrics as proxy
        likes = tweet.get("likes_t0", 0) or 0
        retweets = tweet.get("retweets_t0", 0) or 0
        replies = tweet.get("replies_t0", 0) or 0

        tweet_created = tweet.get("tweet_created_at")
        if tweet_created:
            if isinstance(tweet_created, str):
                tweet_created = datetime.fromisoformat(tweet_created)
            age_min = max((now - tweet_created).total_seconds() / 60, 1)
        else:
            age_min = 60  # Default fallback

        total_eng = likes + retweets * 2 + replies * 1.5
        velocity = total_eng / age_min
        velocity_score = min(velocity * 10, 100)
        score += max(velocity_score, 0) * (weights.get("early_velocity_w", 12) / 100)

    # Reply-to-like ratio
    likes_t0 = tweet.get("likes_t0", 0) or 0
    replies_t0 = tweet.get("replies_t0", 0) or 0
    if likes_t0 > 0:
        reply_ratio = replies_t0 / likes_t0
        ratio_score = min(reply_ratio * 200, 100)
        score += ratio_score * (weights.get("reply_ratio_w", 5) / 100)

    # Quote tweet / retweet ratio
    retweets_t0 = tweet.get("retweets_t0", 0) or 0
    if likes_t0 > 0:
        qt_ratio = retweets_t0 / likes_t0
        qt_score = min(qt_ratio * 200, 100)
        score += qt_score * (weights.get("qt_ratio_w", 5) / 100)

    # Bookmark count
    bookmarks_t0 = tweet.get("bookmarks_t0", 0) or 0
    if bookmarks_t0:
        bookmark_score = min(bookmarks_t0 * 2, 100)
        score += bookmark_score * (weights.get("bookmark_w", 3) / 100)

    # Normalise: sub-weights sum to ~25 (velocity 12 + reply 5 + qt 5 + bookmark 3), scale to 0-100
    return min(score * (100 / 30), 100)
