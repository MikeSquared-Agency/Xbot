from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from echo.db.store import EchoStore

from echo.scout.dedup import filter_already_seen
from echo.scout.extraction import RawTweet, raw_tweet_from_dict
from echo.scout.filters import passes_hard_filters
from echo.scout.keywords import KeywordRotator
from echo.xbot.client import XbotClient

log = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 600  # 10 minutes
RESCRAPE_LIMIT = 20


class ScoutPoller:
    """Polls X every 10 minutes to find tweets worth replying to."""

    def __init__(
        self,
        store: EchoStore,
        xbot: XbotClient,
        watchlist_url: str,
        keywords: list[str],
        anti_signals: list[str] | None = None,
        niche_embedding: list[float] | None = None,
    ):
        self.store = store
        self.xbot = xbot
        self.watchlist_url = watchlist_url
        self.keyword_rotator = KeywordRotator(keywords)
        self.anti_signals = anti_signals
        self.niche_embedding = niche_embedding
        self._running = False

    async def run(self) -> None:
        """Start the polling loop. Runs until cancelled."""
        self._running = True
        log.info("Scout polling started (interval=%ds)", POLL_INTERVAL_SECONDS)

        while self._running:
            try:
                await self.poll_cycle()
            except Exception:
                log.exception("Error in poll cycle")
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    def stop(self) -> None:
        self._running = False

    async def poll_cycle(self) -> None:
        """Single polling cycle: scrape, filter, store."""
        log.info("Starting poll cycle")

        # 1. Watchlist (priority source)
        list_tweets = await self._fetch_list_tweets()

        # 2. Keyword search (secondary, rotate)
        keyword = self.keyword_rotator.next()
        search_tweets = await self._fetch_search_tweets(keyword)

        # 3. Combine and deduplicate by tweet_id
        seen_ids: set[str] = set()
        all_tweets: list[RawTweet] = []
        for tweet in list_tweets + search_tweets:
            if tweet.tweet_id not in seen_ids:
                seen_ids.add(tweet.tweet_id)
                all_tweets.append(tweet)

        log.info("Scraped %d unique tweets (list=%d, search=%d)",
                 len(all_tweets), len(list_tweets), len(search_tweets))

        # 4. Filter out already seen
        new_tweets = await filter_already_seen(self.store, all_tweets)

        # 5. Hard filters
        list_ids = {t.tweet_id for t in list_tweets}
        candidates: list[RawTweet] = []
        for tweet in new_tweets:
            if passes_hard_filters(tweet, self.anti_signals):
                tweet.source = "watchlist" if tweet.tweet_id in list_ids else "keyword_search"
                candidates.append(tweet)

        log.info("After filters: %d candidates from %d new tweets",
                 len(candidates), len(new_tweets))

        # 7. Write to Cortex
        if candidates:
            await self._insert_tweets(candidates)

        # 8. Re-scrape metrics for pending tweets (velocity calculation)
        await self._rescrape_pending_tweets()

        # 9. Score all queued tweets
        try:
            from echo.scorer.pipeline import score_tweets

            scored = await score_tweets(niche_embedding=self.niche_embedding)
            log.info("Scored %d queued tweets", scored)
        except Exception:
            log.exception("Error scoring tweets")

    async def _fetch_list_tweets(self) -> list[RawTweet]:
        try:
            result = await self.xbot.call("x:get-list-feed", {
                "list_url": self.watchlist_url,
            })
            items = result.get("content", [])
            # MCP tools/call returns {content: [{type: "text", text: "..."}]}
            tweets_data = _extract_json_content(items)
            return [raw_tweet_from_dict(d) for d in tweets_data]
        except Exception:
            log.exception("Failed to fetch watchlist")
            return []

    async def _fetch_search_tweets(self, keyword: str) -> list[RawTweet]:
        try:
            result = await self.xbot.call("x:search-tweets", {
                "query": keyword,
                "tab": "latest",
            })
            items = result.get("content", [])
            tweets_data = _extract_json_content(items)
            return [raw_tweet_from_dict(d) for d in tweets_data]
        except Exception:
            log.exception("Failed to search for keyword=%s", keyword)
            return []

    async def _insert_tweets(self, tweets: list[RawTweet]) -> None:
        tweet_dicts = [
            {
                "tweet_id": t.tweet_id,
                "tweet_url": t.tweet_url,
                "author_handle": t.author_handle,
                "author_name": t.author_name,
                "author_verified": t.author_verified,
                "author_followers": t.author_followers,
                "content": t.content,
                "is_quote_tweet": t.is_quote_tweet,
                "is_reply": t.is_reply,
                "is_thread": t.is_thread,
                "has_media": t.has_media,
                "likes_t0": t.likes,
                "retweets_t0": t.retweets,
                "replies_t0": t.replies,
                "bookmarks_t0": t.bookmarks,
                "views_t0": t.views,
                "source": t.source,
                "tweet_created_at": t.created_at,
            }
            for t in tweets
        ]
        inserted = await self.store.insert_tweets(tweet_dicts)
        log.info("Inserted %d tweets", inserted)

    async def _rescrape_pending_tweets(self) -> None:
        """Re-scrape metrics for tweets still in the scoring window."""
        pending = await self.store.get_pending_tweets_for_rescrape(RESCRAPE_LIMIT)

        for tweet in pending:
            try:
                result = await self.xbot.call("x:get-tweet-metrics", {
                    "tweet_url": tweet.get("tweet_url", ""),
                })
                metrics = _extract_json_content(result.get("content", []))
                if not metrics:
                    continue
                m = metrics[0] if isinstance(metrics, list) else metrics

                await self.store.add_metric_snapshot(
                    tweet.get("tweet_id", ""),
                    {
                        "likes": int(m.get("likes", 0)),
                        "retweets": int(m.get("retweets", 0)),
                        "replies": int(m.get("replies", 0)),
                        "bookmarks": m.get("bookmarks"),
                        "views": m.get("views"),
                    },
                )
            except Exception:
                log.exception("Failed to rescrape tweet %s", tweet.get("tweet_id", ""))


def _extract_json_content(items: list | dict) -> list[dict]:
    """Extract structured data from MCP tool result content blocks."""
    import json

    if isinstance(items, dict):
        return [items]

    results = []
    for item in items:
        if isinstance(item, dict):
            text = item.get("text", "")
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    results.extend(parsed)
                else:
                    results.append(parsed)
            except (json.JSONDecodeError, TypeError):
                continue
    return results
