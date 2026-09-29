"""Small provider boundary for Maxe generation.

DeepSeek/Cohere fallback remains owned by ``ai_clients``.  Maxe depends on
this boundary instead of coupling product orchestration to one SDK or URL.
"""

from __future__ import annotations

from typing import Protocol

import ai_clients


class TextProvider(Protocol):
    def generate(self, prompt: str, temperature: float = 0.3) -> str:
        ...


class MaxeProvider:
    """Adapter around the configured primary/fallback text providers."""

    def generate(self, prompt: str, temperature: float = 0.3) -> str:
        return ai_clients.generate_ai_response(prompt, temperature=temperature)


def get_maxe_provider() -> TextProvider:
    return MaxeProvider()
