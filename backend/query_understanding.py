import re
from difflib import SequenceMatcher
from typing import Any, Iterable


FILLER_WORDS = {
    "the", "a", "an", "that", "this", "thing", "thingy", "stuff", "stuffs", "topic",
    "about", "on", "we", "did", "last", "week", "course", "please", "me",
    "give", "find", "explain", "questions", "question", "practice", "from",
    "what", "i", "remember", "dont", "don't", "do", "not", "know", "exact",
    "name", "was", "it", "for", "my",
}

STOPWORDS = FILLER_WORDS | {
    "and", "or", "in", "of", "to", "with", "by", "is", "are", "be", "can",
    "you", "any", "some", "into", "as",
}

# Campus-wide synonym map — NOT CSC-specific
SYNONYM_MAP: dict[str, list[str]] = {
    # ── Management / Organizational Behaviour ─────────────────────────────────
    "human relations": [
        "Human Relations Theory", "Elton Mayo", "Hawthorne Studies",
        "employee motivation", "organizational behaviour", "management theory",
        "workplace relationships",
    ],
    "hawthorne": [
        "Hawthorne Studies", "Elton Mayo", "human relations theory",
        "employee productivity", "observer effect",
    ],
    "workers motivation": [
        "motivation theory", "Maslow hierarchy of needs",
        "Herzberg two factor theory", "employee motivation", "organizational behaviour",
    ],
    "worker motivation": [
        "motivation theory", "Maslow", "Herzberg two factor theory", "employee motivation",
    ],
    "motivation": [
        "motivation theory", "employee motivation", "Maslow hierarchy of needs",
        "Herzberg two factor theory", "intrinsic motivation", "extrinsic motivation",
    ],
    "maslow": [
        "Maslow hierarchy of needs", "motivation theory", "self-actualization",
        "physiological needs", "esteem needs",
    ],
    "herzberg": [
        "Herzberg two factor theory", "hygiene factors", "motivators",
        "job satisfaction", "motivation",
    ],
    "leadership": [
        "leadership styles", "leadership theory", "transformational leadership",
        "transactional leadership", "management", "autocratic leadership",
        "democratic leadership",
    ],
    "communication organizations": [
        "organizational communication", "communication in organizations",
        "formal communication", "informal communication", "management communication",
    ],
    "management": [
        "management theory", "classical management", "scientific management",
        "organization theory", "Taylor scientific management",
    ],
    "scientific management": [
        "Frederick Taylor", "time and motion study", "classical management",
        "Taylor scientific management", "bureaucracy",
    ],
    "organization theory": [
        "organizational theory", "classical organization theory", "bureaucracy",
        "Weber bureaucracy", "management theory",
    ],
    "bureaucracy": [
        "Max Weber", "bureaucratic theory", "Weber bureaucracy",
        "classical management", "organization theory",
    ],

    # ── Economics / Finance / Accounting ──────────────────────────────────────
    "demand supply": [
        "demand and supply", "market equilibrium", "price mechanism",
        "elasticity", "economics",
    ],
    "supply demand": [
        "demand and supply", "market equilibrium", "price mechanism", "economics",
    ],
    "demand": [
        "demand analysis", "law of demand", "demand curve", "elasticity",
        "consumer behaviour",
    ],
    "supply": [
        "supply analysis", "law of supply", "supply curve", "production",
        "market equilibrium",
    ],
    "economics": [
        "microeconomics", "macroeconomics", "demand and supply",
        "market equilibrium", "elasticity",
    ],
    "accounting": [
        "financial accounting", "cost accounting", "management accounting",
        "auditing", "bookkeeping", "balance sheet", "income statement",
    ],
    "finance": [
        "corporate finance", "financial management", "investment",
        "capital structure", "budgeting",
    ],
    "marketing": [
        "market segmentation", "marketing mix", "consumer behaviour",
        "brand management", "4Ps of marketing", "product pricing",
    ],
    "elasticity": [
        "price elasticity of demand", "income elasticity", "cross elasticity",
        "elastic demand", "inelastic demand",
    ],

    # ── Computer Science / Engineering ────────────────────────────────────────
    "algorithm": [
        "algorithms", "sorting algorithms", "searching algorithms",
        "complexity analysis", "Big O notation", "data structures",
    ],
    "data structure": [
        "data structures", "linked list", "binary tree", "graph",
        "stack", "queue", "array",
    ],
    "database": [
        "database management", "SQL", "relational database", "normalization",
        "entity relationship", "DBMS",
    ],
    "networking": [
        "computer networks", "TCP/IP", "OSI model", "protocols",
        "network topology", "routing",
    ],
    "operating system": [
        "operating systems", "process management", "memory management",
        "scheduling", "deadlock",
    ],
    "software engineering": [
        "SDLC", "software development life cycle", "software design",
        "agile methodology", "requirements analysis",
    ],
    "programming": [
        "algorithms", "data structures", "software engineering",
        "object oriented programming", "coding",
    ],

    # ── Biology / Medicine / Nursing ──────────────────────────────────────────
    "biology": [
        "cell biology", "genetics", "ecology", "evolution",
        "physiology", "microbiology",
    ],
    "genetics": [
        "DNA", "RNA", "inheritance", "Mendelian genetics",
        "gene expression", "chromosomes",
    ],
    "anatomy": [
        "human anatomy", "physiology", "body systems",
        "organs", "skeletal system", "muscular system",
    ],
    "nursing": [
        "patient care", "clinical practice", "health assessment",
        "pharmacology", "nursing theory",
    ],
    "pharmacology": [
        "drugs", "medication", "pharmacokinetics",
        "drug interactions", "dosage",
    ],
    "microbiology": [
        "bacteria", "viruses", "fungi", "infection",
        "microbial growth", "antibiotics",
    ],

    # ── Chemistry / Physics / Mathematics ────────────────────────────────────
    "chemistry": [
        "organic chemistry", "inorganic chemistry", "physical chemistry",
        "stoichiometry", "chemical reactions", "periodic table",
    ],
    "organic chemistry": [
        "hydrocarbons", "functional groups", "reactions mechanisms",
        "alkanes", "alkenes", "alcohols",
    ],
    "physics": [
        "mechanics", "thermodynamics", "electromagnetism",
        "quantum physics", "waves and optics",
    ],
    "mathematics": [
        "calculus", "algebra", "statistics", "linear algebra",
        "differential equations", "discrete mathematics",
    ],
    "statistics": [
        "probability", "hypothesis testing", "regression analysis",
        "confidence interval", "sampling", "data analysis",
    ],
    "calculus": [
        "differentiation", "integration", "limits",
        "differential equations", "series",
    ],
    "engineering": [
        "structural analysis", "fluid mechanics", "thermodynamics",
        "electrical circuits", "materials science",
    ],

    # ── Law ──────────────────────────────────────────────────────────────────
    "law": [
        "constitutional law", "commercial law", "tort law",
        "contract law", "criminal law", "legal system",
    ],
    "contract": [
        "contract law", "offer and acceptance", "consideration",
        "breach of contract", "legal remedies",
    ],
    "tort": [
        "tort law", "negligence", "liability", "damages", "nuisance",
    ],
    "criminal law": [
        "criminal offences", "actus reus", "mens rea",
        "criminal procedure", "sentencing",
    ],

    # ── Social Sciences / Psychology ─────────────────────────────────────────
    "psychology": [
        "organizational psychology", "industrial psychology",
        "human behaviour", "social psychology", "cognitive psychology",
    ],
    "sociology": [
        "social theory", "social stratification", "culture",
        "norms and values", "socialization",
    ],
    "communication": [
        "organizational communication", "communication theories",
        "interpersonal communication", "mass communication",
    ],

    # ── Education ────────────────────────────────────────────────────────────
    "curriculum": [
        "curriculum development", "curriculum design", "lesson planning",
        "educational objectives",
    ],
    "pedagogy": [
        "teaching methods", "learning theories", "educational psychology",
        "instructional design",
    ],

    # ── Common student search phrases ────────────────────────────────────────
    "observed": [
        "Hawthorne effect", "Hawthorne studies", "Elton Mayo",
        "human relations theory", "employee productivity",
    ],
    "watched": [
        "Hawthorne effect", "Hawthorne studies", "observer effect",
        "human relations theory",
    ],
}


