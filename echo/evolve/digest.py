"""Phase 3: Claude Sonnet call to synthesise winning_patterns JSON."""

from __future__ import annotations

import json

from echo.auth import get_client
from echo.evolve.analyser import AnalysisResult
from echo.evolve.collector import ReplyRecord

DIGEST_MODEL = "claude-sonnet-4-6-20250514"

DIGEST_PROMPT = """You are analysing reply performance data to extract actionable patterns.

STRATEGY PERFORMANCE (last 7 days):
{strategy_stats_json}

TOP PERFORMING REPLIES (top 20% by engagement score):
{top_performers_formatted}

POOR PERFORMING REPLIES (bottom 20%):
{poor_performers_formatted}

Extract the key learnings. Return ONLY this JSON structure:
{{
  "winning_patterns": {{
    "best_strategies": ["ordered list of strategy names by win rate"],
    "hook_patterns": ["specific opening patterns that appear in top performers"],
    "structural_patterns": ["length/format patterns that work — e.g. 'under 120 chars', 'claim then evidence'"],
    "topic_patterns": ["topics/angles that perform well"],
    "avoid": ["patterns from poor performers to avoid"]
  }},
  "inferred_rules": [
    "3-5 concise rules for the compose agent to follow going forward"
  ],
  "confidence": "high|medium|low based on sample size"
}}

Return ONLY the JSON. No preamble."""


def _format_strategy_stats(analysis: AnalysisResult) -> str:
    rows = []
    for name, stats in sorted(
        analysis.strategy_stats.items(), key=lambda x: x[1].win_rate, reverse=True
    ):
        rows.append(
            f"- {name}: {stats.total} replies, {stats.wins} wins, "
            f"win_rate={stats.win_rate:.2f}, avg_score={stats.avg_score:.1f}"
        )
    return "\n".join(rows) or "(no strategy data)"


def _format_replies(replies: list[ReplyRecord], limit: int = 15) -> str:
    lines = []
    for r in replies[:limit]:
        lines.append(
            f"[strategy={r.strategy or 'unknown'} | "
            f"{r.impressions} imp, {r.likes} likes, {r.retweets} RT, "
            f"{r.bookmarks} bkm, {r.profile_clicks} clicks]\n{r.reply_text}"
        )
    return "\n---\n".join(lines) or "(none)"


async def generate_digest(analysis: AnalysisResult) -> dict:
    """Call Claude Sonnet to produce winning_patterns digest."""
    prompt = DIGEST_PROMPT.format(
        strategy_stats_json=_format_strategy_stats(analysis),
        top_performers_formatted=_format_replies(analysis.top_performers),
        poor_performers_formatted=_format_replies(analysis.poor_performers),
    )

    client = get_client()
    message = await client.messages.create(
        model=DIGEST_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    text = next(block.text for block in message.content if block.type == "text").strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[: text.rfind("```")]

    return json.loads(text)
