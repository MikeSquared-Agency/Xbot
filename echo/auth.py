"""Centralised Anthropic client factory.

Supports two auth modes:
- OAuth token: set ANTHROPIC_AUTH_TOKEN (sk-ant-oat01-... setup token)
- API key:    set ANTHROPIC_API_KEY   (sk-ant-api03-... key)

The Anthropic SDK picks these up automatically — OAuth takes priority.
"""

from __future__ import annotations

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
