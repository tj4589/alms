"""AI client singletons and provider fallback helpers."""

import json
import logging
import math
import os
import socket
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).with_name(".env"), override=False)
except Exception:
    pass

AI_PROVIDER = os.getenv("AI_PROVIDER", "deepseek").strip().lower()
AI_FALLBACK_PROVIDER = os.getenv("AI_FALLBACK_PROVIDER", "cohere").strip().lower()
AI_MODEL = os.getenv("AI_MODEL", "deepseek-chat").strip()
COHERE_MODEL = os.getenv("COHERE_MODEL", "command-r7b-12-2024").strip()
MAX_PROVIDER_TIMEOUT_SECONDS = 120.0

DEEPSEEK_UNAVAILABLE_MESSAGE = (
    "The primary AI provider is temporarily unavailable. ExamMind tried the fallback provider."
)
BOTH_PROVIDERS_UNAVAILABLE_MESSAGE = (
    "AI answers are temporarily unavailable. "
    "Uploaded materials, search, and practice data are still available."
)


def _read_bounded_timeout(value: str | None, default: float, maximum: float = MAX_PROVIDER_TIMEOUT_SECONDS) -> float | None:
    """Parse a provider timeout without allowing an unbounded network wait."""
    if value is None or not str(value).strip():
        return default
    try:
        timeout = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(timeout) or timeout <= 0 or timeout > maximum:
        return None
    return timeout


AI_PROVIDER_TIMEOUT_SECONDS = _read_bounded_timeout(
    os.getenv("AI_PROVIDER_TIMEOUT_SECONDS"),
    default=45.0,
)
if AI_PROVIDER_TIMEOUT_SECONDS is None:
    AI_PROVIDER_TIMEOUT_SECONDS = 45.0


def _provider_status(exc: BaseException) -> str:
    """Return only a status code, never an exception message or response body."""
    current: BaseException | None = exc
    for _ in range(4):
        if current is None:
            break
        status = getattr(current, "status_code", None)
        if status is None:
            status = getattr(current, "code", None)
        if isinstance(status, int):
            return str(status)
        cause = current.__cause__ or current.__context__
        current = cause if isinstance(cause, BaseException) else None
    return "unknown"


def _log_provider_failure(provider: str, exc: BaseException) -> None:
    """Log diagnostic fields only; provider messages can contain secrets or bodies."""
    logger.warning(
        "provider_call_failed provider=%s status=%s error_class=%s",
        provider,
        _provider_status(exc),
        type(exc).__name__,
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
        timeout=AI_PROVIDER_TIMEOUT_SECONDS,
        max_retries=0,
    )
    metadata_llm = ChatOpenAI(
        model=AI_MODEL,
        base_url="https://api.deepseek.com/v1",
        api_key=_deepseek_api_key,
        temperature=0,
        timeout=AI_PROVIDER_TIMEOUT_SECONDS,
        max_retries=0,
    )
    logger.info("provider_ready provider=deepseek timeout_seconds=%s max_retries=0", AI_PROVIDER_TIMEOUT_SECONDS)
except Exception as _e:
    llm = None
    metadata_llm = None
    logger.warning(
        "provider_unavailable provider=deepseek status=not_configured error_class=%s",
        type(_e).__name__,
    )

_cohere_api_key = os.getenv("COHERE_API_KEY")
if AI_FALLBACK_PROVIDER == "cohere" and _cohere_api_key:
    logger.info("provider_ready provider=cohere timeout_seconds=%s max_retries=0", AI_PROVIDER_TIMEOUT_SECONDS)
else:
    logger.info("provider_unavailable provider=cohere status=not_configured")


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
    try:
        with urllib.request.urlopen(request, timeout=AI_PROVIDER_TIMEOUT_SECONDS) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403}:
            message = "Cohere fallback authentication failed."
        elif exc.code == 429:
            message = "Cohere fallback rate limit reached."
        elif exc.code >= 500:
            message = "Cohere fallback server is temporarily unavailable."
        else:
            message = "Cohere fallback request failed."
        raise AIProviderError(message) from exc
    except (TimeoutError, socket.timeout):
        raise AIProviderError("Cohere fallback request timed out.") from None
    except (urllib.error.URLError, OSError):
        raise AIProviderError("Cohere fallback could not reach the provider.") from None
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError, ValueError):
        raise AIProviderError("Cohere fallback returned an invalid response.") from None

    if not isinstance(data, dict):
        raise AIProviderError("Cohere fallback returned an invalid response.")
    message = data.get("message") or {}
    if not isinstance(message, dict):
        raise AIProviderError("Cohere fallback returned an invalid response.")
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
        except Exception as exc:
            deepseek_error = exc
            _log_provider_failure("deepseek", exc)
    else:
        deepseek_error = AIProviderError("DeepSeek primary is not configured.")
        logger.warning("provider_call_failed provider=deepseek status=not_configured error_class=ConfigurationError")

    if AI_FALLBACK_PROVIDER == "cohere" and _cohere_api_key:
        logger.info("provider_fallback_attempt provider=cohere")
        try:
            answer = _cohere_chat(prompt, temperature)
            logger.info("provider_call_succeeded provider=cohere")
            return answer
        except Exception as exc:
            _log_provider_failure("cohere", exc)
            raise AIProviderError(BOTH_PROVIDERS_UNAVAILABLE_MESSAGE) from exc

    logger.warning("provider_chain_unavailable providers=deepseek,cohere")
    raise AIProviderError(BOTH_PROVIDERS_UNAVAILABLE_MESSAGE) from deepseek_error


