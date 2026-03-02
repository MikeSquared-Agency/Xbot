import json
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]


async def _connect() -> asyncpg.Connection:
    return await asyncpg.connect(DATABASE_URL)


async def get_active_profile() -> dict | None:
    """Load the currently active voice profile."""
    conn = await _connect()
    try:
        row = await conn.fetchrow(
            "SELECT profile_json FROM echo.voice_profiles WHERE is_active = TRUE"
        )
        return json.loads(row["profile_json"]) if row else None
    finally:
        await conn.close()


async def create_new_version(
    profile: dict, source: str, notes: str, tweet_corpus_size: int | None = None
) -> str:
    """Create a new profile version and set it as active. Returns the new version string."""
    conn = await _connect()
    try:
        async with conn.transaction():
            # Deactivate current active profile
            await conn.execute(
                "UPDATE echo.voice_profiles SET is_active = FALSE WHERE is_active = TRUE"
            )

            # Get next version number
            latest = await conn.fetchrow(
                "SELECT version FROM echo.voice_profiles ORDER BY created_at DESC LIMIT 1"
            )
            next_version = f"v{int(latest['version'][1:]) + 1}" if latest else "v1"

            await conn.execute(
                """
                INSERT INTO echo.voice_profiles (version, profile_json, source, tweet_corpus_size, notes, is_active)
                VALUES ($1, $2::jsonb, $3, $4, $5, TRUE)
                """,
                next_version,
                json.dumps(profile),
                source,
                tweet_corpus_size,
                notes,
            )

        return next_version
    finally:
        await conn.close()


async def has_bootstrap_profile() -> bool:
    """Check if a bootstrap (v1) profile already exists."""
    conn = await _connect()
    try:
        row = await conn.fetchrow(
            "SELECT 1 FROM echo.voice_profiles WHERE version = 'v1' AND source = 'bootstrap'"
        )
        return row is not None
    finally:
        await conn.close()
