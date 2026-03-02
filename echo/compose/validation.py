"""Character count, deduplication, and quality checks for generated replies."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from echo.compose import GeneratedReply

MAX_TWEET_LENGTH = 280

GENERIC_PATTERNS = [
    r"^great\s+(post|point|take|thread)",
    r"^this\s+is\s+so\s+true",
    r"^couldn'?t\s+agree\s+more",
    r"^love\s+this",
    r"^so\s+true",
    r"^100%",
    r"^exactly",
    r"^well\s+said",
]
_GENERIC_RE = re.compile("|".join(GENERIC_PATTERNS), re.IGNORECASE)


def validate_length(reply: GeneratedReply) -> GeneratedReply:
    """Ensure reply is within 280 chars, truncating as last resort."""
    if len(reply.text) <= MAX_TWEET_LENGTH:
        return reply
    reply.text = reply.text[: MAX_TWEET_LENGTH - 3] + "..."
    return reply


def is_generic(text: str) -> bool:
    """Check if a reply is generic/low-value."""
    return _GENERIC_RE.search(text.strip()) is not None


def validate_replies(replies: list[GeneratedReply]) -> list[GeneratedReply]:
    """Validate and clean a list of generated replies."""
    seen_texts: set[str] = set()
    valid: list[GeneratedReply] = []

    for reply in replies:
        reply = validate_length(reply)

        # Skip exact duplicates
        normalised = reply.text.strip().lower()
        if normalised in seen_texts:
            continue
        seen_texts.add(normalised)

        valid.append(reply)

    return valid
