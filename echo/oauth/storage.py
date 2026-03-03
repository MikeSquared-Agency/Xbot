"""File-based token persistence at ~/.xbot/tokens.json."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

TOKEN_PATH = Path.home() / ".xbot" / "tokens.json"
EXPIRY_LEEWAY = 300  # 5 minutes


class TokenStorage:
    """Read/write OAuth tokens to disk with secure permissions."""

    @staticmethod
    async def load() -> dict | None:
        """Load tokens from disk. Returns None if file missing or invalid."""
        if not TOKEN_PATH.exists():
            return None
        try:
            data = json.loads(TOKEN_PATH.read_text())
            if "access_token" not in data:
                return None
            return data
        except (json.JSONDecodeError, KeyError):
            return None

    @staticmethod
    async def save(tokens: dict) -> None:
        """Atomically write tokens with 0o600 permissions."""
        TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)

        # Compute expires_at from expires_in if not already set
        if "expires_at" not in tokens and "expires_in" in tokens:
            tokens["expires_at"] = time.time() + tokens["expires_in"]

        tmp = TOKEN_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(tokens, indent=2))
        os.chmod(tmp, 0o600)
        os.replace(tmp, TOKEN_PATH)

    @staticmethod
    async def clear() -> None:
        """Remove token file."""
        if TOKEN_PATH.exists():
            TOKEN_PATH.unlink()

    @staticmethod
    def is_expired(tokens: dict) -> bool:
        """Check if access token is expired (with 5-min leeway)."""
        expires_at = tokens.get("expires_at", 0)
        return time.time() >= (expires_at - EXPIRY_LEEWAY)
