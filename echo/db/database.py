"""Legacy Database class — now aliased to EchoStore.

This file exists for backwards compatibility. All new code should
import from echo.db.store directly.
"""

from echo.db.store import EchoStore as Database

__all__ = ["Database"]
