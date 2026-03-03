"""Pull X Analytics CSV via xbot-browser and import to Cortex in one shot.

Usage:
    python -m echo.analytics.pull              # default 1 day
    python -m echo.analytics.pull --days 28    # last 28 days
    python -m echo.analytics.pull -d 7         # last 7 days
"""
from __future__ import annotations

import argparse
import asyncio
import os

from rich.console import Console

console = Console()


async def pull_and_import(days: int = 1) -> dict:
    """Pull analytics CSV via MCP and import to Cortex.

    Returns the import result dict from import_csv_text().
    """
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    from echo.analytics.csv_import import import_csv_text
    from echo.db.store import EchoStore

    xbot_dir = os.path.join(os.path.dirname(__file__), "..", "..", "xbot-browser")
    cli_js = os.path.join(xbot_dir, "cli.js")

    server_params = StdioServerParameters(
        command="node",
        args=[cli_js, "--browser", "chrome"],
        env={**os.environ},
    )

    console.print(f"[blue]Pulling {days} day(s) of analytics via xbot-browser...[/]")

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            result = await session.call_tool(
                "xbot_execute",
                {"toolName": "x:pull-analytics", "args": {"days": days}},
            )

            csv_text = None
            for item in result.content:
                if hasattr(item, "text"):
                    text = item.text
                    # Skip the "### Executed:" header line
                    if text.startswith("### Executed:"):
                        text = text.split("\n", 1)[1] if "\n" in text else ""
                    # Check if it looks like CSV (has the header row)
                    if "Post id" in text or "Tweet id" in text:
                        csv_text = text
                        break

            if not csv_text:
                console.print("[red]Failed to get CSV from x:pull-analytics[/]")
                err_text = ""
                for item in result.content:
                    if hasattr(item, "text"):
                        err_text = item.text[:500]
                        break
                console.print(f"[dim]{err_text}[/]")
                return {"error": "No CSV data received"}

    # Count lines for display
    line_count = csv_text.count("\n")
    console.print(f"[green]Got {line_count} rows of analytics data[/]")

    # Import to Cortex
    console.print("[blue]Importing to Cortex...[/]")
    store = await EchoStore.connect()
    try:
        result = await import_csv_text(store, csv_text)
        console.print(
            f"[green]Done![/] "
            f"matched={result['matched']}, "
            f"stored={result['stored']}, "
            f"skipped={result['skipped']}, "
            f"total={result['total']}"
        )
        return result
    finally:
        await store.close()


def main():
    parser = argparse.ArgumentParser(description="Pull X Analytics and import to Cortex")
    parser.add_argument("-d", "--days", type=int, default=1, help="Number of days (default: 1)")
    args = parser.parse_args()

    asyncio.run(pull_and_import(args.days))


if __name__ == "__main__":
    main()
