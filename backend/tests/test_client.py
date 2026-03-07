"""Unit tests for SurrealClient."""
import os
from unittest.mock import patch, mock_open


class TestSurrealClientInit:
    """Test client initialization and env var handling."""

    def test_defaults(self):
        from app.db.client import SurrealClient
        c = SurrealClient()
        assert c._url == "ws://localhost:8000"
        assert c._namespace == "faultline"
        assert c._database == "faultline"
        assert c._username == "root"
        assert c._password == "root"
        assert c._conn is None

    def test_env_override(self):
        env = {
            "SURREAL_URL": "ws://db:9000",
            "SURREAL_NS": "test_ns",
            "SURREAL_DB": "test_db",
            "SURREAL_USER": "admin",
            "SURREAL_PASS": "secret",
        }
        with patch.dict(os.environ, env):
            from app.db.client import SurrealClient
            c = SurrealClient()
            assert c._url == "ws://db:9000"
            assert c._namespace == "test_ns"
            assert c._database == "test_db"
            assert c._username == "admin"
            assert c._password == "secret"

    def test_module_singleton(self):
        from app.db.client import db
        from app.db.client import SurrealClient
        assert isinstance(db, SurrealClient)


class TestSurrealClientConnect:
    """Test connect/disconnect lifecycle."""

    async def test_connect(self, fresh_client, mock_conn):
        with patch("app.db.client.AsyncSurreal", return_value=mock_conn):
            await fresh_client.connect()
            mock_conn.connect.assert_awaited_once()
            mock_conn.signin.assert_awaited_once_with(
                {"username": "root", "password": "root"}
            )
            mock_conn.use.assert_awaited_once_with("faultline", "faultline")
            assert fresh_client._conn is mock_conn

    async def test_disconnect(self, client, mock_conn):
        await client.disconnect()
        mock_conn.close.assert_awaited_once()
        assert client._conn is None

    async def test_disconnect_when_not_connected(self, fresh_client):
        # Should not raise
        await fresh_client.disconnect()
        assert fresh_client._conn is None


class TestSurrealClientCRUD:
    """Test basic CRUD delegation."""

    async def test_query_without_params(self, client, mock_conn):
        mock_conn.query.return_value = [{"result": [{"count": 5}]}]
        result = await client.query("SELECT count() FROM foo GROUP ALL")
        mock_conn.query.assert_awaited_once_with("SELECT count() FROM foo GROUP ALL")
        assert result == [{"result": [{"count": 5}]}]

    async def test_query_with_params(self, client, mock_conn):
        mock_conn.query.return_value = [{"result": [{"name": "bar"}]}]
        result = await client.query("SELECT * FROM foo WHERE name = $n", {"n": "bar"})
        mock_conn.query.assert_awaited_once_with(
            "SELECT * FROM foo WHERE name = $n", {"n": "bar"}
        )

    async def test_create(self, client, mock_conn):
        mock_conn.create.return_value = {"id": "foo:abc", "name": "test"}
        result = await client.create("foo", {"name": "test"})
        mock_conn.create.assert_awaited_once_with("foo", {"name": "test"})
        assert result["id"] == "foo:abc"

    async def test_select(self, client, mock_conn):
        mock_conn.select.return_value = [{"id": "foo:1"}, {"id": "foo:2"}]
        result = await client.select("foo")
        mock_conn.select.assert_awaited_once_with("foo")
        assert len(result) == 2

    async def test_update(self, client, mock_conn):
        mock_conn.update.return_value = {"id": "foo:1", "name": "updated"}
        result = await client.update("foo:1", {"name": "updated"})
        mock_conn.update.assert_awaited_once_with("foo:1", {"name": "updated"})
        assert result["name"] == "updated"

    async def test_delete(self, client, mock_conn):
        await client.delete("foo:1")
        mock_conn.delete.assert_awaited_once_with("foo:1")


class TestSurrealClientSchema:
    """Test schema execution."""

    async def test_execute_schema_default_path(self, client, mock_conn):
        schema_content = "DEFINE TABLE foo SCHEMAFULL;"
        with patch("builtins.open", mock_open(read_data=schema_content)):
            await client.execute_schema()
            mock_conn.query.assert_awaited_once_with(schema_content)

    async def test_execute_schema_custom_path(self, client, mock_conn):
        schema_content = "DEFINE TABLE bar SCHEMAFULL;"
        with patch("builtins.open", mock_open(read_data=schema_content)):
            await client.execute_schema("/tmp/custom.surql")
            mock_conn.query.assert_awaited_once_with(schema_content)


class TestSurrealClientHelpers:
    """Test FaultLine-specific helper methods."""

    async def test_get_applicable_doctrines(self, client, mock_conn):
        mock_conn.query.return_value = [{"result": [{"name": "apparent_authority"}]}]
        result = await client.get_applicable_doctrines(["UK"], ["contract_law"])
        call_args = mock_conn.query.call_args
        assert "$jurisdictions" in call_args[0][0]
        assert "$domains" in call_args[0][0]
        assert call_args[0][1] == {"jurisdictions": ["UK"], "domains": ["contract_law"]}

    async def test_get_applicable_regulations(self, client, mock_conn):
        mock_conn.query.return_value = [{"result": [{"short_name": "GDPR"}]}]
        result = await client.get_applicable_regulations(["EU/UK"])
        call_args = mock_conn.query.call_args
        assert "status IN ['in_force', 'partial']" in call_args[0][0]
        assert call_args[0][1] == {"jurisdictions": ["EU/UK"]}

    async def test_get_risk_factors_by_category(self, client, mock_conn):
        mock_conn.query.return_value = [{"result": [{"name": "autonomy_level", "weight": 0.9}]}]
        result = await client.get_risk_factors_by_category("technical")
        call_args = mock_conn.query.call_args
        assert "ORDER BY weight DESC" in call_args[0][0]
        assert call_args[0][1] == {"cat": "technical"}

    async def test_get_mitigations_for_risk(self, client, mock_conn):
        mock_conn.query.return_value = [{"result": [{"mitigation_name": "qualified_hitl", "reduction": 0.5}]}]
        result = await client.get_mitigations_for_risk("hallucination_risk")
        call_args = mock_conn.query.call_args
        assert "FROM mitigates" in call_args[0][0]
        assert call_args[0][1] == {"rf_name": "hallucination_risk"}

    async def test_get_doctrine_relationships(self, client, mock_conn):
        mock_conn.query.return_value = [{"result": [{"related_doctrine": "vicarious_liability"}]}]
        result = await client.get_doctrine_relationships("apparent_authority")
        call_args = mock_conn.query.call_args
        assert "FROM doctrine_relates" in call_args[0][0]
        assert call_args[0][1] == {"name": "apparent_authority"}

    async def test_get_knowledge_graph_full(self, client, mock_conn):
        # Each query returns a different shape
        mock_conn.query.return_value = [{"result": []}]
        result = await client.get_knowledge_graph_full()
        assert set(result.keys()) == {
            "doctrines", "regulations", "risk_factors",
            "mitigations", "doctrine_edges", "mitigation_edges",
        }
        # 6 queries: doctrines, regulations, risk_factors, mitigations, doctrine_edges, mitigation_edges
        assert mock_conn.query.await_count == 6
