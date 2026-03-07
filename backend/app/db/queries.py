"""Named query functions for FaultLine operations."""
from app.db.client import db


async def log_audit(session_id: str, agent: str, action: str, **kwargs) -> None:
    """Write an audit log entry."""
    await db.query("""
        CREATE audit_log SET
            session_id = $session_id, agent = $agent, action = $action,
            input_data = $input_data, output_data = $output_data,
            token_usage = $token_usage, cost_usd = $cost_usd,
            latency_ms = $latency_ms, timestamp = time::now()
    """, {
        "session_id": session_id, "agent": agent, "action": action,
        "input_data": kwargs.get("input_data"),
        "output_data": kwargs.get("output_data"),
        "token_usage": kwargs.get("token_usage"),
        "cost_usd": kwargs.get("cost_usd"),
        "latency_ms": kwargs.get("latency_ms"),
    })


async def get_knowledge_stats() -> dict:
    """Summary statistics for the knowledge graph."""
    doctrines = await db.query("SELECT count() FROM doctrine GROUP ALL")
    regulations = await db.query("SELECT count() FROM regulation GROUP ALL")
    risk_factors = await db.query("SELECT count() FROM risk_factor GROUP ALL")
    mitigations = await db.query("SELECT count() FROM mitigation GROUP ALL")
    mitigation_edges = await db.query("SELECT count() FROM mitigates GROUP ALL")
    return {
        "doctrines": doctrines[0]["result"][0]["count"] if doctrines and doctrines[0].get("result") else 0,
        "regulations": regulations[0]["result"][0]["count"] if regulations and regulations[0].get("result") else 0,
        "risk_factors": risk_factors[0]["result"][0]["count"] if risk_factors and risk_factors[0].get("result") else 0,
        "mitigations": mitigations[0]["result"][0]["count"] if mitigations and mitigations[0].get("result") else 0,
        "mitigation_edges": mitigation_edges[0]["result"][0]["count"] if mitigation_edges and mitigation_edges[0].get("result") else 0,
    }
