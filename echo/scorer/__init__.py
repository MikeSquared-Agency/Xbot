from echo.scorer.pipeline import score_tweets, score_single_tweet
from echo.scorer.weights import get_active_weights, DEFAULT_WEIGHTS

__all__ = ["score_tweets", "score_single_tweet", "load_weights", "seed_default_weights"]


async def load_weights() -> dict | None:
    """Load active weights, returns None if unavailable."""
    try:
        return await get_active_weights(force_refresh=True)
    except Exception:
        return None


async def seed_default_weights() -> None:
    """Insert default weights if none exist."""
    try:
        from echo.db.store import get_global_store

        store = get_global_store()
        await store.seed_weights(DEFAULT_WEIGHTS["version"], DEFAULT_WEIGHTS)
    except Exception:
        pass
