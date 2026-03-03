from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from repo root
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)


def get_cortex_url() -> str:
    return os.environ.get("CORTEX_HTTP", "http://localhost:9091")


def get_watchlist_url() -> str:
    url = os.environ.get("ECHO_X_LIST_URL")
    if not url:
        raise RuntimeError("ECHO_X_LIST_URL environment variable is required")
    return url


def get_keywords() -> list[str]:
    """Load keywords from ECHO_KEYWORDS env var (comma-separated)."""
    raw = os.environ.get("ECHO_KEYWORDS", "")
    return [k.strip() for k in raw.split(",") if k.strip()]


def get_anti_signals() -> list[str] | None:
    """Load anti-signal keywords from ECHO_ANTI_SIGNALS env var (comma-separated).
    Returns None to use defaults.
    """
    raw = os.environ.get("ECHO_ANTI_SIGNALS")
    if raw is None:
        return None
    return [k.strip() for k in raw.split(",") if k.strip()]


def get_session_file() -> str | None:
    return os.environ.get("XBOT_SESSION_FILE")
