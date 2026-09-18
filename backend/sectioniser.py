"""Cut a document into sections a student would recognise.

This is deliberately not the same cut as `chunk_text()` in routers/ingest.py.
That one slices a fixed 1000 characters with 200 of overlap because embeddings
want even, redundant windows for recall. Those slices break mid-word and repeat
the last paragraph at the start of the next, which is fine for a vector index
and unreadable for a person.

Sections follow the document's own structure instead:

    1. headings, when the document has them
    2. pages, when it does not but we know where pages ended
    3. paragraph runs of roughly equal length, when we know neither

`cut_by` records which of the three happened, so the reader can say "Page 4"
where that is the truth and stay quiet where the split is arbitrary.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# A heading is short. Anything longer is a sentence that happens to start a
# paragraph, and treating it as a heading produces sections that start with
# half their own first sentence.
HEADING_MAX_CHARS = 90

# Below this, a "section" is a fragment, so it gets folded into a neighbour.
MIN_SECTION_CHARS = 180

# Target size when falling back to length. Large enough to be worth reading,
# small enough to point Maxe at something specific.
TARGET_SECTION_CHARS = 1500

# "1." / "1.2" / "1.2.3" / "IV." / "(a)" style numbering at the start of a line.
_NUMBERED = re.compile(r"^\(?(?:\d+|[ivxlcIVXLC]+|[a-zA-Z])[.)](?:\d+[.)]?)*\s+\S")
_MULTI_NUMBERED = re.compile(r"^\d+(?:\.\d+)+\.?\s+\S")
_KEYWORD = re.compile(
    r"^(chapter|section|unit|module|lecture|topic|part|appendix|introduction"
    r"|conclusion|summary|references|objectives|overview)\b",
    re.IGNORECASE,
)
_SENTENCE_END = re.compile(r"[.!?,;]\s*$")

_BLANK_LINE = re.compile(r"\n\s*\n")
_EXTRA_BLANKS = re.compile(r"\n{3,}")

_PARA_BREAK = "\n\n"
_LINE_BREAK = "\n"


@dataclass
class Section:
    index: int
    heading: str | None
    body: str
    page_from: int | None
    page_to: int | None
    cut_by: str


def _is_heading(line: str) -> bool:
    """Heuristics, tuned to under-detect rather than over-detect.

    A false heading splits a paragraph in half and puts its first clause in
    bold, which looks broken. A missed heading just means one longer section,
    which still reads fine. So every rule here errs toward saying no.
    """
    stripped = line.strip()
    if not stripped or len(stripped) > HEADING_MAX_CHARS:
        return False
    # A line ending in sentence punctuation is prose. A colon is allowed --
    # "Objectives:" is a heading.
    if _SENTENCE_END.search(stripped):
        return False
    # Needs some letters; a lone page number or a row of dashes is not a heading.
    letters = sum(char.isalpha() for char in stripped)
    if letters < 3:
        return False
    # Mostly digits or punctuation means a table row or a page footer.
    if letters / len(stripped) < 0.4:
        return False

    if _MULTI_NUMBERED.match(stripped) or _KEYWORD.match(stripped):
        return True
    if _NUMBERED.match(stripped) and len(stripped.split()) <= 12:
        return True
    # ALL CAPS, but not a single shouted word inside prose.
    alpha = [char for char in stripped if char.isalpha()]
    if alpha and all(char.isupper() for char in alpha) and len(stripped.split()) >= 2:
        return True
    # Title Case with no terminal punctuation, kept tight to avoid eating
    # ordinary sentences that begin with a capital.
    words = stripped.split()
    if 2 <= len(words) <= 8:
        significant = [word for word in words if len(word) > 3]
        if significant and all(word[0].isupper() for word in significant):
            return True
    return False


def _fold_short(sections: list[Section]) -> list[Section]:
    """Merge any section too small to stand on its own into a neighbour.

    Backwards where there is something behind it, forwards where there is not.
    Without the forward case a title card or a running header at the top of a
    document becomes section 1, twenty characters long, sitting above the
    section it was only ever introducing.
    """
    if len(sections) < 2:
        return sections

    folded: list[Section] = []
    for section in sections:
        if folded and len(section.body) < MIN_SECTION_CHARS:
            previous = folded[-1]
            tail = (section.heading + _LINE_BREAK if section.heading else "") + section.body
            previous.body = (previous.body + _PARA_BREAK + tail).strip()
            if section.page_to is not None:
                previous.page_to = section.page_to
            continue
        folded.append(section)

    # The first section has nothing behind it, so it folds into what follows.
    while len(folded) > 1 and len(folded[0].body) < MIN_SECTION_CHARS:
        first, second = folded[0], folded[1]
        lead = (first.heading + _LINE_BREAK if first.heading else "") + first.body
        second.body = (lead + _PARA_BREAK + second.body).strip()
        if first.page_from is not None:
            second.page_from = first.page_from
        folded = folded[1:]

    return folded


def _pack_by_length(text: str, start_index: int = 0) -> list[Section]:
    """Paragraph runs of roughly TARGET_SECTION_CHARS.

    Splits only at blank lines, so a section never starts mid-sentence even
    though where it starts carries no meaning.
    """
    paragraphs = [para.strip() for para in _BLANK_LINE.split(text) if para.strip()]
    sections: list[Section] = []
    buffer: list[str] = []
    size = 0
    for para in paragraphs:
        buffer.append(para)
        size += len(para)
        if size >= TARGET_SECTION_CHARS:
            sections.append(
                Section(len(sections) + start_index, None, _PARA_BREAK.join(buffer), None, None, "length")
            )
            buffer, size = [], 0
    if buffer:
        sections.append(
            Section(len(sections) + start_index, None, _PARA_BREAK.join(buffer), None, None, "length")
        )
    return _fold_short(sections)


def _by_headings(text: str) -> list[Section] | None:
    lines = text.split(_LINE_BREAK)
    marks: list[int] = [i for i, line in enumerate(lines) if _is_heading(line)]
    if len(marks) < 2:
        return None

    # Anything before the first heading is the document's front matter and
    # keeps its text rather than being thrown away.
    blocks: list[tuple[str | None, str]] = []
    if marks[0] > 0:
        preamble = _LINE_BREAK.join(lines[: marks[0]]).strip()
        if preamble:
            blocks.append((None, preamble))

    for position, line_no in enumerate(marks):
        end = marks[position + 1] if position + 1 < len(marks) else len(lines)
        heading = lines[line_no].strip()
        body = _LINE_BREAK.join(lines[line_no + 1 : end]).strip()
        blocks.append((heading, body))

    # A heading whose body is nearly empty is usually a running header or a
    # line off a contents page, so it folds into a neighbour rather than
    # standing as a stub section.
    sections = _fold_short([
        Section(index, heading, body, None, None, "heading")
        for index, (heading, body) in enumerate(blocks)
    ])
    if len(sections) < 2:
        return None
    return sections


def _by_pages(page_texts: list[str]) -> list[Section] | None:
    pages = [
        (number, text.strip())
        for number, text in enumerate(page_texts, start=1)
        if text and text.strip()
    ]
    if len(pages) < 2:
        return None
    # A slide deck's title card is too short to be a section of its own; the
    # shared fold pushes it into the page that follows it.
    sections = _fold_short([
        Section(index, None, text, number, number, "page")
        for index, (number, text) in enumerate(pages)
    ])
    if len(sections) < 2:
        return None
    return sections


def split_into_sections(text: str, page_texts: list[str] | None = None) -> list[Section]:
    """Headings, else pages, else length. Always returns at least one section."""
    clean = _EXTRA_BLANKS.sub(_PARA_BREAK, (text or "").strip())
    if not clean:
        return []

    sections = _by_headings(clean)
    if sections is None and page_texts:
        sections = _by_pages(page_texts)
    if sections is None:
        sections = _pack_by_length(clean)
    if not sections:
        sections = [Section(0, None, clean, None, None, "length")]

    for position, section in enumerate(sections):
        section.index = position
    return sections
