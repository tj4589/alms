from collections import Counter
from typing import Any, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import Text, func, or_
from sqlalchemy.orm import Session

import auth
import models
from database import get_db

from ai_clients import embeddings_model as _embed
from query_understanding import (
    CONVERSATIONAL_NONTOPICS,
    expanded_search_terms,
    public_understanding,
    understand_query,
)

router = APIRouter(tags=["search"])


@router.get("/search")
def smart_search(
    q: str = "",
    course_id: Optional[int] = None,
    limit: int = 8,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    q = q.strip()

    # Guard: if query is only conversational/non-academic tokens, return empty results.
    # Prevents "sure", "lost", "okay", etc. from triggering semantic search.
    import re as _re
    _q_tokens = set(_re.findall(r"[a-z]+", q.lower()))
    _empty_response = {
        "query": q,
        "understanding": public_understanding(understand_query(q)),
        "past_questions": [],
        "lecture_notes": [],
        "threads": [],
        "related_topics": [],
        "study_groups": [],
        "study_sessions": [],
        "suggested_actions": _suggested_actions(understand_query(q), q, False),
    }
    if not q or (_q_tokens and _q_tokens.issubset(CONVERSATIONAL_NONTOPICS)):
        return _empty_response

    metadata_context = _metadata_context(db)
    understanding = understand_query(q, metadata_context)
    terms = expanded_search_terms(understanding)
    best_query = understanding.get("interpreted_topic") or q

    past_questions = []
    lecture_notes = []
    semantic_ok = False

    # ── Semantic search (pgvector) ────────────────────────────
    if _embed:
        try:
            vec = _embed.embed_query(best_query)

            pq_base = db.query(models.PastQuestion)
            if course_id:
                pq_base = pq_base.filter(models.PastQuestion.course_id == course_id)
            past_question_rows = pq_base.order_by(
                models.PastQuestion.embedding.l2_distance(vec)
            ).limit(limit * 4).all()
            past_questions = _group_past_questions(past_question_rows, limit)

            chunk_base = db.query(models.LectureNoteChunk)
            if course_id:
                chunk_base = chunk_base.filter(models.LectureNoteChunk.course_id == course_id)
            top_chunks = chunk_base.order_by(
                models.LectureNoteChunk.embedding.l2_distance(vec)
            ).limit(limit * 2).all()

            seen_note_ids: set = set()
            for chunk in top_chunks:
                if len(lecture_notes) >= limit:
                    break
                nid = chunk.lecture_note_id
                if nid and nid not in seen_note_ids:
                    seen_note_ids.add(nid)
                    note = db.query(models.LectureNote).filter(models.LectureNote.id == nid).first()
                    if note:
                        lecture_notes.append(_ln(note))

            semantic_ok = True
        except Exception:
            pass

    # ── Keyword fallback (ilike) ──────────────────────────────
    if not semantic_ok:
        pq_q = db.query(models.PastQuestion).filter(_past_question_filter(terms))
        if course_id:
            pq_q = pq_q.filter(models.PastQuestion.course_id == course_id)
        past_questions = _group_past_questions(pq_q.limit(limit * 4).all(), limit)

        ln_q = db.query(models.LectureNote).filter(_lecture_note_filter(terms))
        if course_id:
            ln_q = ln_q.filter(models.LectureNote.course_id == course_id)
        lecture_notes = [_ln(r) for r in ln_q.limit(limit).all()]
        if len(lecture_notes) < limit:
            chunk_q = db.query(models.LectureNoteChunk).filter(_lecture_note_chunk_filter(terms))
            if course_id:
                chunk_q = chunk_q.filter(models.LectureNoteChunk.course_id == course_id)
            chunk_note_ids = [
                row.lecture_note_id for row in chunk_q.limit(limit * 3).all()
                if row.lecture_note_id
            ]
            seen_note_ids = {note["id"] for note in lecture_notes}
            for note_id in chunk_note_ids:
                if note_id in seen_note_ids or len(lecture_notes) >= limit:
                    continue
                note = db.query(models.LectureNote).filter(models.LectureNote.id == note_id).first()
                if note:
                    seen_note_ids.add(note_id)
                    lecture_notes.append(_ln(note))

    # ── Threads: always keyword ───────────────────────────────
    thread_rows = (
        db.query(models.DiscussionThread)
        .filter(_thread_filter(terms))
        .order_by(models.DiscussionThread.created_at.desc())
        .limit(5)
        .all()
    )
    creator_ids = {t.created_by for t in thread_rows if t.created_by}
    thread_usernames: dict = {}
    if creator_ids:
        rows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(creator_ids)).all()
        thread_usernames = {r.id: r.username for r in rows}
    threads = [
        {
            "id": t.id,
            "title": t.title,
            "created_by": t.created_by,
            "created_by_username": thread_usernames.get(t.created_by) if t.created_by else None,
            "course_id": t.course_id,
            "created_at": t.created_at,
        }
        for t in thread_rows
    ]

    # ── Related topics from metadata ──────────────────────────
    counter: Counter = Counter()
    for pq in past_questions:
        for topic in ((pq.get("metadata_json") or {}).get("topics_covered") or []):
            counter[topic] += 1
    for ln in lecture_notes:
        if ln.get("topic"):
            counter[ln["topic"]] += 1
    related_topics = [t for t, _ in counter.most_common(8)]

    # ── Study groups: keyword search ──────────────────────────
    sg_rows = (
        db.query(models.StudyGroup)
        .filter(_study_group_filter(terms))
        .order_by(models.StudyGroup.created_at.desc())
        .limit(4)
        .all()
    )
    sg_ids = [g.id for g in sg_rows]
    sg_member_counts: dict[int, int] = {}
    sg_my_ids: set[int] = set()
    if sg_ids:
        cnt_rows = (
            db.query(models.StudyGroupMember.group_id, func.count(models.StudyGroupMember.id).label("cnt"))
            .filter(models.StudyGroupMember.group_id.in_(sg_ids))
            .group_by(models.StudyGroupMember.group_id)
            .all()
        )
        sg_member_counts = {r.group_id: r.cnt for r in cnt_rows}
        my_rows = (
            db.query(models.StudyGroupMember.group_id)
            .filter(
                models.StudyGroupMember.group_id.in_(sg_ids),
                models.StudyGroupMember.user_id == current_user.id,
            )
            .all()
        )
        sg_my_ids = {r.group_id for r in my_rows}
    sg_creator_ids = {g.created_by for g in sg_rows if g.created_by}
    sg_creator_usernames: dict[int, str] = {}
    if sg_creator_ids:
        crows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(sg_creator_ids)).all()
        sg_creator_usernames = {r.id: r.username for r in crows}
    study_groups = [
        {
            "id": g.id,
            "name": g.name,
            "description": g.description,
            "course_id": g.course_id,
            "topic": g.topic,
            "created_by_username": sg_creator_usernames.get(g.created_by) if g.created_by else None,
            "created_at": g.created_at,
            "member_count": sg_member_counts.get(g.id, 0),
            "is_member": g.id in sg_my_ids,
        }
        for g in sg_rows
    ]

    # ── Study sessions (active reading rooms): keyword search ─
    from datetime import datetime, timedelta, timezone
    ss_rows = (
        db.query(models.StudySession)
        .filter(
            models.StudySession.status == "active",
            _study_session_filter(terms),
        )
        .order_by(models.StudySession.created_at.desc())
        .limit(4)
        .all()
    )
    ss_ids = [s.id for s in ss_rows]
    ss_creator_ids = {s.created_by for s in ss_rows if s.created_by}
    ss_creator_usernames: dict[int, str] = {}
    if ss_creator_ids:
        crows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(ss_creator_ids)).all()
        ss_creator_usernames = {r.id: r.username for r in crows}

    # Participant counts per session
    ss_part_counts: dict[int, dict] = {sid: {"total": 0, "studying": 0, "on_break": 0} for sid in ss_ids}
    if ss_ids:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=120)
        parts = (
            db.query(models.StudySessionParticipant)
            .filter(
                models.StudySessionParticipant.session_id.in_(ss_ids),
                models.StudySessionParticipant.status != "left",
                models.StudySessionParticipant.last_seen_at >= cutoff,
            )
            .all()
        )
        for p in parts:
            ss_part_counts[p.session_id]["total"] += 1
            if p.status == "studying":
                ss_part_counts[p.session_id]["studying"] += 1
            elif p.status == "on_break":
                ss_part_counts[p.session_id]["on_break"] += 1

    study_sessions = [
        {
            "id": s.id,
            "title": s.title,
            "topic": s.topic,
            "exam_goal": s.exam_goal,
            "course_id": s.course_id,
            "creator_username": ss_creator_usernames.get(s.created_by) if s.created_by else None,
            "status": s.status,
            "created_at": s.created_at,
            "participant_count": ss_part_counts[s.id]["total"],
            "studying_count": ss_part_counts[s.id]["studying"],
            "on_break_count": ss_part_counts[s.id]["on_break"],
        }
        for s in ss_rows
    ]

    return {
        "query": q,
        "understanding": public_understanding(understanding),
        "past_questions": past_questions,
        "lecture_notes": lecture_notes,
        "threads": threads,
        "related_topics": related_topics,
        "study_groups": study_groups,
        "study_sessions": study_sessions,
        "suggested_actions": _suggested_actions(
            understanding,
            q,
            bool(past_questions or lecture_notes or threads or study_groups or study_sessions),
        ),
    }


