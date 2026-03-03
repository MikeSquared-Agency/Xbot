"""Centralised Anthropic client factory.

Supports three auth modes (checked in order):
1. ANTHROPIC_API_KEY env var — standard API key
2. ANTHROPIC_AUTH_TOKEN env var — OAuth token (e.g. setup token)
3. ~/.xbot/tokens.json — Claude Max OAuth tokens (auto-refreshed)

Run `python -m echo.oauth.login` to set up OAuth tokens.
"""

from __future__ import annotations

import os

import anthropic

_client: anthropic.AsyncAnthropic | None = None


def get_client() -> anthropic.AsyncAnthropic:
    """Return a shared AsyncAnthropic client.

    The SDK auto-reads ANTHROPIC_AUTH_TOKEN (OAuth) or ANTHROPIC_API_KEY
    from the environment. No explicit key handling needed.
    """
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


async def get_client_async() -> anthropic.AsyncAnthropic:
    """Return a shared AsyncAnthropic client, with OAuth token refresh fallback.

    Checks in order:
    1. ANTHROPIC_API_KEY env var → use SDK default
    2. ANTHROPIC_AUTH_TOKEN env var → use SDK default
    3. Token storage (~/.xbot/tokens.json) → refresh if expired → set auth_token
    """
    global _client
    if _client is not None:
        return _client

    # If env vars are set, the SDK handles it
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        _client = anthropic.AsyncAnthropic()
        return _client

    # Try OAuth token storage
    from echo.oauth.client import get_valid_token

    token = await get_valid_token()
    if token:
        _client = anthropic.AsyncAnthropic(auth_token=token)
        return _client

    raise RuntimeError(
        "No Anthropic credentials found. Either:\n"
        "  - Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN env var, or\n"
        "  - Run `python -m echo.oauth.login` to authenticate via Claude Max OAuth"
    )
