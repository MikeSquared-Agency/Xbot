import math
import os

_embedding_client = None


async def get_embedding_client():
    """Lazy-init the OpenAI client for embeddings (voyage-3 or text-embedding-3-small)."""
    global _embedding_client
    if _embedding_client is None:
        from openai import AsyncOpenAI

        _embedding_client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    return _embedding_client


async def generate_embedding(text: str, model: str = "text-embedding-3-small") -> list[float]:
    """Generate a 1536-dim embedding vector for the given text."""
    client = await get_embedding_client()
    response = await client.embeddings.create(input=text, model=model)
    return response.data[0].embedding


async def generate_niche_embedding(keywords: list[str], topics: list[str] | None = None) -> list[float]:
    """Build the niche embedding from configured keywords and topics."""
    parts = list(keywords)
    if topics:
        parts.extend(topics)
    niche_text = " ".join(parts)
    return await generate_embedding(niche_text)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
