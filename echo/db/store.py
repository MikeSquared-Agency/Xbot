"""EchoStore — high-level domain store built on CortexClient.

All Echo data lives as Cortex graph nodes. This replaces asyncpg/PostgreSQL.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from echo.db.cortex import CortexClient

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Global singleton
# ---------------------------------------------------------------------------

_global_store: EchoStore | None = None


def set_global_store(store: EchoStore) -> None:
    global _global_store
    _global_store = store


def get_global_store() -> EchoStore:
    if _global_store is None:
        raise RuntimeError("EchoStore not initialised — call set_global_store() first")
    return _global_store


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_body(node: dict) -> dict:
    """Parse the body field of a Cortex node (may be JSON string or dict)."""
    body = node.get("body", "{}")
    if isinstance(body, str):
        try:
            return json.loads(body)
        except (json.JSONDecodeError, TypeError):
            return {}
    return body if isinstance(body, dict) else {}


def _node_id(node: dict) -> str:
    return node.get("id", "")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _kind_eq(node: dict, expected: str) -> bool:
    """Case-insensitive kind comparison (Cortex returns PascalCase)."""
    return node.get("kind", "").lower() == expected.lower()


# ---------------------------------------------------------------------------
# EchoStore
# ---------------------------------------------------------------------------

class EchoStore:
    """Domain-level storage for Echo, backed by Cortex graph nodes."""

    def __init__(self, cortex: CortexClient):
        self.cortex = cortex

    @classmethod
    async def connect(cls, cortex_url: str | None = None) -> EchoStore:
        from echo.config import get_cortex_url
        url = cortex_url or get_cortex_url()
        client = CortexClient(base_url=url)
        ok = await client.health()
        if not ok:
            log.warning("Cortex health check failed at %s — continuing anyway", url)
        return cls(client)

    async def close(self) -> None:
        await self.cortex.close()

    # ==================================================================
    # Config
    # ==================================================================

    async def get_config(self) -> dict | None:
        nodes = await self.cortex.get_nodes(kind="echo_config", tag="echo-config", limit=1)
        if not nodes:
            return None
        return _parse_body(nodes[0])

    async def save_config(self, config: dict) -> None:
        nodes = await self.cortex.get_nodes(kind="echo_config", tag="echo-config", limit=1)
        if nodes:
            await self.cortex.update_node(
                _node_id(nodes[0]),
                body=config,
            )
        else:
            await self.cortex.create_node(
                kind="echo_config",
                title="echo-config",
                body=config,
                tags=["echo-config"],
            )

    # ==================================================================
    # Voice profiles
    # ==================================================================

    async def get_active_voice_profile(self) -> dict | None:
        nodes = await self.cortex.get_nodes(kind="voice_profile", tag="active", limit=10)
        for node in nodes:
            data = _parse_body(node)
            if data.get("is_active"):
                profile = data.get("profile_json")
                if isinstance(profile, str):
                    try:
                        return json.loads(profile)
                    except (json.JSONDecodeError, TypeError):
                        return None
                return profile
        return None

    async def create_voice_profile(
        self,
        version: str,
        profile: dict,
        source: str,
        notes: str,
        corpus_size: int | None = None,
    ) -> str:
        # Deactivate current active profiles
        active_nodes = await self.cortex.get_nodes(kind="voice_profile", tag="active", limit=50)
        for node in active_nodes:
            data = _parse_body(node)
            if data.get("is_active"):
                data["is_active"] = False
                old_tags = node.get("tags", [])
                new_tags = [t for t in old_tags if t != "active"]
                await self.cortex.update_node(_node_id(node), body=data, tags=new_tags)

        body = {
            "profile_json": profile,
            "source": source,
            "corpus_size": corpus_size,
            "notes": notes,
            "is_active": True,
            "created_at": _now_iso(),
        }
        result = await self.cortex.create_node(
            kind="voice_profile",
            title=version,
            body=body,
            tags=["voice-profile", "active"],
        )
        return _node_id(result) if result else version

    async def has_bootstrap_profile(self) -> bool:
        nodes = await self.cortex.get_nodes(kind="voice_profile", limit=50)
        for node in nodes:
            data = _parse_body(node)
            if node.get("title") == "v1" and data.get("source") == "bootstrap":
                return True
        return False

    async def get_next_voice_version(self) -> str:
        nodes = await self.cortex.get_nodes(kind="voice_profile", limit=100)
        max_v = 0
        for node in nodes:
            title = node.get("title", "")
            if title.startswith("v") and title[1:].isdigit():
                max_v = max(max_v, int(title[1:]))
        return f"v{max_v + 1}"

    async def get_active_voice_version(self) -> str | None:
        nodes = await self.cortex.get_nodes(kind="voice_profile", tag="active", limit=10)
        for node in nodes:
            data = _parse_body(node)
            if data.get("is_active"):
                return node.get("title")
        return None

    # ==================================================================
    # Model weights
    # ==================================================================

    async def get_active_weights(self) -> dict | None:
        nodes = await self.cortex.get_nodes(kind="model_weights", tag="active", limit=10)
        for node in nodes:
            data = _parse_body(node)
            if data.get("is_active"):
                weights = data.get("weights_json")
                if isinstance(weights, str):
                    try:
                        return json.loads(weights)
                    except (json.JSONDecodeError, TypeError):
                        return None
                return weights
        return None

    async def seed_weights(self, version: str, weights: dict) -> None:
        existing = await self.get_active_weights()
        if existing:
            return
        body = {
            "weights_json": weights,
            "is_active": True,
            "notes": "Auto-seeded defaults",
            "created_at": _now_iso(),
        }
        await self.cortex.create_node(
            kind="model_weights",
            title=version,
            body=body,
            tags=["model-weights", "active"],
        )

    # ==================================================================
    # Authors
    # ==================================================================

    async def get_author(self, handle: str) -> dict | None:
        tag = handle.lstrip("@").lower()
        nodes = await self.cortex.get_nodes(kind="author", tag=tag, limit=5)
        for node in nodes:
            if node.get("title", "").lstrip("@").lower() == tag:
                data = _parse_body(node)
                data["_node_id"] = _node_id(node)
                data["handle"] = handle
                return data
        return None

    async def upsert_author(self, data: dict) -> None:
        handle = data["handle"]
        tag = handle.lstrip("@").lower()
        existing = await self.get_author(handle)

        body = {k: v for k, v in data.items() if k not in ("handle", "_node_id")}
        body["updated_at"] = _now_iso()

        if existing and existing.get("_node_id"):
            await self.cortex.update_node(
                existing["_node_id"],
                body={**_strip_internal(existing), **body},
            )
        else:
            await self.cortex.create_node(
                kind="author",
                title=f"@{tag}",
                body=body,
                tags=["author", tag],
            )

    async def get_author_brief(self, handle: str) -> str | None:
        author = await self.get_author(handle)
        if author:
            return author.get("enrichment_brief")
        return None

    async def save_author_brief(self, handle: str, brief: str) -> None:
        author = await self.get_author(handle)
        if author and author.get("_node_id"):
            updated = _strip_internal(author)
            updated["enrichment_brief"] = brief
            updated["enrichment_updated"] = _now_iso()
            await self.cortex.update_node(author["_node_id"], body=updated)

    async def increment_reply_count(self, handle: str) -> None:
        author = await self.get_author(handle)
        if author and author.get("_node_id"):
            updated = _strip_internal(author)
            updated["times_replied_to"] = updated.get("times_replied_to", 0) + 1
            updated["last_replied_at"] = _now_iso()
            await self.cortex.update_node(author["_node_id"], body=updated)

    # ==================================================================
    # Tweets
    # ==================================================================

    async def insert_tweets(self, tweets: list[dict]) -> int:
        inserted = 0
        for t in tweets:
            tweet_id = t.get("tweet_id", "")
            # Check for duplicates
            existing = await self.cortex.get_nodes(kind="tweet", tag=f"tid-{tweet_id}", limit=1)
            if existing:
                continue

            body = {k: v for k, v in t.items() if k != "tweet_id"}
            body["discovered_at"] = body.get("discovered_at") or _now_iso()
            body["metric_snapshots"] = []

            # Serialize datetime objects
            for key in ("tweet_created_at", "discovered_at"):
                val = body.get(key)
                if isinstance(val, datetime):
                    body[key] = val.isoformat()

            tags = ["tweet", "status-queued", f"tid-{tweet_id}"]
            source = body.get("source")
            if source:
                tags.append(f"source-{source}")
            author = body.get("author_handle", "")
            if author:
                tags.append(f"author-{author.lstrip('@').lower()}")

            node = await self.cortex.create_node(
                kind="tweet",
                title=tweet_id,
                body=body,
                tags=tags,
            )

            if node:
                # Create author→tweet edge if author exists
                author_data = await self.get_author(author)
                if author_data and author_data.get("_node_id"):
                    await self.cortex.create_edge(
                        author_data["_node_id"], _node_id(node), "authored"
                    )
                inserted += 1

        return inserted

    async def get_tweet(self, tweet_id: str) -> dict | None:
        nodes = await self.cortex.get_nodes(kind="tweet", tag=f"tid-{tweet_id}", limit=1)
        if not nodes:
            return None
        node = nodes[0]
        data = _parse_body(node)
        data["tweet_id"] = tweet_id
        data["_node_id"] = _node_id(node)
        data["status"] = _extract_status(node.get("tags", []))
        return data

    async def get_tweet_ids(self, tweet_ids: list[str]) -> set[str]:
        found: set[str] = set()
        for tid in tweet_ids:
            nodes = await self.cortex.get_nodes(kind="tweet", tag=f"tid-{tid}", limit=1)
            if nodes:
                found.add(tid)
        return found

    async def get_queued_tweets(self) -> list[dict]:
        nodes = await self.cortex.get_nodes(kind="tweet", tag="status-queued", limit=200)
        results = []
        for node in nodes:
            data = _parse_body(node)
            data["tweet_id"] = node.get("title", "")
            data["_node_id"] = _node_id(node)
            data["id"] = _node_id(node)
            data["status"] = "queued"
            results.append(data)
        return results

    async def get_queued_tweets_with_metrics(self) -> list[dict]:
        tweets = await self.get_queued_tweets()
        for t in tweets:
            t["_metric_snapshots"] = t.get("metric_snapshots", [])
        return tweets

    async def get_top_candidates(self, threshold: float, limit: int) -> list[dict]:
        queued = await self.get_queued_tweets()
        scored = [
            t for t in queued
            if t.get("virality_score") is not None and t["virality_score"] >= threshold
        ]
        scored.sort(key=lambda t: t.get("virality_score", 0), reverse=True)
        return scored[:limit]

    async def update_tweet_status(self, tweet_id: str, status: str) -> None:
        nodes = await self.cortex.get_nodes(kind="tweet", tag=f"tid-{tweet_id}", limit=1)
        if not nodes:
            return
        node = nodes[0]
        old_tags = node.get("tags", [])
        new_tags = [t for t in old_tags if not t.startswith("status-")]
        new_tags.append(f"status-{status}")

        data = _parse_body(node)
        now = _now_iso()
        if status == "presented":
            data["presented_at"] = now
        elif status == "replied":
            data["replied_at"] = now

        await self.cortex.update_node(_node_id(node), body=data, tags=new_tags)

    async def update_tweet_scores(self, tweet_id: str, scores: dict) -> None:
        nodes = await self.cortex.get_nodes(kind="tweet", tag=f"tid-{tweet_id}", limit=1)
        if not nodes:
            return
        node = nodes[0]
        data = _parse_body(node)
        data.update(scores)
        # If tier is discard, expire the tweet
        new_tags = None
        if scores.get("tier") == "discard" or scores.get("status") == "expired":
            old_tags = node.get("tags", [])
            new_tags = [t for t in old_tags if not t.startswith("status-")]
            new_tags.append("status-expired")
        await self.cortex.update_node(_node_id(node), body=data, tags=new_tags)

    async def expire_stale_tweets(self, hours: int) -> None:
        queued = await self.get_queued_tweets()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        for t in queued:
            created = t.get("tweet_created_at")
            if created:
                if isinstance(created, str):
                    try:
                        created = datetime.fromisoformat(created)
                    except (ValueError, TypeError):
                        continue
                if created < cutoff:
                    await self.update_tweet_status(t.get("tweet_id", t.get("_node_id", "")), "expired")

    async def revert_presented_tweets(self) -> None:
        nodes = await self.cortex.get_nodes(kind="tweet", tag="status-presented", limit=200)
        for node in nodes:
            tweet_id = node.get("title", "")
            await self.update_tweet_status(tweet_id, "queued")

    async def get_pending_tweets_for_rescrape(self, limit: int) -> list[dict]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=4)
        results = []
        for status_tag in ("status-queued", "status-presented"):
            nodes = await self.cortex.get_nodes(kind="tweet", tag=status_tag, limit=100)
            for node in nodes:
                data = _parse_body(node)
                discovered = data.get("discovered_at")
                if discovered:
                    if isinstance(discovered, str):
                        try:
                            discovered = datetime.fromisoformat(discovered)
                        except (ValueError, TypeError):
                            continue
                    if discovered > cutoff:
                        data["tweet_id"] = node.get("title", "")
                        data["tweet_url"] = data.get("tweet_url", "")
                        data["_node_id"] = _node_id(node)
                        results.append(data)
        # Sort by virality_score desc
        results.sort(key=lambda t: t.get("virality_score") or 0, reverse=True)
        return results[:limit]

    async def add_metric_snapshot(self, tweet_id: str, metrics: dict) -> None:
        nodes = await self.cortex.get_nodes(kind="tweet", tag=f"tid-{tweet_id}", limit=1)
        if not nodes:
            return
        node = nodes[0]
        data = _parse_body(node)
        snapshots = data.get("metric_snapshots", [])
        metrics["scraped_at"] = _now_iso()
        snapshots.append(metrics)
        data["metric_snapshots"] = snapshots
        await self.cortex.update_node(_node_id(node), body=data)

    # ==================================================================
    # Replies
    # ==================================================================

    async def insert_reply(self, data: dict) -> str:
        tweet_id = data.get("tweet_id", "")
        now = _now_iso()
        body = {k: v for k, v in data.items() if k != "tweet_id"}
        body["tweet_id"] = tweet_id
        body.setdefault("posted_at", now)

        # Serialize datetimes
        for key in ("posted_at",):
            val = body.get(key)
            if isinstance(val, datetime):
                body[key] = val.isoformat()

        tags = ["reply", f"tweet-{tweet_id}"]
        strategy = body.get("strategy")
        if strategy:
            tags.append(f"strategy-{strategy}")

        node = await self.cortex.create_node(
            kind="reply",
            title=f"reply-{tweet_id}-{now}",
            body=body,
            tags=tags,
        )
        node_id = _node_id(node) if node else ""

        # Create reply→tweet edge
        if node:
            tweet_nodes = await self.cortex.get_nodes(kind="tweet", tag=f"tid-{tweet_id}", limit=1)
            if tweet_nodes:
                await self.cortex.create_edge(node_id, _node_id(tweet_nodes[0]), "reply_to")

        return node_id

    async def insert_replies_batch(self, tweet_id: str, replies: list[dict]) -> None:
        for r in replies:
            r["tweet_id"] = tweet_id
            await self.insert_reply(r)

    async def count_replies_for_tweet(self, tweet_id: str) -> int:
        nodes = await self.cortex.get_nodes(kind="reply", tag=f"tweet-{tweet_id}", limit=200)
        return len(nodes)

    async def get_recent_replies(self, limit: int = 10) -> list[dict]:
        nodes = await self.cortex.get_nodes(kind="reply", limit=200)
        results = []
        for node in nodes:
            data = _parse_body(node)
            data["_node_id"] = _node_id(node)
            results.append(data)
        # Sort by posted_at desc
        results.sort(key=lambda r: r.get("posted_at", ""), reverse=True)
        return results[:limit]

    async def get_reply_window(self, days: int = 7) -> list[dict]:
        nodes = await self.cortex.get_nodes(kind="reply", limit=500)
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        results = []
        for node in nodes:
            data = _parse_body(node)
            posted = data.get("posted_at")
            if not posted:
                continue
            if isinstance(posted, str):
                try:
                    posted = datetime.fromisoformat(posted)
                except (ValueError, TypeError):
                    continue
            if posted >= cutoff and data.get("impressions", 0) > 0:
                data["_node_id"] = _node_id(node)
                results.append(data)
        results.sort(key=lambda r: r.get("posted_at", ""), reverse=True)
        return results

    async def get_today_replies(self) -> list[dict]:
        nodes = await self.cortex.get_nodes(kind="reply", limit=200)
        today = date.today().isoformat()
        results = []
        for node in nodes:
            data = _parse_body(node)
            posted = data.get("posted_at", "")
            if isinstance(posted, str) and posted.startswith(today):
                # Enrich with tweet author
                tweet_id = data.get("tweet_id", "")
                tweet = await self.get_tweet(tweet_id) if tweet_id else None
                data["author_handle"] = tweet.get("author_handle", "") if tweet else ""
                data["_node_id"] = _node_id(node)
                results.append(data)
        results.sort(key=lambda r: r.get("posted_at", ""), reverse=True)
        return results

    async def update_reply_metrics(self, reply_node_id: str, metrics: dict) -> None:
        node = await self.cortex.get_node(reply_node_id)
        if not node:
            return
        data = _parse_body(node)
        data.update(metrics)
        data["metrics_updated_at"] = _now_iso()
        await self.cortex.update_node(reply_node_id, body=data)

    async def upsert_post_analytics(self, post_id: str, data: dict) -> str:
        """Create or update a post analytics node.

        Used by the CSV importer to store metrics for any post/reply
        from the account, whether or not Echo generated it.
        """
        tag = f"pid-{post_id}"
        existing = await self.cortex.get_nodes(kind="post", tag=tag, limit=1)

        metrics_data = {k: v for k, v in data.items()}
        metrics_data["post_id"] = post_id
        metrics_data["metrics_updated_at"] = _now_iso()

        if existing:
            node_id = _node_id(existing[0])
            old_data = _parse_body(existing[0])
            old_data.update(metrics_data)
            await self.cortex.update_node(node_id, body=old_data)
            return node_id

        tags = ["post", tag]
        text = data.get("text", "")
        # Tag as reply if it starts with @ (it's a reply to someone)
        if text.startswith("@"):
            tags.append("is-reply")
        post_url = data.get("post_url", "")
        if post_url:
            tags.append("has-url")

        node = await self.cortex.create_node(
            kind="post",
            title=post_id,
            body=metrics_data,
            tags=tags,
        )
        return _node_id(node) if node else ""

    async def find_post_by_id(self, post_id: str) -> dict | None:
        """Find a post analytics node by post ID."""
        nodes = await self.cortex.get_nodes(kind="post", tag=f"pid-{post_id}", limit=1)
        if nodes:
            data = _parse_body(nodes[0])
            data["_node_id"] = _node_id(nodes[0])
            return data
        return None

    async def find_reply_by_reply_id(self, reply_id: str) -> dict | None:
        nodes = await self.cortex.get_nodes(kind="reply", limit=500)
        for node in nodes:
            data = _parse_body(node)
            if data.get("reply_id") == reply_id:
                data["_node_id"] = _node_id(node)
                return data
        return None

    async def find_reply_by_text(self, text: str) -> dict | None:
        nodes = await self.cortex.get_nodes(kind="reply", limit=500)
        prefix = text[:50]
        for node in nodes:
            data = _parse_body(node)
            reply_text = data.get("reply_text", "")
            if reply_text == text or prefix in reply_text:
                data["_node_id"] = _node_id(node)
                return data
        return None

    async def get_replies_due_for_scrape(self, limit: int = 10) -> list[dict]:
        nodes = await self.cortex.get_nodes(kind="reply", limit=500)
        now = datetime.now(timezone.utc)
        due = []
        for node in nodes:
            data = _parse_body(node)
            if not data.get("posted_at") or not data.get("reply_url"):
                continue
            posted = _parse_dt(data["posted_at"])
            if not posted:
                continue
            last_scraped = _parse_dt(data.get("metrics_updated_at")) if data.get("metrics_updated_at") else None

            age = now - posted
            is_due = False
            if last_scraped is None and age > timedelta(hours=1):
                is_due = True
            elif last_scraped and (now - last_scraped) > timedelta(hours=5) and age < timedelta(hours=24):
                is_due = True
            elif last_scraped and (now - last_scraped) > timedelta(hours=20) and age < timedelta(hours=48):
                is_due = True

            if is_due:
                data["_node_id"] = _node_id(node)
                due.append(data)

        due.sort(key=lambda r: r.get("posted_at", ""), reverse=True)
        return due[:limit]

    # ==================================================================
    # Digests
    # ==================================================================

    async def store_digest(
        self, date_str: str, digest_json: dict, total_replies: int, avg_score: float,
    ) -> None:
        if isinstance(date_str, date):
            date_str = date_str.isoformat()
        # Check for existing digest for this date
        nodes = await self.cortex.get_nodes(kind="daily_digest", limit=100)
        for node in nodes:
            if node.get("title") == date_str:
                await self.cortex.update_node(
                    _node_id(node),
                    body={
                        "digest_json": digest_json,
                        "total_replies": total_replies,
                        "avg_score": avg_score,
                    },
                )
                return

        await self.cortex.create_node(
            kind="daily_digest",
            title=date_str,
            body={
                "digest_json": digest_json,
                "total_replies": total_replies,
                "avg_score": avg_score,
            },
            tags=["daily-digest"],
        )

    async def get_latest_digest(self) -> dict | None:
        nodes = await self.cortex.get_nodes(kind="daily_digest", limit=100)
        if not nodes:
            return None
        # Sort by title (date string) desc
        nodes.sort(key=lambda n: n.get("title", ""), reverse=True)
        node = nodes[0]
        data = _parse_body(node)
        data["date"] = node.get("title", "")
        return data

    async def get_winning_patterns(self) -> dict | None:
        digest = await self.get_latest_digest()
        if not digest:
            return None
        dj = digest.get("digest_json", {})
        if isinstance(dj, str):
            try:
                dj = json.loads(dj)
            except (json.JSONDecodeError, TypeError):
                return None
        return dj.get("winning_patterns")

    async def get_thirty_day_avg_score(self) -> float:
        nodes = await self.cortex.get_nodes(kind="daily_digest", limit=100)
        cutoff = (date.today() - timedelta(days=30)).isoformat()
        scores = []
        for node in nodes:
            title = node.get("title", "")
            if title >= cutoff:
                data = _parse_body(node)
                score = data.get("avg_score")
                if score is not None:
                    scores.append(float(score))
        return sum(scores) / len(scores) if scores else 0.0

    # ==================================================================
    # Strategy scores
    # ==================================================================

    async def get_latest_strategy_scores(self) -> dict[str, float]:
        nodes = await self.cortex.get_nodes(kind="strategy_score", limit=100)
        if not nodes:
            return {}
        # Find the latest date
        latest_date = ""
        for node in nodes:
            data = _parse_body(node)
            d = data.get("date", node.get("title", ""))
            if isinstance(d, date):
                d = d.isoformat()
            if d > latest_date:
                latest_date = d
        # Collect scores for that date
        result: dict[str, float] = {}
        for node in nodes:
            data = _parse_body(node)
            d = data.get("date", node.get("title", ""))
            if isinstance(d, date):
                d = d.isoformat()
            if d == latest_date:
                strategy = data.get("strategy", "")
                result[strategy] = data.get("win_rate", 0.0)
        return result

    async def upsert_strategy_score(
        self, date_val: str | date, strategy: str, total: int, wins: int, win_rate: float,
    ) -> None:
        if isinstance(date_val, date):
            date_val = date_val.isoformat()
        title = f"{date_val}-{strategy}"

        # Check for existing
        nodes = await self.cortex.get_nodes(kind="strategy_score", limit=200)
        for node in nodes:
            if node.get("title") == title:
                await self.cortex.update_node(
                    _node_id(node),
                    body={
                        "date": date_val,
                        "strategy": strategy,
                        "total": total,
                        "wins": wins,
                        "win_rate": win_rate,
                    },
                )
                return

        await self.cortex.create_node(
            kind="strategy_score",
            title=title,
            body={
                "date": date_val,
                "strategy": strategy,
                "total": total,
                "wins": wins,
                "win_rate": win_rate,
            },
            tags=["strategy-score", f"strategy-{strategy}"],
        )

    # ==================================================================
    # Stats (for CLI / orchestrator)
    # ==================================================================

    async def get_session_stats(self) -> dict:
        queued = await self.cortex.get_nodes(kind="tweet", tag="status-queued", limit=500)
        today_replies = await self.get_today_replies()

        # Compute avg score of today's discovered tweets
        today_str = date.today().isoformat()
        all_tweets = await self.cortex.get_nodes(kind="tweet", limit=500)
        today_scores = []
        for node in all_tweets:
            data = _parse_body(node)
            discovered = data.get("discovered_at", "")
            if isinstance(discovered, str) and discovered.startswith(today_str):
                score = data.get("virality_score")
                if score is not None:
                    today_scores.append(float(score))

        return {
            "queue_depth": len(queued),
            "posted_today": len(today_replies),
            "avg_score": sum(today_scores) / len(today_scores) if today_scores else None,
            "follower_delta": 0,
        }

    # ==================================================================
    # Candidate queue (compatibility with Database class)
    # ==================================================================

    async def get_next_candidate(self) -> dict | None:
        queued = await self.get_queued_tweets()
        scored = [t for t in queued if t.get("virality_score") is not None]
        if not scored:
            return None
        scored.sort(key=lambda t: t.get("virality_score", 0), reverse=True)
        return scored[0]

    async def get_queue_depth(self) -> int:
        nodes = await self.cortex.get_nodes(kind="tweet", tag="status-queued", limit=500)
        return len(nodes)

    async def record_reply(
        self,
        tweet_id: str,
        reply_text: str,
        strategy: str,
        was_edited: bool,
        original_text: str | None = None,
    ) -> str:
        node_id = await self.insert_reply({
            "tweet_id": tweet_id,
            "reply_text": reply_text,
            "strategy": strategy,
            "was_edited": was_edited,
            "original_text": original_text,
        })
        await self.update_tweet_status(tweet_id, "replied")
        return node_id


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _strip_internal(d: dict) -> dict:
    """Remove internal keys from a dict before saving back."""
    return {k: v for k, v in d.items() if not k.startswith("_")}


def _extract_status(tags: list[str]) -> str:
    """Extract status from tag list like ['status-queued', ...]."""
    for tag in tags:
        if tag.startswith("status-"):
            return tag[7:]
    return "unknown"


def _parse_dt(val: Any) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val)
        except (ValueError, TypeError):
            return None
    return None
