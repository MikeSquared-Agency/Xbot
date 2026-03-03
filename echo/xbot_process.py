"""Xbot MCP server subprocess management.

Manages the xbot-browser MCP server as a child process, communicating
via the official MCP SDK stdio transport.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


@dataclass
class XbotResult:
    """Wrapper around an MCP tool call result."""

    content: list[Any] = field(default_factory=list)
    is_error: bool = False

    @property
    def authenticated(self) -> bool:
        text = self._content_text()
        if isinstance(text, str):
            try:
                parsed = json.loads(text)
                return parsed.get("authenticated", False)
            except (json.JSONDecodeError, AttributeError):
                pass
        return False

    def _content_text(self) -> str | None:
        for item in self.content:
            if hasattr(item, "text"):
                return item.text
            if isinstance(item, dict) and item.get("type") == "text":
                return item["text"]
        return None


class XbotProcess:
    """Manages the Xbot MCP server as a subprocess via the MCP SDK."""

    def __init__(
        self,
        session: ClientSession,
        cleanup_cm: Any = None,
        session_cm: Any = None,
    ) -> None:
        self.session = session
        self._cleanup_cm = cleanup_cm
        self._session_cm = session_cm

    @staticmethod
    async def start(
        xbot_path: str,
        browser: str = "chrome",
        session_file: str | None = None,
    ) -> XbotProcess:
        """Launch the Xbot MCP server and establish an MCP session."""
        cli_path = os.path.join(os.path.abspath(xbot_path), "cli.js")

        args = [cli_path, "--browser", browser]
        if session_file:
            args.extend(["--session-file", session_file])

        server_params = StdioServerParameters(
            command="node",
            args=args,
            env={**os.environ},
        )

        # Enter the stdio_client context manager — keeps the subprocess alive
        cleanup_cm = stdio_client(server_params)
        read, write = await cleanup_cm.__aenter__()

        # Enter the ClientSession context manager
        session_cm = ClientSession(read, write)
        session = await session_cm.__aenter__()

        # MCP handshake
        await session.initialize()

        return XbotProcess(session, cleanup_cm=cleanup_cm, session_cm=session_cm)

    async def call(self, tool_name: str, params: dict[str, Any] | None = None) -> XbotResult:
        """Call an MCP tool by name with parameters."""
        result = await self.session.call_tool(tool_name, params or {})
        return XbotResult(
            content=list(result.content) if result.content else [],
            is_error=getattr(result, "isError", False),
        )

    async def stop(self) -> None:
        """Shut down the MCP session and subprocess."""
        if self._session_cm:
            try:
                await self._session_cm.__aexit__(None, None, None)
            except Exception:
                pass
        if self._cleanup_cm:
            try:
                await self._cleanup_cm.__aexit__(None, None, None)
            except Exception:
                pass
