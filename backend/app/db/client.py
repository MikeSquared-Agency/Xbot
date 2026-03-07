"""
Async SurrealDB client for FaultLine.

Wraps the surrealdb Python SDK with connection management, schema execution,
and domain-specific helpers for the knowledge graph.
"""
import os
from pathlib import Path
from surrealdb import AsyncSurreal


class SurrealClient:
    def __init__(self):
        self._url = os.getenv("SURREAL_URL", "ws://localhost:8000")
        self._namespace = os.getenv("SURREAL_NS", "faultline")
        self._database = os.getenv("SURREAL_DB", "faultline")
        self._username = os.getenv("SURREAL_USER", "root")
        self._password = os.getenv("SURREAL_PASS", "root")
        self._conn: AsyncSurreal | None = None

    async def connect(self):
        """Connect to SurrealDB and authenticate."""
        self._conn = AsyncSurreal(self._url)
        await self._conn.connect()
        await self._conn.signin({"username": self._username, "password": self._password})
        await self._conn.use(self._namespace, self._database)

    async def disconnect(self):
        """Close the connection."""
        if self._conn:
            await self._conn.close()
            self._conn = None

    async def execute_schema(self, schema_path: str | None = None):
        """Execute a .surql schema file against the database."""
        if schema_path is None:
            schema_path = str(Path(__file__).parent / "schema.surql")
        with open(schema_path) as f:
            schema_sql = f.read()
        await self._conn.query(schema_sql)

    async def query(self, sql: str, params: dict | None = None) -> list:
        """Execute a SurrealQL query and return results."""
        if params:
            result = await self._conn.query(sql, params)
        else:
            result = await self._conn.query(sql)
        return result

    async def create(self, table: str, data: dict) -> dict:
        """Create a record in a table."""
        return await self._conn.create(table, data)

    async def select(self, table: str) -> list:
        """Select all records from a table."""
        return await self._conn.select(table)

    async def update(self, thing: str, data: dict) -> dict:
        """Update a record by its full ID (e.g. 'assessment:xyz')."""
        return await self._conn.update(thing, data)

    async def delete(self, thing: str):
        """Delete a record by its full ID."""
        return await self._conn.delete(thing)

    # ---- FaultLine-specific helpers ----

    async def get_applicable_doctrines(self, jurisdictions: list[str], domains: list[str]) -> list:
        """Get legal doctrines relevant to given jurisdictions and domains."""
        return await self.query("""
            SELECT * FROM doctrine
            WHERE (jurisdiction IN $jurisdictions OR jurisdiction = 'global')
            AND domain IN $domains
        """, {"jurisdictions": jurisdictions, "domains": domains})

    async def get_applicable_regulations(self, jurisdictions: list[str]) -> list:
        """Get regulations in force for given jurisdictions."""
        return await self.query("""
            SELECT * FROM regulation
            WHERE (jurisdiction IN $jurisdictions OR jurisdiction = 'global')
            AND status IN ['in_force', 'partial']
        """, {"jurisdictions": jurisdictions})

    async def get_risk_factors_by_category(self, category: str) -> list:
        return await self.query(
            "SELECT * FROM risk_factor WHERE category = $cat ORDER BY weight DESC",
            {"cat": category}
        )

    async def get_mitigations_for_risk(self, risk_factor_name: str) -> list:
        """Get all mitigations that reduce a specific risk factor."""
        return await self.query("""
            SELECT in.name AS mitigation_name, in.category, in.description,
                   in.effectiveness, in.implementation_cost, reduction, conditions
            FROM mitigates
            WHERE out.name = $rf_name
            ORDER BY reduction DESC
        """, {"rf_name": risk_factor_name})

    async def get_doctrine_relationships(self, doctrine_name: str) -> list:
        """Get doctrines related to a specific doctrine."""
        return await self.query("""
            SELECT out.name AS related_doctrine, out.description, relationship, description AS rel_description
            FROM doctrine_relates
            WHERE in.name = $name
        """, {"name": doctrine_name})

    async def get_knowledge_graph_full(self) -> dict:
        """Return the full knowledge graph for visualization."""
        doctrines = await self.query("SELECT name, domain, jurisdiction, risk_direction, precedent_status FROM doctrine")
        regulations = await self.query("SELECT short_name, jurisdiction, status, max_penalty FROM regulation")
        risk_factors = await self.query("SELECT name, category, weight FROM risk_factor")
        mitigations = await self.query("SELECT name, category, effectiveness FROM mitigation")
        doctrine_edges = await self.query("SELECT in.name AS source, out.name AS target, relationship FROM doctrine_relates")
        mitigation_edges = await self.query("SELECT in.name AS source, out.name AS target, reduction FROM mitigates")
        return {
            "doctrines": doctrines,
            "regulations": regulations,
            "risk_factors": risk_factors,
            "mitigations": mitigations,
            "doctrine_edges": doctrine_edges,
            "mitigation_edges": mitigation_edges,
        }


# Module-level singleton
db = SurrealClient()
