from __future__ import annotations

from dataclasses import dataclass


class PublishError(Exception):
    pass


@dataclass
class PublishResult:
    success: bool
    reply_url: str | None = None
    reply_id: str | None = None
    time_to_reply: int | None = None
    error: str | None = None
