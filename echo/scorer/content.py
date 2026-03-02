from echo.scorer.embeddings import cosine_similarity


def score_content(tweet: dict, niche_embedding: list[float] | None, weights: dict) -> float:
    """MVP content scoring — structural signals only, no LLM calls.

    Signals:
        - Topic relevance via embedding similarity
        - Has media
        - Is thread
        - Placeholder midpoints for LLM signals (controversy, novelty, emotional, hook quality)
    """
    score = 0.0

    # Topic relevance via embedding similarity
    content_embedding = tweet.get("content_embedding")
    if content_embedding and niche_embedding:
        similarity = cosine_similarity(content_embedding, niche_embedding)
        relevance_score = max((similarity - 0.3) * 250, 0)
        score += min(relevance_score, 100) * (weights.get("topic_relevance_w", 12) / 100)

    # Has media
    if tweet.get("has_media"):
        score += 70 * (weights.get("has_media_w", 4) / 100)

    # Is thread
    if tweet.get("is_thread"):
        score += 65 * (weights.get("is_thread_w", 3) / 100)

    # Placeholder midpoint scores for V2 LLM signals
    score += 50 * (weights.get("controversy_w", 8) / 100)
    score += 50 * (weights.get("novelty_w", 6) / 100)
    score += 50 * (weights.get("emotional_w", 4) / 100)
    score += 50 * (weights.get("hook_quality_w", 3) / 100)

    # Normalise: sub-weights sum to 40, scale to 0-100
    return min(score * (100 / 40), 100)
