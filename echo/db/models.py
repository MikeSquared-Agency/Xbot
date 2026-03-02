from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class GeneratedReply:
    """In-memory reply option produced by the Compose module (not DB-backed)."""
    slot: int
    strategy: str
    text: str
    original_text: Optional[str] = None


@dataclass
class Tweet:
    tweet_id: str
    tweet_url: str
    author_handle: str
    author_name: Optional[str]
    content: str
    author_followers: Optional[int]
    author_verified: bool
    likes_t0: int
    replies_t0: int
    retweets_t0: int
    virality_score: Optional[float]
    status: str
    tweet_created_at: Optional[datetime]
    discovered_at: datetime


@dataclass
class Candidate:
    tweet: Tweet
    generated_replies: list[GeneratedReply] = field(default_factory=list)


@dataclass
class SessionStats:
    queue_depth: int
    posted_today: int
    avg_score: Optional[float]
    follower_delta: int


@dataclass
class PostedReply:
    reply_text: str
    strategy: str
    impressions: Optional[int]
    likes: Optional[int]
    posted_at: Optional[datetime]
    author_handle: str


@dataclass
class DailyDigest:
    date: datetime
    tweets_discovered: Optional[int]
    replies_posted: Optional[int]
    avg_impressions: Optional[float]
    follower_delta: Optional[int]
    strategy_breakdown: Optional[dict]
    recommendations: Optional[str]
