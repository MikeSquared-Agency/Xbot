"""Phase 5: Persist digest and updated weights."""

from __future__ import annotations

from datetime import date

from echo.evolve.analyser import AnalysisResult


async def store_digest(
    store,
    analysis: AnalysisResult,
    digest_json: dict,
) -> None:
    """Store today's digest in Cortex."""
    date_str = analysis.date
    if isinstance(date_str, date):
        date_str = date_str.isoformat()
    await store.store_digest(
        date_str,
        digest_json,
        analysis.total_replies,
        analysis.avg_engagement_score,
    )
