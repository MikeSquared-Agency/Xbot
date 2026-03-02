"""Compose prompt construction for reply generation."""

from __future__ import annotations

import json
from typing import Any


def build_compose_prompt(
    tweet_author: str,
    tweet_content: str,
    author_brief: str,
    profile: dict[str, Any],
    strategy_order: list[str],
    recent_own_tweets: list[str],
    winning_patterns: dict | None = None,
) -> str:
    """Build the full prompt sent to Claude for reply generation."""

    recent_own_text = (
        "\n".join(f"- {t}" for t in recent_own_tweets[:10])
        if recent_own_tweets
        else "(no recent tweets available)"
    )

    patterns_section = ""
    if winning_patterns:
        patterns_section = f"""
TOP-PERFORMING REPLY PATTERNS (from your analytics):
{json.dumps(winning_patterns, indent=2)}
"""

    strategy_slots = "\n".join(
        f'  {{\n    "strategy": "{s}",\n    "text": "...",\n    "reasoning": "Brief explanation of why this approach works here"\n  }}{"," if i < len(strategy_order) - 1 else ""}'
        for i, s in enumerate(strategy_order)
    )

    return f"""You are writing X/Twitter replies as Mike.

VOICE PROFILE:
{json.dumps(profile, indent=2)}

YOUR RECENT TWEETS (for voice consistency):
{recent_own_text}

{patterns_section}

---

ORIGINAL TWEET TO REPLY TO:
Author: @{tweet_author}
Content: "{tweet_content}"

AUTHOR BRIEF:
{author_brief}

---

RULES:
- Max 280 characters per reply
- Must add genuine value (insight, experience, contrarian angle, or specific question)
- NEVER generic ("Great post!", "This is so true", "Couldn't agree more")
- Reference specific details from the tweet
- Match or slightly elevate the author's technical level
- Write as Mike — use his vocabulary, sentence structure, and personality markers from the profile
- Each reply must use a DIFFERENT strategy

GENERATE 5 REPLIES in this exact JSON format:

[
{strategy_slots}
]

Return ONLY the JSON array. No preamble."""
