#!/usr/bin/env python3
"""Echo entry point — launches the orchestrator."""

import asyncio

from rich.console import Console

from echo.orchestrator import startup

console = Console()


async def main() -> None:
    console.print("[bold]Starting Echo...[/]\n")
    orchestrator = await startup()

    try:
        await orchestrator.run()
    except KeyboardInterrupt:
        pass
    finally:
        console.print("\n[dim]Shutting down Echo...[/]")
        await orchestrator.cleanup()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        console.print("\n[dim]Bye.[/]")
