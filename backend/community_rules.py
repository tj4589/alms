"""Dependency-free rules shared by Study Community routes and tests."""

import re

ACADEMIC_TERMS = {
    "exam", "assignment", "course", "lecture", "question", "past paper",
    "define", "explain", "formula", "theory", "deadline", "quiz", "test",
}


def classify_discussion(text: str) -> tuple[str, str]:
    value = text.lower()
    category = "academic" if any(term in value for term in ACADEMIC_TERMS) else "casual"
    if any(term in value for term in {"stuck", "confused", "help", "lost", "don't understand"}):
        mood = "stuck"
    elif any(term in value for term in {"share", "resource", "found", "note", "link"}):
        mood = "resource"
    else:
        mood = "question" if category == "academic" else "conversation"
    return category, mood


def safe_username(value: str) -> str:
    return re.sub(r"[^a-z0-9_]", "", value.strip().lower())[:24]


def can_leave_group(role: str | None) -> bool:
    return role not in {"owner"}


def can_post_announcement(role: str | None) -> bool:
    return role in {"owner", "admin"}


def next_attendance_status(current: str, event: str) -> str:
    transitions = {
        ("left", "join"): "studying",
        ("studying", "break_start"): "on_break",
        ("on_break", "break_end"): "studying",
        ("studying", "leave"): "left",
        ("on_break", "leave"): "left",
        ("studying", "timeout"): "left",
        ("on_break", "timeout"): "left",
    }
    return transitions.get((current, event), current)