# Exported — used by the /understand endpoint's rule-based fallback
GUIDANCE_NEEDED_MARKERS: frozenset[str] = frozenset([
    # English confusion / frustration
    "i'm lost", "im lost", "i am lost",
    "i'm confused", "im confused", "i am confused",
    "i'm blank", "im blank", "i am blank",
    "i'm frustrated", "im frustrated",
    "i'm overwhelmed", "im overwhelmed",
    "i'm thinking about it", "im thinking about it",
    "nothing is entering", "nothing entering",
    "don't know where to start", "dont know where to start",
    "don't even know where", "dont even know where",
    "don't know what to read", "dont know what to read",
    "don't know what course", "dont know what course",
    "can't remember the course", "cannot remember the course",
    "can't place it", "can't place the", "cannot place",
    "can't think of", "cannot think of",
    "don't even know", "dont even know",
    "i can't place", "i can't think",
    "i'm just tired", "im just tired",
    "no idea what", "no clue what",
    # Self-doubt / exam anxiety
    "will not understand", "won't understand",
    "i will fail", "i'm going to fail", "im going to fail",
    "i feel dumb", "i feel stupid", "i feel hopeless", "i feel useless",
    "i'm so dumb", "im so dumb", "i am so dumb",
    "i don't think i will", "i dont think i will",
    "i don't think i can", "i dont think i can",
    "i can't cope", "i cannot cope",
    "this is too much", "it is too much", "too much to understand",
    "regardless of how much", "regardless i will",
    # Nigerian Pidgin
    "no sabi wetin", "i no sabi", "no know wetin",
    "dey lost", "i dey lost",
    "dey blank", "i dey blank",
    "e no dey enter", "nothing dey enter",
    "wetin to read", "wetin i wan read",
    "i dey confused", "i dey tire",
    "e don tire me",
    "i go fail", "e don too much",
])

