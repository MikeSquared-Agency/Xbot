from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import asyncpg

from echo.config import get_database_url
from echo.db.models import (
    Candidate,
    DailyDigest,
    PostedReply,
    SessionStats,
    Tweet,
)


class Database:
    def __init__(self, database_url: Optional[str] = None):
        self._url = database_url or get_database_url()
        self._pool: Optional[asyncpg.Pool] = None

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(self._url, min_size=1, max_size=5)

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    # ------------------------------------------------------------------
    # Candidate queue
    # ------------------------------------------------------------------

    async def get_next_candidate(self) -> Optional[Candidate]:
        """Return the highest-scoring queued tweet."""
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT tweet_id, tweet_url, author_handle, author_name,
                       content, author_followers, author_verified,
                       likes_t0, replies_t0, retweets_t0, virality_score,
                       status, tweet_created_at, discovered_at
                FROM echo.tweets
                WHERE status = 'queued'
                ORDER BY virality_score DESC NULLS LAST
                LIMIT 1
                """
            )
            if row is None:
                return None

            tweet = Tweet(**dict(row))
            return Candidate(tweet=tweet)

    async def get_queue_depth(self) -> int:
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            row = await conn.fetchval(
                "SELECT COUNT(*) FROM echo.tweets WHERE status = 'queued'"
            )
            return row or 0

    # ------------------------------------------------------------------
    # Status updates
    # ------------------------------------------------------------------

    async def update_status(self, tweet_id: str, status: str) -> None:
        assert self._pool is not None
        now = datetime.now(timezone.utc)
        async with self._pool.acquire() as conn:
            if status == "presented":
                await conn.execute(
                    "UPDATE echo.tweets SET status = $1, presented_at = $2 WHERE tweet_id = $3",
                    status, now, tweet_id,
                )
            elif status == "replied":
                await conn.execute(
                    "UPDATE echo.tweets SET status = $1, replied_at = $2 WHERE tweet_id = $3",
                    status, now, tweet_id,
                )
            else:
                await conn.execute(
                    "UPDATE echo.tweets SET status = $1 WHERE tweet_id = $2",
                    status, tweet_id,
                )

    # ------------------------------------------------------------------
    # Post a reply
    # ------------------------------------------------------------------

    async def record_reply(
        self,
        tweet_id: str,
        reply_text: str,
        strategy: str,
        was_edited: bool,
        original_text: Optional[str] = None,
    ) -> str:
        assert self._pool is not None
        now = datetime.now(timezone.utc)
        async with self._pool.acquire() as conn:
            row_id = await conn.fetchval(
                """
                INSERT INTO echo.replies
                    (tweet_id, reply_text, strategy, was_edited, original_text, posted_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
                """,
                tweet_id, reply_text, strategy, was_edited, original_text, now,
            )
            await self.update_status(tweet_id, "replied")
            return str(row_id)

    # ------------------------------------------------------------------
    # Stats & history
    # ------------------------------------------------------------------

    async def get_session_stats(self) -> SessionStats:
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    (SELECT COUNT(*) FROM echo.tweets WHERE status = 'queued') AS queue_depth,
                    (SELECT COUNT(*) FROM echo.replies WHERE posted_at::date = CURRENT_DATE) AS posted_today,
                    (SELECT AVG(virality_score) FROM echo.tweets WHERE discovered_at::date = CURRENT_DATE) AS avg_score,
                    (SELECT COALESCE(SUM(follower_delta), 0) FROM echo.replies WHERE posted_at::date = CURRENT_DATE) AS follower_delta
                """
            )
            return SessionStats(
                queue_depth=row["queue_depth"],
                posted_today=row["posted_today"],
                avg_score=float(row["avg_score"]) if row["avg_score"] is not None else None,
                follower_delta=row["follower_delta"],
            )

    async def get_today_replies(self) -> list[PostedReply]:
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT r.reply_text, r.strategy, r.impressions, r.likes,
                       r.posted_at, t.author_handle
                FROM echo.replies r
                JOIN echo.tweets t ON r.tweet_id = t.tweet_id
                WHERE r.posted_at::date = CURRENT_DATE
                ORDER BY r.posted_at DESC
                """
            )
            return [PostedReply(**dict(r)) for r in rows]

    async def get_latest_digest(self) -> Optional[DailyDigest]:
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT date, tweets_discovered, replies_posted,
                       avg_impressions, follower_delta, strategy_breakdown,
                       recommendations
                FROM echo.daily_digests
                ORDER BY date DESC
                LIMIT 1
                """
            )
            if row is None:
                return None
            data = dict(row)
            # strategy_breakdown is JSONB, asyncpg returns it as a string or dict
            import json
            sb = data["strategy_breakdown"]
            if isinstance(sb, str):
                data["strategy_breakdown"] = json.loads(sb)
            return DailyDigest(**data)
