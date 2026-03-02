import math


def score_author(tweet: dict, author: dict | None, weights: dict) -> float:
    """Compute author score (0-100) from scraped profile data.

    Signals:
        - Follower count (log-scaled)
        - Follower/following ratio
        - Average engagement rate
        - Verification / account age baseline
        - Posting frequency
    """
    score = 0.0

    followers = tweet.get("author_followers") or 0
    following = tweet.get("author_following") or 0

    # Follower count (log-scaled)
    if followers > 0:
        log_followers = math.log10(followers)
        # log10(1K)=3 -> 25, log10(10K)=4 -> 50, log10(100K)=5 -> 75, log10(1M)=6 -> 100
        follower_score = min((log_followers - 2) * 25, 100)
        score += max(follower_score, 0) * (weights.get("follower_count_w", 8) / 100)

    # Follower/following ratio
    if following > 0:
        ratio = followers / following
        ratio_score = min(ratio * 10, 100)
        score += ratio_score * (weights.get("follower_ratio_w", 5) / 100)

    # Average engagement rate
    if author and author.get("avg_engagement_rate"):
        eng_rate = author["avg_engagement_rate"]
        eng_score = min(eng_rate * 2000, 100)
        score += eng_score * (weights.get("avg_engagement_w", 10) / 100)

    # Verification baseline
    score += 70 * (weights.get("verification_w", 3) / 100)

    # Posting frequency
    if author and author.get("posting_frequency"):
        freq = author["posting_frequency"]
        if 1 <= freq <= 5:
            freq_score = 80
        elif freq < 1:
            freq_score = 40
        else:
            freq_score = max(100 - (freq - 5) * 5, 30)
        score += freq_score * (weights.get("posting_freq_w", 4) / 100)

    # Normalise: sub-weights sum to 30, scale to 0-100
    return min(score * (100 / 30), 100)