# Tokens that must NEVER become an academic interpreted_topic alone or combined.
# Used as a post-processing guard: if interpreted_topic consists only of these
# tokens, it is discarded and intent is reclassified as "confirmation".
CONVERSATIONAL_NONTOPICS: frozenset[str] = frozenset([
    "sure", "okay", "ok", "yes", "yeah", "yep", "no", "nah", "nope", "maybe",
    "really", "meant", "lost", "confused", "frustrated", "tired", "overwhelmed",
    "hmm", "hm", "alright", "thanks", "meh", "mehh", "mehhh", "ugh", "argh",
    "don", "what", "why", "how", "help", "blank", "stuck", "bored",
    "worried", "scared", "nervous", "anxious", "stressed", "drained",
    "feel", "feeling", "think", "know", "just", "still", "going", "done",
    "been", "want", "need", "like", "get", "am", "right", "said",
    # Self-doubt / exam anxiety words
    "understand", "regardless", "will", "fail", "pass", "dumb", "stupid",
    "behind", "cope", "hopeless", "useless", "worthless",
])

# Conversational filler — must NEVER be interpreted as academic topics.
# These return intent="confirmation" with no interpreted_topic.
CONVERSATIONAL_FILLER: frozenset[str] = frozenset([
    "sure", "are you sure", "are u sure", "you sure", "u sure",
    "really", "for real",
    "okay", "ok", "yes", "yeah", "yep", "no", "nah",
    "hmm", "hm",
    "alright", "alright then",
    "what do you mean", "what does that mean", "what do u mean",
    "then what", "and then", "what next", "what happens next",
    "how", "why",
    "explain that", "explain more",
    "so what should i do", "so what do i do",
    "okay but how", "ok but how", "yes but how", "but how",
    "how do i do that", "how do i start",
    "what should i do", "what can i do",
    "is that right", "is this right", "are you certain",
])


INTENT_PATTERNS = {
    "practice": re.compile(
        r"\b(practice|quiz|test me|questions for practice|generate|exercise|drill)\b", re.I
    ),
    "find_past_questions": re.compile(
        r"\b(past question|past questions|exam question|previous question|questions about|came out|what came out|came up|show me questions)\b",
        re.I,
    ),
    "upload_help": re.compile(
        r"\b(upload|what should i upload|materials? to upload)\b", re.I
    ),
    "explain": re.compile(
        r"\b(explain|teach|summari[sz]e|what is|define|meaning of|understand|how does)\b", re.I
    ),
    "campus_social": re.compile(
        r"\b(reading room|study group|study session|who is (studying|reading)|join (people|others|a group)|find a group|is there a (group|room)|others studying|who else is)\b",
        re.I,
    ),
}

