from echo.scorer.pipeline import score_tweets, score_single_tweet
from echo.scorer.weights import get_active_weights, get_db_pool, DEFAULT_WEIGHTS

__all__ = ["score_tweets", "score_single_tweet", "load_weights", "seed_default_weights"]


async def load_weights() -> dict | None:
    """Load active weights, returns None if DB unavailable."""
    try:
        return await get_active_weights(force_refresh=True)
    except Exception:
        return None


async def seed_default_weights() -> None:
    """Insert default weights row if none exist."""
    try:
        import json

        pool = await get_db_pool()
        existing = await pool.fetchval(
            "SELECT COUNT(*) FROM echo.model_weights WHERE is_active = TRUE"
        )
        if existing == 0:
            await pool.execute(
                """
                INSERT INTO echo.model_weights (version, weights_json, is_active, notes)
                VALUES ($1, $2, TRUE, 'Auto-seeded defaults')
                ON CONFLICT (version) DO NOTHING
                """,
                DEFAULT_WEIGHTS["version"],
                json.dumps(DEFAULT_WEIGHTS),
            )
    except Exception:
        pass
