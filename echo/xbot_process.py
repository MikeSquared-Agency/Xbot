"""Xbot MCP server subprocess management.

Manages the ami-browser MCP server as a child process, communicating
via JSON-RPC 2.0 over stdio.
"""

from __future__ import annotations

import asyncio
import json
import itertools
from dataclasses import dataclass
from typing import Any


@dataclass
class XbotResult:
    """Wrapper around a JSON-RPC response from the Xbot MCP server."""

    raw: dict[str, Any]

    @property
    def authenticated(self) -> bool:
        content = self._content_text()
        if isinstance(content, str):
            try:
                parsed = json.loads(content)
                return parsed.get("authenticated", False)
            except (json.JSONDecodeError, AttributeError):
                pass
        if isinstance(self.raw.get("result"), dict):
            return self.raw["result"].get("authenticated", False)
        return False

    def _content_text(self) -> str | None:
        result = self.raw.get("result", {})
        if isinstance(result, dict):
            for item in result.get("content", []):
                if isinstance(item, dict) and item.get("type") == "text":
                    return item["text"]
        return None

    def __getattr__(self, name: str) -> Any:
        result = self.raw.get("result", {})
        if isinstance(result, dict) and name in result:
            return result[name]
        raise AttributeError(f"XbotResult has no attribute {name!r}")


class XbotProcess:
    """Manages the Xbot MCP server as a subprocess."""

    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        self.proc = proc
        self._id_counter = itertools.count(1)
        self._lock = asyncio.Lock()

    def next_id(self) -> int:
        return next(self._id_counter)

    @staticmethod
    async def start(xbot_path: str, browser: str = "chrome") -> XbotProcess:
        """Launch the Xbot MCP server and wait for it to be ready."""
        proc = await asyncio.create_subprocess_exec(
            "node",
            f"{xbot_path}/cli.js",
            "--browser",
            browser,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        instance = XbotProcess(proc)
        await instance._wait_for_ready()
        return instance

    async def _wait_for_ready(self, timeout: float = 30.0) -> None:
        """Wait for the MCP server to signal readiness on stderr."""
        assert self.proc.stderr is not None
        try:
            async with asyncio.timeout(timeout):
                while True:
                    line = await self.proc.stderr.readline()
                    if not line:
                        break
                    text = line.decode("utf-8", errors="replace").strip()
                    if "listening" in text.lower() or "ready" in text.lower():
                        return
        except TimeoutError:
            pass
        # Even without an explicit ready signal, the server may be up.

    async def call(self, tool_name: str, params: dict[str, Any] | None = None) -> XbotResult:
        """Send an MCP tool call via JSON-RPC over stdio."""
        assert self.proc.stdin is not None
        assert self.proc.stdout is not None

        request = {
            "jsonrpc": "2.0",
            "id": self.next_id(),
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": params or {},
            },
        }

        payload = json.dumps(request) + "\n"

        async with self._lock:
            self.proc.stdin.write(payload.encode())
            await self.proc.stdin.drain()
            response_line = await self.proc.stdout.readline()

        if not response_line:
            return XbotResult({"error": {"code": -1, "message": "No response from Xbot"}})

        return XbotResult(json.loads(response_line))

    async def stop(self) -> None:
        """Terminate the Xbot subprocess."""
        if self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), timeout=5.0)
            except TimeoutError:
                self.proc.kill()
                await self.proc.wait()
