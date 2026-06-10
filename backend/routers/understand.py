"""
POST /understand — semantic intent classification for student messages.

Classification layers (fastest to most expensive):
1. Empty / trivial greeting / short ack  → instant rule-based result
2. GUIDANCE_NEEDED_MARKERS check         → fast substring scan
3. LLM (metadata_llm, temperature=0)     → one call per message send
4. Rule-based fallback via query_understanding.py when LLM unavailable
"""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from query_understanding import CONVERSATIONAL_NONTOPICS, GUIDANCE_NEEDED_MARKERS, understand_query

try:
    from ai_clients import metadata_llm as _llm
except ImportError:
    _llm = None  # type: ignore[assignment]

router = APIRouter(tags=["understand"])

# ── Trivial constant sets ─────────────────────────────────────────────────────

_GREETINGS = frozenset([
    "hi", "hey", "hello", "yo", "sup", "hiya", "howdy",
    "good morning", "good afternoon", "good evening",
])

_SHORT_ACKS = frozenset([
    "ok", "okay", "yes", "yeah", "yep", "no", "nah",
    "sure", "alright", "thanks", "thank you", "noted",
    "got it", "fine", "cool", "understood", "i see",
])

# Follow-up / conversational phrases — NEVER academic, NEVER call RAG
_FOLLOWUP_PHRASES: frozenset[str] = frozenset([
    "are you sure", "are u sure", "you sure", "u sure",
    "really", "for real",
    "how", "why",
    "explain", "explain that", "explain more",
    "what do you mean", "what does that mean", "what do u mean",
    "then what", "what next", "and then", "what happens next",
    "okay but how", "ok but how", "yes but how", "but how",
    "alright then",
    "so what should i do", "so what do i do",
    "how do i do that", "how do i start",
    "what should i do", "what can i do",
    "is that right", "is this right", "are you certain",
])


# ── Schema ────────────────────────────────────────────────────────────────────


class UnderstandRequest(BaseModel):
    message: str
    conversation_context: str | None = None


class IntentResult(BaseModel):
    intent: str
    student_state: str
    should_call_rag: bool
    should_search: bool
    should_ask_clarifying_question: bool
    interpreted_topic: str | None = None
    related_terms: list[str] = []
    possible_course: str | None = None
    possible_lecturer: str | None = None
    lecturer_name: str | None = None
    course_code: str | None = None
    topic: str | None = None
    needs_course: bool = False
    needs_lecturer: bool = False
    confidence: float
    response_strategy: str
    clarifying_question: str | None = None


# ── Classification prompt ─────────────────────────────────────────────────────

_CLASSIFY_PROMPT = """\
Classify this student message for ExamMind, a Nigerian university study assistant.
Output ONLY valid JSON — no explanation, no markdown fences.

Student message: {message}
Last assistant reply (context): {context}

Intent options (pick exactly one):
- "guidance_needed" — student is confused, lost, blank, frustrated, overwhelmed, mentally tired, doesn't know where to start, doesn't know what to study. THIS INCLUDES: "I'm lost", "I'm blank", "I'm overwhelmed", "I'm frustrated", "nothing is entering my head", "I don't know where to start", "I can't remember the course", "I can't place it", Nigerian Pidgin like "I no sabi wetin I wan read", "nothing dey enter my head", "I dey blank", "I dey confused", "I no know wetin to read". NEVER set should_call_rag=true for guidance_needed.
- "greeting" — hello/hi/hey/good morning/yo only. NEVER set should_call_rag=true.
- "help" — asking what ExamMind can do or how it works. NEVER call RAG.
- "confirmation" — ok/yes/sure/are you sure/really responding to something said. NEVER call RAG.
- "academic_explanation" — wants explanation of a topic, even vaguely described ("the human relations thingy", "workers motivation topic", "computer stuffs"). Use your knowledge to identify the academic topic and set interpreted_topic. CAN call RAG when a topic is identifiable.
- "academic_search" — looking for past questions, exam materials, what came out. Set should_search=true.
- "practice_request" — wants quiz/practice/test. Do NOT call RAG — route to practice.
- "lecturer_pattern" — asking about a specific lecturer's topics, style, patterns ("how does Iheanetu set questions?").
- "campus_social" — looking for study groups, reading rooms. Do NOT call RAG.
- "upload_help" — asking what to upload. Do NOT call RAG.
- "unclear" — truly cannot determine intent. Set should_ask_clarifying_question=true.

Rules:
- should_call_rag = true ONLY when intent is "academic_explanation" AND a topic can be reasonably identified.
- should_call_rag MUST BE false for: guidance_needed, greeting, confirmation, help, campus_social, practice_request, upload_help, unclear.
- student_state: neutral | confused | frustrated | overwhelmed | curious | focused.
- confidence: 0.0–1.0 based on how clear the intent is.
- For vague academic descriptions, fill interpreted_topic using academic knowledge.

Required JSON (fill every field):
{{"intent":"","student_state":"neutral","should_call_rag":false,"should_search":false,"should_ask_clarifying_question":false,"interpreted_topic":null,"related_terms":[],"possible_course":null,"possible_lecturer":null,"confidence":0.5,"response_strategy":"","clarifying_question":null}}"""


