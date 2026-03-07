"""Unit tests for queries.py — named query functions."""
from unittest.mock import AsyncMock, patch


class TestLogAudit:
    """Test audit logging function."""

    async def test_log_audit_minimal(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = []

        with patch("app.db.queries.db", mock_db):
            from app.db.queries import log_audit
            await log_audit("sess-1", "risk_assessor", "assess")

        mock_db.query.assert_awaited_once()
        params = mock_db.query.call_args[0][1]
        assert params["session_id"] == "sess-1"
        assert params["agent"] == "risk_assessor"
        assert params["action"] == "assess"
        assert params["input_data"] is None
        assert params["output_data"] is None
        assert params["token_usage"] is None
        assert params["cost_usd"] is None
        assert params["latency_ms"] is None

    async def test_log_audit_full(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = []

        with patch("app.db.queries.db", mock_db):
            from app.db.queries import log_audit
            await log_audit(
                "sess-2", "intake_agent", "parse_deployment",
                input_data={"text": "my agent does X"},
                output_data={"profile": {}},
                token_usage={"input": 500, "output": 200},
                cost_usd=0.003,
                latency_ms=1200,
            )

        params = mock_db.query.call_args[0][1]
        assert params["input_data"] == {"text": "my agent does X"}
        assert params["output_data"] == {"profile": {}}
        assert params["token_usage"] == {"input": 500, "output": 200}
        assert params["cost_usd"] == 0.003
        assert params["latency_ms"] == 1200

    async def test_log_audit_sql_structure(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = []

        with patch("app.db.queries.db", mock_db):
            from app.db.queries import log_audit
            await log_audit("s", "a", "x")

        sql = mock_db.query.call_args[0][0]
        assert "CREATE audit_log SET" in sql
        assert "session_id" in sql
        assert "time::now()" in sql


class TestGetKnowledgeStats:
    """Test knowledge graph statistics function."""

    async def test_returns_all_keys(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = [{"result": [{"count": 0}]}]

        with patch("app.db.queries.db", mock_db):
            from app.db.queries import get_knowledge_stats
            stats = await get_knowledge_stats()

        assert set(stats.keys()) == {
            "doctrines", "regulations", "risk_factors",
            "mitigations", "mitigation_edges",
        }

    async def test_extracts_counts(self):
        mock_db = AsyncMock()
        # Return different counts for each query
        mock_db.query.side_effect = [
            [{"result": [{"count": 8}]}],   # doctrines
            [{"result": [{"count": 5}]}],   # regulations
            [{"result": [{"count": 10}]}],  # risk_factors
            [{"result": [{"count": 15}]}],  # mitigations
            [{"result": [{"count": 14}]}],  # mitigation_edges
        ]

        with patch("app.db.queries.db", mock_db):
            from app.db.queries import get_knowledge_stats
            stats = await get_knowledge_stats()

        assert stats["doctrines"] == 8
        assert stats["regulations"] == 5
        assert stats["risk_factors"] == 10
        assert stats["mitigations"] == 15
        assert stats["mitigation_edges"] == 14

    async def test_handles_empty_results(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = []

        with patch("app.db.queries.db", mock_db):
            from app.db.queries import get_knowledge_stats
            stats = await get_knowledge_stats()

        assert stats["doctrines"] == 0
        assert stats["regulations"] == 0

    async def test_handles_missing_result_key(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = [{}]

        with patch("app.db.queries.db", mock_db):
            from app.db.queries import get_knowledge_stats
            stats = await get_knowledge_stats()

        assert stats["doctrines"] == 0
