"""Phase 3: Claude Sonnet call to synthesise winning_patterns JSON."""

from __future__ import annotations

import json

from echo.auth import get_client_async
from echo.evolve.analyser import AnalysisResult, PostAnalysisResult
from echo.evolve.collector import PostRecord, ReplyRecord

DIGEST_MODEL = "claude-sonnet-4-6-20250514"

DIGEST_PROMPT = """You are analysing X (Twitter) performance data to extract actionable patterns.

## REPLY DATA

STRATEGY PERFORMANCE:
{strategy_stats_json}

TOP PERFORMING REPLIES (top 20% by engagement score):
{top_performers_formatted}

POOR PERFORMING REPLIES (bottom 20%):
{poor_performers_formatted}

## ORIGINAL POST DATA

TOP PERFORMING POSTS:
{top_posts_formatted}

POOR PERFORMING POSTS:
{poor_posts_formatted}

## INSTRUCTIONS

Analyse BOTH replies and original posts to extract what works. Return ONLY this JSON structure:
{{
  "winning_patterns": {{
    "best_strategies": ["ordered list of strategy names by win rate"],
    "hook_patterns": ["specific opening patterns that appear in top performers"],
    "structural_patterns": ["length/format patterns that work — e.g. 'under 120 chars', 'claim then evidence'"],
    "topic_patterns": ["topics/angles that perform well"],
    "target_accounts": ["@handles that get best reach when replied to, ranked"],
    "post_patterns": ["what standalone original content works — topics, formats, hooks"],
    "avoid": ["patterns from poor performers to avoid"]
  }},
  "inferred_rules": [
    "3-5 concise rules for the compose agent to follow going forward"
  ],
  "confidence": "high|medium|low based on sample size"
}}

Return ONLY the JSON. No preamble."""

REPLY_ONLY_PROMPT = """You are analysing reply performance data to extract actionable patterns.

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
        target = f" → @{r.reply_target}" if r.reply_target else ""
        lines.append(
            f"[strategy={r.strategy or 'unknown'}{target} | "
            f"{r.impressions} imp, {r.likes} likes, {r.retweets} RT, "
            f"{r.bookmarks} bkm, {r.profile_clicks} clicks]\n{r.reply_text}"
        )
    return "\n---\n".join(lines) or "(none)"


def _format_posts(posts: list[PostRecord], limit: int = 10) -> str:
    lines = []
    for p in posts[:limit]:
        lines.append(
            f"[{p.impressions} imp, {p.likes} likes, {p.retweets} RT, "
            f"{p.bookmarks} bkm, {p.profile_clicks} clicks]\n{p.text}"
        )
    return "\n---\n".join(lines) or "(none)"


async def generate_digest(
    analysis: AnalysisResult,
    post_analysis: PostAnalysisResult | None = None,
) -> dict:
    """Call Claude Sonnet to produce winning_patterns digest."""
    if post_analysis and post_analysis.total_posts > 0:
        prompt = DIGEST_PROMPT.format(
            strategy_stats_json=_format_strategy_stats(analysis),
            top_performers_formatted=_format_replies(analysis.top_performers),
            poor_performers_formatted=_format_replies(analysis.poor_performers),
            top_posts_formatted=_format_posts(post_analysis.top_posts),
            poor_posts_formatted=_format_posts(post_analysis.poor_posts),
        )
    else:
        prompt = REPLY_ONLY_PROMPT.format(
            strategy_stats_json=_format_strategy_stats(analysis),
            top_performers_formatted=_format_replies(analysis.top_performers),
            poor_performers_formatted=_format_replies(analysis.poor_performers),
        )

    client = await get_client_async()
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