# ── Layer 1: trivial rule-based (no LLM) ─────────────────────────────────────


def _trivial(message: str) -> IntentResult | None:
    core = re.sub(r"[!.,?\s]+$", "", message.strip().lower()).strip()
    if not core:
        return IntentResult(
            intent="unclear",
            student_state="neutral",
            should_call_rag=False,
            should_search=False,
            should_ask_clarifying_question=True,
            confidence=1.0,
            response_strategy="ask what to study",
            clarifying_question="What course, topic, or exam are you preparing for?",
        )
    if core in _GREETINGS:
        return IntentResult(
            intent="greeting",
            student_state="neutral",
            should_call_rag=False,
            should_search=False,
            should_ask_clarifying_question=False,
            confidence=1.0,
            response_strategy="greet naturally and ask what to study",
        )
    if core in _SHORT_ACKS or core in _FOLLOWUP_PHRASES:
        return IntentResult(
            intent="confirmation",
            student_state="neutral",
            should_call_rag=False,
            should_search=False,
            should_ask_clarifying_question=False,
            confidence=1.0,
            response_strategy="continue conversation",
        )
    return None


# ── Layer 2: guidance-needed marker scan (no LLM) ────────────────────────────


def _guidance_scan(message: str) -> IntentResult | None:
    lower = message.lower()
    if any(marker in lower for marker in GUIDANCE_NEEDED_MARKERS):
        state = "frustrated" if any(w in lower for w in ("frustrated", "tired", "tired of", "overwhelm")) else "confused"
        return IntentResult(
            intent="guidance_needed",
            student_state=state,
            should_call_rag=False,
            should_search=False,
            should_ask_clarifying_question=False,
            confidence=0.92,
            response_strategy="reassure and guide",
        )
    return None


# ── Layer 3: LLM classification ───────────────────────────────────────────────


def _llm_classify(message: str, context: str) -> IntentResult:
    if _llm is None:
        return _rule_fallback(message)

    prompt = _CLASSIFY_PROMPT.format(
        message=json.dumps(message),
        context=json.dumps((context or "(none)")[:400]),
    )
    try:
        response = _llm.invoke(prompt)
        raw = getattr(response, "content", str(response)).strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw).strip()
        # Extract first JSON object if extra text present
        m = re.search(r"\{[\s\S]*\}", raw)
        if m:
            raw = m.group(0)
        data = json.loads(raw)
        return IntentResult(
            intent=str(data.get("intent", "unclear")),
            student_state=str(data.get("student_state", "neutral")),
            should_call_rag=bool(data.get("should_call_rag", False)),
            should_search=bool(data.get("should_search", False)),
            should_ask_clarifying_question=bool(data.get("should_ask_clarifying_question", False)),
            interpreted_topic=data.get("interpreted_topic") or None,
            related_terms=[str(t) for t in (data.get("related_terms") or [])[:8]],
            possible_course=data.get("possible_course") or None,
            possible_lecturer=data.get("possible_lecturer") or None,
            lecturer_name=data.get("lecturer_name") or data.get("possible_lecturer") or None,
            course_code=data.get("course_code") or data.get("possible_course") or None,
            topic=data.get("topic") or None,
            needs_course=bool(data.get("needs_course", False)),
            needs_lecturer=bool(data.get("needs_lecturer", False)),
            confidence=max(0.0, min(1.0, float(data.get("confidence", 0.5)))),
            response_strategy=str(data.get("response_strategy", "")),
            clarifying_question=data.get("clarifying_question") or None,
        )
    except Exception:
        return _rule_fallback(message)


# ── Layer 4: rule-based fallback when LLM unavailable ────────────────────────


