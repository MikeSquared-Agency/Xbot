from __future__ import annotations

import os

_cached_weights: dict | None = None
_db_pool = None

# Default weights matching SPEC-04 seed values
DEFAULT_WEIGHTS: dict = {
    "version": "v1",
    "author_weight": 0.30,
    "content_weight": 0.40,
    "momentum_weight": 0.30,
    "watchlist_bonus": 15,
    "follower_count_w": 8,
    "follower_ratio_w": 5,
    "avg_engagement_w": 10,
    "verification_w": 3,
    "posting_freq_w": 4,
    "topic_relevance_w": 12,
    "controversy_w": 8,
    "novelty_w": 6,
    "has_media_w": 4,
    "is_thread_w": 3,
    "emotional_w": 4,
    "hook_quality_w": 3,
    "early_velocity_w": 12,
    "reply_ratio_w": 5,
    "qt_ratio_w": 5,
    "bookmark_w": 3,
    "recency_half_life_minutes": 120,
}


async def get_db_pool():
    """Lazy-init asyncpg connection pool."""
    global _db_pool
    if _db_pool is None:
        import asyncpg

        _db_pool = await asyncpg.create_pool(
            os.environ["DATABASE_URL"],
            min_size=1,
            max_size=5,
        )
    return _db_pool


async def get_active_weights(force_refresh: bool = False) -> dict:
    """Load the active model weights from echo.model_weights.

    Falls back to DEFAULT_WEIGHTS if no active row exists.
    Caches in memory until force_refresh is True.
    """
    global _cached_weights
    if _cached_weights is not None and not force_refresh:
        return _cached_weights

    try:
        pool = await get_db_pool()
        row = await pool.fetchrow(
            "SELECT weights_json FROM echo.model_weights WHERE is_active = TRUE LIMIT 1"
        )
        if row and row["weights_json"]:
            import json

            weights = json.loads(row["weights_json"]) if isinstance(row["weights_json"], str) else row["weights_json"]
            # Merge with defaults so any missing keys get filled
            merged = {**DEFAULT_WEIGHTS, **weights}
            _cached_weights = merged
            return merged
    except Exception:
        pass

    _cached_weights = DEFAULT_WEIGHTS.copy()
    return _cached_weights


def invalidate_weights_cache():
    """Clear the cached weights so next call re-fetches from DB."""
    global _cached_weights
    _cached_weights = None
