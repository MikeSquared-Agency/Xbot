import json

from echo.auth import get_client

VOICE_ANALYSIS_PROMPT = """You are analysing a person's Twitter/X writing style to create a voice profile.
This profile will be used to generate replies that sound authentically like them.

Here are their tweets (with engagement metrics):

ALL TWEETS (sample of up to 100):
{all_text}

TOP PERFORMING TWEETS (top 20% by engagement):
{top_text}

Analyse these tweets and produce a JSON voice profile with these fields:

{{
  "tone": "Description of overall tone (2-3 sentences)",
  "sentence_structure": "How they construct sentences — length, rhythm, patterns",
  "vocabulary": {{
    "preferred_terms": ["words/phrases they use often"],
    "avoided_terms": ["words/phrases they never use"],
    "technical_level": "How technical vs accessible (1-10 scale with description)"
  }},
  "hooks": {{
    "patterns": ["Common opening patterns they use"],
    "examples": ["Direct examples of their best opening lines"]
  }},
  "reply_style": {{
    "typical_length": "Character range for their replies",
    "structure_patterns": ["How they structure a reply — e.g., claim-then-evidence"],
    "engagement_triggers": ["What makes their best content work"]
  }},
  "personality_markers": ["Distinctive traits — humor style, references, quirks"],
  "topics_of_expertise": ["Topics they write about most confidently"],
  "contrarian_tendencies": "How often and how they push back on ideas",
  "what_works": "Summary of patterns in their TOP performing tweets vs average",
  "what_to_avoid": "Patterns that appear in low-performing tweets"
}}

Return ONLY the JSON. No preamble, no markdown fences."""


def _format_tweets(tweets: list[dict], limit: int) -> str:
    lines = []
    for t in tweets[:limit]:
        likes = t.get("likes", 0)
        retweets = t.get("retweets", 0)
        replies = t.get("replies", 0)
        content = t.get("content", t.get("text", ""))
        lines.append(f"[{likes}\u2764 {retweets}\U0001f501 {replies}\U0001f4ac] {content}")
    return "\n---\n".join(lines)


async def analyse_voice(all_tweets: list[dict], top_tweets: list[dict]) -> dict:
    """Analyse tweet corpus and extract voice profile via Claude Opus."""
    all_text = _format_tweets(all_tweets, limit=100)
    top_text = _format_tweets(top_tweets, limit=30)

    prompt = VOICE_ANALYSIS_PROMPT.format(all_text=all_text, top_text=top_text)

    response = await get_client().messages.create(
        model="claude-opus-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    text = next(block.text for block in response.content if block.type == "text")

    # Strip markdown fences if the model includes them despite instructions
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[: text.rfind("```")]

    return json.loads(text)
