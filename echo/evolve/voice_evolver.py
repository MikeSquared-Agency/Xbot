"""Phase 4b: Optionally evolve voice profile when performance declines."""

from __future__ import annotations

from echo.evolve.analyser import AnalysisResult


async def get_thirty_day_avg(store) -> float:
    """Fetch 30-day rolling average engagement score from daily digests."""
    return await store.get_thirty_day_avg_score()


async def maybe_evolve_voice(
    store,
    analysis: AnalysisResult,
    thirty_day_avg: float,
) -> bool:
    """Re-run voice analysis if performance is declining (>20% below 30-day avg)."""
    if thirty_day_avg <= 0:
        return False  # No historical data yet

    if analysis.avg_engagement_score > thirty_day_avg * 0.8:
        return False  # Performance is fine, skip

    # Re-use existing voice analysis machinery with recent top/poor performers
    if not analysis.top_performers:
        return False  # Need some top performers to learn from

    def _to_dict(r):
        return {
            "content": r.reply_text,
            "likes": r.likes,
            "retweets": r.retweets,
            "replies": 0,
        }

    all_dicts = [_to_dict(r) for r in analysis.top_performers + analysis.poor_performers]
    top_dicts = [_to_dict(r) for r in analysis.top_performers]

    from echo.voice.analyser import analyse_voice

    new_profile = await analyse_voice(
        all_tweets=all_dicts,
        top_tweets=top_dicts,
    )

    from echo.voice.profile import create_new_version

    await create_new_version(
        profile=new_profile,
        source="daily_refinement",
        notes=(
            f"Auto-evolved: avg score {analysis.avg_engagement_score:.2f} "
            f"vs 30d avg {thirty_day_avg:.2f}"
        ),
        tweet_corpus_size=len(all_dicts),
    )
    return True