# Single-word / short-phrase greetings — only match when the WHOLE message is a greeting
GREETING_WORDS: frozenset[str] = frozenset([
    "hi", "hey", "hello", "yo", "sup", "hiya", "morning", "evening",
    "good morning", "good afternoon", "good evening", "howdy",
])

# Patterns signalling "I don't know what to ask"
UNSURE_PHRASES: list[re.Pattern[str]] = [
    re.compile(r"^(i\s+)?(do\s+not|don'?t|dont)\s+(know|have\s+an?\s+idea)(\s+yet)?[!.,\s]*$", re.I),
    re.compile(r"^(not\s+sure|nothing\s+yet|no\s+idea)[!.,\s]*$", re.I),
    re.compile(r"^i'?m\s+(confused|thinking|not\s+sure)[!.,\s]*$", re.I),
    re.compile(r"^(what\s+topic|what\s+should\s+i\s+(study|read|revise))\??[!.,\s]*$", re.I),
    re.compile(r"^no\s+topic\s+yet[!.,\s]*$", re.I),
    re.compile(r"^i'?m\s+not\s+sure\s+what\s+to\s+ask[!.,\s]*$", re.I),
]

# Lecturer-context query detection
LECTURER_QUERY_PATTERN = re.compile(
    r"what\s+(?:did|does)\s+\w+\s+(?:teach|cover|explain|ask|focus\s+on|like\s+to\s+ask)"
    r"|how\s+does\s+(?:she|he|they|the\s+lecturer|the\s+professor)\s+(?:set|ask|make|write|structure)"
    r"|how\s+(?:does|did)\s+\w+\s+(?:set|ask)\s+(?:the|her|his)?\s*question"
    r"|what\s+(?:topic|topics|course)\s+did\s+\w+\s+(?:teach|cover|take)"
    r"|give\s+me\s+questions\s+from\s+(?:what|the\s+one)\s+\w+\s+(?:explained|taught|covered)"
    r"|(?:madam|sir|dr\.?|prof\.?|professor|lecturer|mr\.?|mrs\.?|miss)\s+\w+",
    re.I,
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOPWORDS and len(t) > 2]


def _dedupe(items: Iterable[str], limit: int = 12) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        value = str(item).strip()
        key = value.lower()
        if not value or key in seen:
            continue
        seen.add(key)
        out.append(value)
        if len(out) >= limit:
            break
    return out


def _is_greeting(query: str) -> bool:
    cleaned = re.sub(r"[!.,?]+$", "", _normalize(query)).strip()
    return cleaned in GREETING_WORDS


def _is_conversational_filler(query: str) -> bool:
    """True for short conversational phrases that are NOT academic topics.
    These must never be interpreted as study queries or produce an interpreted_topic.
    """
    cleaned = re.sub(r"[!.,?…\s]+$", "", _normalize(query)).strip()
    return cleaned in CONVERSATIONAL_FILLER


def _is_emotional_expression(query: str) -> bool:
    """Detect emotional/confused/frustrated expressions not covered by exact markers.
    Catches: expressive sounds (mehhh), intensified emotions (so lost), Pidgin variants,
    and self-doubt / exam anxiety expressions.
    """
    lower = query.lower()
    # Expressive frustration sounds
    if re.search(r"\bmeh{2,}\b|\bugh+\b|\bargh+\b|\bsigh{2,}\b", lower):
        return True
    # "so/very/really + emotion" intensifiers
    if re.search(
        r"\b(so|very|really|extremely|just)\s+(lost|confused|blank|frustrated|overwhelmed|tired|drained)\b",
        lower,
    ):
        return True
    # "I am / I'm + emotion"
    if re.search(
        r"\b(i'?m|i\s+am)\s+(so\s+)?(lost|confused|blank|frustrated|overwhelmed|tired|drained)\b",
        lower,
    ):
        return True
    # "don't know where/what" confusion
    if re.search(
        r"\b(don'?t|do not|cant|cannot|can'?t)\s+know\s+(where|what\s+course|what\s+topic|which)\b",
        lower,
    ):
        return True
    # Self-doubt / exam anxiety
    if re.search(r"\b(will\s+not|won'?t)\s+(understand|pass|cope|learn)\b", lower):
        return True
    if re.search(r"\bi\s+feel(\s+like)?\s+i\s+(will\s+not|won'?t|can'?t|cannot)\b", lower):
        return True
    if re.search(r"\bi\s+(don'?t|do\s+not)\s+think\s+i\s+(will|can|could)\b", lower):
        return True
    if re.search(r"\b(i\s+will|i'?m\s+going\s+to|i'll)\s+(fail|never\s+(pass|understand|cope))\b", lower):
        return True
    if re.search(r"\b(i'?m|i\s+am|i\s+feel)\s+(so\s+)?(dumb|stupid|hopeless|useless|worthless)\b", lower):
        return True
    if re.search(r"\b(this|it)\s+is\s+too\s+(much|hard|difficult|confusing)\b", lower):
        return True
    if re.search(r"\b(i\s+)?(can'?t|cannot)\s+cope\b", lower):
        return True
    if re.search(r"\b(will\s+not|won'?t)\s+\w+\s+regardless\b", lower):
        return True
    return False


