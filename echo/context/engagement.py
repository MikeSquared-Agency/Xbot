from __future__ import annotations


def compute_avg_engagement(tweets: list[dict], followers: int) -> float:
    """Average engagement rate across recent tweets.

    Engagement per tweet = likes + retweets*2 + replies*1.5
    Rate = avg engagement per tweet / follower count
    """
    if not tweets or not followers or followers == 0:
        return 0.0

    total_engagement = sum(
        t.get("likes", 0) + t.get("retweets", 0) * 2 + t.get("replies", 0) * 1.5
        for t in tweets
    )
    avg_per_tweet = total_engagement / len(tweets)
    return avg_per_tweet / followers


def compute_posting_frequency(tweets: list[dict]) -> float:
    """Tweets per day based on recent sample."""
    if len(tweets) < 2:
        return 0.0

    first = tweets[0].get("created_at")
    last = tweets[-1].get("created_at")
    if first is None or last is None:
        return 0.0

    time_span = abs((first - last).total_seconds())
    days = max(time_span / 86400, 0.1)
    return len(tweets) / days