def _suggested_actions(understanding: dict, query: str, has_results: bool) -> list[dict[str, Any]]:
    topic = (
        understanding.get("interpreted_topic")
        or understanding.get("course_code")
        or understanding.get("person_name")
        or query
    )
    actions: list[dict[str, Any]] = []
    if topic:
        actions.append({
            "label": f"Ask AI to explain {topic}",
            "action": "ask_ai",
            "payload": {"question": f"Explain {topic}"},
        })
        actions.append({
            "label": f"Generate practice on {topic}",
            "action": "practice",
            "payload": {"topic": topic},
        })
    actions.extend([
        {"label": "Upload materials for this topic", "action": "upload", "payload": {"query": query}},
        {"label": "Start discussion", "action": "discussion", "payload": {"query": query}},
        {"label": "Create study group", "action": "study_group", "payload": {"topic": topic or query}},
        {"label": "Join a reading room", "action": "reading_room", "payload": {"topic": topic or query}},
    ])
    if not has_results and understanding.get("needs_course") and understanding.get("person_name"):
        actions.insert(0, {
            "label": f"Add a course for {understanding.get('person_name')}",
            "action": "ask_ai",
            "payload": {"question": f"What course should I analyze for {understanding.get('person_name')}?"},
        })
    return actions[:6]