def _is_unsure(query: str) -> bool:
    return any(p.search(query.strip()) for p in UNSURE_PHRASES)


def _needs_guidance(query: str) -> bool:
    """True when the student is confused/frustrated/overwhelmed — guidance_needed intent."""
    lower = query.lower()
    return any(marker in lower for marker in GUIDANCE_NEEDED_MARKERS)


def _extract_lecturer_references(raw_query: str) -> list[str]:
    """Extract potential lecturer names from the query."""
    lecturers: list[str] = []
    patterns = [
        r"what\s+(?:did|does)\s+([A-Z][a-z]+)\s+(?:teach|cover|explain|ask)",
        r"how\s+does\s+([A-Z][a-z]+)\s+(?:set|ask|make|write)",
        r"(?:madam|sir|dr\.?|prof\.?|professor|mr\.?|mrs\.?|miss)\s+([A-Za-z]+)",
        r"([A-Z][a-z]{2,})'s\s+(?:class|lecture|notes?|course|question|style|material)",
        r"from\s+(?:what|the\s+one)\s+([A-Z][a-z]+)\s+(?:explained|taught|covered)",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, raw_query):
            if match.lastindex:
                lecturers.append(match.group(1))
    return _dedupe(lecturers)


def _intent(query: str, meaningful_tokens: list[str]) -> str:
    if _is_greeting(query):
        return "greeting"
    if _is_conversational_filler(query):
        return "confirmation"
    if _is_unsure(query) or _needs_guidance(query) or _is_emotional_expression(query):
        return "guidance_needed"
    if LECTURER_QUERY_PATTERN.search(query):
        return "lecturer_pattern"
    for intent_name, pattern in INTENT_PATTERNS.items():
        if pattern.search(query):
            return intent_name
    if len(meaningful_tokens) < 1:
        return "unclear"
    return "general_search"


def _metadata_strings(available_courses: Any) -> list[str]:
    if not available_courses:
        return []
    strings: list[str] = []
    for item in available_courses:
        if isinstance(item, str):
            strings.append(item)
            continue
        if isinstance(item, dict):
            for key in ("code", "name", "title", "topic", "content", "description"):
                value = item.get(key)
                if value:
                    strings.append(str(value))
            topics = item.get("topics_covered")
            if isinstance(topics, list):
                strings.extend(str(t) for t in topics if t)
    return _dedupe(strings, limit=80)


def _metadata_matches(query: str, metadata: list[str]) -> tuple[list[str], list[str]]:
    tokens = set(_tokens(query))
    if not tokens:
        return [], []

    topics: list[str] = []
    courses: list[str] = []
    query_norm = _normalize(query)
    for value in metadata:
        value_norm = _normalize(value)
        value_tokens = set(_tokens(value_norm))
        ratio = SequenceMatcher(None, query_norm, value_norm).ratio()
        overlap = len(tokens & value_tokens)
        if value_norm in query_norm or query_norm in value_norm or overlap >= 1 or ratio >= 0.58:
            if re.match(r"^[a-z]{2,4}\s*\d{2,4}$", value_norm, re.I):
                courses.append(value)
            elif len(value.split()) <= 7:
                topics.append(value)
    return _dedupe(topics, limit=8), _dedupe(courses, limit=5)


def _synonym_matches(query: str) -> tuple[str | None, list[str]]:
    query_norm = _normalize(query)
    compact = " ".join(_tokens(query_norm))
    matches: list[str] = []
    interpreted: str | None = None
    for trigger, terms in SYNONYM_MAP.items():
        trigger_tokens = set(trigger.split())
        query_tokens = set(compact.split())
        if trigger in query_norm or trigger in compact or trigger_tokens <= query_tokens:
            matches.extend(terms)
            interpreted = terms[0]
        elif trigger_tokens and len(trigger_tokens & query_tokens) >= min(2, len(trigger_tokens)):
            matches.extend(terms)
            interpreted = interpreted or terms[0]
    return interpreted, _dedupe(matches, limit=10)


