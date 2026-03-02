from __future__ import annotations

from datetime import datetime, timezone

REFRESH_HOURS = 24


def needs_refresh(author: dict | None) -> bool:
    """Return True if the author record needs a fresh scrape + enrichment."""
    if author is None:
        return True
    enrichment_updated = author.get("enrichment_updated")
    if enrichment_updated is None:
        return True
    now = datetime.now(timezone.utc)
    hours_since = (now - enrichment_updated).total_seconds() / 3600
    return hours_since > REFRESH_HOURS
