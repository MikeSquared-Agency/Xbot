"""PKCE generation and token exchange for Claude Max OAuth."""

from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import urlencode

import httpx

from echo.oauth.storage import TokenStorage

CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"
REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
SCOPES = "org:create_api_key user:profile user:inference"


def generate_pkce() -> tuple[str, str]:
    """Generate PKCE code_verifier and code_challenge (S256)."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def generate_state() -> str:
    """Generate a random state parameter."""
    return secrets.token_urlsafe(32)


def build_authorize_url(challenge: str, state: str) -> str:
    """Build the full OAuth authorize URL with PKCE."""
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code(code: str, verifier: str) -> dict:
    """Exchange authorization code for tokens."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": CLIENT_ID,
                "code": code,
                "redirect_uri": REDIRECT_URI,
                "code_verifier": verifier,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def refresh(refresh_token: str) -> dict:
    """Refresh an expired access token."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": CLIENT_ID,
                "refresh_token": refresh_token,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def get_valid_token() -> str | None:
    """Load token from storage, refresh if expired, return access_token or None."""
    tokens = await TokenStorage.load()
    if tokens is None:
        return None

    if not TokenStorage.is_expired(tokens):
        return tokens["access_token"]

    # Try refresh
    rt = tokens.get("refresh_token")
    if not rt:
        return None

    try:
        new_tokens = await refresh(rt)
        # Preserve refresh_token if not returned in response
        if "refresh_token" not in new_tokens and rt:
            new_tokens["refresh_token"] = rt
        await TokenStorage.save(new_tokens)
        return new_tokens["access_token"]
    except httpx.HTTPError:
        return None
