"""Context assembly primitives for Maxe's source-aware chat pipeline.

The model receives a bounded, explicit context envelope.  The public response
only exposes safe labels and flags; selected text and recent conversation stay
inside the provider prompt.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


SOURCE_MODE: Literal["source", "beyond_materials"] = "source"
BEYOND_MATERIALS_MODE: Literal["source", "beyond_materials"] = "beyond_materials"
MAX_SELECTED_TEXT_CHARS = 4_000
MAX_RECENT_CONTEXT_CHARS = 4_000
MAX_ACTIVE_RESOURCE_CHARS = 6_000


def normalize_maxe_mode(value: Any) -> Literal["source", "beyond_materials"]:
    normalized = str(value or "").strip().lower().replace("-", "_")
    return BEYOND_MATERIALS_MODE if normalized in {"beyond_materials", "beyond", "general"} else SOURCE_MODE


def bounded_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


@dataclass(frozen=True)
class MaxeContext:
    mode: Literal["source", "beyond_materials"]
    workspace_name: str | None
    active_resource: dict[str, Any] | None
    active_resource_text: str
    selected_text: str
    selected_text_source: str | None
    recent_context: str

    @property
    def has_source_context(self) -> bool:
        return bool(self.active_resource or self.selected_text)

    def public_payload(self) -> dict[str, Any]:
        """Return context state safe for the authenticated client."""
        active = self.active_resource
        return {
            "mode": self.mode,
            "workspace_name": self.workspace_name,
            "active_resource": (
                {
                    "resource_type": active.get("resource_type"),
                    "resource_id": active.get("resource_id"),
                    "title": active.get("title"),
                }
                if active
                else None
            ),
            "selected_text_used": bool(self.selected_text),
            "selected_text_source": self.selected_text_source if self.selected_text else None,
            "recent_context_used": bool(self.recent_context),
        }

    def prompt_block(self) -> str:
        active = self.active_resource or {}
        active_label = "None"
        if active:
            active_label = (
                f"{active.get('title') or 'Untitled source'} "
                f"({active.get('resource_type')}, id {active.get('resource_id')})"
            )
        return "\n".join(
            [
                f"Learning space: {self.workspace_name or 'ExamMind workspace'}",
                f"Knowledge mode: {'BEYOND YOUR MATERIALS' if self.mode == BEYOND_MATERIALS_MODE else 'FROM YOUR MATERIALS'}",
                f"Active authorized resource: {active_label}",
                f"Active resource context:\n{self.active_resource_text or '(none)'}",
                f"Student-selected text (focus only; not a citation):\n{self.selected_text or '(none)'}",
                f"Selected text label: {self.selected_text_source or '(none)'}",
                f"Recent conversation:\n{self.recent_context or '(none)'}",
            ]
        )


def assemble_maxe_context(
    *,
    mode: Any = SOURCE_MODE,
    workspace_name: Any = None,
    active_resource: dict[str, Any] | None = None,
    active_resource_text: Any = None,
    selected_text: Any = None,
    selected_text_source: Any = None,
    recent_context: Any = None,
) -> MaxeContext:
    """Build a bounded context envelope after resource permission checks."""
    return MaxeContext(
        mode=normalize_maxe_mode(mode),
        workspace_name=bounded_text(workspace_name, 160) or None,
        active_resource=active_resource,
        active_resource_text=bounded_text(active_resource_text, MAX_ACTIVE_RESOURCE_CHARS),
        selected_text=bounded_text(selected_text, MAX_SELECTED_TEXT_CHARS),
        selected_text_source=bounded_text(selected_text_source, 240) or None,
        recent_context=bounded_text(recent_context, MAX_RECENT_CONTEXT_CHARS),
    )