TRANSCRIPTION_PROVIDER = os.getenv("TRANSCRIPTION_PROVIDER", "openai").strip().lower()
OPENAI_TRANSCRIPTION_MODEL = os.getenv("OPENAI_TRANSCRIPTION_MODEL", "whisper-1").strip()
OPENAI_TRANSCRIPTION_BASE_URL = (os.getenv("OPENAI_TRANSCRIPTION_BASE_URL", "https://api.openai.com/v1") or "").strip().rstrip("/")
OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or "").strip()


def _read_transcription_timeout(value: str | None) -> float | None:
    return _read_bounded_timeout(value, default=90.0)


TRANSCRIPTION_TIMEOUT_SECONDS = _read_transcription_timeout(os.getenv("TRANSCRIPTION_TIMEOUT_SECONDS"))


def transcription_configuration_error() -> str | None:
    """Return a safe, actionable configuration error without exposing secrets."""
    if TRANSCRIPTION_PROVIDER != "openai":
        return "Audio transcription provider is unsupported. Set TRANSCRIPTION_PROVIDER=openai."
    if not OPENAI_API_KEY:
        return "Audio transcription is not configured. Set OPENAI_API_KEY for the OpenAI transcription provider."
    if not OPENAI_TRANSCRIPTION_MODEL:
        return "Audio transcription is not configured. Set OPENAI_TRANSCRIPTION_MODEL."
    try:
        parsed_base_url = urlsplit(OPENAI_TRANSCRIPTION_BASE_URL)
    except ValueError:
        return "Audio transcription is not configured. Set a valid OPENAI_TRANSCRIPTION_BASE_URL."
    if parsed_base_url.scheme not in {"http", "https"} or not parsed_base_url.netloc:
        return "Audio transcription is not configured. Set a valid OPENAI_TRANSCRIPTION_BASE_URL."
    if TRANSCRIPTION_TIMEOUT_SECONDS is None:
        return "Audio transcription is not configured. Set TRANSCRIPTION_TIMEOUT_SECONDS to a positive number."
    return None


def transcription_configuration_status() -> dict[str, object]:
    """Expose non-secret configuration state for diagnostics and tests."""
    error = transcription_configuration_error()
    return {
        "configured": error is None,
        "provider": TRANSCRIPTION_PROVIDER,
        "model": OPENAI_TRANSCRIPTION_MODEL,
        "timeout_seconds": TRANSCRIPTION_TIMEOUT_SECONDS,
        "error": error,
    }


