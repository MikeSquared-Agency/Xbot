from __future__ import annotations


async def get_active_profile() -> dict | None:
    """Load the currently active voice profile."""
    from echo.db.store import get_global_store

    store = get_global_store()
    return await store.get_active_voice_profile()


async def create_new_version(
    profile: dict, source: str, notes: str, tweet_corpus_size: int | None = None
) -> str:
    """Create a new profile version and set it as active. Returns the new version string."""
    from echo.db.store import get_global_store

    store = get_global_store()
    next_version = await store.get_next_voice_version()
    await store.create_voice_profile(
        version=next_version,
        profile=profile,
        source=source,
        notes=notes,
        corpus_size=tweet_corpus_size,
    )
    return next_version


async def has_bootstrap_profile() -> bool:
    """Check if a bootstrap (v1) profile already exists."""
    from echo.db.store import get_global_store

    store = get_global_store()
    return await store.has_bootstrap_profile()
