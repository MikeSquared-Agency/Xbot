"""Tests for prompt construction."""

import json

from echo.compose.prompt import build_compose_prompt


class TestBuildComposePrompt:
    def test_contains_tweet_content(self):
        prompt = build_compose_prompt(
            tweet_author="elonmusk",
            tweet_content="AI will change everything",
            author_brief="Tech CEO",
            profile={"name": "Mike", "style": "technical"},
            strategy_order=["contrarian", "experience", "additive", "question", "pattern_interrupt"],
            recent_own_tweets=["Built a new API today"],
        )
        assert "AI will change everything" in prompt
        assert "@elonmusk" in prompt

    def test_contains_voice_profile(self):
        profile = {"name": "Mike", "style": "technical", "tone": "direct"}
        prompt = build_compose_prompt(
            tweet_author="test",
            tweet_content="test",
            author_brief="test",
            profile=profile,
            strategy_order=["contrarian"],
            recent_own_tweets=[],
        )
        assert json.dumps(profile, indent=2) in prompt

    def test_contains_author_brief(self):
        prompt = build_compose_prompt(
            tweet_author="test",
            tweet_content="test",
            author_brief="Senior engineer at Google, focuses on distributed systems",
            profile={},
            strategy_order=["contrarian"],
            recent_own_tweets=[],
        )
        assert "Senior engineer at Google" in prompt

    def test_contains_all_strategies(self):
        strategies = ["contrarian", "experience", "additive", "question", "pattern_interrupt"]
        prompt = build_compose_prompt(
            tweet_author="test",
            tweet_content="test",
            author_brief="test",
            profile={},
            strategy_order=strategies,
            recent_own_tweets=[],
        )
        for s in strategies:
            assert f'"strategy": "{s}"' in prompt

    def test_includes_winning_patterns(self):
        patterns = {"top_opener": "Actually,", "avg_length": 120}
        prompt = build_compose_prompt(
            tweet_author="test",
            tweet_content="test",
            author_brief="test",
            profile={},
            strategy_order=["contrarian"],
            recent_own_tweets=[],
            winning_patterns=patterns,
        )
        assert "TOP-PERFORMING REPLY PATTERNS" in prompt
        assert "top_opener" in prompt

    def test_no_patterns_section_when_none(self):
        prompt = build_compose_prompt(
            tweet_author="test",
            tweet_content="test",
            author_brief="test",
            profile={},
            strategy_order=["contrarian"],
            recent_own_tweets=[],
            winning_patterns=None,
        )
        assert "TOP-PERFORMING REPLY PATTERNS" not in prompt

    def test_includes_recent_tweets(self):
        prompt = build_compose_prompt(
            tweet_author="test",
            tweet_content="test",
            author_brief="test",
            profile={},
            strategy_order=["contrarian"],
            recent_own_tweets=["My first tweet", "My second tweet"],
        )
        assert "- My first tweet" in prompt
        assert "- My second tweet" in prompt

    def test_empty_recent_tweets_placeholder(self):
        prompt = build_compose_prompt(
            tweet_author="test",
            tweet_content="test",
            author_brief="test",
            profile={},
            strategy_order=["contrarian"],
            recent_own_tweets=[],
        )
        assert "no recent tweets available" in prompt

    def test_contains_rules(self):
        prompt = build_compose_prompt(
            tweet_author="test",
            tweet_content="test",
            author_brief="test",
            profile={},
            strategy_order=["contrarian"],
            recent_own_tweets=[],
        )
        assert "Max 280 characters" in prompt
        assert "NEVER generic" in prompt
        assert "Return ONLY the JSON array" in prompt
