import json
import os
import re
from io import BytesIO
from typing import Any, Dict, Optional

import PyPDF2
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

import auth
import models
from database import get_db

from ai_clients import embeddings_model, metadata_llm

try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None

try:
    import pytesseract
    from PIL import Image
except Exception:
    pytesseract = None
    Image = None

router = APIRouter(prefix="/ingest", tags=["ingestion"])

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
MAX_INDEX_CHUNKS = int(os.getenv("MAX_INDEX_CHUNKS", "40"))
MIN_INDEXABLE_TEXT_CHARS = int(os.getenv("MIN_INDEXABLE_TEXT_CHARS", "80"))
MAX_OCR_PAGES = int(os.getenv("MAX_OCR_PAGES", "20"))

DOCUMENT_TYPES = {
    "past_question",
    "lecture_note",
    "course_outline",
    "tutorial",
    "assignment",
    "revision_slide",
    "exam_prep",
    "unknown",
}
EXAM_TYPES = {"quiz", "test", "midterm", "final", "unknown"}


def missing_ai_error(feature: str):
    return HTTPException(
        status_code=503,
        detail=f"{feature} is not available. Check DEEPSEEK_API_KEY and that fastembed is installed (pip install fastembed).",
    )


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200):
    chunks = []
    start = 0
    clean_text = re.sub(r"\n{3,}", "\n\n", text).strip()
    while start < len(clean_text):
        end = start + chunk_size
        chunks.append(clean_text[start:end])
        start += chunk_size - overlap
    return chunks


def _quality_score(text: str, page_count: int, method: str) -> float:
    clean = re.sub(r"\s+", " ", text or "").strip()
    if not clean:
        return 0.0
    length_score = min(len(clean) / 1200, 1.0)
    alpha_ratio = sum(ch.isalpha() for ch in clean) / max(len(clean), 1)
    page_bonus = min(page_count / 8, 1.0) * 0.1
    method_base = 0.55 if method == "ocr" else 0.65
    return round(min(method_base + (length_score * 0.25) + (alpha_ratio * 0.12) + page_bonus, 0.98), 2)


def _clean_extracted_text(parts: list[str]) -> str:
    return re.sub(r"\n{3,}", "\n\n", "\n".join(part for part in parts if part).strip())


def _extract_with_pymupdf(content: bytes) -> tuple[str, int]:
    if not fitz:
        return "", 0
    doc = fitz.open(stream=content, filetype="pdf")
    try:
        parts = [page.get_text("text") or "" for page in doc]
        return _clean_extracted_text(parts), doc.page_count
    finally:
        doc.close()


def _extract_with_pypdf2(content: bytes) -> tuple[str, int]:
    pdf_reader = PyPDF2.PdfReader(BytesIO(content))
    if getattr(pdf_reader, "is_encrypted", False):
        raise ValueError("encrypted_pdf")
    parts = [(page.extract_text() or "") for page in pdf_reader.pages]
    return _clean_extracted_text(parts), len(pdf_reader.pages)


def _ocr_pdf(content: bytes, page_count: int, warnings: list[str]) -> tuple[str, str | None]:
    if not fitz:
        warnings.append("OCR could not run because PyMuPDF is not installed.")
        return "", "ocr_not_installed"
    if not pytesseract or not Image:
        warnings.append("OCR support is not installed. Install Tesseract OCR or upload a text-based PDF.")
        return "", "ocr_not_installed"

    doc = fitz.open(stream=content, filetype="pdf")
    try:
        ocr_parts = []
        pages_to_scan = min(doc.page_count, MAX_OCR_PAGES)
        if page_count and doc.page_count > MAX_OCR_PAGES:
            warnings.append(f"OCR scanned the first {MAX_OCR_PAGES} pages only.")
        for page_index in range(pages_to_scan):
            page = doc.load_page(page_index)
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image = Image.open(BytesIO(pix.tobytes("png")))
            ocr_parts.append(pytesseract.image_to_string(image) or "")
        return _clean_extracted_text(ocr_parts), None
    except pytesseract.TesseractNotFoundError:
        warnings.append("OCR support is not installed. Install Tesseract OCR or upload a text-based PDF.")
        return "", "ocr_not_installed"
    except Exception as exc:
        warnings.append(f"OCR could not read this PDF: {exc}")
        return "", "ocr_failed"
    finally:
        doc.close()


