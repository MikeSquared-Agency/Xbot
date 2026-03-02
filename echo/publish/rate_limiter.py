from __future__ import annotations

from datetime import datetime, timezone


class RateLimiter:
    def __init__(self, min_interval_seconds: int = 600):
        self.min_interval = min_interval_seconds
        self.last_post_time: datetime | None = None

    async def check(self) -> tuple[bool, int]:
        """Returns (can_post, seconds_to_wait)."""
        if self.last_post_time is None:
            return True, 0

        elapsed = (datetime.now(timezone.utc) - self.last_post_time).total_seconds()
        if elapsed >= self.min_interval:
            return True, 0

        wait = int(self.min_interval - elapsed)
        return False, wait

    def record_post(self) -> None:
        self.last_post_time = datetime.now(timezone.utc)
