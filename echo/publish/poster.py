from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg
import nats as nats_client
from mcp import ClientSession

from echo.publish.errors import PublishError, PublishResult
from echo.publish.rate_limiter import RateLimiter

DATABASE_URL = os.environ.get("DATABASE_URL", "")
NATS_URL = os.environ.get("NATS_URL", "nats://localhost:4222")

rate_limiter = RateLimiter()


@dataclass
class Tweet:
    tweet_id: str
    tweet_url: str
    author_handle: str
    discovered_at: datetime
    id: str | None = None


@dataclass
class GeneratedReply:
    text: str
    strategy: str
    original_text: str | None = None


async def _get_voice_profile_version(conn: asyncpg.Connection) -> str | None:
    row = await conn.fetchrow(
        "SELECT version FROM echo.voice_profiles WHERE is_active = true LIMIT 1"
    )
    return str(row["version"]) if row else None


async def post_reply(
    xbot: ClientSession,
    tweet: Tweet,
    reply: GeneratedReply,
    was_edited: bool,
) -> PublishResult:
    """Post a reply to X and record the result."""
    start_time = datetime.now(timezone.utc)

    # 1. Call Xbot stored tool
    result = await xbot.call_tool(
        "x:post-reply",
        {"tweet_url": tweet.tweet_url, "reply_text": reply.text},
    )

    content = result.content[0] if result.content else None
    if content is None or getattr(result, "isError", False):
        error_msg = content.text if content else "Unknown error"
        return PublishResult(success=False, error=error_msg)

    payload = json.loads(content.text) if isinstance(content.text, str) else content.text
    reply_id = payload.get("reply_id")
    reply_url = payload.get("reply_url")

    # 2. Calculate timing
    time_to_reply = int((start_time - tweet.discovered_at).total_seconds())

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        voice_version = await _get_voice_profile_version(conn)

        # 3. Store in echo.replies
        await conn.execute(
            """
            INSERT INTO echo.replies (
                tweet_id, reply_id, reply_url, reply_text, strategy,
                was_edited, original_text, voice_profile_version,
                time_to_reply_seconds, posted_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """,
            tweet.tweet_id,
            reply_id,
            reply_url,
            reply.text,
            reply.strategy,
            was_edited,
            reply.original_text if was_edited else None,
            voice_version,
            time_to_reply,
            start_time,
        )

        # 4. Update tweet status
        await conn.execute(
            """
            UPDATE echo.tweets
            SET status = 'replied', replied_at = $1
            WHERE tweet_id = $2
            """,
            datetime.now(timezone.utc),
            tweet.tweet_id,
        )

        # 5. Update author interaction count
        await conn.execute(
            """
            UPDATE echo.authors
            SET times_replied_to = times_replied_to + 1,
                last_replied_at = NOW()
            WHERE handle = $1
            """,
            tweet.author_handle,
        )
    finally:
        await conn.close()

    # 6. Emit NATS event
    try:
        nc = await nats_client.connect(NATS_URL)
        await nc.publish(
            "echo.reply.posted",
            json.dumps(
                {
                    "tweet_id": tweet.tweet_id,
                    "reply_id": reply_id,
                    "reply_url": reply_url,
                    "strategy": reply.strategy,
                    "time_to_reply_seconds": time_to_reply,
                    "posted_at": start_time.isoformat(),
                }
            ).encode(),
        )
        await nc.flush()
        await nc.close()
    except Exception:
        pass  # NATS failure should not block publish success

    return PublishResult(
        success=True,
        reply_url=reply_url,
        reply_id=reply_id,
        time_to_reply=time_to_reply,
    )


async def post_reply_with_rate_limit(
    xbot: ClientSession,
    tweet: Tweet,
    reply: GeneratedReply,
    was_edited: bool,
) -> PublishResult:
    """Post a reply respecting the rate limit."""
    can_post, wait_seconds = await rate_limiter.check()

    if not can_post:
        # Import here to avoid hard dep on rich for library consumers
        try:
            from rich.console import Console

            Console().print(
                f"[yellow]⏳ Rate limit: waiting {wait_seconds}s before posting...[/]"
            )
        except ImportError:
            pass
        await asyncio.sleep(wait_seconds)

    result = await post_reply(xbot, tweet, reply, was_edited)
    if result.success:
        rate_limiter.record_post()
    return result


async def post_reply_safe(
    xbot: ClientSession,
    tweet: Tweet,
    reply: GeneratedReply,
    was_edited: bool,
    max_retries: int = 2,
) -> PublishResult:
    """Post with retry and error handling."""
    try:
        from rich.console import Console

        console = Console()
    except ImportError:
        console = None

    for attempt in range(max_retries + 1):
        try:
            result = await post_reply_with_rate_limit(xbot, tweet, reply, was_edited)

            if result.success:
                return result

            if attempt < max_retries:
                if console:
                    console.print(
                        f"[yellow]⚠ Post failed: {result.error}. Retrying...[/]"
                    )
                await asyncio.sleep(3)
            else:
                if console:
                    console.print(
                        f"[red]✗ Post failed after {max_retries + 1} attempts: {result.error}[/]"
                    )
                return result

        except Exception as e:
            if "session" in str(e).lower() or "login" in str(e).lower():
                if console:
                    console.print(
                        "[red]⚠ Session expired. Please re-authenticate in the browser.[/]"
                    )
                raise PublishError("Session expired") from e

            if attempt < max_retries:
                if console:
                    console.print(f"[yellow]⚠ Error: {e}. Retrying...[/]")
                await asyncio.sleep(3)
            else:
                raise

    # Unreachable, but satisfies type checker
    return PublishResult(success=False, error="Max retries exceeded")
