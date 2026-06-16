"""AI client singletons and provider fallback helpers."""

import json
import os
import socket
import urllib.error
import urllib.request
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).with_name(".env"), override=False)
except Exception:
    pass

AI_PROVIDER = os.getenv("AI_PROVIDER", "deepseek").strip().lower()
AI_FALLBACK_PROVIDER = os.getenv("AI_FALLBACK_PROVIDER", "cohere").strip().lower()
AI_MODEL = os.getenv("AI_MODEL", "deepseek-chat").strip()
COHERE_MODEL = os.getenv("COHERE_MODEL", "command-r7b-12-2024").strip()

DEEPSEEK_UNAVAILABLE_MESSAGE = (
    "The primary AI provider is temporarily unavailable. ExamMind tried the fallback provider."
)
BOTH_PROVIDERS_UNAVAILABLE_MESSAGE = (
    "AI answers are temporarily unavailable because the primary provider balance is low. "
    "Uploaded materials, search, and practice data are still available."
)


try:
    from langchain_openai import ChatOpenAI

    if AI_PROVIDER != "deepseek":
        raise ValueError(f"Unsupported AI_PROVIDER '{AI_PROVIDER}'. Set AI_PROVIDER=deepseek.")

    _deepseek_api_key = os.getenv("DEEPSEEK_API_KEY")
    if not _deepseek_api_key:
        raise ValueError("DEEPSEEK_API_KEY is not set")

    llm = ChatOpenAI(
        model=AI_MODEL,
        base_url="https://api.deepseek.com/v1",
        api_key=_deepseek_api_key,
        temperature=0.3,
    )
    metadata_llm = ChatOpenAI(
        model=AI_MODEL,
        base_url="https://api.deepseek.com/v1",
        api_key=_deepseek_api_key,
        temperature=0,
    )
    print("AI: DeepSeek primary ready")
except Exception as _e:
    llm = None
    metadata_llm = None
    print(f"Warning: DeepSeek LLM not configured - {_e}")

_cohere_api_key = os.getenv("COHERE_API_KEY")
if AI_FALLBACK_PROVIDER == "cohere" and _cohere_api_key:
    print("AI: Cohere fallback ready")
else:
    print("AI: Cohere fallback not configured")


class AIProviderError(RuntimeError):
    """Clean error raised after configured AI providers are unavailable."""


def _extract_langchain_content(response) -> str:
    content = getattr(response, "content", response)
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
            else:
                parts.append(str(getattr(item, "text", item)))
        return "\n".join(part for part in parts if part).strip()
    return str(content).strip()


def _cohere_chat(prompt: str, temperature: float) -> str:
    if AI_FALLBACK_PROVIDER != "cohere" or not _cohere_api_key:
        raise AIProviderError("Cohere fallback is not configured.")

    payload = json.dumps(
        {
            "model": COHERE_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://api.cohere.com/v2/chat",
        data=payload,
        headers={
            "Authorization": f"Bearer {_cohere_api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        data = json.loads(response.read().decode("utf-8"))

    message = data.get("message") or {}
    content = message.get("content") or []
    if isinstance(content, str):
        answer = content
    else:
        answer = "\n".join(
            str(item.get("text") or item.get("content") or "")
            for item in content
            if isinstance(item, dict)
        )
    answer = answer.strip()
    if not answer:
        raise AIProviderError("Cohere returned an empty response.")
    return answer


def _provider_error_text(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        return f"HTTP {exc.code}: {body or exc.reason}"
    return str(exc)


def generate_ai_response(prompt: str, temperature: float = 0.3) -> str:
    """Generate text with DeepSeek first, then optional Cohere fallback."""
    deepseek_error: Exception | None = None
    if llm is not None:
        try:
            response = llm.invoke(prompt)
            answer = _extract_langchain_content(response)
            if answer:
                return answer
            raise AIProviderError("DeepSeek returned an empty response.")
        except (TimeoutError, socket.timeout, Exception) as exc:
            deepseek_error = exc
            print(f"AI: DeepSeek primary failed - {_provider_error_text(exc)}")
    else:
        deepseek_error = AIProviderError("DeepSeek primary is not configured.")
        print("AI: DeepSeek primary failed - not configured")

    if AI_FALLBACK_PROVIDER == "cohere" and _cohere_api_key:
        print("AI: Trying Cohere fallback...")
        try:
            answer = _cohere_chat(prompt, temperature)
            print("AI: Cohere fallback succeeded")
            return answer
        except Exception as exc:
            print(f"AI: Cohere fallback failed - {_provider_error_text(exc)}")
            raise AIProviderError(BOTH_PROVIDERS_UNAVAILABLE_MESSAGE) from exc

    print("AI: Both providers unavailable")
    raise AIProviderError(BOTH_PROVIDERS_UNAVAILABLE_MESSAGE) from deepseek_error


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
