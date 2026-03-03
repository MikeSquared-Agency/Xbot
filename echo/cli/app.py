from __future__ import annotations

import asyncio
from typing import Optional

from rich.console import Console

from echo.cli.commands import handle_digest, handle_history, handle_status
from echo.cli.editor import open_in_editor
from echo.cli.rendering import render_replies, render_tweet, render_waiting
from echo.db.models import Candidate, GeneratedReply, Tweet


class Publisher:
    """Stub publisher — replace with the real Publish module."""

    async def post(
        self,
        store,
        candidate: Candidate,
        reply: GeneratedReply,
        was_edited: bool,
    ) -> str:
        reply_id = await store.record_reply(
            tweet_id=candidate.tweet.tweet_id,
            reply_text=reply.text,
            strategy=reply.strategy,
            was_edited=was_edited,
            original_text=reply.original_text,
        )
        return reply_id


class EchoCLI:
    def __init__(
        self,
        store,
        publisher: Optional[Publisher] = None,
    ):
        self.console = Console()
        self.store = store
        self.publisher = publisher or Publisher()
        self.running = True

    async def run(self) -> None:
        """Main loop — poll queue, present candidates, handle input."""
        self.console.print("[bold cyan]Echo CLI started[/]")

        while self.running:
            candidate_data = await self.store.get_next_candidate()

            if candidate_data:
                # Convert dict to Candidate dataclass for rendering
                tweet = Tweet(
                    tweet_id=candidate_data.get("tweet_id", ""),
                    tweet_url=candidate_data.get("tweet_url", ""),
                    author_handle=candidate_data.get("author_handle", ""),
                    author_name=candidate_data.get("author_name"),
                    content=candidate_data.get("content", ""),
                    author_followers=candidate_data.get("author_followers"),
                    author_verified=candidate_data.get("author_verified", False),
                    likes_t0=candidate_data.get("likes_t0", 0),
                    replies_t0=candidate_data.get("replies_t0", 0),
                    retweets_t0=candidate_data.get("retweets_t0", 0),
                    virality_score=candidate_data.get("virality_score"),
                    status=candidate_data.get("status", "queued"),
                    tweet_created_at=candidate_data.get("tweet_created_at"),
                    discovered_at=candidate_data.get("discovered_at"),
                )
                candidate = Candidate(tweet=tweet)
                await self._present_candidate(candidate)
            else:
                stats = await self.store.get_session_stats()
                queue_depth = stats.get("queue_depth", 0) if isinstance(stats, dict) else stats.queue_depth
                render_waiting(self.console, queue_depth, stats)
                await asyncio.sleep(10)

    # ------------------------------------------------------------------
    # Candidate presentation
    # ------------------------------------------------------------------

    async def _present_candidate(self, candidate: Candidate) -> None:
        await self.store.update_tweet_status(candidate.tweet.tweet_id, "presented")

        render_tweet(self.console, candidate)
        render_replies(self.console, candidate.generated_replies)

        while True:
            try:
                action = await asyncio.to_thread(
                    self.console.input,
                    "[bold]⌨️  1-5 to post · e to edit · s to skip · q to quit\n> [/]",
                )
            except EOFError:
                self.running = False
                break

            result = await self._handle_action(action.strip(), candidate)
            if result == "next":
                break
            elif result == "quit":
                self.running = False
                break

    # ------------------------------------------------------------------
    # Action dispatch
    # ------------------------------------------------------------------

    async def _handle_action(self, action: str, candidate: Candidate) -> str:
        replies = candidate.generated_replies

        # Direct post: 1–5
        if action in ("1", "2", "3", "4", "5"):
            idx = int(action) - 1
            if idx >= len(replies):
                self.console.print("[red]No reply at that index.[/]")
                return "continue"
            reply = replies[idx]
            await self.publisher.post(self.store, candidate, reply, was_edited=False)
            self.console.print(f"[green]✓ Posted reply #{action}[/]")
            return "next"

        # Edit: "e3 new text" or "e3"
        if action.startswith("e") and len(action) > 1 and action[1].isdigit():
            return await self._handle_edit(action, candidate)

        if action == "s":
            await self.store.update_tweet_status(candidate.tweet.tweet_id, "skipped")
            self.console.print("[yellow]⏭ Skipped[/]")
            return "next"

        if action == "q":
            return "quit"

        if action == "status":
            await handle_status(self.console, self.store)
            return "continue"

        if action == "history":
            await handle_history(self.console, self.store)
            return "continue"

        if action == "digest":
            await handle_digest(self.console, self.store)
            return "continue"

        if action == "refresh":
            self.console.print("[cyan]Refreshing...[/]")
            return "next"

        self.console.print("[red]Unknown command. Use 1-5, e<N>, s, q, status, history, digest.[/]")
        return "continue"

    async def _handle_edit(self, action: str, candidate: Candidate) -> str:
        replies = candidate.generated_replies

        parts = action.split(" ", 1)
        try:
            idx = int(parts[0][1:]) - 1
        except ValueError:
            self.console.print("[red]Invalid edit command. Use e1–e5.[/]")
            return "continue"

        if idx < 0 or idx >= len(replies):
            self.console.print("[red]No reply at that index.[/]")
            return "continue"

        reply = replies[idx]

        if len(parts) > 1:
            new_text = parts[1]
        else:
            new_text = await asyncio.to_thread(open_in_editor, reply.text)

        if not new_text:
            self.console.print("[yellow]Edit cancelled (empty text).[/]")
            return "continue"

        reply.original_text = reply.text
        reply.text = new_text
        await self.publisher.post(self.store, candidate, reply, was_edited=True)
        self.console.print("[green]✓ Posted edited reply[/]")
        return "next"
