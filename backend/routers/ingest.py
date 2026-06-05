import json
import re
from io import BytesIO
from typing import Any, Dict, Optional

import PyPDF2
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

import auth
import models
from database import get_db

try:
    from langchain_openai import ChatOpenAI, OpenAIEmbeddings

    embeddings_model = OpenAIEmbeddings(model="text-embedding-3-small")
    metadata_llm = ChatOpenAI(model="gpt-4o", temperature=0)
except Exception as e:
    embeddings_model = None
    metadata_llm = None
    print(f"Warning: OpenAI Langchain integrations not fully configured. {e}")

router = APIRouter(prefix="/ingest", tags=["ingestion"])


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200):
    chunks = []
    start = 0
    clean_text = re.sub(r"\n{3,}", "\n\n", text).strip()
    while start < len(clean_text):
        end = start + chunk_size
        chunks.append(clean_text[start:end])
        start += chunk_size - overlap
    return chunks


def extract_pdf_text(file: UploadFile) -> str:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    content = file.file.read()
    try:
        pdf_reader = PyPDF2.PdfReader(BytesIO(content))
        extracted_text = "\n".join((page.extract_text() or "") for page in pdf_reader.pages)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"PDF could not be read: {exc}")

    if len(extracted_text.strip()) < 80:
        raise HTTPException(
            status_code=400,
            detail="This PDF is not readable enough to index. Try a clearer scan or text-based PDF.",
        )
    return extracted_text


def infer_metadata_fallback(filename: str, text: str) -> Dict[str, Any]:
    sample = f"{filename}\n{text[:2500]}"
    course_match = re.search(r"\b[A-Z]{2,4}\s?\d{3}\b", sample, re.IGNORECASE)
    year_match = re.search(r"\b(20\d{2}|19\d{2})\b", sample)
    semester_match = re.search(r"\b(first|second|rain|harmattan)\s+semester\b", sample, re.IGNORECASE)
    looks_like_exam = bool(re.search(r"\b(time allowed|marks|answer question|examination|exam)\b", sample, re.IGNORECASE))

    document_type = "past_question" if looks_like_exam else "lecture_note"
    course_code = course_match.group(0).upper().replace(" ", "") if course_match else "UNKNOWN"
    semester = semester_match.group(1).title() if semester_match else "Unknown"

    return {
        "document_type": document_type,
        "course_code": course_code,
        "course_title": "",
        "year": int(year_match.group(1)) if year_match else None,
        "semester": semester,
        "department": "",
        "faculty": "",
        "topics_covered": [],
        "confidence_score": 0.45 if course_match else 0.25,
    }


def extract_metadata(filename: str, text: str) -> Dict[str, Any]:
    if not metadata_llm:
        return infer_metadata_fallback(filename, text)

    prompt = f"""
Extract academic document metadata from this Nigerian university PDF.
Return JSON only with these keys:
document_type: "past_question" or "lecture_note"
course_code, course_title, year, semester, department, faculty,
topics_covered: array of concise topic strings,
confidence_score: number from 0 to 1.

Filename: {filename}
Document excerpt:
{text[:6000]}
"""
    try:
        response = metadata_llm.invoke(prompt)
        raw = getattr(response, "content", str(response)).strip()
        raw = re.sub(r"^```json|```$", "", raw, flags=re.IGNORECASE | re.MULTILINE).strip()
        metadata = json.loads(raw)
    except Exception as exc:
        print(f"Metadata extraction fell back to heuristics: {exc}")
        metadata = infer_metadata_fallback(filename, text)

    metadata["document_type"] = metadata.get("document_type") or "past_question"
    metadata["document_type"] = metadata["document_type"].lower()
    metadata["course_code"] = (metadata.get("course_code") or "UNKNOWN").upper().replace(" ", "")
    metadata["semester"] = metadata.get("semester") or "Unknown"
    metadata["topics_covered"] = metadata.get("topics_covered") or []
    return metadata


def normalized_metadata(metadata_json: Optional[str], fallback: Dict[str, Any]) -> Dict[str, Any]:
    if not metadata_json:
        return fallback
    try:
        parsed = json.loads(metadata_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="confirmed_metadata must be valid JSON.")
    return {**fallback, **parsed}