def extract_pdf_text(file: UploadFile) -> Dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    content = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"PDF is too large. Maximum upload size is {MAX_UPLOAD_BYTES} bytes.",
        )

    warnings = []
    embedded_text = ""
    page_count = 0
    failure_reason = "embedded_text_weak"

    try:
        embedded_text, page_count = _extract_with_pymupdf(content)
    except Exception as exc:
        warnings.append(f"PyMuPDF text extraction failed: {exc}")
        if "encrypted" in str(exc).lower():
            failure_reason = "encrypted_pdf"

    if len(embedded_text.strip()) < MIN_INDEXABLE_TEXT_CHARS:
        try:
            fallback_text, fallback_pages = _extract_with_pypdf2(content)
            if len(fallback_text.strip()) > len(embedded_text.strip()):
                embedded_text = fallback_text
            page_count = page_count or fallback_pages
        except Exception as exc:
            warnings.append(f"PyPDF2 text extraction failed: {exc}")
            if "encrypted_pdf" in str(exc) or "encrypted" in str(exc).lower():
                failure_reason = "encrypted_pdf"

    embedded_count = len(embedded_text.strip())
    if embedded_count >= MIN_INDEXABLE_TEXT_CHARS:
        return {
            "text": embedded_text,
            "method": "embedded_text",
            "page_count": page_count,
            "text_char_count": embedded_count,
            "ocr_used": False,
            "extraction_confidence": _quality_score(embedded_text, page_count, "embedded_text"),
            "failure_reason": None,
            "warnings": warnings,
        }

    warnings.append("Weak embedded text detected")
    ocr_text, ocr_failure_reason = _ocr_pdf(content, page_count, warnings)
    ocr_count = len(ocr_text.strip())

    if ocr_count >= MIN_INDEXABLE_TEXT_CHARS:
        text = ocr_text
        method = "ocr"
        if embedded_count:
            text = _clean_extracted_text([embedded_text, ocr_text])
            method = "mixed"
        return {
            "text": text,
            "method": method,
            "page_count": page_count,
            "text_char_count": len(text.strip()),
            "ocr_used": True,
            "extraction_confidence": _quality_score(text, page_count, "ocr"),
            "failure_reason": None,
            "warnings": warnings,
        }

    if ocr_failure_reason:
        failure_reason = ocr_failure_reason
    elif ocr_count > 0:
        failure_reason = "ocr_low_confidence"
    elif failure_reason == "embedded_text_weak":
        failure_reason = "file_too_blurry"

    return {
        "text": embedded_text if embedded_count >= ocr_count else ocr_text,
        "method": "failed",
        "page_count": page_count,
        "text_char_count": max(embedded_count, ocr_count),
        "ocr_used": True,
        "extraction_confidence": 0.0,
        "failure_reason": failure_reason,
        "warnings": warnings,
    }


def infer_metadata_fallback(filename: str, text: str) -> Dict[str, Any]:
    sample = f"{filename}\n{text[:2500]}"
    course_match = re.search(r"\b[A-Z]{2,4}\s?\d{3}\b", sample, re.IGNORECASE)
    academic_year = _extract_academic_year(sample)
    year_match = re.search(r"\b(20\d{2}|19\d{2})\b", sample)
    semester_match = re.search(r"\b(first|second|rain|harmattan)\s+semester\b", sample, re.IGNORECASE)
    looks_like_exam = bool(
        re.search(r"\b(pq|past\s+questions?|time allowed|marks|answer question|examination|exam|test|quiz|final|mid[-\s]?semester)\b", sample, re.IGNORECASE)
    )
    looks_like_note = bool(re.search(r"\b(note|lecture|slide|revision)\b", sample, re.IGNORECASE))
    lecturer_names = _extract_lecturer_names(text[:2500]) if len(text.strip()) >= MIN_INDEXABLE_TEXT_CHARS else []
    exam_type = _infer_exam_type(sample)

    if looks_like_exam:
        document_type = "past_question"
    elif looks_like_note:
        document_type = "lecture_note"
    else:
        document_type = "unknown"
    course_code = course_match.group(0).upper().replace(" ", "") if course_match else "UNKNOWN"
    semester = semester_match.group(1).title() if semester_match else "Unknown"
    year = int(year_match.group(1)) if year_match else None
    if academic_year and not year:
        year = int(academic_year.split("/")[-1])

    return {
        "document_type": document_type,
        "document_title": "",
        "course_code": course_code,
        "course_title": "",
        "lecturer_names": lecturer_names,
        "academic_year": academic_year,
        "year": year,
        "semester": semester,
        "department": _extract_named_line(sample, "department"),
        "faculty": _extract_named_line(sample, "faculty"),
        "college": _extract_named_line(sample, "college"),
        "exam_type": exam_type,
        "topics_covered": [],
        "confidence_score": 0.45 if course_match else 0.25,
    }


