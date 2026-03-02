from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path


class XbotClient:
    """Python MCP client for calling Xbot stored tools via stdio JSON-RPC.

    Spawns the xbot-browser Node process and communicates over stdin/stdout.
    """

    def __init__(
        self,
        cli_path: str | None = None,
        session_file: str | None = None,
        headless: bool = True,
    ):
        # Default to the cli.js in the sibling xbot-browser directory
        if cli_path is None:
            repo_root = Path(__file__).resolve().parent.parent.parent
            cli_path = str(repo_root / "xbot-browser" / "cli.js")

        self.cli_path = cli_path
        self.session_file = session_file
        self.headless = headless
        self._process: asyncio.subprocess.Process | None = None
        self._request_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._reader_task: asyncio.Task | None = None

    async def start(self) -> None:
        """Spawn the xbot-browser MCP server process."""
        cmd = ["node", self.cli_path, "--headless"]
        if self.session_file:
            cmd.extend(["--session-file", self.session_file])

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ},
        )
        self._reader_task = asyncio.create_task(self._read_responses())

        # Send MCP initialize
        await self._send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "echo-scout", "version": "0.1.0"},
        })

    async def stop(self) -> None:
        """Shut down the MCP server process."""
        if self._process and self._process.returncode is None:
            self._process.stdin.close()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._process.kill()
        if self._reader_task:
            self._reader_task.cancel()

    async def call(self, tool_name: str, params: dict | None = None) -> dict:
        """Call a stored tool by name with parameters."""
        result = await self._send_request("tools/call", {
            "name": tool_name,
            "arguments": params or {},
        })
        return result

    async def _send_request(self, method: str, params: dict) -> dict:
        self._request_id += 1
        req_id = self._request_id

        msg = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params,
        }

        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[req_id] = future

        data = json.dumps(msg) + "\n"
        self._process.stdin.write(data.encode())
        await self._process.stdin.drain()

        return await future

    async def _read_responses(self) -> None:
        """Read JSON-RPC responses from stdout."""
        while True:
            line = await self._process.stdout.readline()
            if not line:
                break
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue

            req_id = msg.get("id")
            if req_id is not None and req_id in self._pending:
                future = self._pending.pop(req_id)
                if "error" in msg:
                    future.set_exception(
                        RuntimeError(f"MCP error: {msg['error']}")
                    )
                else:
                    future.set_result(msg.get("result", {}))
