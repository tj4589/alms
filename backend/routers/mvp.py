from collections import defaultdict
import json
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Text, func, or_
from sqlalchemy.orm import Session

import auth
import models
from ai_clients import AIProviderError, generate_ai_response
from database import get_db
from routers.rag import run_rag_query

router = APIRouter(tags=["mvp"])


class PracticeGenerateRequest(BaseModel):
    course_id: Optional[int] = None
    topic: Optional[str] = None
    count: int = 5


class PracticeSubmitRequest(BaseModel):
    course_id: Optional[int] = None
    topic: Optional[str] = None
    score: int
    total_questions: int


MAX_NOTE_PRACTICE_CHUNKS = 6
MAX_NOTE_PRACTICE_CONTEXT_CHARS = 4500


def _topic_terms(topic: str | None) -> list[str]:
    if not topic:
        return []
    words = re.findall(r"[A-Za-z0-9]+", topic.lower())
    phrases = [topic.strip().lower()]
    if len(words) > 1:
        phrases.extend(" ".join(words[i : i + 2]) for i in range(len(words) - 1))
    phrases.extend(word for word in words if len(word) >= 4)
    return list(dict.fromkeys(term for term in phrases if term))


PRACTICE_TOPIC_KEYWORDS = [
    ("project network diagram", r"\bnetwork\s+diagram\b"),
    ("critical path", r"\bcritical\s+path\b"),
    ("path lengths", r"\bpath\s+lengths?\b|\blength\s+of\s+each\s+path\b"),
    ("PERT duration", r"\bPERT\b|\bexpected\s+duration\b|optimistic|pessimistic|most\s+likely"),
    ("project scope management", r"\bscope\s+management\b"),
    ("scope management issues", r"\bscope\s+(?:management\s+)?(?:issues|problems)\b"),
    ("risk management", r"\brisk\s+management\b|\brisk\b"),
    ("risk breakdown structure", r"\brisk\s+breakdown\s+structure\b|\bRBS\b"),
    ("communication management", r"\bcommunication\s+management\b|\bcommunication\b"),
    ("procurement management", r"\bprocurement\s+management\b|\bprocurement\b"),
    ("contract pricing", r"\bcontract\s+pricing\b|\bpricing\s+contracts?\b"),
    ("cost management", r"\bcost\s+management\b"),
    ("earned value management", r"\bearned\s+value\b|\bEVM\b"),
    ("cost variance", r"\bcost\s+variance\b|\bCV\b"),
    ("schedule variance", r"\bschedule\s+variance\b|\bSV\b"),
    ("cost performance index", r"\bcost\s+performance\s+index\b|\bCPI\b"),
    ("schedule performance index", r"\bschedule\s+performance\s+index\b|\bSPI\b"),
    ("stakeholder management", r"\bstakeholder\s+management\b|\bstakeholder\b"),
    ("power/interest grid", r"\bpower\s*/?\s*interest\s+grid\b"),
]