def _rule_fallback(message: str, db: Session | None = None) -> IntentResult:
    context_data: list[dict] = []
    if db is not None:
        context_data = [
            {"code": c.code, "name": c.name, "description": c.description}
            for c in db.query(models.Course).limit(40).all()
        ]

    understanding = understand_query(message, context_data or None)
    raw_intent = understanding.get("intent", "general_search")

    intent_map: dict[str, str] = {
        "greeting": "greeting",
        "guidance_needed": "guidance_needed",
        "lecturer_pattern": "lecturer_pattern",
        "practice": "practice_request",
        "find_past_questions": "academic_search",
        "explain": "academic_explanation",
        "campus_social": "campus_social",
        "upload_help": "upload_help",
        "general_search": "academic_explanation",
        "unclear": "unclear",
    }
    intent = intent_map.get(raw_intent, "academic_explanation")

    has_topic = bool(understanding.get("interpreted_topic"))
    possible_courses: list[str] = understanding.get("possible_courses") or []
    possible_lecturers: list[str] = understanding.get("possible_lecturers") or []
    lecturer_name = understanding.get("lecturer_name") or (possible_lecturers[0] if possible_lecturers else None)
    course_code = understanding.get("course_code") or (possible_courses[0] if possible_courses else None)

    return IntentResult(
        intent=intent,
        student_state="neutral",
        should_call_rag=(intent == "academic_explanation" and has_topic),
        should_search=(intent == "academic_search" or intent == "lecturer_pattern"),
        should_ask_clarifying_question=bool(understanding.get("needs_clarification")),
        interpreted_topic=understanding.get("interpreted_topic"),
        related_terms=understanding.get("related_terms") or [],
        possible_course=course_code,
        possible_lecturer=lecturer_name,
        lecturer_name=lecturer_name,
        course_code=course_code,
        topic=understanding.get("topic"),
        needs_course=bool(understanding.get("needs_course")),
        needs_lecturer=bool(understanding.get("needs_lecturer")),
        confidence=float(understanding.get("confidence", 0.5)),
        response_strategy=f"handle {intent}",
        clarifying_question=understanding.get("clarifying_question"),
    )


# ── Endpoint ──────────────────────────────────────────────────────────────────


@router.post("/understand", response_model=IntentResult)
def understand_message(
    req: UnderstandRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),  # noqa: ARG001
):
    message = (req.message or "").strip()
    context = (req.conversation_context or "").strip()

    # Layer 1 — trivial
    result = _trivial(message)
    if result:
        return result

    # Layer 2 — guidance marker scan (catches Pidgin/emotional messages fast)
    result = _guidance_scan(message)
    if result:
        return result

    # Layer 3/4 — LLM (with rule-based fallback)
    result = _llm_classify(message, context)

    lecturer_understanding = understand_query(message)
    if lecturer_understanding.get("intent") == "lecturer_pattern":
        lecturer_name = lecturer_understanding.get("lecturer_name")
        course_code = lecturer_understanding.get("course_code")
        result = IntentResult(
            intent="lecturer_pattern",
            student_state="focused",
            should_call_rag=bool(lecturer_name and course_code),
            should_search=True,
            should_ask_clarifying_question=bool(lecturer_understanding.get("needs_lecturer")),
            interpreted_topic=(
                f"{lecturer_name} {course_code} question pattern"
                if lecturer_name and course_code
                else lecturer_name
            ),
            related_terms=lecturer_understanding.get("related_terms") or [],
            possible_course=course_code,
            possible_lecturer=lecturer_name,
            lecturer_name=lecturer_name,
            course_code=course_code,
            topic=lecturer_understanding.get("topic"),
            needs_course=bool(lecturer_understanding.get("needs_course")),
            needs_lecturer=bool(lecturer_understanding.get("needs_lecturer")),
            confidence=0.94,
            response_strategy="analyze lecturer question pattern from uploaded materials",
            clarifying_question=(
                "Which lecturer should I analyze?"
                if lecturer_understanding.get("needs_lecturer")
                else None
            ),
        )

    # Post-process: if the LLM returned an interpreted_topic made entirely of
    # conversational non-topic words (e.g. "sure", "lost", "don lost mehhh"),
    # discard it and flip to confirmation so RAG is never called.
    if result.interpreted_topic:
        topic_tokens = set(re.findall(r"[a-z]+", result.interpreted_topic.lower()))
        if topic_tokens and topic_tokens.issubset(CONVERSATIONAL_NONTOPICS):
            result = IntentResult(
                intent="confirmation",
                student_state=result.student_state,
                should_call_rag=False,
                should_search=False,
                should_ask_clarifying_question=False,
                interpreted_topic=None,
                related_terms=[],
                possible_course=None,
                possible_lecturer=None,
                confidence=0.95,
                response_strategy="continue conversation",
                clarifying_question=None,
            )

    return result
