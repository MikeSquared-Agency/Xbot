from __future__ import annotations


class KeywordRotator:
    """Round-robin keyword rotation for search queries.

    With N keywords and 10-minute polling cycles, each keyword
    gets searched once every N*10 minutes.
    """

    def __init__(self, keywords: list[str]):
        if not keywords:
            raise ValueError("keywords list must not be empty")
        self.keywords = keywords
        self.index = 0

    def next(self) -> str:
        keyword = self.keywords[self.index % len(self.keywords)]
        self.index += 1
        return keyword
