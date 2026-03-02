#!/usr/bin/env python3
"""Echo CLI — interactive terminal for reviewing and posting tweet replies."""

import asyncio
import sys

from echo.cli import EchoCLI
from echo.db import Database


async def main() -> None:
    db = Database()
    try:
        await db.connect()
    except Exception as e:
        print(f"Failed to connect to database: {e}", file=sys.stderr)
        print("Set DATABASE_URL environment variable.", file=sys.stderr)
        sys.exit(1)

    cli = EchoCLI(db=db)
    try:
        await cli.run()
    except KeyboardInterrupt:
        pass
    finally:
        await db.close()
        print("\nGoodbye.")


if __name__ == "__main__":
    asyncio.run(main())