def _metadata_context(db: Session) -> list[dict]:
    context: list[dict] = []
    for course in db.query(models.Course).limit(80).all():
        context.append({"code": course.code, "name": course.name, "description": course.description})
    for topic in db.query(models.Topic).limit(120).all():
        context.append({"topic": topic.name})
    for note in db.query(models.LectureNote).order_by(models.LectureNote.created_at.desc()).limit(120).all():
        context.append({"title": note.title, "topic": note.topic, **(note.metadata_json or {})})
    for pq in db.query(models.PastQuestion).order_by(models.PastQuestion.created_at.desc()).limit(120).all():
        context.append({"content": (pq.content_text or "")[:180], **(pq.metadata_json or {})})
    for thread in db.query(models.DiscussionThread).order_by(models.DiscussionThread.created_at.desc()).limit(80).all():
        context.append({"title": thread.title})
    return context


def _term_conditions(terms: list[str], *columns):
    conditions = []
    for term in terms:
        if not term:
            continue
        pattern = f"%{term}%"
        conditions.extend(column.ilike(pattern) for column in columns)
    return conditions or [columns[0].ilike("%__never_match__%")]


def _past_question_filter(terms: list[str]):
    return or_(*_term_conditions(terms, models.PastQuestion.content_text, models.PastQuestion.metadata_json.cast(Text)))


def _lecture_note_filter(terms: list[str]):
    return or_(*_term_conditions(terms, models.LectureNote.title, models.LectureNote.topic, models.LectureNote.metadata_json.cast(Text)))


def _lecture_note_chunk_filter(terms: list[str]):
    return or_(*_term_conditions(terms, models.LectureNoteChunk.chunk_text, models.LectureNoteChunk.topic_tag, models.LectureNoteChunk.metadata_json.cast(Text)))


def _thread_filter(terms: list[str]):
    return or_(*_term_conditions(terms, models.DiscussionThread.title))


def _study_group_filter(terms: list[str]):
    return or_(*_term_conditions(terms, models.StudyGroup.name, models.StudyGroup.topic, models.StudyGroup.description))


def _study_session_filter(terms: list[str]):
    return or_(*_term_conditions(terms, models.StudySession.title, models.StudySession.topic, models.StudySession.description, models.StudySession.exam_goal))


