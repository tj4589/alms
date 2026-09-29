"""Maxe chat route over the permission-aware retrieval service."""

from fastapi import APIRouter, Depends, HTTPException

import auth
import models
from database import get_db
from routers.rag import AskQuestionRequest, AskQuestionResponse, run_rag_query
from sqlalchemy.orm import Session


router = APIRouter(prefix="/maxe", tags=["maxe"])


@router.post("/chat", response_model=AskQuestionResponse)
def chat(
    req: AskQuestionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Answer one Maxe turn without exposing an unauthorized context."""
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required.")
    if len(question) > 2000:
        raise HTTPException(status_code=413, detail="Question is too long. Limit it to 2000 characters.")
    recent_context = (req.recent_context or "").strip()[:1200] or None
    return run_rag_query(
        question,
        req.course_id,
        req.topic_id,
        db,
        room_context=recent_context,
        current_user=current_user,
        mode=req.mode,
        selected_text=req.selected_text or req.passage,
        selected_text_source=req.selected_text_source or req.passage_source,
        active_resource_type=req.active_resource_type,
        active_resource_id=req.active_resource_id,
        active_resource_title=req.active_resource_title,
        active_timestamp=req.active_timestamp,
    )