def match_course(db: Session, metadata: Dict[str, Any]) -> Optional[models.Course]:
    course_code = metadata.get("course_code")
    if not course_code or course_code == "UNKNOWN":
        return None

    return db.query(models.Course).filter(models.Course.code == course_code).first()


def find_duplicate(db: Session, metadata: Dict[str, Any]):
    course_code = metadata.get("course_code")
    year = metadata.get("year")
    semester = metadata.get("semester")
    document_type = metadata.get("document_type")

    if not course_code or not year or not semester:
        return None

    if document_type == "lecture_note":
        query = db.query(models.LectureNote).filter(
            models.LectureNote.year == year,
            models.LectureNote.semester == semester,
            models.LectureNote.metadata_json["course_code"].as_string() == course_code,
        )
        duplicate = query.first()
        if duplicate:
            return {"id": duplicate.id, "type": "lecture_note", "title": duplicate.title, "file_url": duplicate.file_url}
        return None

    duplicate = (
        db.query(models.PastQuestion)
        .filter(
            models.PastQuestion.year == year,
            models.PastQuestion.semester == semester,
            models.PastQuestion.metadata_json["course_code"].as_string() == course_code,
            models.PastQuestion.metadata_json["document_type"].as_string() == "past_question",
        )
        .first()
    )
    if duplicate:
        return {"id": duplicate.id, "type": "past_question", "title": duplicate.metadata_json.get("source_file"), "file_url": duplicate.file_url}
    return None


def embed_or_fail(text: str):
    if not embeddings_model:
        raise HTTPException(status_code=500, detail="Embeddings model not configured. Set OPENAI_API_KEY.")
    return embeddings_model.embed_query(text)


@router.post("/upload")
def upload_document(
    file: UploadFile = File(...),
    confirm: bool = Form(False),
    confirmed_metadata: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    extracted_text = extract_pdf_text(file)
    ai_metadata = extract_metadata(file.filename or "upload.pdf", extracted_text)
    metadata = normalized_metadata(confirmed_metadata, ai_metadata)
    metadata["source_file"] = file.filename

    duplicate = find_duplicate(db, metadata)
    if duplicate:
        return {"status": "duplicate", "metadata": metadata, "existing_document": duplicate}

    if not confirm:
        return {
            "status": "needs_confirmation",
            "metadata": metadata,
            "preview": extracted_text[:800],
        }

    course = match_course(db, metadata)
    chunks = [chunk for chunk in chunk_text(extracted_text) if len(chunk.strip()) >= 50]

    if metadata.get("document_type") == "lecture_note":
        note = models.LectureNote(
            course_id=course.id if course else None,
            uploaded_by=current_user.id,
            topic=", ".join(metadata.get("topics_covered", [])[:3]) or None,
            title=metadata.get("course_title") or metadata.get("source_file") or "Lecture note",
            year=metadata.get("year"),
            semester=metadata.get("semester"),
            file_url=file.filename,
            verified_status="unverified",
            metadata_json=metadata,
        )
        db.add(note)
        db.flush()
        for index, chunk in enumerate(chunks):
            db.add(
                models.LectureNoteChunk(
                    lecture_note_id=note.id,
                    course_id=course.id if course else None,
                    chunk_text=chunk,
                    embedding=embed_or_fail(chunk),
                    topic_tag=", ".join(metadata.get("topics_covered", [])[:2]) or None,
                    chunk_index=index,
                    metadata_json=metadata,
                )
            )
        document_id = note.id
    else:
        document_id = None
        for index, chunk in enumerate(chunks):
            pq = models.PastQuestion(
                course_id=course.id if course else None,
                uploaded_by=current_user.id,
                year=metadata.get("year"),
                semester=metadata.get("semester"),
                difficulty="mixed",
                content_text=chunk,
                embedding=embed_or_fail(chunk),
                file_url=file.filename,
                verified_status="unverified",
                metadata_json={**metadata, "chunk_index": index},
            )
            db.add(pq)
            db.flush()
            document_id = document_id or pq.id

    db.commit()
    return {
        "status": "success",
        "document_id": document_id,
        "document_type": metadata.get("document_type"),
        "chunks_indexed": len(chunks),
        "metadata": metadata,
    }
