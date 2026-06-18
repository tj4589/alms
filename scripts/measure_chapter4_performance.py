"""Measure Chapter Four performance and database evidence for ExamMind.

The script is intentionally conservative: it records real measurements when the
backend/database are available and writes "not_measured" or "unavailable"
otherwise. It does not fabricate upload, OCR, AI, or database values.

Optional environment variables:
  EXAMMIND_API_BASE_URL       Default: http://127.0.0.1:8001
  CHAPTER4_AUTH_TOKEN         Bearer token for protected API endpoints
  EXAMMIND_TEST_EMAIL         Email/username for login fallback
  EXAMMIND_TEST_PASSWORD      Password for login fallback
  CHAPTER4_SEARCH_QUERY       Default: critical path
  CHAPTER4_AI_QUESTION        Default: What does the uploaded material say about critical path?
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "docs" / "chapter4_performance_results.json"
BACKEND_DIR = ROOT / "backend"


def now_ms() -> float:
    return time.perf_counter() * 1000


def request_json(
    method: str,
    path: str,
    *,
    base_url: str,
    token: str | None = None,
    body: dict[str, Any] | None = None,
    form: urllib.parse.urlencode | None = None,
    timeout: float = 30,
) -> tuple[int | None, Any, float | None, str | None]:
    url = f"{base_url.rstrip('/')}{path}"
    headers: dict[str, str] = {"Accept": "application/json"}
    data: bytes | None = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if form is not None:
        data = str(form).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    started = now_ms()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            elapsed = now_ms() - started
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw) if raw else None
            return response.status, parsed, round(elapsed, 2), None
    except urllib.error.HTTPError as exc:
        elapsed = now_ms() - started
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = raw
        return exc.code, parsed, round(elapsed, 2), f"HTTP {exc.code}"
    except Exception as exc:  # backend offline, DNS, timeout, etc.
        return None, None, None, str(exc)


def obtain_token(base_url: str) -> tuple[str | None, dict[str, Any]]:
    existing = os.getenv("CHAPTER4_AUTH_TOKEN")
    if existing:
        return existing, {"method": "CHAPTER4_AUTH_TOKEN", "status": "provided"}

    email = os.getenv("EXAMMIND_TEST_EMAIL")
    password = os.getenv("EXAMMIND_TEST_PASSWORD")
    if not email or not password:
        return None, {
            "method": "none",
            "status": "not_configured",
            "note": "Set CHAPTER4_AUTH_TOKEN or EXAMMIND_TEST_EMAIL/EXAMMIND_TEST_PASSWORD to measure protected endpoints.",
        }

    form = urllib.parse.urlencode({"username": email, "password": password})
    status, payload, elapsed, error = request_json("POST", "/auth/login", base_url=base_url, form=form)
    token = payload.get("access_token") if isinstance(payload, dict) else None
    return token, {
        "method": "login",
        "status": "success" if token else "failed",
        "http_status": status,
        "elapsed_ms": elapsed,
        "error": error,
    }


def measure_api(base_url: str, token: str | None) -> dict[str, Any]:
    results: dict[str, Any] = {}

    root_status, root_payload, root_elapsed, root_error = request_json("GET", "/", base_url=base_url, timeout=5)
    results["backend_health"] = {
        "status": "available" if root_status == 200 else "unavailable",
        "http_status": root_status,
        "elapsed_ms": root_elapsed,
        "error": root_error,
        "payload": root_payload,
    }

    unauth_status, unauth_payload, unauth_elapsed, unauth_error = request_json(
        "GET", "/courses", base_url=base_url, timeout=8
    )
    results["unauthenticated_protected_request"] = {
        "endpoint": "GET /courses",
        "http_status": unauth_status,
        "elapsed_ms": unauth_elapsed,
        "expected": "401 or 403 when backend is available",
        "result": "protected" if unauth_status in (401, 403) else "not_verified",
        "error": unauth_error,
        "payload": unauth_payload,
    }

    search_query = os.getenv("CHAPTER4_SEARCH_QUERY", "critical path")
    if token:
        encoded = urllib.parse.urlencode({"q": search_query})
        status, payload, elapsed, error = request_json(
            "GET", f"/search?{encoded}", base_url=base_url, token=token, timeout=30
        )
        results["semantic_search"] = {
            "query": search_query,
            "http_status": status,
            "elapsed_ms": elapsed,
            "measured": status == 200 and elapsed is not None,
            "result_counts": {
                "past_questions": len(payload.get("past_questions", [])) if isinstance(payload, dict) else None,
                "lecture_notes": len(payload.get("lecture_notes", [])) if isinstance(payload, dict) else None,
                "threads": len(payload.get("threads", [])) if isinstance(payload, dict) else None,
                "study_groups": len(payload.get("study_groups", [])) if isinstance(payload, dict) else None,
                "reading_rooms": len(payload.get("study_sessions", [])) if isinstance(payload, dict) else None,
            },
            "error": error,
        }

        question = os.getenv("CHAPTER4_AI_QUESTION", "What does the uploaded material say about critical path?")
        status, payload, elapsed, error = request_json(
            "POST",
            "/rag/ask",
            base_url=base_url,
            token=token,
            body={"question": question},
            timeout=90,
        )
        results["ai_assistant"] = {
            "question": question,
            "http_status": status,
            "elapsed_ms": elapsed,
            "measured": status == 200 and elapsed is not None,
            "sources_count": len(payload.get("sources", [])) if isinstance(payload, dict) else None,
            "error": error,
        }
    else:
        results["semantic_search"] = {
            "query": search_query,
            "measured": False,
            "status": "not_measured",
            "reason": "No auth token or test credentials provided.",
        }
        results["ai_assistant"] = {
            "measured": False,
            "status": "not_measured",
            "reason": "No auth token or test credentials provided.",
        }

    results["upload_ocr_indexing"] = {
        "measured": False,
        "value": "Not measured in current test session.",
        "manual_timing_instructions": [
            "Start a stopwatch immediately before selecting/uploading the PDF.",
            "Stop when the upload confirmation/indexing success state appears.",
            "Record file name, file size, reading method, page count, and elapsed time.",
        ],
    }

    return results


def count_database_rows() -> dict[str, Any]:
    if not os.getenv("DATABASE_URL"):
        return {
            "status": "unavailable",
            "reason": "DATABASE_URL is not set in the current environment.",
        }

    sys.path.insert(0, str(BACKEND_DIR))
    try:
        import models  # type: ignore
        from database import SessionLocal  # type: ignore

        model_map = {
            "users": models.User,
            "courses": models.Course,
            "lecture_notes": models.LectureNote,
            "lecture_note_chunks": models.LectureNoteChunk,
            "past_questions": models.PastQuestion,
            "practice_attempts": models.PracticeAttempt,
            "readiness_records": models.ReadinessScore,
            "student_progress_records": models.StudentProgress,
            "study_groups": models.StudyGroup,
            "discussion_threads": models.DiscussionThread,
            "thread_messages": models.ThreadMessage,
            "reading_rooms_study_sessions": models.StudySession,
        }

        db = SessionLocal()
        try:
            return {
                "status": "available",
                "counts": {name: db.query(model).count() for name, model in model_map.items()},
            }
        finally:
            db.close()
    except Exception as exc:
        return {
            "status": "unavailable",
            "reason": str(exc),
        }


def main() -> int:
    base_url = os.getenv("EXAMMIND_API_BASE_URL", "http://127.0.0.1:8001")
    token, auth_info = obtain_token(base_url)
    output = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "api_base_url": base_url,
        "auth": auth_info,
        "api_measurements": measure_api(base_url, token),
        "database": count_database_rows(),
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