def _multipart_form_data(fields: dict[str, str], file_name: str, mime_type: str, content: bytes) -> tuple[bytes, str]:
    boundary = f"----ExamMindBoundary{os.urandom(12).hex()}"
    boundary_bytes = boundary.encode("ascii")
    safe_file_name = Path(file_name).name.replace('"', "'").replace("\r", "").replace("\n", "") or "recording"
    body = bytearray()
    for name, value in fields.items():
        body.extend(b"--" + boundary_bytes + b"\r\n")
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")
    body.extend(b"--" + boundary_bytes + b"\r\n")
    body.extend(f'Content-Disposition: form-data; name="file"; filename="{safe_file_name}"\r\n'.encode("utf-8"))
    body.extend(f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"))
    body.extend(content)
    body.extend(b"\r\n--" + boundary_bytes + b"--\r\n")
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def _openai_transcription_request(file_name: str, mime_type: str, content: bytes) -> dict:
    configuration_error = transcription_configuration_error()
    if configuration_error:
        raise AIProviderError(configuration_error)
    body, content_type = _multipart_form_data(
        {"model": OPENAI_TRANSCRIPTION_MODEL, "response_format": "verbose_json"},
        file_name,
        mime_type,
        content,
    )
    request = urllib.request.Request(
        f"{OPENAI_TRANSCRIPTION_BASE_URL}/audio/transcriptions",
        data=body,
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": content_type},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TRANSCRIPTION_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        _log_provider_failure("openai_transcription", exc)
        if exc.code in {401, 403}:
            message = "Audio transcription authentication failed."
        elif exc.code == 429:
            message = "Audio transcription rate limit reached."
        elif exc.code >= 500:
            message = "Audio transcription provider is temporarily unavailable."
        else:
            message = "Audio transcription provider request failed."
        raise AIProviderError(message) from exc
    except (TimeoutError, socket.timeout) as exc:
        _log_provider_failure("openai_transcription", exc)
        raise AIProviderError("Audio transcription request timed out.") from None
    except (urllib.error.URLError, OSError) as exc:
        _log_provider_failure("openai_transcription", exc)
        raise AIProviderError("Audio transcription could not reach the provider.") from None
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError, ValueError) as exc:
        _log_provider_failure("openai_transcription", exc)
        raise AIProviderError("Audio transcription provider returned an invalid response.") from None


def normalize_transcript_segments(payload: dict | list) -> list[dict]:
    """Validate provider segments without inventing timestamps or speakers."""
    raw_segments = payload.get("segments") if isinstance(payload, dict) else payload
    if not isinstance(raw_segments, list):
        raise AIProviderError("Audio transcription did not return timestamped segments.")

    normalized: list[dict] = []
    for original_index, raw in enumerate(raw_segments):
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "").strip()
        try:
            start = float(raw.get("start"))
            end = float(raw.get("end"))
        except (TypeError, ValueError):
            raise AIProviderError("Audio transcription returned a segment without valid timestamps.")
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < 0 or end < start:
            raise AIProviderError("Audio transcription returned a segment with invalid timestamps.")
        if not text:
            continue
        item = {
            "start_time": start,
            "end_time": end,
            "text": text,
            "_provider_index": original_index,
        }
        speaker = raw.get("speaker")
        if isinstance(speaker, str) and speaker.strip():
            item["speaker"] = speaker.strip()
        confidence = raw.get("confidence")
        if isinstance(confidence, (int, float)) and 0 <= float(confidence) <= 1:
            item["confidence"] = float(confidence)
        normalized.append(item)

    normalized.sort(key=lambda item: (item["start_time"], item["_provider_index"]))
    if not normalized:
        raise AIProviderError("Audio transcription returned no readable timestamped speech.")
    for index, item in enumerate(normalized):
        item["segment_index"] = index
        item.pop("_provider_index", None)
    return normalized


def transcribe_audio(file_name: str, mime_type: str, content: bytes) -> dict:
    """Transcribe audio through the configured provider and return safe segments."""
    configuration_error = transcription_configuration_error()
    if configuration_error:
        raise AIProviderError(configuration_error)
    payload = _openai_transcription_request(file_name, mime_type, content)
    return {
        "provider": "openai",
        "model": OPENAI_TRANSCRIPTION_MODEL,
        "segments": normalize_transcript_segments(payload),
    }


EMBEDDING_DIM = 384
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")

# Small cloud instances cannot afford this model at boot. fastembed plus the
# onnxruntime session is roughly 400-600MB resident, and a 512MB container is
# over its cap before it has served a request -- the platform OOM-kills it
# during startup and the deploy reads as a crash loop rather than a memory
# limit. Set DISABLE_LOCAL_EMBEDDINGS=true to skip it entirely: every consumer
# already treats a missing model as "use keyword search", so the app stays
# usable, it just stops ranking semantically.
EMBEDDINGS_DISABLED = os.getenv("DISABLE_LOCAL_EMBEDDINGS", "false").lower() == "true"


class _LocalEmbeddings:
    """Loads the model on first use, not at import.

    Deferring it means the API boots in a small container and only the
    endpoints that actually embed pay the memory. Callers guard on
    truthiness and wrap the call, so a load failure here degrades to keyword
    search rather than failing the request outright.
    """

    def __init__(self) -> None:
        self._model = None

    def _ensure(self):
        if self._model is None:
            from fastembed import TextEmbedding

            self._model = TextEmbedding(model_name=EMBEDDING_MODEL_NAME)
            print(f"AI: fastembed loaded on demand ({EMBEDDING_MODEL_NAME}, {EMBEDDING_DIM}-dim)")
        return self._model

    def embed_query(self, text: str) -> list[float]:
        return list(list(self._ensure().embed([text]))[0])

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [list(v) for v in self._ensure().embed(texts)]


if EMBEDDINGS_DISABLED:
    embeddings_model = None
    print("AI: local embeddings disabled by DISABLE_LOCAL_EMBEDDINGS")
    print("Semantic search disabled; keyword search fallback remains available.")
else:
    embeddings_model = _LocalEmbeddings()
    print(f"AI: embeddings deferred until first use ({EMBEDDING_MODEL_NAME}, {EMBEDDING_DIM}-dim)")