def extract_metadata(filename: str, text: str) -> Dict[str, Any]:
    if not metadata_llm:
        return infer_metadata_fallback(filename, text)

    prompt = f"""
Extract academic document metadata from this Nigerian university PDF.
Read headers, footers, cover pages, course information, lecturer names, department/faculty/college names, exam instructions, and repeated topic headings.
Return JSON only with these keys:
document_type: "past_question", "lecture_note", "course_outline", "tutorial", "assignment", "revision_slide", "exam_prep", or "unknown"
document_title, course_code, course_title,
lecturer_names: array of explicit lecturer names only. If no lecturer name is explicit, return [].
year, semester, department, faculty, college,
exam_type: "quiz", "test", "midterm", "final", or "unknown",
topics_covered: array of concise topic strings,
confidence_score: number from 0 to 1.
Do not hallucinate lecturer names.

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

    return normalize_metadata_fields(metadata)


def _extract_named_line(sample: str, label: str) -> str:
    match = re.search(rf"\b{label}\s*(?:of)?\s*[:\-]\s*([A-Za-z][A-Za-z&,\s]+)", sample, re.IGNORECASE)
    return match.group(1).strip()[:120] if match else ""


def _extract_lecturer_names(sample: str) -> list[str]:
    names: list[str] = []
    patterns = [
        r"\b(?:course\s+lecturer|lecturer|instructor)\s*[:\-]\s*([A-Za-z. ]{3,80})",
        r"\b(?:Dr|Prof|Mr|Mrs|Miss)\.?\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, sample, re.IGNORECASE):
            raw = match.group(1).strip()
            raw = re.split(r"\s{2,}|,|\n|\(|\)|\b(course|department|faculty|college)\b", raw, maxsplit=1, flags=re.IGNORECASE)[0].strip()
            if raw and raw.lower() not in {"unknown", "nil", "none"} and raw not in names:
                names.append(raw)
    return names[:5]


def _extract_academic_year(sample: str) -> str:
    patterns = [
        r"\b(20\d{2})\s*[-/]\s*(20\d{2})\b",
        r"\b(20\d{2})\s*[-/]\s*(\d{2})\b",
        r"\b(\d{2})\s*[-/]\s*(\d{2})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, sample)
        if not match:
            continue
        start_raw, end_raw = match.group(1), match.group(2)
        start = int(start_raw) if len(start_raw) == 4 else 2000 + int(start_raw)
        if len(end_raw) == 4:
            end = int(end_raw)
        else:
            end = (start // 100) * 100 + int(end_raw)
            if end < start:
                end += 100
        if 1900 <= start <= 2099 and 1900 <= end <= 2099 and start <= end <= start + 2:
            return f"{start}/{end}"
    return ""


def _infer_exam_type(sample: str) -> str:
    checks = [
        ("midterm", r"\b(mid[-\s]?semester|midterm)\b"),
        ("final", r"\b(final|examination|exam)\b"),
        ("quiz", r"\bquiz\b"),
        ("test", r"\btest\b"),
    ]
    for value, pattern in checks:
        if re.search(pattern, sample, re.IGNORECASE):
            return value
    return "unknown"


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return []


def normalize_metadata_fields(metadata: Dict[str, Any]) -> Dict[str, Any]:
    document_type = str(metadata.get("document_type") or "unknown").lower().strip()
    if document_type not in DOCUMENT_TYPES:
        document_type = "unknown"

    exam_type = str(metadata.get("exam_type") or "unknown").lower().strip()
    if exam_type not in EXAM_TYPES:
        exam_type = "unknown"

    course_code = (metadata.get("course_code") or "UNKNOWN")
    course_code = str(course_code).upper().replace(" ", "")

    year = metadata.get("year")
    try:
        year = int(year) if year not in ("", None) else None
    except (TypeError, ValueError):
        year = None

    confidence_score = metadata.get("confidence_score", 0.25)
    try:
        confidence_score = float(confidence_score)
    except (TypeError, ValueError):
        confidence_score = 0.25

    return {
        "document_type": document_type,
        "document_title": str(metadata.get("document_title") or "").strip(),
        "course_code": course_code,
        "course_title": str(metadata.get("course_title") or "").strip(),
        "lecturer_names": _as_list(metadata.get("lecturer_names")),
        "academic_year": str(metadata.get("academic_year") or "").strip(),
        "year": year,
        "semester": str(metadata.get("semester") or "Unknown").strip() or "Unknown",
        "department": str(metadata.get("department") or "").strip(),
        "faculty": str(metadata.get("faculty") or "").strip(),
        "college": str(metadata.get("college") or "").strip(),
        "exam_type": exam_type,
        "topics_covered": _as_list(metadata.get("topics_covered")),
        "source_file": str(metadata.get("source_file") or "").strip(),
        "extraction_method": str(metadata.get("extraction_method") or "embedded_text").strip(),
        "extraction_confidence": float(metadata.get("extraction_confidence") or 0),
        "extraction_failure_reason": str(metadata.get("extraction_failure_reason") or "").strip(),
        "indexed_status": str(metadata.get("indexed_status") or "indexed").strip(),
        "searchable": bool(metadata.get("searchable", True)),
        "needs_clearer_file": bool(metadata.get("needs_clearer_file", False)),
        "confidence_score": max(0.0, min(confidence_score, 1.0)),
    }


def normalized_metadata(metadata_json: Optional[str], fallback: Dict[str, Any]) -> Dict[str, Any]:
    if not metadata_json:
        return normalize_metadata_fields(fallback)
    try:
        parsed = json.loads(metadata_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="confirmed_metadata must be valid JSON.")
    return normalize_metadata_fields({**fallback, **parsed})


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
    source_file = (metadata.get("source_file") or "").strip().lower()
    document_title = (metadata.get("document_title") or "").strip().lower()

    if not course_code or not year or not semester or course_code == "UNKNOWN":
        return None

    if document_type != "past_question":
        query = db.query(models.LectureNote).filter(
            models.LectureNote.year == year,
            models.LectureNote.semester == semester,
            models.LectureNote.metadata_json["course_code"].as_string() == course_code,
        )
        candidates = query.limit(20).all()
        duplicate = next((row for row in candidates if _same_uploaded_file(row.metadata_json, source_file, document_title)), None)
        if duplicate:
            return {"id": duplicate.id, "type": "lecture_note", "title": duplicate.title, "file_url": duplicate.file_url}
        return None

    candidates = (
        db.query(models.PastQuestion)
        .filter(
            models.PastQuestion.year == year,
            models.PastQuestion.semester == semester,
            models.PastQuestion.metadata_json["course_code"].as_string() == course_code,
            models.PastQuestion.metadata_json["document_type"].as_string() == "past_question",
        )
        .limit(20)
        .all()
    )
    duplicate = next((row for row in candidates if _same_uploaded_file(row.metadata_json, source_file, document_title)), None)
    if duplicate:
        return {"id": duplicate.id, "type": "past_question", "title": duplicate.metadata_json.get("source_file"), "file_url": duplicate.file_url}
    return None


def _same_uploaded_file(existing: Optional[Dict[str, Any]], source_file: str, document_title: str) -> bool:
    existing = existing or {}
    existing_file = str(existing.get("source_file") or "").strip().lower()
    existing_title = str(existing.get("document_title") or "").strip().lower()
    return bool((source_file and existing_file == source_file) or (document_title and existing_title == document_title))


def embed_or_fail(text: str):
    if not embeddings_model:
        raise missing_ai_error("Embeddings model")
    return embeddings_model.embed_query(text)


def extraction_message(extraction: Dict[str, Any]) -> str:
    if extraction.get("method") in {"ocr", "mixed"}:
        return "Read using OCR. Please review the detected metadata."
    reason = extraction.get("failure_reason")
    if reason == "ocr_not_installed":
        return "OCR is not installed on this server. Install Tesseract OCR or upload a text-based PDF."
    if reason in {"ocr_failed", "ocr_low_confidence", "file_too_blurry"}:
        return "ExamMind tried OCR, but the scan is too unclear to read confidently."
    if reason == "encrypted_pdf":
        return "This PDF appears to be encrypted. Upload an unlocked PDF."
    if reason == "unsupported_pdf":
        return "This PDF could not be read. Upload a standard PDF file."
    return "ExamMind could not read this scan clearly. Try a clearer PDF or enter metadata manually."


@router.post("/upload")
def upload_document(
    file: UploadFile = File(...),
    confirm: bool = Form(False),
    confirmed_metadata: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    extraction = extract_pdf_text(file)
    extracted_text = extraction["text"]
    extraction_succeeded = extraction["method"] != "failed" and len(extracted_text.strip()) >= MIN_INDEXABLE_TEXT_CHARS

    ai_metadata = extract_metadata(file.filename or "upload.pdf", extracted_text) if extraction_succeeded else infer_metadata_fallback(file.filename or "upload.pdf", extracted_text)
    ai_metadata.update(
        {
            "source_file": file.filename,
            "extraction_method": extraction["method"],
            "extraction_confidence": extraction["extraction_confidence"],
            "extraction_failure_reason": extraction.get("failure_reason") or "",
        }
    )
    metadata = normalized_metadata(confirmed_metadata, ai_metadata)
    metadata["source_file"] = file.filename
    metadata["extraction_method"] = metadata.get("extraction_method") or extraction["method"]
    metadata["extraction_confidence"] = metadata.get("extraction_confidence", extraction["extraction_confidence"])
    metadata["extraction_failure_reason"] = extraction.get("failure_reason") or metadata.get("extraction_failure_reason") or ""
    metadata["extraction_warnings"] = extraction.get("warnings", [])

    duplicate = find_duplicate(db, metadata)
    if duplicate:
        return {"status": "duplicate", "metadata": metadata, "existing_document": duplicate}

    if not extraction_succeeded and not confirm:
        return {
            "status": "manual_metadata_required",
            "metadata": {
                **metadata,
                "indexed_status": "unindexed",
                "searchable": False,
                "needs_clearer_file": True,
            },
            "preview": extracted_text[:800],
            "extraction": extraction,
            "message": extraction_message(extraction),
        }

    if not confirm:
        return {
            "status": "needs_confirmation",
            "metadata": metadata,
            "preview": extracted_text[:800],
            "extraction": extraction,
            "message": extraction_message(extraction),
        }

    course = match_course(db, metadata)
    manual_unindexed = metadata.get("extraction_method") == "manual" or not extraction_succeeded
    chunks = [] if manual_unindexed else [chunk for chunk in chunk_text(extracted_text) if len(chunk.strip()) >= 50]
    if not chunks:
        metadata.update(
            {
                "indexed_status": "unindexed",
                "searchable": False,
                "needs_clearer_file": True,
                "extraction_method": "manual" if manual_unindexed else metadata.get("extraction_method"),
            }
        )
    else:
        metadata.update({"indexed_status": "indexed", "searchable": True, "needs_clearer_file": False})
    if len(chunks) > MAX_INDEX_CHUNKS:
        raise HTTPException(
            status_code=413,
            detail=f"PDF produced {len(chunks)} chunks, which exceeds MAX_INDEX_CHUNKS={MAX_INDEX_CHUNKS}. Upload a smaller document.",
        )

    if metadata.get("document_type") != "past_question":
        note = models.LectureNote(
            course_id=course.id if course else None,
            uploaded_by=current_user.id,
            topic=", ".join(metadata.get("topics_covered", [])[:3]) or None,
            title=metadata.get("document_title") or metadata.get("course_title") or metadata.get("source_file") or "Lecture note",
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
        indexed_chunks = chunks or [""]
        for index, chunk in enumerate(indexed_chunks):
            pq = models.PastQuestion(
                course_id=course.id if course else None,
                uploaded_by=current_user.id,
                year=metadata.get("year"),
                semester=metadata.get("semester"),
                difficulty="mixed",
                content_text=chunk,
                embedding=embed_or_fail(chunk) if chunk.strip() else None,
                file_url=file.filename,
                verified_status="unverified",
                metadata_json={**metadata, "chunk_index": index, "indexed": bool(chunk.strip())},
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
        "indexed": bool(chunks),
        "metadata": metadata,
    }
