"""Evidence-backed quiz, learning-profile and readiness primitives.

This module deliberately keeps learning evidence separate from passive reading.
Only completed quiz answers create evidence, and every generated question keeps
the authorized source citation that supported it.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import re
from typing import Any, Iterable

from sqlalchemy import Text, or_
from sqlalchemy.orm import Session

import models
from material_access import accessible_material_filter
from resource_index import citation_payload
from storage_safety import defer_binary_column


MIN_READINESS_ANSWERS = 10
MIN_READINESS_ATTEMPTS = 2
MIN_TOPIC_ANSWERS = 4
STRONG_TOPIC_THRESHOLD = 80
WEAK_TOPIC_THRESHOLD = 60
MAX_QUIZ_QUESTIONS = 20
STOP_WORDS = {
    "about", "after", "again", "also", "because", "being", "between", "could",
    "does", "from", "have", "into", "more", "over", "should", "that", "their",
    "there", "these", "they", "this", "those", "under", "which", "with", "would",
}
CONCEPT_ALIASES = {
    "linear": {"linear", "straight"},
    "equation": {"equation", "equations", "formula"},
    "variable": {"variable", "unknown", "symbol"},
    "substitution": {"substitution", "replace", "replacing", "replacement", "plug"},
    "balanced": {"balanced", "equal", "equals", "same"},
}


@dataclass(frozen=True)
class AuthorizedSource:
    resource_type: str
    resource_id: int
    title: str
    course_id: int | None
    topic: str
    topics: tuple[str, ...]
    text: str
    citation: dict[str, Any]


def _normalise_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _metadata(row: Any) -> dict[str, Any]:
    value = getattr(row, "metadata_json", None)
    return value if isinstance(value, dict) else {}


def _resource_type(row: Any) -> str:
    metadata = _metadata(row)
    file_name = str(getattr(row, "file_name", "") or "").lower()
    mime = str(getattr(row, "file_mime", "") or "").lower()
    if metadata.get("document_type") == "audio" or mime.startswith("audio/") or file_name.endswith((".mp3", ".wav", ".m4a", ".mp4")):
        return "audio"
    if isinstance(row, models.PastQuestion):
        return "past_question"
    return "lecture_note"


def _resource_title(row: Any) -> str:
    metadata = _metadata(row)
    title = (
        metadata.get("document_title")
        or getattr(row, "title", None)
        or metadata.get("source_file")
        or getattr(row, "file_name", None)
        or "Uploaded source"
    )
    return _normalise_text(title)[:240] or "Uploaded source"


def _resource_topic(row: Any, chunk: models.ResourceChunk | None, requested: str | None) -> str:
    if requested and requested.strip():
        return _normalise_text(requested)[:160]
    if chunk and chunk.topic:
        return _normalise_text(chunk.topic)[:160]
    if getattr(row, "topic", None):
        return _normalise_text(row.topic)[:160]
    topics = _metadata(row).get("topics_covered")
    if isinstance(topics, list) and topics:
        return _normalise_text(topics[0])[:160]
    return "Mixed revision"


def _resource_topics(row: Any, chunk: models.ResourceChunk | None, requested: str | None, primary: str) -> tuple[str, ...]:
    values: list[str] = [primary]
    if not requested and chunk and chunk.topic:
        values.append(_normalise_text(chunk.topic)[:160])
    metadata_topics = _metadata(row).get("topics_covered")
    if not requested and isinstance(metadata_topics, list):
        values.extend(_normalise_text(value)[:160] for value in metadata_topics if _normalise_text(value))
    return tuple(dict.fromkeys(value for value in values if value and value != "Mixed revision"))


def _chunks_for_source(db: Session, resource_type: str, resource_id: int) -> list[models.ResourceChunk]:
    types = [resource_type]
    if resource_type == "audio":
        types.append("lecture_note")
    return (
        db.query(models.ResourceChunk)
        .filter(
            models.ResourceChunk.resource_type.in_(types),
            models.ResourceChunk.resource_id == resource_id,
        )
        .order_by(models.ResourceChunk.chunk_index.asc())
        .limit(8)
        .all()
    )


def _row_text(row: Any, chunks: list[models.ResourceChunk]) -> str:
    if chunks:
        return _normalise_text(" ".join(chunk.chunk_text or "" for chunk in chunks))[:9000]
    metadata = _metadata(row)
    preview = metadata.get("content_preview") if isinstance(metadata.get("content_preview"), dict) else {}
    parts = [
        getattr(row, "content_text", None),
        metadata.get("cleaned_text"),
        preview.get("instruction"),
        preview.get("scenario"),
    ]
    for item in preview.get("questions", []) if isinstance(preview.get("questions"), list) else []:
        if isinstance(item, dict):
            parts.append(item.get("preview") or item.get("text"))
        else:
            parts.append(item)
    return _normalise_text(" ".join(str(part) for part in parts if part))[:9000]


def _citation_for_source(row: Any, resource_type: str, title: str, chunk: models.ResourceChunk | None) -> dict[str, Any]:
    if chunk is not None:
        return citation_payload(
            resource_type=chunk.resource_type,
            resource_id=chunk.resource_id,
            chunk_id=chunk.id,
            metadata=_metadata(row) | (chunk.metadata_json or {}),
            page_from=chunk.page_from,
            page_to=chunk.page_to,
            slide_from=chunk.slide_from,
            slide_to=chunk.slide_to,
            timestamp_start=chunk.timestamp_start,
            timestamp_end=chunk.timestamp_end,
            section=chunk.section,
            heading=chunk.heading,
            resource_title=title,
        ) | {"source": title}
    return citation_payload(
        resource_type=resource_type,
        resource_id=int(row.id),
        chunk_id=None,
        metadata=_metadata(row),
        resource_title=title,
    ) | {"source": title}


def _source_from_row(db: Session, row: Any, requested_topic: str | None) -> AuthorizedSource | None:
    resource_type = _resource_type(row)
    chunks = _chunks_for_source(db, resource_type, int(row.id))
    text = _row_text(row, chunks)
    if len(text) < 20:
        return None
    chunk = chunks[0] if chunks else None
    title = _resource_title(row)
    primary_topic = _resource_topic(row, chunk, requested_topic)
    return AuthorizedSource(
        resource_type=resource_type,
        resource_id=int(row.id),
        title=title,
        course_id=getattr(row, "course_id", None),
        topic=primary_topic,
        topics=_resource_topics(row, chunk, requested_topic, primary_topic),
        text=text,
        citation=_citation_for_source(row, resource_type, title, chunk),
    )


def authorized_sources(
    db: Session,
    user: models.User,
    *,
    source_scope: str = "workspace",
    resource_type: str | None = None,
    resource_id: int | None = None,
    course_id: int | None = None,
    topic: str | None = None,
) -> list[AuthorizedSource]:
    """Return only source rows the current user may read."""
    if source_scope not in {"workspace", "resource", "topic"}:
        raise ValueError("source_scope must be workspace, resource, or topic")
    if source_scope == "resource" and (resource_type not in {"lecture_note", "past_question", "audio"} or not resource_id):
        raise ValueError("resource scope requires a resource type and id")

    rows: list[Any] = []
    note_query = defer_binary_column(db.query(models.LectureNote), models.LectureNote).filter(accessible_material_filter(db, models.LectureNote, user))
    past_query = defer_binary_column(db.query(models.PastQuestion), models.PastQuestion).filter(accessible_material_filter(db, models.PastQuestion, user))
    if course_id is not None:
        note_query = note_query.filter(models.LectureNote.course_id == course_id)
        past_query = past_query.filter(models.PastQuestion.course_id == course_id)

    if source_scope == "resource":
        if resource_type == "past_question":
            past_query = past_query.filter(models.PastQuestion.id == resource_id)
            rows = past_query.all()
        else:
            note_query = note_query.filter(models.LectureNote.id == resource_id)
            rows = note_query.all()
    else:
        rows = [*note_query.order_by(models.LectureNote.id.desc()).limit(40).all(), *past_query.order_by(models.PastQuestion.id.desc()).limit(40).all()]

    sources: list[AuthorizedSource] = []
    topic_terms = [term for term in re.findall(r"[a-z0-9]+", str(topic or "").lower()) if len(term) >= 3]
    for row in rows:
        source = _source_from_row(db, row, topic)
        if source is None:
            continue
        if resource_scope_is_audio_mismatch(source, resource_type, source_scope):
            continue
        if source_scope == "topic" and topic_terms:
            haystack = f"{source.topic} {source.title} {source.text}".lower()
            if not any(term in haystack for term in topic_terms):
                continue
        sources.append(source)
    return sources


def resource_scope_is_audio_mismatch(source: AuthorizedSource, requested_type: str | None, scope: str) -> bool:
    return scope == "resource" and requested_type == "audio" and source.resource_type != "audio"


def _sentences(source: AuthorizedSource) -> list[str]:
    candidates = re.split(r"(?<=[.!?])\s+|\n+", source.text)
    clean: list[str] = []
    seen: set[str] = set()
    for value in candidates:
        sentence = _normalise_text(value).strip(" -:;•")
        if len(sentence) < 24 or len(sentence) > 300:
            continue
        key = re.sub(r"\W+", " ", sentence.lower()).strip()
        if key and key not in seen:
            clean.append(sentence)
            seen.add(key)
    if not clean and len(source.text) >= 24:
        clean.append(source.text[:280].rstrip(" .") + ".")
    return clean


def _keywords(sentence: str) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z-]{4,}", sentence.lower())
    return list(dict.fromkeys(word for word in words if word not in STOP_WORDS))[:4]


def _difficulty(requested: str, index: int) -> str:
    if requested in {"easy", "medium", "hard"}:
        return requested
    return ("easy", "medium", "hard")[index % 3]


def create_grounded_quiz(
    db: Session,
    user: models.User,
    *,
    source_scope: str,
    resource_type: str | None,
    resource_id: int | None,
    course_id: int | None,
    topic: str | None,
    count: int,
    difficulty: str,
    question_type: str,
) -> models.LearningQuiz:
    count = max(1, min(int(count), MAX_QUIZ_QUESTIONS))
    if difficulty not in {"mixed", "easy", "medium", "hard"}:
        raise ValueError("difficulty must be mixed, easy, medium, or hard")
    if question_type not in {"multiple_choice", "short_answer"}:
        raise ValueError("question_type must be multiple_choice or short_answer")
    sources = authorized_sources(
        db,
        user,
        source_scope=source_scope,
        resource_type=resource_type,
        resource_id=resource_id,
        course_id=course_id,
        topic=topic,
    )
    if not sources:
        raise LookupError("No authorized source material matched this quiz setup.")

    quiz = models.LearningQuiz(
        user_id=user.id,
        course_id=course_id or sources[0].course_id,
        topic=_normalise_text(topic)[:160] if topic else None,
        source_scope=source_scope,
        resource_type=resource_type,
        resource_id=resource_id,
        difficulty=difficulty,
        question_type=question_type,
        question_count=0,
    )
    db.add(quiz)
    db.flush()

    position = 0
    for source in sources:
        for sentence in _sentences(source):
            if position >= count:
                break
            keywords = _keywords(sentence)
            if question_type == "short_answer" and len(keywords) < 2:
                continue
            level = _difficulty(difficulty, position)
            if question_type == "multiple_choice":
                options = [
                    sentence,
                    "The source does not make this statement.",
                    "The source states the opposite of this.",
                    "The source leaves this question unanswered.",
                ]
                correct_answer = "0"
                grading_keywords = None
                prompt = "Which statement is supported by the cited source?"
            else:
                options = []
                correct_answer = sentence
                grading_keywords = keywords
                prompt = "In your own words, what does the cited source state?"
            db.add(models.LearningQuizQuestion(
                quiz_id=quiz.id,
                position=position,
                question_type=question_type,
                prompt=prompt,
                options=options,
                correct_answer=correct_answer,
                grading_keywords=grading_keywords,
                explanation=f"This answer is grounded in {source.title}: {sentence}",
                topic=source.topic,
                difficulty=level,
                citation_json=source.citation,
            ))
            position += 1
        if position >= count:
            break

    if position == 0:
        db.rollback()
        raise LookupError("ExamMind could not create reliably gradable questions from the authorized source text.")
    quiz.question_count = position
    db.commit()
    db.refresh(quiz)
    return quiz


def _normalise_answer(value: Any) -> str:
    return _normalise_text(value).lower()


def _concept_matches(keyword: str, candidate: set[str]) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", keyword.lower())
    aliases = CONCEPT_ALIASES.get(normalized, {normalized})
    return bool(aliases & candidate)


def grade_question_result(question: models.LearningQuizQuestion, answer: Any) -> dict[str, Any]:
    if question.question_type == "multiple_choice":
        candidate = _normalise_answer(answer)
        if candidate.isdigit():
            is_correct = candidate == str(question.correct_answer)
        else:
            options = question.options if isinstance(question.options, list) else []
            is_correct = any(index == int(question.correct_answer) and _normalise_answer(option) == candidate for index, option in enumerate(options)) if candidate else False
        return {"status": "correct" if is_correct else "incorrect", "is_correct": is_correct, "graded": True, "identified_concepts": [], "missing_concepts": []}
    candidate = set(re.findall(r"[a-z0-9]{4,}", _normalise_answer(answer)))
    keywords = [str(item).lower() for item in (question.grading_keywords or [])]
    identified = [keyword for keyword in keywords if _concept_matches(keyword, candidate)]
    missing = [keyword for keyword in keywords if keyword not in identified]
    if keywords and not missing:
        return {"status": "correct", "is_correct": True, "graded": True, "identified_concepts": identified, "missing_concepts": []}
    return {"status": "needs_review", "is_correct": None, "graded": False, "identified_concepts": identified, "missing_concepts": missing}


def grade_question(question: models.LearningQuizQuestion, answer: Any) -> bool:
    """Compatibility helper: only reliably graded correct answers return True."""
    return bool(grade_question_result(question, answer)["is_correct"] is True)


def quiz_public_payload(quiz: models.LearningQuiz, questions: Iterable[models.LearningQuizQuestion] | None = None) -> dict[str, Any]:
    rows = list(questions) if questions is not None else []
    return {
        "id": quiz.id,
        "course_id": quiz.course_id,
        "topic": quiz.topic,
        "source_scope": quiz.source_scope,
        "resource_type": quiz.resource_type,
        "resource_id": quiz.resource_id,
        "difficulty": quiz.difficulty,
        "question_type": quiz.question_type,
        "question_count": quiz.question_count,
        "created_at": quiz.created_at,
        "questions": [question_public_payload(row) for row in rows],
    }


def question_public_payload(question: models.LearningQuizQuestion) -> dict[str, Any]:
    return {
        "id": question.id,
        "position": question.position,
        "question_type": question.question_type,
        "prompt": question.prompt,
        "options": question.options or [],
        "topic": question.topic,
        "difficulty": question.difficulty,
        "citation": question.citation_json,
    }


def _profile(db: Session, user_id: int) -> models.LearningProfile:
    profile = db.query(models.LearningProfile).filter(models.LearningProfile.user_id == user_id).first()
    if profile is None:
        profile = models.LearningProfile(user_id=user_id, explicit_preferences={}, inferred_preferences={})
        db.add(profile)
        db.flush()
    return profile


def profile_payload(profile: models.LearningProfile) -> dict[str, Any]:
    return {
        "id": profile.id,
        "explicit_preferences": profile.explicit_preferences or {},
        "inferred_preferences": profile.inferred_preferences or {},
        "updated_at": profile.updated_at,
    }


def update_inferred_profile(db: Session, user_id: int, questions: Iterable[models.LearningQuizQuestion]) -> None:
    profile = _profile(db, user_id)
    counts = Counter(question.question_type for question in questions)
    total = sum(counts.values())
    if total < 2:
        return
    preferred = counts.most_common(1)[0][0]
    inferred = dict(profile.inferred_preferences or {})
    inferred["preferred_learning_format"] = {
        "value": preferred,
        "source": "observed completed quiz answers",
        "sample_size": total,
    }
    profile.inferred_preferences = inferred


def record_quiz_attempt(
    db: Session,
    user: models.User,
    quiz: models.LearningQuiz,
    answers: list[dict[str, Any]],
) -> models.LearningQuizAttempt:
    questions = db.query(models.LearningQuizQuestion).filter(
        models.LearningQuizQuestion.quiz_id == quiz.id,
    ).order_by(models.LearningQuizQuestion.position.asc()).all()
    by_id = {question.id: question for question in questions}
    if len(answers) != len(questions) or set(int(item.get("question_id", 0)) for item in answers) != set(by_id):
        raise ValueError("Answer every quiz question exactly once before submitting.")

    review: list[dict[str, Any]] = []
    evidence: list[models.LearningEvidence] = []
    score = 0
    now = datetime.now(timezone.utc)
    for item in answers:
        question = by_id[int(item["question_id"])]
        submitted = item.get("answer")
        result = grade_question_result(question, submitted)
        score += int(result["is_correct"] is True)
        review.append({
            "question_id": question.id,
            "position": question.position,
            "prompt": question.prompt,
            "answer": submitted,
            "correct_answer": question.correct_answer,
            "is_correct": result["is_correct"],
            "status": result["status"],
            "graded": result["graded"],
            "identified_concepts": result["identified_concepts"],
            "missing_concepts": result["missing_concepts"],
            "model_answer": question.correct_answer,
            "explanation": question.explanation,
            "citation": question.citation_json,
            "topic": question.topic,
        })

    graded_questions = sum(1 for item in review if item["graded"])
    needs_review_count = len(review) - graded_questions
    attempt = models.LearningQuizAttempt(
        quiz_id=quiz.id,
        user_id=user.id,
        score=score,
        total_questions=len(questions),
        graded_questions=graded_questions,
        needs_review_count=needs_review_count,
        percentage=round(score / graded_questions * 100) if graded_questions else None,
        review_json=review,
        completed_at=now,
    )
    db.add(attempt)
    db.flush()
    for item in review:
        question = by_id[item["question_id"]]
        if not item["graded"]:
            continue
        evidence.append(models.LearningEvidence(
            user_id=user.id,
            attempt_id=attempt.id,
            question_id=question.id,
            course_id=quiz.course_id,
            topic=question.topic or quiz.topic,
            evidence_type="quiz_answer",
            is_correct=bool(item["is_correct"]),
            answered_at=now,
        ))
    db.add_all(evidence)
    update_inferred_profile(db, user.id, questions)
    db.commit()
    db.refresh(attempt)
    return attempt


def attempt_payload(attempt: models.LearningQuizAttempt, quiz: models.LearningQuiz | None = None) -> dict[str, Any]:
    return {
        "id": attempt.id,
        "quiz_id": attempt.quiz_id,
        "course_id": quiz.course_id if quiz else None,
        "topic": quiz.topic if quiz else None,
        "score": attempt.score,
        "total_questions": attempt.total_questions,
        "graded_questions": attempt.graded_questions,
        "needs_review_count": attempt.needs_review_count,
        "percentage": attempt.percentage,
        "completed_at": attempt.completed_at,
        "review": attempt.review_json or [],
    }


def _topic_evidence(rows: Iterable[models.LearningEvidence]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {"answers": 0, "correct": 0, "missed": 0, "last_answered_at": None, "attempt_ids": set()})
    for row in rows:
        topic = _normalise_text(row.topic) or "Mixed revision"
        item = grouped[topic]
        item["answers"] += 1
        item["correct"] += int(row.is_correct)
        item["missed"] += int(not row.is_correct)
        item["attempt_ids"].add(row.attempt_id)
        if item["last_answered_at"] is None or row.answered_at > item["last_answered_at"]:
            item["last_answered_at"] = row.answered_at
    return grouped


def readiness_payload(db: Session, user: models.User) -> dict[str, Any]:
    evidence_rows = db.query(models.LearningEvidence).filter(models.LearningEvidence.user_id == user.id).order_by(models.LearningEvidence.answered_at.desc()).all()
    grouped = _topic_evidence(evidence_rows)
    topics: list[dict[str, Any]] = []
    for topic, item in sorted(grouped.items()):
        answers = item["answers"]
        score = round(item["correct"] / answers * 100) if answers else None
        if answers < MIN_TOPIC_ANSWERS:
            classification = "insufficient_evidence"
        elif score is not None and score >= STRONG_TOPIC_THRESHOLD:
            classification = "strong"
        elif score is not None and score < WEAK_TOPIC_THRESHOLD:
            classification = "weak"
        else:
            classification = "developing"
        topics.append({
            "topic": topic,
            "score": score if answers >= MIN_TOPIC_ANSWERS else None,
            "classification": classification,
            "answers": answers,
            "required_answers": MIN_TOPIC_ANSWERS,
            "progress_message": f"{answers} of {MIN_TOPIC_ANSWERS} answers collected for {topic}." if answers < MIN_TOPIC_ANSWERS else None,
            "correct": item["correct"],
            "missed": item["missed"],
            "attempts": len(item["attempt_ids"]),
            "last_answered_at": item["last_answered_at"],
        })

    assessed = [topic for topic in topics if topic["score"] is not None]
    total_answers = len(evidence_rows)
    total_correct = sum(1 for row in evidence_rows if row.is_correct)
    score = round(total_correct / total_answers * 100) if total_answers >= MIN_READINESS_ANSWERS else None
    known_topics: set[str] = set()
    for source in authorized_sources(db, user, source_scope="workspace"):
        known_topics.update(source.topics)
    evidence_topics = {topic["topic"] for topic in topics}
    topic_coverage_required = len(known_topics) >= 2
    enough_answers = total_answers >= MIN_READINESS_ANSWERS
    completed_attempts = len({row.attempt_id for row in evidence_rows})
    enough_attempts = completed_attempts >= MIN_READINESS_ATTEMPTS
    enough_topic_coverage = not topic_coverage_required or len(evidence_topics & known_topics) >= 2
    overall_ready = enough_answers and enough_attempts and enough_topic_coverage
    unassessed = sorted(known_topics - {topic["topic"] for topic in assessed})
    if not enough_answers:
        remaining = MIN_READINESS_ANSWERS - total_answers
        suffix = " across another quiz" if completed_attempts < MIN_READINESS_ATTEMPTS else ""
        recommendation = f"Readiness is still gathering evidence. Complete {remaining} more questions{suffix}."
    elif not enough_attempts:
        recommendation = "You have enough graded answers, but complete another quiz attempt to confirm the evidence."
    elif not enough_topic_coverage:
        recommendation = "You have enough answers, but not enough topic coverage to calculate overall readiness."
    elif any(topic["classification"] == "weak" for topic in assessed):
        weakest = next(topic for topic in assessed if topic["classification"] == "weak")
        recommendation = f"Review {weakest['topic']}, then complete another short quiz to check the change."
    else:
        recommendation = "Keep taking short quizzes across your unassessed topics to broaden the evidence."
    return {
        "available": overall_ready,
        "score": score if overall_ready else None,
        "formula": "correct graded answers ÷ total graded answers × 100",
        "thresholds": {
            "minimum_answers_for_readiness": MIN_READINESS_ANSWERS,
            "minimum_attempts_for_readiness": MIN_READINESS_ATTEMPTS,
            "minimum_answers_for_topic": MIN_TOPIC_ANSWERS,
            "minimum_topics_for_readiness": 2,
            "strong": STRONG_TOPIC_THRESHOLD,
            "weak_below": WEAK_TOPIC_THRESHOLD,
        },
        "evidence_used": {
            "answered_questions": total_answers,
            "graded_answers": total_answers,
            "correct_answers": total_correct,
            "attempts": completed_attempts,
            "distinct_topics": len(evidence_topics),
            "known_topics": len(known_topics),
            "latest_answered_at": evidence_rows[0].answered_at if evidence_rows else None,
        },
        "topics": topics,
        "assessed_topics": [topic["topic"] for topic in assessed],
        "unassessed_topics": unassessed,
        "recommended_next_action": recommendation,
    }


def learning_suggestion(db: Session, user: models.User, question: str | None = None) -> dict[str, Any] | None:
    readiness = readiness_payload(db, user)
    weak = next((topic for topic in readiness["topics"] if topic["classification"] == "weak"), None)
    if weak:
        return {
            "message": f"You have missed {weak['topic']} questions {weak['missed']} times. Review these sections, then try again.",
            "topic": weak["topic"],
            "action": "practice",
            "evidence": {"answers": weak["answers"], "missed": weak["missed"], "attempts": weak["attempts"]},
        }
    if readiness["available"] and readiness["assessed_topics"]:
        topic = readiness["assessed_topics"][0]
        return {
            "message": f"You have evidence for {topic}. Would you like a five-question check?",
            "topic": topic,
            "action": "practice",
            "evidence": readiness["evidence_used"],
        }
    return None