# ── Main function ─────────────────────────────────────────────────────────────


def understand_query(raw_query: str, available_courses: Any = None) -> dict:
    original = raw_query or ""
    cleaned = _normalize(original)
    meaningful = _tokens(cleaned)
    intent = _intent(cleaned, meaningful)

    possible_lecturers = _extract_lecturer_references(original)

    # Non-academic intents have no interpreted_topic — skip synonym/metadata work entirely
    if intent in ("greeting", "guidance_needed", "confirmation"):
        return {
            "original_query": original,
            "cleaned_query": cleaned,
            "interpreted_topic": None,
            "related_terms": [],
            "possible_courses": [],
            "possible_lecturers": possible_lecturers,
            "intent": intent,
            "confidence": 1.0,
            "needs_clarification": False,
            "clarifying_question": None,
        }

    metadata = _metadata_strings(available_courses)
    metadata_topics, possible_courses = _metadata_matches(cleaned, metadata)
    synonym_topic, synonym_terms = _synonym_matches(cleaned)

    interpreted_topic = synonym_topic or (metadata_topics[0] if metadata_topics else None)
    if not interpreted_topic and meaningful:
        interpreted_topic = " ".join(meaningful[:5])

    # Guard: never return a topic that consists only of conversational non-topic words.
    # This prevents "lost", "don lost mehhh", "meant", "sure" from becoming search topics.
    if interpreted_topic:
        topic_tokens = set(re.findall(r"[a-z]+", interpreted_topic.lower()))
        if topic_tokens and topic_tokens.issubset(CONVERSATIONAL_NONTOPICS):
            interpreted_topic = None

    related_terms = _dedupe([
        *(synonym_terms or []),
        *metadata_topics,
        *([" ".join(meaningful)] if meaningful else []),
        *meaningful,
    ], limit=12)

    vague_markers = {
        "thing", "thingy", "stuff", "stuffs", "that", "what",
        "dont", "don't", "remember", "something",
    }
    is_vague = any(marker in cleaned for marker in vague_markers) or len(meaningful) <= 1

    confidence = 0.35
    if synonym_terms:
        confidence += 0.35
    if metadata_topics:
        confidence += 0.25
    if len(meaningful) >= 2:
        confidence += 0.15
    if intent in {"explain", "find_past_questions", "practice"}:
        confidence += 0.05
    if is_vague and not (synonym_terms or metadata_topics):
        confidence -= 0.2
    confidence = max(0.05, min(0.95, round(confidence, 2)))

    needs_clarification = confidence < 0.35 or intent == "unclear"
    clarifying_question = None
    if needs_clarification:
        clarifying_question = (
            "I'm not fully sure what you mean. "
            "Can you add the course, a topic from class, "
            "or one phrase you remember from the material?"
        )

    return {
        "original_query": original,
        "cleaned_query": cleaned,
        "interpreted_topic": interpreted_topic,
        "related_terms": related_terms,
        "possible_courses": possible_courses,
        "possible_lecturers": possible_lecturers,
        "intent": intent,
        "confidence": confidence,
        "needs_clarification": needs_clarification,
        "clarifying_question": clarifying_question,
    }


def public_understanding(understanding: dict) -> dict:
    return {
        "interpreted_topic": understanding.get("interpreted_topic"),
        "related_terms": understanding.get("related_terms") or [],
        "possible_courses": understanding.get("possible_courses") or [],
        "possible_lecturers": understanding.get("possible_lecturers") or [],
        "intent": understanding.get("intent") or "general_search",
        "confidence": understanding.get("confidence") or 0,
        "needs_clarification": bool(understanding.get("needs_clarification")),
        "clarifying_question": understanding.get("clarifying_question"),
    }


def expanded_search_terms(understanding: dict, limit: int = 10) -> list[str]:
    return _dedupe([
        understanding.get("interpreted_topic") or "",
        *(understanding.get("related_terms") or []),
        understanding.get("cleaned_query") or "",
        understanding.get("original_query") or "",
    ], limit=limit)
