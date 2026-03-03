import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from dotenv import load_dotenv

from echo.voice.analyser import analyse_voice
from echo.voice.profile import create_new_version, has_bootstrap_profile

load_dotenv()

X_PROFILE_HANDLE = os.environ["X_PROFILE_HANDLE"]

XBOT_BROWSER_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "xbot-browser", "cli.js"
)


def _engagement_score(tweet: dict) -> float:
    likes = tweet.get("likes", 0)
    retweets = tweet.get("retweets", 0)
    replies = tweet.get("replies", 0)
    return likes + retweets * 2 + replies * 1.5


async def _scrape_timeline(mcp_session: ClientSession, handle: str, count: int = 200) -> list[dict]:
    """Scrape tweets from X timeline via Xbot MCP."""
    result = await mcp_session.call_tool(
        "x:get-author-timeline",
        {"handle": handle, "count": count},
    )

    # Extract text content from MCP result
    text = ""
    for content in result.content:
        if hasattr(content, "text"):
            text += content.text

    tweets = json.loads(text)
    if isinstance(tweets, dict) and "tweets" in tweets:
        tweets = tweets["tweets"]

    return tweets


def _filter_original_tweets(tweets: list[dict]) -> list[dict]:
    """Filter to original tweets only — no retweets, no replies."""
    original = []
    for t in tweets:
        is_retweet = t.get("is_retweet", False) or t.get("isRetweet", False)
        is_reply = t.get("is_reply", False) or t.get("isReply", False) or t.get("in_reply_to", None) is not None
        if not is_retweet and not is_reply:
            original.append(t)
    return original


async def bootstrap_voice_profile() -> dict:
    """One-time: scrape your timeline, analyse, generate v1 profile."""
    # Idempotency check
    if await has_bootstrap_profile():
        print("Bootstrap profile (v1) already exists. Skipping.")
        return None

    server_params = StdioServerParameters(
        command="node",
        args=[os.path.abspath(XBOT_BROWSER_PATH)],
        env={**os.environ},
    )

    print(f"Bootstrapping voice profile for @{X_PROFILE_HANDLE}...")

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as mcp_session:
            await mcp_session.initialize()

            # 1. Scrape timeline
            print("Scraping timeline...")
            tweets = await _scrape_timeline(mcp_session, X_PROFILE_HANDLE)
            print(f"  Fetched {len(tweets)} tweets")

            # 2. Filter to originals
            original_tweets = _filter_original_tweets(tweets)
            print(f"  {len(original_tweets)} original tweets (no RTs/replies)")

            if len(original_tweets) < 10:
                print("Not enough original tweets to build a profile.", file=sys.stderr)
                return None

            # 3. Sort by engagement
            original_tweets.sort(key=_engagement_score, reverse=True)

            # 4. Separate top 20%
            cutoff = max(1, len(original_tweets) // 5)
            top_tweets = original_tweets[:cutoff]
            print(f"  Top 20%: {len(top_tweets)} tweets")

            # 5. Analyse with Claude Opus
            print("Analysing voice with Claude Opus...")
            profile = await analyse_voice(original_tweets, top_tweets)
            print("  Voice profile generated")

            # 6. Store as v1
            version = await create_new_version(
                profile=profile,
                source="bootstrap",
                notes="Initial bootstrap from timeline scrape",
                tweet_corpus_size=len(original_tweets),
            )
            print(f"  Stored as {version} (active)")

            return profile


if __name__ == "__main__":
    result = asyncio.run(bootstrap_voice_profile())
    if result:
        print("\nVoice profile:\n")
        print(json.dumps(result, indent=2))
