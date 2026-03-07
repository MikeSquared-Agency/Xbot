"""Unit tests for seed.py — knowledge graph seeding."""
import pytest
from unittest.mock import AsyncMock, patch


class TestSeedIdempotency:
    """Verify seeding skips when data already exists."""

    async def test_skips_when_data_exists(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = [{"result": [{"count": 6}]}]

        with patch("app.db.seed.db", mock_db):
            from app.db.seed import seed_knowledge_graph
            await seed_knowledge_graph()

        # Only the idempotency check query, no creates
        mock_db.query.assert_awaited_once()
        mock_db.create.assert_not_awaited()

    async def test_seeds_when_empty(self):
        mock_db = AsyncMock()
        # First call: idempotency check returns 0
        mock_db.query.return_value = [{"result": [{"count": 0}]}]
        mock_db.create.return_value = {}

        with patch("app.db.seed.db", mock_db):
            from app.db.seed import seed_knowledge_graph
            await seed_knowledge_graph()

        # Should have created records
        assert mock_db.create.await_count > 0

    async def test_seeds_when_result_empty(self):
        mock_db = AsyncMock()
        # Simulate empty DB (no result key)
        mock_db.query.return_value = []
        mock_db.create.return_value = {}

        with patch("app.db.seed.db", mock_db):
            from app.db.seed import seed_knowledge_graph
            await seed_knowledge_graph()

        assert mock_db.create.await_count > 0

    async def test_seeds_when_result_is_none(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = [{"result": None}]
        mock_db.create.return_value = {}

        with patch("app.db.seed.db", mock_db):
            from app.db.seed import seed_knowledge_graph
            await seed_knowledge_graph()

        assert mock_db.create.await_count > 0


class TestSeedCounts:
    """Verify exact record counts match acceptance criteria."""

    @pytest.fixture
    def mock_db(self):
        mock = AsyncMock()
        mock.query.return_value = [{"result": [{"count": 0}]}]
        mock.create.return_value = {}
        return mock

    async def test_6_legal_domains(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_legal_domains
            await _seed_legal_domains()

        domain_calls = [c for c in mock_db.create.call_args_list if c[0][0] == "legal_domain"]
        assert len(domain_calls) == 6

    async def test_8_doctrines(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_doctrines
            await _seed_doctrines()

        doctrine_calls = [c for c in mock_db.create.call_args_list if c[0][0] == "doctrine"]
        assert len(doctrine_calls) == 8

    async def test_5_regulations(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_regulations
            await _seed_regulations()

        reg_calls = [c for c in mock_db.create.call_args_list if c[0][0] == "regulation"]
        assert len(reg_calls) == 5

    async def test_3_risk_categories(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_risk_factors
            await _seed_risk_factors()

        cat_calls = [c for c in mock_db.create.call_args_list if c[0][0] == "risk_category"]
        assert len(cat_calls) == 3

    async def test_10_risk_factors(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_risk_factors
            await _seed_risk_factors()

        factor_calls = [c for c in mock_db.create.call_args_list if c[0][0] == "risk_factor"]
        assert len(factor_calls) == 10

    async def test_15_mitigations(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_mitigations
            await _seed_mitigations()

        mit_calls = [c for c in mock_db.create.call_args_list if c[0][0] == "mitigation"]
        assert len(mit_calls) == 15


class TestSeedDataIntegrity:
    """Verify seed data structure and content."""

    @pytest.fixture
    def mock_db(self):
        mock = AsyncMock()
        mock.query.return_value = [{"result": [{"count": 0}]}]
        mock.create.return_value = {}
        return mock

    async def test_legal_domain_fields(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_legal_domains
            await _seed_legal_domains()

        for c in mock_db.create.call_args_list:
            data = c[0][1]
            assert "name" in data
            assert "description" in data
            assert "jurisdiction" in data
            assert "volatility" in data
            assert data["volatility"] in ("settled", "evolving", "untested")
            assert "relevance_to_agents" in data

    async def test_doctrine_fields(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_doctrines
            await _seed_doctrines()

        for c in mock_db.create.call_args_list:
            data = c[0][1]
            assert "name" in data
            assert "domain" in data
            assert "description" in data
            assert "jurisdiction" in data
            assert "precedent_status" in data
            assert data["precedent_status"] in ("established", "analogous", "untested", "evolving", "conflicting")
            assert "risk_direction" in data
            assert data["risk_direction"] in ("increases_liability", "decreases_liability", "uncertain")
            assert isinstance(data["key_cases"], list)
            assert isinstance(data["key_statutes"], list)

    async def test_risk_factor_weights_in_range(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_risk_factors
            await _seed_risk_factors()

        factor_calls = [c for c in mock_db.create.call_args_list if c[0][0] == "risk_factor"]
        for c in factor_calls:
            data = c[0][1]
            assert 0.0 <= data["weight"] <= 1.0, f"{data['name']} weight {data['weight']} out of range"
            assert len(data["levels"]) >= 2, f"{data['name']} needs at least 2 levels"
            for level in data["levels"]:
                assert 0.0 <= level["score"] <= 1.0

    async def test_mitigation_effectiveness_in_range(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_mitigations
            await _seed_mitigations()

        for c in mock_db.create.call_args_list:
            data = c[0][1]
            assert 0.0 <= data["effectiveness"] <= 1.0
            assert data["implementation_cost"] in ("trivial", "moderate", "significant", "major")
            assert isinstance(data["prerequisites"], list)

    async def test_mitigation_categories_valid(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_mitigations
            await _seed_mitigations()

        valid_cats = {"legal_conformity", "human_oversight", "architectural", "evidentiary"}
        for c in mock_db.create.call_args_list:
            data = c[0][1]
            assert data["category"] in valid_cats, f"Unknown category: {data['category']}"

    async def test_regulation_fields(self, mock_db):
        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_regulations
            await _seed_regulations()

        for c in mock_db.create.call_args_list:
            data = c[0][1]
            assert "name" in data
            assert "short_name" in data
            assert "jurisdiction" in data
            assert "status" in data
            assert data["status"] in ("in_force", "partial", "proposed", "guidance_only")
            assert isinstance(data["compliance_requirements"], list)
            assert len(data["compliance_requirements"]) > 0


class TestSeedRelationships:
    """Verify edge creation in _seed_relationships."""

    async def test_doctrine_edges_created(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = [{"result": [{"count": 0}]}]

        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_relationships
            await _seed_relationships()

        # 4 doctrine rels + 14 mitigation edges = 18 query calls
        assert mock_db.query.await_count == 18

    async def test_doctrine_rel_queries_use_correct_params(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = []

        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_relationships
            await _seed_relationships()

        # First call should be apparent_authority -> vicarious_liability
        first_call = mock_db.query.call_args_list[0]
        params = first_call[0][1]
        assert params["from_name"] == "apparent_authority"
        assert params["to_name"] == "vicarious_liability"
        assert params["rel"] == "supports"

    async def test_mitigation_edge_queries_use_correct_params(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = []

        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_relationships
            await _seed_relationships()

        # 5th call (index 4) is first mitigation edge: qualified_hitl -> autonomy_level
        fifth_call = mock_db.query.call_args_list[4]
        params = fifth_call[0][1]
        assert params["mit_name"] == "qualified_hitl"
        assert params["rf_name"] == "autonomy_level"
        assert params["reduction"] == 0.6
        assert params["conditions"] is None

    async def test_conditional_mitigation_edges(self):
        mock_db = AsyncMock()
        mock_db.query.return_value = []

        with patch("app.db.seed.db", mock_db):
            from app.db.seed import _seed_relationships
            await _seed_relationships()

        # Find the eu_ai_act_conformity_assessment -> jurisdiction_risk edge (should have conditions)
        for c in mock_db.query.call_args_list:
            params = c[0][1]
            if params.get("mit_name") == "eu_ai_act_conformity_assessment":
                assert params["conditions"] == "Only for EU jurisdiction"
                return
        pytest.fail("eu_ai_act_conformity_assessment edge not found")
