"""Tests for validation module."""

from echo.compose import GeneratedReply
from echo.compose.validation import (
    MAX_TWEET_LENGTH,
    is_generic,
    validate_length,
    validate_replies,
)


def _reply(text: str, strategy: str = "additive") -> GeneratedReply:
    return GeneratedReply(strategy=strategy, text=text, reasoning="test")


class TestValidateLength:
    def test_short_text_unchanged(self):
        r = _reply("Hello world")
        result = validate_length(r)
        assert result.text == "Hello world"

    def test_exact_280_unchanged(self):
        text = "a" * 280
        r = _reply(text)
        result = validate_length(r)
        assert result.text == text
        assert len(result.text) == 280

    def test_over_280_truncated(self):
        text = "a" * 300
        r = _reply(text)
        result = validate_length(r)
        assert len(result.text) == MAX_TWEET_LENGTH
        assert result.text.endswith("...")

    def test_281_truncated(self):
        text = "a" * 281
        r = _reply(text)
        result = validate_length(r)
        assert len(result.text) == MAX_TWEET_LENGTH


class TestIsGeneric:
    def test_great_post(self):
        assert is_generic("Great post!") is True

    def test_so_true(self):
        assert is_generic("So true") is True

    def test_couldnt_agree_more(self):
        assert is_generic("Couldn't agree more") is True

    def test_love_this(self):
        assert is_generic("Love this") is True

    def test_specific_reply_not_generic(self):
        assert is_generic("The cache invalidation approach here misses the TTL edge case") is False

    def test_well_said(self):
        assert is_generic("Well said") is True


class TestValidateReplies:
    def test_deduplicates(self):
        replies = [
            _reply("Same text", "contrarian"),
            _reply("Same text", "experience"),
            _reply("Different text", "additive"),
        ]
        result = validate_replies(replies)
        assert len(result) == 2

    def test_truncates_long_replies(self):
        replies = [_reply("x" * 300, "contrarian")]
        result = validate_replies(replies)
        assert len(result[0].text) == MAX_TWEET_LENGTH

    def test_preserves_valid_replies(self):
        replies = [
            _reply("Reply one", "contrarian"),
            _reply("Reply two", "experience"),
            _reply("Reply three", "additive"),
            _reply("Reply four", "question"),
            _reply("Reply five", "pattern_interrupt"),
        ]
        result = validate_replies(replies)
        assert len(result) == 5

    def test_case_insensitive_dedup(self):
        replies = [
            _reply("Hello World", "contrarian"),
            _reply("hello world", "experience"),
        ]
        result = validate_replies(replies)
        assert len(result) == 1
