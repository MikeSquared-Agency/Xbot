"""Async Python client for Cortex graph memory (HTTP API at port 9091).

Mirrors the patterns used by xbot-browser's CortexStore.js.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)


class CortexClient:
    """Low-level async HTTP client for the Cortex graph memory API."""

    def __init__(
        self,
        base_url: str = "http://localhost:9091",
        source_agent: str = "echo",
        timeout: float = 5.0,
    ):
        self._base = base_url.rstrip("/")
        self._agent = source_agent
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------

    async def _post(self, path: str, body: dict) -> dict | None:
        client = await self._ensure_client()
        try:
            res = await client.post(
                f"{self._base}{path}?gate=skip",
                json=body,
                headers={
                    "x-agent-id": self._agent,
                    "x-gate-override": "true",
                },
            )
            if res.status_code >= 400:
                log.warning("POST %s failed: %d", path, res.status_code)
                return None
            data = res.json()
            return data.get("data") if data.get("success") else None
        except Exception as exc:
            log.warning("POST %s error: %s", path, exc)
            return None

    async def _get(self, path: str) -> Any:
        client = await self._ensure_client()
        try:
            res = await client.get(
                f"{self._base}{path}",
                headers={"x-agent-id": self._agent},
            )
            if res.status_code >= 400:
                return None
            data = res.json()
            return data.get("data") if data.get("success") else None
        except Exception:
            return None

    async def _patch(self, node_id: str, body: dict) -> dict | None:
        client = await self._ensure_client()
        try:
            res = await client.patch(
                f"{self._base}/nodes/{node_id}",
                json=body,
                headers={
                    "x-agent-id": self._agent,
                    "x-gate-override": "true",
                },
            )
            if res.status_code >= 400:
                return None
            data = res.json()
            return data.get("data") if data.get("success") else None
        except Exception:
            return None

    async def _delete(self, path: str) -> bool:
        client = await self._ensure_client()
        try:
            res = await client.delete(
                f"{self._base}{path}?gate=skip",
                headers={
                    "x-agent-id": self._agent,
                    "x-gate-override": "true",
                },
            )
            return res.status_code < 400
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Node CRUD
    # ------------------------------------------------------------------

    async def create_node(
        self,
        kind: str,
        title: str,
        body: dict | str,
        tags: list[str] | None = None,
        importance: float = 0.5,
    ) -> dict | None:
        payload: dict[str, Any] = {
            "kind": kind,
            "title": title,
            "body": json.dumps(body) if isinstance(body, dict) else body,
            "source_agent": self._agent,
            "importance": importance,
        }
        if tags:
            payload["tags"] = tags
        return await self._post("/nodes", payload)

    async def get_node(self, node_id: str) -> dict | None:
        return await self._get(f"/nodes/{node_id}")

    async def get_nodes(
        self,
        kind: str | None = None,
        tag: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        parts = [f"limit={limit}"]
        if kind:
            parts.append(f"kind={kind}")
        if tag:
            parts.append(f"tag={tag}")
        qs = "&".join(parts)
        result = await self._get(f"/nodes?{qs}")
        if isinstance(result, list):
            return result
        return []

    async def update_node(
        self,
        node_id: str,
        body: dict | str | None = None,
        tags: list[str] | None = None,
        title: str | None = None,
        importance: float | None = None,
    ) -> dict | None:
        patch: dict[str, Any] = {}
        if body is not None:
            patch["body"] = json.dumps(body) if isinstance(body, dict) else body
        if tags is not None:
            patch["tags"] = tags
        if title is not None:
            patch["title"] = title
        if importance is not None:
            patch["importance"] = importance
        if not patch:
            return None
        return await self._patch(node_id, patch)

    async def delete_node(self, node_id: str) -> bool:
        return await self._delete(f"/nodes/{node_id}")

    # ------------------------------------------------------------------
    # Edge CRUD
    # ------------------------------------------------------------------

    async def create_edge(
        self,
        from_id: str,
        to_id: str,
        relation: str,
        weight: float = 1.0,
    ) -> dict | None:
        return await self._post("/edges", {
            "from_id": from_id,
            "to_id": to_id,
            "relation": relation,
            "weight": weight,
        })

    async def get_neighbors(
        self,
        node_id: str,
        direction: str = "outgoing",
        depth: int = 1,
    ) -> list[dict]:
        result = await self._get(
            f"/nodes/{node_id}/neighbors?direction={direction}&depth={depth}"
        )
        if isinstance(result, list):
            # Filter out the source node itself
            return [n for n in result if (n.get("node", n)).get("id") != node_id]
        return []

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    async def search(self, query: str, limit: int = 10) -> list[dict]:
        result = await self._post("/search", {"query": query, "limit": limit})
        if isinstance(result, list):
            return result
        return []

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    async def health(self) -> bool:
        client = await self._ensure_client()
        try:
            res = await client.get(f"{self._base}/health")
            return res.status_code == 200
        except Exception:
            return False
