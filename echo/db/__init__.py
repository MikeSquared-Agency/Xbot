from echo.db.store import EchoStore, get_global_store, set_global_store
from echo.db.cortex import CortexClient
from echo.db.models import (
    Candidate,
    DailyDigest,
    GeneratedReply,
    PostedReply,
    SessionStats,
    Tweet,
)

# Legacy alias
Database = EchoStore

__all__ = [
    "EchoStore",
    "CortexClient",
    "Database",
    "get_global_store",
    "set_global_store",
    "Candidate",
    "DailyDigest",
    "GeneratedReply",
    "PostedReply",
    "SessionStats",
    "Tweet",
]
