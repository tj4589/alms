"""
AI client singletons imported by ingest, rag, and search routers.

LLM: DeepSeek Chat via OpenAI-compatible API.
Embeddings: fastembed local model when installed; routers fall back to keyword
search when embeddings are unavailable.
"""

import os

AI_PROVIDER = os.getenv("AI_PROVIDER", "deepseek").lower()
AI_MODEL = os.getenv("AI_MODEL", "deepseek-chat")

try:
    from langchain_openai import ChatOpenAI

    if AI_PROVIDER != "deepseek":
        raise ValueError(f"Unsupported AI_PROVIDER '{AI_PROVIDER}'. Set AI_PROVIDER=deepseek.")

    _api_key = os.getenv("DEEPSEEK_API_KEY")
    if not _api_key:
        raise ValueError("DEEPSEEK_API_KEY is not set")

    llm = ChatOpenAI(
        model=AI_MODEL,
        base_url="https://api.deepseek.com/v1",
        api_key=_api_key,
        temperature=0.3,
    )
    metadata_llm = ChatOpenAI(
        model=AI_MODEL,
        base_url="https://api.deepseek.com/v1",
        api_key=_api_key,
        temperature=0,
    )
    print(f"AI: DeepSeek Chat ready ({AI_MODEL})")
except Exception as _e:
    llm = None
    metadata_llm = None
    print(f"Warning: DeepSeek LLM not configured - {_e}")


EMBEDDING_DIM = 384

try:
    from fastembed import TextEmbedding as _TE

    _fe = _TE(model_name="BAAI/bge-small-en-v1.5")

    class _LocalEmbeddings:
        def embed_query(self, text: str) -> list[float]:
            return list(list(_fe.embed([text]))[0])

        def embed_documents(self, texts: list[str]) -> list[list[float]]:
            return [list(v) for v in _fe.embed(texts)]

    embeddings_model = _LocalEmbeddings()
    print("AI: fastembed embeddings ready (BAAI/bge-small-en-v1.5, 384-dim)")
except Exception as _e:
    embeddings_model = None
    print(f"Warning: fastembed not available - {_e}")
    print("Semantic search disabled; keyword search fallback remains available.")
