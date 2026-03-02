from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class GeneratedReply:
    """A single generated reply candidate."""

    strategy: str  # contrarian, experience, additive, question, pattern_interrupt
    text: str  # The reply text (≤280 chars)
    reasoning: str  # Why this approach (stored for analysis)
    original_text: str | None = None  # Set if user edits before posting


@dataclass
class Tweet:
    """Minimal tweet record used by the compose pipeline."""

    tweet_id: str
    author_handle: str
    content: str
    score: float | None = None
    metadata: dict | None = field(default_factory=dict)


from echo.compose.generator import generate_replies  # noqa: E402, F401

__all__ = ["GeneratedReply", "Tweet", "generate_replies"]