def _clean_practice_prompt(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip(" -:\t\r\n")
    text = re.sub(r"\b(COVENANT UNIVERSITY|COLLEGE OF|DEPARTMENT OF|COURSE CODE|COURSE TITLE|SESSION|SEMESTER)\b.*?(?=\b(question|identify|determine|calculate|discuss|explain|evaluate|state|draw)\b|$)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^[#*=_~|\\/\W\d]{1,12}$", "", text).strip()
    text = re.sub(r"\bQuestion\s*\d+\s*[:.)-]?\s*", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s+", " ", text).strip(" -:")
    if text and not text.endswith("?") and not text.endswith("."):
        text += "."
    return text[:320]


def _practice_tags(text: str, metadata: dict | None = None) -> list[str]:
    tags = [tag for tag, pattern in PRACTICE_TOPIC_KEYWORDS if re.search(pattern, text, re.IGNORECASE)]
    if not tags:
        haystack = " ".join((metadata or {}).get("topics_covered") or [])
        tags = [tag for tag, pattern in PRACTICE_TOPIC_KEYWORDS if re.search(pattern, haystack, re.IGNORECASE)]
    return list(dict.fromkeys(tags))[:6]


def _practice_source_title(row: models.PastQuestion) -> str:
    metadata = row.metadata_json or {}
    title = metadata.get("document_title") or metadata.get("source_file") or metadata.get("course_title") or "Uploaded past question"
    return re.sub(r"\s+", " ", str(title)).strip()


def _preview_question_prompts(metadata: dict | None) -> list[str]:
    metadata = metadata or {}
    preview = metadata.get("content_preview") or {}
    prompts: list[str] = []
    questions = preview.get("questions") if isinstance(preview, dict) else None
    if isinstance(questions, list):
        for item in questions:
            if isinstance(item, dict):
                prompts.append(str(item.get("preview") or item.get("text") or ""))
            else:
                prompts.append(str(item or ""))
    preview_sections = metadata.get("preview_sections") or []
    if isinstance(preview_sections, list):
        for section in preview_sections:
            if isinstance(section, dict) and re.search(r"question|\b\d+[.)]", str(section.get("label") or ""), re.IGNORECASE):
                prompts.append(str(section.get("text") or section.get("preview") or ""))
    return [_clean_practice_prompt(prompt) for prompt in prompts if _clean_practice_prompt(prompt)]


def _fallback_practice_prompts(row: models.PastQuestion) -> list[str]:
    metadata = row.metadata_json or {}
    text = str(metadata.get("cleaned_text") or row.content_text or "")
    chunks = re.split(r"\b(?:Question\s*)?(?=[1-9]\s*[.)])", text)
    prompts: list[str] = []
    for chunk in chunks:
        cleaned = _clean_practice_prompt(chunk)
        if len(cleaned) < 24:
            continue
        if re.search(r"covenant university|department|course title|session|semester|#\d+", cleaned, re.IGNORECASE):
            continue
        if not re.search(r"\b(identify|determine|calculate|discuss|explain|evaluate|state|draw|prepare|develop|risk|cost|scope|critical|PERT|stakeholder|procurement|communication)\b", cleaned, re.IGNORECASE):
            continue
        prompts.append(cleaned)
    return list(dict.fromkeys(prompts))[:8]


def _practice_item_score(item: dict, topic: str | None) -> int:
    if not topic:
        return 0
    haystack = " ".join([item.get("prompt", ""), " ".join(item.get("topic_tags", []))]).lower()
    terms = _topic_terms(topic)
    score = sum(4 for term in terms if term in haystack)
    if "critical path" in topic.lower():
        score += sum(
            3
            for term in ["critical path", "network diagram", "pert", "path length", "completion time"]
            if term in haystack
        )
    return score


def _serialize_practice_items(rows: list[models.PastQuestion], topic: str | None, limit: int) -> list[dict]:
    items: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        metadata = row.metadata_json or {}
        prompts = _preview_question_prompts(metadata) or _fallback_practice_prompts(row)
        source = _practice_source_title(row)
        for index, prompt in enumerate(prompts, start=1):
            key = re.sub(r"\W+", " ", prompt.lower()).strip()
            if not key or key in seen:
                continue
            seen.add(key)
            tags = _practice_tags(prompt, metadata)
            items.append(
                {
                    "id": f"pq-{row.id}-{index}",
                    "prompt": prompt,
                    "source": source,
                    "year": row.year or metadata.get("year"),
                    "difficulty": row.difficulty or "mixed",
                    "topic_tags": tags,
                    "source_type": "past_question",
                }
            )
    items.sort(key=lambda item: _practice_item_score(item, topic), reverse=True)
    return items[:limit]


def _practice_item_key(prompt: str) -> str:
    return re.sub(r"\W+", " ", str(prompt or "").lower()).strip()


def _note_source_title(metadata: dict | None, fallback: str = "Uploaded notes") -> str:
    metadata = metadata or {}
    title = metadata.get("document_title") or metadata.get("source_file") or metadata.get("course_title") or fallback
    return re.sub(r"\s+", " ", str(title)).strip()


def _relevant_note_chunks(
    db: Session,
    course_id: int | None,
    topic: str | None,
    limit: int = MAX_NOTE_PRACTICE_CHUNKS,
) -> list[models.LectureNoteChunk]:
    query = db.query(models.LectureNoteChunk)
    if course_id is not None:
        query = query.filter(models.LectureNoteChunk.course_id == course_id)

    terms = _topic_terms(topic)
    if terms:
        filters = []
        for term in terms[:8]:
            pattern = f"%{term}%"
            filters.append(models.LectureNoteChunk.chunk_text.ilike(pattern))
            filters.append(models.LectureNoteChunk.topic_tag.ilike(pattern))
        query = query.filter(or_(*filters))

    rows = query.order_by(models.LectureNoteChunk.id.desc()).limit(30).all()
    if not terms:
        return rows[:limit]

    def score(row: models.LectureNoteChunk) -> int:
        haystack = f"{row.topic_tag or ''} {row.chunk_text or ''}".lower()
        return sum(3 if term in (row.topic_tag or "").lower() else 1 for term in terms if term in haystack)

    return sorted(rows, key=score, reverse=True)[:limit]


def _strip_json_fences(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _parse_generated_practice_json(value: str) -> list[dict[str, Any]]:
    text = _strip_json_fences(value)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", text)
        if not match:
            return []
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []
    if isinstance(parsed, dict):
        parsed = parsed.get("questions") or parsed.get("items") or []
    return parsed if isinstance(parsed, list) else []


def _generated_practice_from_notes(
    chunks: list[models.LectureNoteChunk],
    topic: str | None,
    count: int,
) -> tuple[list[dict], str | None]:
    if not chunks or count <= 0:
        return [], None

    parts: list[str] = []
    source_titles: list[str] = []
    total_chars = 0
    for index, chunk in enumerate(chunks, start=1):
        metadata = chunk.metadata_json or {}
        source_title = _note_source_title(metadata)
        source_titles.append(source_title)
        chunk_text = re.sub(r"\s+", " ", str(chunk.chunk_text or "")).strip()
        if not chunk_text:
            continue
        remaining = MAX_NOTE_PRACTICE_CONTEXT_CHARS - total_chars
        if remaining <= 0:
            break
        snippet = chunk_text[:remaining]
        total_chars += len(snippet)
        parts.append(f"[Source {index}: {source_title}]\n{snippet}")

    context = "\n\n".join(parts).strip()
    if not context:
        return [], None

    source_label = ", ".join(list(dict.fromkeys(source_titles))[:3])
    prompt = f"""
You are ExamMind's practice-question generator for authenticated university students.
Use ONLY the provided uploaded lecture-note/study-material context.
Generate {count} exam-style practice questions{f" about {topic}" if topic else ""}.

Return STRICT JSON only: a list of objects.
Each object must have:
{{"prompt": "...", "topic": "...", "difficulty": "easy|medium|hard"}}

Rules:
- Do not include answers.
- Do not invent facts not supported by the context.
- Do not use markdown fences or prose outside the JSON.
- Keep each prompt clear and academically useful.

Context:
{context}
""".strip()

    try:
        raw = generate_ai_response(prompt, temperature=0.3)
    except AIProviderError as exc:
        return [], f"Practice generation from notes is temporarily unavailable: {exc}"
    except Exception:
        return [], "Practice generation from notes is temporarily unavailable."

    parsed = _parse_generated_practice_json(raw)
    items: list[dict] = []
    seen: set[str] = set()
    for index, item in enumerate(parsed, start=1):
        if not isinstance(item, dict):
            continue
        question = _clean_practice_prompt(str(item.get("prompt") or ""))
        if len(question) < 20:
            continue
        key = _practice_item_key(question)
        if not key or key in seen:
            continue
        seen.add(key)
        item_topic = str(item.get("topic") or topic or "Generated practice").strip()
        difficulty = str(item.get("difficulty") or "medium").lower().strip()
        if difficulty not in {"easy", "medium", "hard"}:
            difficulty = "medium"
        items.append(
            {
                "id": f"note-gen-{index}",
                "prompt": question,
                "source": source_label or "Uploaded notes",
                "year": None,
                "difficulty": difficulty,
                "topic": item_topic,
                "topic_tags": _practice_tags(f"{question} {item_topic}") or ([item_topic] if item_topic else []),
                "source_type": "generated_from_notes",
            }
        )
        if len(items) >= count:
            break

    if not items:
        return [], "ExamMind found note material, but could not generate clean practice questions from it yet."
    return items, None


def _merge_practice_items(past_items: list[dict], generated_items: list[dict], limit: int) -> list[dict]:
    merged: list[dict] = []
    seen: set[str] = set()
    for item in [*past_items, *generated_items]:
        key = _practice_item_key(item.get("prompt", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(item)
        if len(merged) >= limit:
            break
    return merged


def serialize_course(row: models.Course) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "description": row.description,
    }


def serialize_past_question(row: models.PastQuestion) -> dict:
    return {
        "id": row.id,
        "course_id": row.course_id,
        "topic_id": row.topic_id,
        "uploaded_by": row.uploaded_by,
        "year": row.year,
        "semester": row.semester,
        "difficulty": row.difficulty,
        "content_text": row.content_text,
        "file_url": row.file_url,
        "created_at": row.created_at,
        "metadata_json": row.metadata_json or {},
    }


def serialize_lecture_note(row: models.LectureNote) -> dict:
    return {
        "id": row.id,
        "course_id": row.course_id,
        "uploaded_by": row.uploaded_by,
        "topic": row.topic,
        "title": row.title,
        "year": row.year,
        "semester": row.semester,
        "file_url": row.file_url,
        "created_at": row.created_at,
        "metadata_json": row.metadata_json or {},
    }


def serialize_thread(row: models.DiscussionThread) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "course_id": row.course_id,
        "past_question_id": row.past_question_id,
        "created_by": row.created_by,
        "created_at": row.created_at,
    }


class ThreadCreateRequest(BaseModel):
    title: str
    course_id: Optional[int] = None
    past_question_id: Optional[int] = None


class ThreadMessageRequest(BaseModel):
    content: str


class StudyGroupCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    course_id: Optional[int] = None
    topic: Optional[str] = None


@router.get("/courses")
def list_courses(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    rows = db.query(models.Course).order_by(models.Course.code).all()
    return [serialize_course(row) for row in rows]


@router.get("/past-questions")
def list_past_questions(
    course_id: Optional[int] = None,
    year: Optional[int] = None,
    topic: Optional[str] = None,
    difficulty: Optional[str] = None,
    uploaded_by: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.PastQuestion)
    if course_id is not None:
        query = query.filter(models.PastQuestion.course_id == course_id)
    if year is not None:
        query = query.filter(models.PastQuestion.year == year)
    if difficulty:
        query = query.filter(models.PastQuestion.difficulty == difficulty)
    if uploaded_by is not None:
        query = query.filter(models.PastQuestion.uploaded_by == uploaded_by)

    rows = query.order_by(models.PastQuestion.year.desc().nullslast(), models.PastQuestion.id.desc()).limit(100).all()
    if topic:
        lowered = topic.lower()
        rows = [
            row for row in rows
            if lowered in (row.content_text or "").lower()
            or lowered in " ".join((row.metadata_json or {}).get("topics_covered", [])).lower()
        ]
    return [serialize_past_question(row) for row in rows]


@router.get("/lecture-notes")
def list_lecture_notes(
    course_id: Optional[int] = None,
    topic: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.LectureNote)
    if course_id is not None:
        query = query.filter(models.LectureNote.course_id == course_id)
    if topic:
        query = query.filter(models.LectureNote.topic.ilike(f"%{topic}%"))
    rows = query.order_by(models.LectureNote.created_at.desc()).limit(100).all()
    return [serialize_lecture_note(row) for row in rows]


@router.get("/analytics/cohort")
def cohort_analytics(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    attempts = db.query(models.PracticeAttempt).all()
    avg_score = round(sum(a.score for a in attempts) / len(attempts), 1) if attempts else 0
    by_topic = defaultdict(list)
    for attempt in attempts:
        by_topic[attempt.topic or "General"].append(attempt.score)

    challenging_topics = [
        {"topic": topic, "average_score": round(sum(scores) / len(scores), 1), "attempts": len(scores)}
        for topic, scores in by_topic.items()
    ]
    challenging_topics.sort(key=lambda item: item["average_score"])

    return {
        "active_students": db.query(models.User).count(),
        "avg_practice_score": avg_score,
        "questions_attempted": sum(a.total_questions for a in attempts),
        "notes_uploaded": db.query(models.LectureNote).count(),
        "most_challenging_topics": challenging_topics[:8],
    }


@router.get("/analytics/student/{student_id}")
def student_analytics(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.id != student_id:
        raise HTTPException(status_code=403, detail="Not enough permissions.")
    readiness = db.query(models.ReadinessScore).filter(models.ReadinessScore.user_id == student_id).all()
    attempts = db.query(models.PracticeAttempt).filter(models.PracticeAttempt.user_id == student_id).all()
    return {"readiness": readiness, "attempts": attempts}


@router.post("/practice/generate")
def generate_practice(
    req: PracticeGenerateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    safe_count = max(1, min(req.count, 30))
    query = db.query(models.PastQuestion)
    if req.course_id is not None:
        query = query.filter(models.PastQuestion.course_id == req.course_id)

    warning = None
    if req.topic:
        topic_conditions = []
        for term in _topic_terms(req.topic):
            topic_pattern = f"%{term}%"
            topic_conditions.extend(
                [
                    models.PastQuestion.content_text.ilike(topic_pattern),
                    models.PastQuestion.metadata_json.cast(Text).ilike(topic_pattern),
                ]
            )
        topic_query = query.filter(
            or_(
                *(topic_conditions or [models.PastQuestion.content_text.ilike("%__never_match__%")])
            )
        )
        questions = (
            topic_query.order_by(models.PastQuestion.year.desc().nullslast(), models.PastQuestion.id.desc())
            .limit(max(safe_count, 20))
            .all()
        )
        if not questions and req.course_id is not None:
            questions = (
                query.order_by(models.PastQuestion.year.desc().nullslast(), models.PastQuestion.id.desc())
                .limit(max(safe_count, 20))
                .all()
            )
            if questions:
                warning = (
                    f"No exact topic match for '{req.topic}' yet, so ExamMind generated practice "
                    "from broader past questions in the selected course."
                )
    else:
        questions = (
            query.order_by(models.PastQuestion.year.desc().nullslast(), models.PastQuestion.id.desc())
        .limit(max(safe_count, 20))
        .all()
        )
    practice_items = _serialize_practice_items(questions, req.topic, safe_count)
    if questions and not practice_items:
        warning = warning or "ExamMind found uploaded material, but it could not extract clean practice prompts from it yet."

    generated_items: list[dict] = []
    generation_warning: str | None = None
    remaining_count = max(safe_count - len(practice_items), 0)
    note_chunks = _relevant_note_chunks(db, req.course_id, req.topic)
    if note_chunks and remaining_count > 0:
        generated_items, generation_warning = _generated_practice_from_notes(note_chunks, req.topic, remaining_count)
    elif note_chunks and not practice_items:
        generated_items, generation_warning = _generated_practice_from_notes(note_chunks, req.topic, safe_count)

    combined_items = _merge_practice_items(practice_items, generated_items, safe_count)
    if generation_warning:
        warning = f"{warning} {generation_warning}".strip() if warning else generation_warning
    if note_chunks and not generated_items and not practice_items and not warning:
        warning = "ExamMind found uploaded notes, but could not generate clean practice questions from them yet."

    return {
        "topic": req.topic or "Mixed revision",
        "warning": warning,
        "questions": combined_items,
    }


@router.post("/practice/submit")
def submit_practice(
    req: PracticeSubmitRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    if req.total_questions <= 0:
        raise HTTPException(status_code=400, detail="total_questions must be greater than zero.")
    if req.score < 0 or req.score > req.total_questions:
        raise HTTPException(status_code=400, detail="score must be between 0 and total_questions.")

    total = req.total_questions
    percent = round((req.score / total) * 100)
    debrief = (
        f"You scored {percent}%. Review the questions you missed, then retry the same topic. "
        "ExamMind updates readiness from repeated practice, so improvement matters more than one score."
    )
    attempt = models.PracticeAttempt(
        user_id=current_user.id,
        course_id=req.course_id,
        topic=req.topic,
        score=percent,
        total_questions=total,
        debrief_generated=True,
        debrief=debrief,
    )
    db.add(attempt)

    readiness = (
        db.query(models.ReadinessScore)
        .filter(
            models.ReadinessScore.user_id == current_user.id,
            models.ReadinessScore.course_id == req.course_id,
            models.ReadinessScore.topic == req.topic,
        )
        .first()
    )
    if readiness:
        readiness.score = round((readiness.score + percent) / 2)
    else:
        readiness = models.ReadinessScore(user_id=current_user.id, course_id=req.course_id, topic=req.topic, score=percent)
        db.add(readiness)

    db.commit()
    db.refresh(attempt)
    return {"attempt_id": attempt.id, "readiness_score": readiness.score, "debrief": debrief}


@router.get("/threads")
def list_threads(
    course_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.DiscussionThread)
    if course_id is not None:
        query = query.filter(models.DiscussionThread.course_id == course_id)
    threads = query.order_by(models.DiscussionThread.created_at.desc()).limit(50).all()

    user_ids = {t.created_by for t in threads if t.created_by is not None}
    user_usernames: dict[int, str] = {}
    if user_ids:
        rows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(user_ids)).all()
        user_usernames = {row.id: row.username for row in rows}

    return [
        {
            "id": t.id,
            "title": t.title,
            "created_by": t.created_by,
            "created_by_username": user_usernames.get(t.created_by) if t.created_by else None,
            "course_id": t.course_id,
            "past_question_id": t.past_question_id,
            "created_at": t.created_at,
        }
        for t in threads
    ]


@router.post("/threads")
def create_thread(
    req: ThreadCreateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    thread = models.DiscussionThread(
        title=req.title,
        course_id=req.course_id,
        past_question_id=req.past_question_id,
        created_by=current_user.id,
    )
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return serialize_thread(thread)


@router.get("/threads/{thread_id}/messages")
def list_thread_messages(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    messages = (
        db.query(models.ThreadMessage)
        .filter(models.ThreadMessage.thread_id == thread_id)
        .order_by(models.ThreadMessage.created_at)
        .all()
    )

    user_ids = {m.user_id for m in messages if m.user_id is not None}
    user_usernames: dict[int, str] = {}
    if user_ids:
        rows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(user_ids)).all()
        user_usernames = {row.id: row.username for row in rows}

    return [
        {
            "id": m.id,
            "thread_id": m.thread_id,
            "user_id": m.user_id,
            "user_username": user_usernames.get(m.user_id) if m.user_id else None,
            "content": m.content,
            "is_ai_response": m.is_ai_response,
            "created_at": m.created_at,
        }
        for m in messages
    ]


@router.post("/threads/{thread_id}/message")
def post_thread_message(
    thread_id: int,
    req: ThreadMessageRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    thread = db.query(models.DiscussionThread).filter(models.DiscussionThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")

    message = models.ThreadMessage(thread_id=thread_id, user_id=current_user.id, content=req.content)
    db.add(message)
    if "@ai" in req.content.lower():
        ai_question = req.content.replace("@AI", "").replace("@ai", "").strip()
        if not ai_question:
            ai_question = thread.title
        try:
            course = db.query(models.Course).filter(models.Course.id == thread.course_id).first() if thread.course_id else None
            recent_messages = (
                db.query(models.ThreadMessage)
                .filter(models.ThreadMessage.thread_id == thread_id)
                .order_by(models.ThreadMessage.created_at.desc())
                .limit(6)
                .all()
            )
            recent_messages.reverse()
            recent_context = "\n".join(
                f"- {'AI' if msg.is_ai_response else 'Student'}: {msg.content[:220]}"
                for msg in recent_messages
                if msg.content
            )
            thread_context = "\n".join(
                part
                for part in [
                    f"Discussion thread: {thread.title}",
                    f"Course: {course.code} - {course.name}" if course else "",
                    f"Recent thread messages:\n{recent_context}" if recent_context else "",
                    "Use uploaded materials linked to this course/thread first.",
                ]
                if part
            )
            contextual_question = f"{thread_context}\n\nStudent message: {ai_question}"
            rag_result = run_rag_query(contextual_question, thread.course_id, None, db, room_context=thread_context)
            ai_content = rag_result["answer"]
        except HTTPException as exc:
            ai_content = str(exc.detail)
        except Exception:
            ai_content = (
                "AI answers are temporarily unavailable because the primary provider balance is low. "
                "Uploaded materials, search, and practice data are still available."
            )
        db.add(
            models.ThreadMessage(
                thread_id=thread_id,
                user_id=None,
                content=ai_content,
                is_ai_response=True,
            )
        )
    db.commit()
    return {"status": "posted", "ai_response_added": "@ai" in req.content.lower()}


# ── Study Groups ───────────────────────────────────────────────────────────────

def _serialize_group(g: models.StudyGroup, member_count: int, is_member: bool, creator_username: str | None) -> dict:
    return {
        "id": g.id,
        "name": g.name,
        "description": g.description,
        "course_id": g.course_id,
        "topic": g.topic,
        "created_by": g.created_by,
        "created_by_username": creator_username,
        "created_at": g.created_at,
        "member_count": member_count,
        "is_member": is_member,
    }


@router.get("/study-groups")
def list_study_groups(
    q: Optional[str] = None,
    course_id: Optional[int] = None,
    topic: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.StudyGroup)
    if q:
        query = query.filter(
            or_(
                models.StudyGroup.name.ilike(f"%{q}%"),
                models.StudyGroup.description.ilike(f"%{q}%"),
                models.StudyGroup.topic.ilike(f"%{q}%"),
            )
        )
    if course_id is not None:
        query = query.filter(models.StudyGroup.course_id == course_id)
    if topic:
        query = query.filter(models.StudyGroup.topic.ilike(f"%{topic}%"))
    groups = query.order_by(models.StudyGroup.created_at.desc()).limit(20).all()

    group_ids = [g.id for g in groups]
    member_counts: dict[int, int] = {}
    my_group_ids: set[int] = set()
    if group_ids:
        count_rows = (
            db.query(models.StudyGroupMember.group_id, func.count(models.StudyGroupMember.id).label("cnt"))
            .filter(models.StudyGroupMember.group_id.in_(group_ids))
            .group_by(models.StudyGroupMember.group_id)
            .all()
        )
        member_counts = {row.group_id: row.cnt for row in count_rows}
        my_rows = (
            db.query(models.StudyGroupMember.group_id)
            .filter(
                models.StudyGroupMember.group_id.in_(group_ids),
                models.StudyGroupMember.user_id == current_user.id,
            )
            .all()
        )
        my_group_ids = {row.group_id for row in my_rows}

    creator_ids = {g.created_by for g in groups if g.created_by}
    creator_usernames: dict[int, str] = {}
    if creator_ids:
        rows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(creator_ids)).all()
        creator_usernames = {r.id: r.username for r in rows}

    return [
        _serialize_group(g, member_counts.get(g.id, 0), g.id in my_group_ids, creator_usernames.get(g.created_by) if g.created_by else None)
        for g in groups
    ]


@router.post("/study-groups")
def create_study_group(
    req: StudyGroupCreateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Group name is required.")
    group = models.StudyGroup(
        name=req.name.strip(),
        description=req.description,
        course_id=req.course_id,
        topic=req.topic,
        created_by=current_user.id,
    )
    db.add(group)
    db.flush()
    db.add(models.StudyGroupMember(group_id=group.id, user_id=current_user.id))
    db.commit()
    db.refresh(group)
    return _serialize_group(group, 1, True, current_user.username)


@router.post("/study-groups/{group_id}/join")
def join_study_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    group = db.query(models.StudyGroup).filter(models.StudyGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Study group not found.")
    already = db.query(models.StudyGroupMember).filter(
        models.StudyGroupMember.group_id == group_id,
        models.StudyGroupMember.user_id == current_user.id,
    ).first()
    if not already:
        db.add(models.StudyGroupMember(group_id=group_id, user_id=current_user.id))
        db.commit()
    count = db.query(models.StudyGroupMember).filter(models.StudyGroupMember.group_id == group_id).count()
    return {"status": "joined", "member_count": count}


@router.get("/study-groups/{group_id}/members")
def list_group_members(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = db.query(models.StudyGroup).filter(models.StudyGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Study group not found.")
    members = (
        db.query(models.StudyGroupMember, models.User)
        .join(models.User, models.User.id == models.StudyGroupMember.user_id)
        .filter(models.StudyGroupMember.group_id == group_id)
        .order_by(models.StudyGroupMember.joined_at)
        .all()
    )
    return [
        {"user_id": u.id, "username": u.username, "name": u.name, "joined_at": m.joined_at}
        for m, u in members
    ]


@router.post("/study-groups/{group_id}/leave")
def leave_study_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    member = db.query(models.StudyGroupMember).filter(
        models.StudyGroupMember.group_id == group_id,
        models.StudyGroupMember.user_id == current_user.id,
    ).first()
    if member:
        db.delete(member)
        db.commit()
    count = db.query(models.StudyGroupMember).filter(models.StudyGroupMember.group_id == group_id).count()
    return {"status": "left", "member_count": count}
