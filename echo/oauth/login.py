"""Browser-based OAuth login using xbot-browser MCP.

Automates the Claude Max OAuth PKCE flow:
1. Generate PKCE challenge + state
2. Navigate browser to authorize URL (uses existing claude.ai session)
3. Handle consent screen if needed
4. Extract auth code from callback page
5. Exchange code for tokens and save

Run: python -m echo.oauth.login
"""

from __future__ import annotations

import asyncio
import os
import re
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from echo.oauth.client import build_authorize_url, exchange_code, generate_pkce, generate_state
from echo.oauth.storage import TokenStorage

XBOT_BROWSER_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "xbot-browser", "cli.js"
)


def _extract_text(result) -> str:
    """Extract text content from MCP result."""
    parts = []
    for item in result.content:
        if hasattr(item, "text"):
            parts.append(item.text)
    return "\n".join(parts)


async def run_login() -> None:
    """Run the full OAuth login flow via xbot-browser."""
    verifier, challenge = generate_pkce()
    state = generate_state()
    authorize_url = build_authorize_url(challenge, state)

    print(f"Starting OAuth login flow...")
    print(f"Authorize URL: {authorize_url[:80]}...")

    server_params = StdioServerParameters(
        command="node",
        args=[os.path.abspath(XBOT_BROWSER_PATH), "--browser", "chrome"],
        env={**os.environ},
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # Navigate to authorize URL
            print("Navigating to Claude OAuth...")
            await session.call_tool("browser_navigate", {"url": authorize_url})
            print(f"  Page loaded")

            # Check page state — may auto-redirect or show consent
            max_attempts = 15
            snapshot = ""
            for attempt in range(max_attempts):
                await asyncio.sleep(2)

                result = await session.call_tool("browser_snapshot", {})
                snapshot = _extract_text(result)

                # Check if we landed on the callback page
                if "console.anthropic.com/oauth/code/callback" in snapshot:
                    print("  Reached callback page")
                    break

                # Look for auth code pattern in snapshot
                code_match = re.search(r"[a-zA-Z0-9_-]{20,}", snapshot)
                if "callback" in snapshot.lower() and code_match:
                    print("  Found callback with code")
                    break

                # Look for an "Allow" or "Authorize" button to click
                if any(kw in snapshot.lower() for kw in ["allow", "authorize", "accept", "confirm"]):
                    print("  Consent screen detected, clicking authorize...")
                    # Find the authorize/allow button ref
                    for line in snapshot.split("\n"):
                        line_lower = line.lower()
                        if any(kw in line_lower for kw in ["allow", "authorize", "accept"]):
                            # Extract ref like "e12" from the snapshot line
                            ref_match = re.search(r'\[ref=(e\d+)\]', line)
                            if not ref_match:
                                ref_match = re.search(r'(e\d+)', line)
                            if ref_match:
                                ref = ref_match.group(1)
                                print(f"    Clicking {ref}...")
                                await session.call_tool("browser_fallback", {
                                    "tool": "browser_click",
                                    "arguments": {"ref": ref},
                                })
                                await asyncio.sleep(3)
                                break
                    continue

                if attempt < max_attempts - 1:
                    print(f"  Waiting for redirect... (attempt {attempt + 1}/{max_attempts})")
            else:
                print("Timed out waiting for callback redirect.", file=sys.stderr)
                print("Last snapshot:", file=sys.stderr)
                print(snapshot[:500], file=sys.stderr)
                sys.exit(1)

            # Extract the authorization code from the callback page
            # Take a final snapshot to get the code
            result = await session.call_tool("browser_snapshot", {})
            snapshot = _extract_text(result)

            # The callback page shows the code — try several extraction patterns
            code = None

            # Pattern: code appears in page text, possibly as "code#state" or just the code
            # Look for the code in the snapshot text
            for line in snapshot.split("\n"):
                # "Authorization code: XXXX" or similar
                m = re.search(r'(?:code|authorization)[:\s]+([a-zA-Z0-9_-]{20,})', line, re.IGNORECASE)
                if m:
                    code = m.group(1)
                    break

            if not code:
                # Try to find code in URL params shown on page
                m = re.search(r'code=([a-zA-Z0-9_-]{20,})', snapshot)
                if m:
                    code = m.group(1)

            if not code:
                # Fallback: get the page URL which may contain code param
                result = await session.call_tool("browser_navigate", {"url": "about:blank"})
                # Actually, let's try getting current URL from a snapshot before navigating away
                # The code might be the main content on the page
                lines = [l.strip() for l in snapshot.split("\n") if l.strip() and len(l.strip()) > 20]
                for line in lines:
                    # Look for a long alphanumeric string that could be the code
                    m = re.search(r'\b([a-zA-Z0-9_-]{30,})\b', line)
                    if m:
                        code = m.group(1)
                        break

            if not code:
                print("Could not extract authorization code from callback page.", file=sys.stderr)
                print("Snapshot:", file=sys.stderr)
                print(snapshot[:1000], file=sys.stderr)
                sys.exit(1)

            # Strip state suffix if present (code#state format)
            if "#" in code:
                code = code.split("#")[0]

            print(f"  Authorization code: {code[:10]}...")

    # Exchange code for tokens (outside MCP session — don't need browser anymore)
    print("Exchanging code for tokens...")
    tokens = await exchange_code(code, verifier)

    print(f"  Access token: {tokens['access_token'][:20]}...")
    if "refresh_token" in tokens:
        print(f"  Refresh token: {tokens['refresh_token'][:20]}...")
    print(f"  Expires in: {tokens.get('expires_in', 'unknown')}s")

    await TokenStorage.save(tokens)
    print(f"Tokens saved to {TokenStorage.TOKEN_PATH}")
    print("Done! Echo can now use Claude Max OAuth.")


if __name__ == "__main__":
    asyncio.run(run_login())