def _document_key(r: models.PastQuestion) -> str:
    metadata = r.metadata_json or {}
    return "|".join(
        str(part or "").strip().lower()
        for part in (
            metadata.get("document_title"),
            metadata.get("source_file"),
            metadata.get("course_code"),
            metadata.get("academic_year") or r.year,
            r.semester,
            metadata.get("document_type"),
        )
    )


def _clean_snippet(text: str | None, max_len: int = 280) -> str:
    clean = (text or "").replace("\n", " ")
    clean = re.sub(r"[_=*#~|]{2,}", " ", clean)
    clean = re.sub(r"[^\w\s.,;:()/&%+-]", " ", clean)
    clean = " ".join(clean.split())
    alpha_count = sum(ch.isalpha() for ch in clean)
    if len(clean) < 12 or alpha_count < 6:
        return ""
    return f"{clean[:max_len].strip()}..." if len(clean) > max_len else clean


def _display_title(metadata: dict, fallback: str = "Past question") -> str:
    title = str(metadata.get("document_title") or "").strip()
    if title:
        return title
    course_code = str(metadata.get("course_code") or "").strip()
    course_title = str(metadata.get("course_title") or "").strip()
    document_type = str(metadata.get("document_type") or "").replace("_", " ").strip().title()
    academic_year = str(metadata.get("academic_year") or metadata.get("year") or "").strip()
    parts = [course_code, course_title, document_type, academic_year]
    generated = " ".join(part for part in parts if part)
    return generated or str(metadata.get("source_file") or fallback)


def _metadata_snippets(metadata: dict) -> list[str]:
    preview = metadata.get("content_preview") or {}
    snippets: list[str] = []
    if preview.get("instruction"):
        cleaned = _clean_snippet(str(preview["instruction"]), 240)
        if cleaned:
            snippets.append(f"Instruction: {cleaned}")
    if preview.get("scenario"):
        cleaned = _clean_snippet(str(preview["scenario"]), 260)
        if cleaned:
            snippets.append(f"Scenario: {cleaned}")
    for question in (preview.get("questions") or [])[:3]:
        number = question.get("number") or "Question"
        text = question.get("preview") or ""
        cleaned = _clean_snippet(str(text), 260)
        if cleaned:
            snippets.append(f"{number}: {cleaned}")
    return snippets


def _group_past_questions(rows: list[models.PastQuestion], limit: int) -> list[dict]:
    grouped: dict[str, dict] = {}
    for row in rows:
        metadata = row.metadata_json or {}
        key = _document_key(row) or f"row-{row.id}"
        title = _display_title(metadata)
        if key not in grouped:
            snippets = _metadata_snippets(metadata)
            fallback_snippet = _clean_snippet(row.content_text)
            if not snippets and fallback_snippet:
                snippets = [fallback_snippet]
            grouped[key] = {
                "id": row.id,
                "course_id": row.course_id,
                "year": row.year,
                "semester": row.semester,
                "difficulty": row.difficulty,
                "title": title,
                "content_text": snippets[0] if snippets else _clean_snippet(row.content_text),
                "snippets": snippets,
                "chunk_ids": [row.id],
                "matching_sections": 1,
                "metadata_json": metadata,
                "verified_status": row.verified_status,
            }
        else:
            grouped[key]["chunk_ids"].append(row.id)
            grouped[key]["matching_sections"] = len(grouped[key]["chunk_ids"])
            cleaned = _clean_snippet(row.content_text)
            if cleaned and cleaned not in grouped[key]["snippets"] and len(grouped[key]["snippets"]) < 3:
                grouped[key]["snippets"].append(cleaned)
    return list(grouped.values())[:limit]


def _pq(r: models.PastQuestion) -> dict:
    metadata = r.metadata_json or {}
    return {
        "id": r.id,
        "course_id": r.course_id,
        "year": r.year,
        "semester": r.semester,
        "difficulty": r.difficulty,
        "title": _display_title(metadata),
        "content_text": _metadata_snippets(metadata)[0] if _metadata_snippets(metadata) else _clean_snippet(r.content_text),
        "snippets": _metadata_snippets(metadata) or [_clean_snippet(r.content_text)],
        "chunk_ids": [r.id],
        "matching_sections": 1,
        "metadata_json": metadata,
        "verified_status": r.verified_status,
    }


def _ln(r: models.LectureNote) -> dict:
    return {
        "id": r.id,
        "course_id": r.course_id,
        "topic": r.topic,
        "title": r.title,
        "year": r.year,
        "semester": r.semester,
        "verified_status": r.verified_status,
        "metadata_json": r.metadata_json,
    }
