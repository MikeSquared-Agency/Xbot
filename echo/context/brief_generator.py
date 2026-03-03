from __future__ import annotations

from echo.auth import get_client_async


async def generate_brief(
    profile: dict,
    recent_tweets: list[dict],
    interaction: dict | None,
) -> str:
    """Generate a structured author brief via Claude Sonnet."""
    tweets_text = "\n".join(
        f"- {t.get('content', '')} ({t.get('likes', 0)} likes, {t.get('replies', 0)} replies)"
        for t in recent_tweets
    ) or "No recent tweets available."

    interaction_context = ""
    if interaction and interaction.get("times_replied_to", 0) > 0:
        interaction_context = (
            f"\nPrevious interactions: You have replied to this person "
            f"{interaction['times_replied_to']} times.\n"
            f"Last reply: {interaction.get('last_replied_at', 'unknown')}"
        )

    followers = profile.get("followers", 0)
    following = profile.get("following", 0)

    prompt = f"""Analyse this X/Twitter author and produce a structured brief for crafting a reply to their tweet.

PROFILE:
- Handle: @{profile.get('handle', '')}
- Name: {profile.get('display_name', '')}
- Bio: {profile.get('bio', 'No bio')}
- Followers: {followers:,}
- Following: {following:,}
- Website: {profile.get('website') or 'None'}

RECENT TWEETS:
{tweets_text}

{interaction_context}

Produce a brief with these fields:
1. Role: Their likely professional role (infer from bio + tweets)
2. Vibe: Communication style (formal/casual, technical/accessible, serious/humorous)
3. Current focus: What they're currently talking about most
4. Shared interests: Topics that overlap with AI agents, developer tools, and agentic engineering
5. Engagement style: What kind of replies do they seem to appreciate? (specific technical, casual agreement, contrarian pushback, questions)
6. Reply approach: Given all the above, what approach would land best?

Keep it concise — 6 lines max. This will be injected into a reply generation prompt."""

    client = await get_client_async()
    message = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}],
    )
    block = message.content[0]
    return block.text if hasattr(block, "text") else str(block)
