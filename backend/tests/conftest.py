"""Shared fixtures for FaultLine tests."""
import pytest
from unittest.mock import AsyncMock, patch


@pytest.fixture
def mock_conn():
    """A mock AsyncSurreal connection."""
    conn = AsyncMock()
    conn.connect = AsyncMock()
    conn.signin = AsyncMock()
    conn.use = AsyncMock()
    conn.close = AsyncMock()
    conn.query = AsyncMock(return_value=[])
    conn.create = AsyncMock(return_value={})
    conn.select = AsyncMock(return_value=[])
    conn.update = AsyncMock(return_value={})
    conn.delete = AsyncMock()
    return conn


@pytest.fixture
def client(mock_conn):
    """A SurrealClient with a mocked connection (already 'connected')."""
    with patch("app.db.client.AsyncSurreal", return_value=mock_conn):
        from app.db.client import SurrealClient
        c = SurrealClient()
        c._conn = mock_conn
        return c


@pytest.fixture
def fresh_client():
    """A SurrealClient with no connection (for testing connect/disconnect)."""
    from app.db.client import SurrealClient
    return SurrealClient()
