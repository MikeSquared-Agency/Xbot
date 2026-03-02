"""Tests for echo.context module — cache, engagement, and brief_generator."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from echo.context.cache import needs_refresh
from echo.context.engagement import compute_avg_engagement, compute_posting_frequency


# ---------------------------------------------------------------------------
# cache.needs_refresh
# ---------------------------------------------------------------------------

class TestNeedsRefresh:
    def test_none_author(self):
        assert needs_refresh(None) is True

    def test_no_enrichment_updated(self):
        assert needs_refresh({"handle": "test"}) is True

    def test_enrichment_updated_none(self):
        assert needs_refresh({"enrichment_updated": None}) is True

    def test_fresh_author(self):
        recent = datetime.now(timezone.utc) - timedelta(hours=1)
        assert needs_refresh({"enrichment_updated": recent}) is False

    def test_stale_author(self):
        old = datetime.now(timezone.utc) - timedelta(hours=25)
        assert needs_refresh({"enrichment_updated": old}) is True

    def test_just_under_24_hours(self):
        # 23h59m — should NOT refresh
        boundary = datetime.now(timezone.utc) - timedelta(hours=23, minutes=59)
        assert needs_refresh({"enrichment_updated": boundary}) is False


# ---------------------------------------------------------------------------
# engagement.compute_avg_engagement
# ---------------------------------------------------------------------------

class TestComputeAvgEngagement:
    def test_empty_tweets(self):
        assert compute_avg_engagement([], 1000) == 0.0

    def test_zero_followers(self):
        tweets = [{"likes": 10, "retweets": 5, "replies": 2}]
        assert compute_avg_engagement(tweets, 0) == 0.0

    def test_none_followers(self):
        tweets = [{"likes": 10, "retweets": 5, "replies": 2}]
        assert compute_avg_engagement(tweets, None) == 0.0

    def test_single_tweet(self):
        tweets = [{"likes": 100, "retweets": 50, "replies": 20}]
        # engagement = 100 + 50*2 + 20*1.5 = 100 + 100 + 30 = 230
        # rate = 230 / 10000 = 0.023
        rate = compute_avg_engagement(tweets, 10000)
        assert rate == pytest.approx(0.023)

    def test_multiple_tweets(self):
        tweets = [
            {"likes": 10, "retweets": 5, "replies": 2},
            {"likes": 20, "retweets": 10, "replies": 4},
        ]
        # tweet1: 10 + 10 + 3 = 23
        # tweet2: 20 + 20 + 6 = 46
        # total: 69, avg: 34.5, rate: 34.5 / 1000 = 0.0345
        rate = compute_avg_engagement(tweets, 1000)
        assert rate == pytest.approx(0.0345)

    def test_missing_fields_default_zero(self):
        tweets = [{"likes": 10}]
        # 10 + 0 + 0 = 10, rate = 10 / 1000 = 0.01
        rate = compute_avg_engagement(tweets, 1000)
        assert rate == pytest.approx(0.01)


# ---------------------------------------------------------------------------
# engagement.compute_posting_frequency
# ---------------------------------------------------------------------------

class TestComputePostingFrequency:
    def test_empty_tweets(self):
        assert compute_posting_frequency([]) == 0.0

    def test_single_tweet(self):
        assert compute_posting_frequency([{"created_at": datetime.now(timezone.utc)}]) == 0.0

    def test_two_tweets_one_day_apart(self):
        now = datetime.now(timezone.utc)
        tweets = [
            {"created_at": now},
            {"created_at": now - timedelta(days=1)},
        ]
        freq = compute_posting_frequency(tweets)
        assert freq == pytest.approx(2.0, abs=0.1)

    def test_five_tweets_over_two_days(self):
        now = datetime.now(timezone.utc)
        tweets = [
            {"created_at": now},
            {"created_at": now - timedelta(hours=12)},
            {"created_at": now - timedelta(hours=24)},
            {"created_at": now - timedelta(hours=36)},
            {"created_at": now - timedelta(hours=48)},
        ]
        freq = compute_posting_frequency(tweets)
        assert freq == pytest.approx(2.5, abs=0.1)

    def test_missing_created_at(self):
        tweets = [{"created_at": None}, {"created_at": None}]
        assert compute_posting_frequency(tweets) == 0.0


# ---------------------------------------------------------------------------
# brief_generator.generate_brief
# ---------------------------------------------------------------------------

class TestGenerateBrief:
    @pytest.mark.asyncio
    async def test_generate_brief_calls_claude(self):
        mock_block = type("TextBlock", (), {"text": "Role: Engineer\nVibe: casual"})()
        mock_message = type("Message", (), {"content": [mock_block]})()

        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_message)

        with patch("echo.context.brief_generator._get_client", return_value=mock_client):
            from echo.context.brief_generator import generate_brief

            profile = {
                "handle": "testuser",
                "display_name": "Test User",
                "bio": "AI engineer",
                "followers": 5000,
                "following": 200,
                "website": "https://test.com",
            }
            tweets = [
                {"content": "Building agents", "likes": 50, "replies": 5},
            ]
            interaction = {"times_replied_to": 2, "last_replied_at": "2025-01-01"}

            brief = await generate_brief(profile, tweets, interaction)

            assert "Role: Engineer" in brief
            mock_client.messages.create.assert_called_once()
            call_kwargs = mock_client.messages.create.call_args[1]
            assert call_kwargs["model"] == "claude-sonnet-4-20250514"
            assert call_kwargs["max_tokens"] == 300

    @pytest.mark.asyncio
    async def test_generate_brief_no_interaction(self):
        mock_block = type("TextBlock", (), {"text": "Role: Designer"})()
        mock_message = type("Message", (), {"content": [mock_block]})()

        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_message)

        with patch("echo.context.brief_generator._get_client", return_value=mock_client):
            from echo.context.brief_generator import generate_brief

            profile = {"handle": "u", "followers": 0, "following": 0}
            brief = await generate_brief(profile, [], None)

            assert "Role: Designer" in brief

    @pytest.mark.asyncio
    async def test_generate_brief_handles_missing_profile_fields(self):
        mock_block = type("TextBlock", (), {"text": "Role: Unknown"})()
        mock_message = type("Message", (), {"content": [mock_block]})()

        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_message)

        with patch("echo.context.brief_generator._get_client", return_value=mock_client):
            from echo.context.brief_generator import generate_brief

            # Minimal profile — no bio, no website, no display_name
            profile = {"handle": "minimal"}
            brief = await generate_brief(profile, [], None)

            assert isinstance(brief, str)


# ---------------------------------------------------------------------------
# enrichment.enrich_author (integration-style with mocks)
# ---------------------------------------------------------------------------

class TestEnrichAuthor:
    @pytest.mark.asyncio
    async def test_cache_hit_returns_existing_brief(self):
        recent = datetime.now(timezone.utc) - timedelta(hours=1)
        cached_author = {
            "handle": "cached",
            "enrichment_brief": "Cached brief",
            "enrichment_updated": recent,
            "times_replied_to": 0,
        }

        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=cached_author)

        with patch("echo.context.enrichment.asyncpg") as mock_asyncpg:
            mock_asyncpg.connect = AsyncMock(return_value=mock_conn)

            from echo.context.enrichment import enrich_author

            xbot_call = AsyncMock()
            brief = await enrich_author("cached", xbot_call)

            assert brief == "Cached brief"
            xbot_call.assert_not_called()

    @pytest.mark.asyncio
    async def test_cache_miss_scrapes_and_enriches(self):
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)  # No cached author
        mock_conn.execute = AsyncMock()

        profile = {
            "handle": "newuser",
            "display_name": "New User",
            "bio": "Developer",
            "followers": 1000,
            "following": 500,
            "verified": False,
            "website": None,
            "join_date": None,
        }
        tweets = [
            {
                "content": "Hello world",
                "likes": 10,
                "retweets": 2,
                "replies": 1,
                "created_at": datetime.now(timezone.utc),
            },
        ]

        async def mock_xbot_call(tool, params):
            if tool == "x:get-author-profile":
                return profile
            if tool == "x:get-author-timeline":
                return tweets
            return None

        with (
            patch("echo.context.enrichment.asyncpg") as mock_asyncpg,
            patch("echo.context.enrichment.generate_brief", new_callable=AsyncMock) as mock_brief,
        ):
            mock_asyncpg.connect = AsyncMock(return_value=mock_conn)
            mock_brief.return_value = "Generated brief for newuser"

            from echo.context.enrichment import enrich_author

            brief = await enrich_author("newuser", mock_xbot_call)

            assert brief == "Generated brief for newuser"
            mock_brief.assert_called_once()
            mock_conn.execute.assert_called_once()  # upsert was called
