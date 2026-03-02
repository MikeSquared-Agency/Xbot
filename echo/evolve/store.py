"""Phase 5: Persist digest and updated weights to DB."""

from __future__ import annotations

import json

import asyncpg

from echo.evolve.analyser import AnalysisResult


async def store_digest(
    conn: asyncpg.Connection,
    analysis: AnalysisResult,
    digest_json: dict,
) -> None:
    """Upsert today's digest into echo.daily_digests."""
    await conn.execute(
        """
        INSERT INTO echo.daily_digests
            (date, digest_json, total_replies_analysed, avg_engagement_score)
        VALUES ($1, $2::jsonb, $3, $4)
        ON CONFLICT (date) DO UPDATE SET
            digest_json = EXCLUDED.digest_json,
            total_replies_analysed = EXCLUDED.total_replies_analysed,
            avg_engagement_score = EXCLUDED.avg_engagement_score
        """,
        analysis.date,
        json.dumps(digest_json),
        analysis.total_replies,
        analysis.avg_engagement_score,
    )
