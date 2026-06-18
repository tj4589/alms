import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, MsgType, ScreenType, User } from '../types';
import { apiGet, apiPost } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type AskResponse = {
  answer: string;
  sources: string[];
  past_question_sources: string[];
  lecture_note_sources: string[];
  no_past_questions_found: boolean;
  no_lecture_notes_found: boolean;
  understanding?: QueryUnderstanding | null;
};

type QueryUnderstanding = {
  interpreted_topic: string | null;
  related_terms: string[];
  possible_courses: string[];
  possible_people: string[];
  person_name?: string | null;
  course_code?: string | null;
  topic?: string | null;
  needs_course?: boolean;
  needs_person?: boolean;
  intent: string;
  confidence: number;
  needs_clarification: boolean;
  clarifying_question: string | null;
};

type IntentResult = {
  intent: string;
  student_state: string;
  should_call_rag: boolean;
  should_search: boolean;
  should_ask_clarifying_question: boolean;
  interpreted_topic: string | null;
  related_terms: string[];
  possible_course: string | null;
  possible_person: string | null;
  person_name?: string | null;
  course_code?: string | null;
  topic?: string | null;
  needs_course?: boolean;
  needs_person?: boolean;
  confidence: number;
  response_strategy: string;
  clarifying_question: string | null;
};

type Course = {
  id: number;
  code: string;
  name: string;
};

type LastRagContext = {
  lastCourseId?: number;
  lastCourseCode?: string;
  lastDocumentTitle?: string;
  lastTopic?: string;
  lastSources: string[];
  lastQuestion: string;
};

// ── Pre-gate types ────────────────────────────────────────────────────────────

// Message function — what the user is TRYING TO DO, not what they typed
type ConversationFunction =
  | 'greeting'
  | 'self_doubt_or_anxiety'     // I feel dumb, I will fail, this is too much
  | 'emotional_confusion'       // lost, confused, frustrated, blank, overwhelmed
  | 'correction_or_complaint'   // "not what I meant", "you misunderstood"
  | 'confirmation_or_followup'  // "are u sure?", "how?", "then what?"
  | 'acknowledgement'           // ok, yes, alright, thanks, hmm
  | 'academic_or_search_intent';

type ConversationPrecheck = {
  intent: ConversationFunction;
  shouldBypassAcademicSearch: boolean;
  confidence: number;
  studentState: 'neutral' | 'confused' | 'frustrated' | 'overwhelmed' | 'anxious';
};

// Tracks what the assistant last asked and whether it's expecting user to fill a slot
type ConversationState = {
  pendingSlot: 'course_or_topic' | 'person_clue' | 'exam' | 'material_clue' | null;
  lastAssistantMsgType: MsgType | null;
  awaitingUserDetail: boolean;
};

type DecisionIntent =
  | 'greeting'
  | 'emotional_confusion'
  | 'self_doubt'
  | 'confirmation_or_followup'
  | 'pending_slot_reply'
  | 'correction_or_complaint'
  | 'academic_search'
  | 'academic_explanation'
  | 'person_pattern'
  | 'practice_request'
  | 'acknowledgement'
  | 'upload_help'
  | 'campus_social'
  | 'unclear';

type DecisionStudentState = 'neutral' | 'confused' | 'anxious' | 'overwhelmed' | 'focused';
type DecisionAction = 'local_reply' | 'ask_for_detail' | 'search' | 'rag' | 'practice' | 'clarify';

type AssistantDecision = {
  intent: DecisionIntent;
  student_state: DecisionStudentState;
  action: DecisionAction;
  should_search: boolean;
  should_call_rag: boolean;
  should_show_understood_as: boolean;
  interpreted_topic: string | null;
  person_name?: string | null;
  course_code?: string | null;
  needs_course?: boolean;
  needs_person?: boolean;
  related_terms: string[];
  response_goal: string;
};

type NaturalReplyContext = {
  user: User | null;
  userMessage: string;
  messages: ChatMessage[];
  pendingSlot: ConversationState['pendingSlot'];
  previousAssistant?: ChatMessage;
  currentPage: 'assistant';
};

// ── Thinking phases ───────────────────────────────────────────────────────────

type ThinkingPhase = 'idle' | 'understanding' | 'searching' | 'context' | 'support' | 'empathy';

const PHASE_TEXT: Record<Exclude<ThinkingPhase, 'idle'>, string> = {
  understanding: 'Understanding what you mean...',
  searching: 'Checking uploaded materials...',
  context: 'Thinking through the best next step...',
  support: "Understanding where you're stuck...",
  empathy: 'Checking the context...',
};

// ── Pre-gate constants ────────────────────────────────────────────────────────

// Words that must NEVER become an academic interpreted_topic alone or combined.
// Used by: classifyConversationFunction (Layer 3/5) + buildInterpretationMsg guard.
const CONVERSATIONAL_TOKENS = new Set([
  // Emotional states
  'lost', 'confused', 'frustrated', 'tired', 'overwhelmed', 'blank', 'stuck',
  'bored', 'worried', 'scared', 'nervous', 'anxious', 'stressed', 'drained',
  // Self-doubt / exam anxiety words
  'understand', 'regardless', 'will', 'fail', 'pass', 'dumb', 'stupid',
  'behind', 'cope', 'hopeless', 'useless', 'worthless',
  // Acknowledgements / filler
  'sure', 'okay', 'ok', 'yes', 'yeah', 'yep', 'no', 'nah', 'nope', 'maybe',
  'hmm', 'hm', 'ohh', 'oh', 'ah', 'ugh', 'argh', 'meh', 'mehh', 'mehhh',
  'alright', 'thanks', 'noted', 'fine', 'cool', 'understood', 'got',
  'really', 'exactly', 'meant', 'said', 'asked', 'right',
  // Common verbs / short words (non-academic when standalone)
  'don', 'what', 'why', 'how', 'help', 'know', 'think', 'feel', 'like',
  'just', 'still', 'going', 'done', 'been', 'want', 'need', 'get',
]);

// ── Pre-gate: classifyConversationFunction ────────────────────────────────────
// Runs BEFORE /understand, /search, and /rag/ask.
// Returns shouldBypassAcademicSearch=true for all non-academic messages.
// Academic APIs are only called when shouldBypassAcademicSearch===false.

function classifyConversationFunction(
  text: string,
): ConversationPrecheck {
  const norm = text.trim().toLowerCase().replace(/\s+/g, ' ');
  // stripped: for exact set lookups — removes all punctuation
  const stripped = norm.replace(/[!.,?…;:'"]+/g, ' ').replace(/\s+/g, ' ').trim();

  const bypass = (
    intent: ConversationFunction,
    confidence: number,
    studentState: ConversationPrecheck['studentState'] = 'neutral',
  ): ConversationPrecheck => ({ intent, shouldBypassAcademicSearch: true, confidence, studentState });

  const academic = (confidence = 0.72): ConversationPrecheck => ({
    intent: 'academic_or_search_intent',
    shouldBypassAcademicSearch: false,
    confidence,
    studentState: 'neutral',
  });

  // ── Layer 1: Exact phrase sets (highest confidence, no ambiguity) ─────────
  // IMPORTANT: FOLLOWUP_SET checked BEFORE ACK_SET so "okay are you sure?"
  // is caught as confirmation_or_followup, not acknowledgement.

  const GREETING_SET = new Set([
    'hi', 'hey', 'hello', 'yo', 'sup', 'hiya',
    'good morning', 'good afternoon', 'good evening',
  ]);
  if (GREETING_SET.has(stripped)) return bypass('greeting', 1.0);

  const READINESS_FOLLOWUP_RE =
    /\b(are\s+(you|u)\s+sure|you\s+sure|u\s+sure|will\s+i|can\s+i)\b.*\b(ready|prepared|pass|make\s+it|understand|cope)\b/i;
  if (READINESS_FOLLOWUP_RE.test(stripped)) {
    return bypass('confirmation_or_followup', 0.97, 'anxious');
  }

  const FOLLOWUP_SET = new Set([
    'are u sure', 'are you sure', 'you sure', 'u sure',
    'really', 'for real',
    'how', 'why',
    'explain', 'explain that', 'explain more',
    'what do you mean', 'what does that mean', 'what do u mean',
    'then what', 'what next', 'and then', 'what happens next',
    'okay but how', 'ok but how', 'yes but how', 'but how',
    'alright then', 'so what should i do', 'so what do i do',
    'how do i do that', 'how do i start',
    'what should i do', 'what can i do',
    'is that right', 'is this right', 'are you certain',
  ]);
  if (FOLLOWUP_SET.has(stripped)) return bypass('confirmation_or_followup', 1.0);

  // Substring check: catches "okay are you sure?", "hmm are you certain", etc.
  // Only multi-word phrases to avoid false positives from single words like "how".
  const multiWordFollowups = [...FOLLOWUP_SET].filter(p => p.includes(' '));
  if (multiWordFollowups.some(p => stripped.includes(p))) {
    return bypass('confirmation_or_followup', 0.92);
  }

  const ACK_SET = new Set([
    'ok', 'okay', 'yes', 'yeah', 'yep', 'no', 'nah', 'nope',
    'sure', 'alright', 'thanks', 'thank you', 'noted', 'got it', 'fine', 'cool',
    'understood', 'i see', 'hmm', 'hm', 'ohh', 'oh', 'ah', 'nice', 'great',
  ]);
  if (ACK_SET.has(stripped)) return bypass('acknowledgement', 1.0);

  // ── Layer 2a: Correction / complaint ─────────────────────────────────────

  const CORRECTION_PATTERNS = [
    /\b(not what i meant|not what i said|not what i asked|didn'?t mean that|did not mean that)\b/i,
    /\b(you misunderstood|misunderstood me|that'?s wrong|that is wrong)\b/i,
    /\b(that'?s not (it|right|correct|what)|not (that|this one))\b/i,
    /\b(why are you searching|you'?re not getting|not getting me)\b/i,
    /\b(reset|start over|i said no|you got it wrong)\b/i,
    // "what that's not..." / "no that's not..."
    /^(what|no)[,.\s]+that'?s?\s+not\b/i,
    // "that is not what i..."
    /\bthat\s+is\s+not\s+what\s+i\b/i,
  ];
  if (CORRECTION_PATTERNS.some(p => p.test(norm))) {
    return bypass('correction_or_complaint', 0.95, 'frustrated');
  }

  // ── Layer 2b: Emotional confusion / frustration ───────────────────────────

  const CONFUSION_PATTERNS = [
    // "so/very/really lost/confused/blank/..." — intensified emotion
    /\b(so|very|really|just)\s+(lost|confused|blank|stuck|overwhelmed|frustrated|tired|drained)\b/i,
    // "I'm / I am" + emotion
    /\b(i'?m|i\s+am)\s+(so\s+)?(lost|confused|blank|stuck|overwhelmed|frustrated|tired|drained)\b/i,
    // "don't know where/what to..."
    /\b(don'?t|do not|cant|cannot|can'?t)\s+know\s+(where|what|which|how|the\s+topic|what\s+course)\b/i,
    // Standalone "I don't know" / "don't know" (whole message)
    /^(i\s+)?(don'?t|dont|do not)\s+(know|have\s+(an?\s+)?idea)(\s+yet)?[!.,\s]*$/i,
    // No idea / no clue
    /\b(no idea|have no idea|no clue|not sure what|not sure where)\b/i,
    // Can't remember / can't place
    /\b(can'?t|cannot)\s+(remember|place|think of|find)\b/i,
    // Nothing entering my head
    /\b(nothing\s+(is\s+)?entering|e no dey enter)\b/i,
    // Expressive frustration sounds (meh, ugh, argh)
    /\bmeh{2,}\b/i,
    /\bugh+\b/i,
    /\bargh+\b/i,
    // Nigerian Pidgin
    /\b(no sabi|i no sabi|dey lost|dey blank|dey confused|nothing dey enter|wetin to read|wetin i wan read|i dey tire)\b/i,
  ];
  if (CONFUSION_PATTERNS.some(p => p.test(norm))) {
    const isFrustrated = /\b(frustrated|ugh+|argh+|meh{2,}|tired|drained|e don tire|i dey tire)\b/i.test(norm);
    const isOverwhelmed = /\b(overwhelmed|so lost|so confused|everything at once|all at once)\b/i.test(norm);
    const studentState = isOverwhelmed ? 'overwhelmed' : isFrustrated ? 'frustrated' : 'confused';
    return bypass('emotional_confusion', 0.93, studentState);
  }

  // ── Layer 2c: Self-doubt / exam anxiety ───────────────────────────────────
  // Catches: "I feel I will not understand regardless", "I will fail",
  // "I feel dumb", "this is too much", etc.
  // Must fire BEFORE Layer 4 (which has "understand" in ACADEMIC_RE).

  const SELF_DOUBT_PATTERNS = [
    // "will not understand/pass/cope" — the core failing case
    /\b(will\s+not|won'?t)\s+(understand|pass|cope|learn|get\s+(it|this))\b/i,
    // "I feel (like) I will/can't/won't..."
    /\bi\s+feel(\s+like)?\s+i\s+(will\s+not|won'?t|can'?t|cannot|could\s+not)\b/i,
    // "I don't think I will/can..."
    /\bi\s+(don'?t|do\s+not)\s+think\s+i\s+(will|can|could)\b/i,
    // "I will fail" / "I'm going to fail" / "I'll never pass"
    /\b(i\s+will|i'?m\s+going\s+to|i'll)\s+(fail|never\s+(pass|understand|cope|learn))\b/i,
    // "I feel/am dumb/stupid/hopeless/useless/worthless"
    /\b(i'?m|i\s+am|i\s+feel)\s+(so\s+)?(dumb|stupid|hopeless|useless|worthless|a\s+failure)\b/i,
    // "this is too much/hard/confusing/difficult"
    /\b(this|it)\s+is\s+too\s+(much|hard|difficult|confusing)\b/i,
    // "I can't cope"
    /\b(i\s+)?(can'?t|cannot)\s+cope\b/i,
    // "will not X regardless" / "won't X regardless"
    /\b(will\s+not|won'?t)\s+\w+\s+regardless\b/i,
    // "I feel like I will never..."
    /\bi\s+feel\s+like\s+i\s+(will\s+never|won'?t\s+(ever\s+)?|can'?t\s+(ever\s+)?)\b/i,
    // "too much to read/understand/cover"
    /\btoo\s+much\s+to\s+(read|understand|cover|study|revise)\b/i,
    // Nigerian Pidgin self-doubt
    /\b(i\s+go\s+fail|e\s+don\s+too\s+much|too\s+plenty\s+to\s+(read|understand))\b/i,
  ];
  if (SELF_DOUBT_PATTERNS.some(p => p.test(norm))) {
    return bypass('self_doubt_or_anxiety', 0.95, 'anxious');
  }

  // ── Layer 3: Content-word analysis ───────────────────────────────────────
  // If ALL non-stopword content words are purely conversational → bypass.

  const STOPWORDS = new Set([
    'i', 'am', 'is', 'are', 'the', 'a', 'an', 'and', 'or', 'in', 'of', 'to',
    'with', 'be', 'do', 'my', 'me', 'we', 'it', 'so', 'for', 'on', 'at',
    'this', 'that', 'these', 'those', 'not', 'just', 'very', 'quite', 'about',
    'from', 'by', 'as', 'if', 'but', 'then', 'than', 'into', 'out', 'up', 'down',
  ]);
  const words = stripped.split(/\s+/).filter(w => w.length > 1);
  const contentWords = words.filter(w => !STOPWORDS.has(w));
  const allConversational =
    contentWords.length > 0 && contentWords.every(w => CONVERSATIONAL_TOKENS.has(w));
  if (allConversational) return bypass('acknowledgement', 0.88);

  // ── Layer 4: Academic signal detection ───────────────────────────────────

  const ACADEMIC_RE =
    /\b(explain|find|search|show me|give me|what is|what are|what did|what does|what topic|how does|how do|when did|who is|who was|define|summarize|summarise|tell me about|past question|lecture note|course outline|practice|quiz|test me|drill me|generate|theory|concept|model|principle|law|method|analysis|system|structure|function|understand)\b/i;
  const COURSE_CODE_RE = /\b[a-z]{2,4}\s*\d{3,4}\b/i;
  const PERSON_RE = /\b(professor|dr\.?|madam|sir|prof\.?|mr\.?|mrs\.?)\s+\w+/i;

  if (ACADEMIC_RE.test(norm) || COURSE_CODE_RE.test(norm) || PERSON_RE.test(norm)) {
    return academic(0.83);
  }

  // ── Layer 5: Meaningful-word richness ────────────────────────────────────
  // If the message has no meaningful non-conversational words → bypass.

  const meaningfulWords = contentWords.filter(
    w => w.length >= 4 && !CONVERSATIONAL_TOKENS.has(w),
  );
  if (meaningfulWords.length === 0) return bypass('acknowledgement', 0.74);

  // Default: pass through to academic pipeline
  return academic(0.65);
}

// ── Pending slot reply classifier ─────────────────────────────────────────────
// Runs when awaitingUserDetail=true and user sends a reply.
// Returns whether they gave a topic/detail, just confirmed, or declined.

function classifyPendingSlotReply(
  input: string,
): 'affirmed_but_no_detail' | 'declined_or_unsure' | 'provided_detail' {
  const norm = input.trim().toLowerCase().replace(/\s+/g, ' ');

  // Affirmations that confirm they have a topic but haven't given it yet
  const AFFIRM_NO_DETAIL = [
    /^(yes|yeah|yep|yup|sure|okay|ok|alright)(\s+i\s+(have|got)\s+one(\s+in\s+mind)?)?\s*$/i,
    /^yes\s+i\s+have\s+one(\s+in\s+mind)?\s*$/i,
    /^i\s+have\s+one(\s+in\s+mind)?\s*$/i,
    /^(maybe|kind\s+of|i\s+think\s+so|sort\s+of|perhaps|more\s+or\s+less)\s*$/i,
    /^i\s+think\s+i\s+do\s*$/i,
    /^(yes|yeah|sure|okay)\s+(please|of\s+course|absolutely|definitely)\s*$/i,
    /^(yes|yeah)\s*[,!.]?\s*$/i,
  ];
  if (AFFIRM_NO_DETAIL.some(p => p.test(norm))) return 'affirmed_but_no_detail';

  // Declining or expressing uncertainty (no detail forthcoming)
  const DECLINE = [
    /^(no|nah|not\s+yet|not\s+really|none\s+(yet|right\s+now)|not\s+at\s+all)\s*$/i,
    /^(not\s+sure|i'm\s+not\s+sure|i\s+don'?t\s+know(\s+yet)?)\s*$/i,
    /^i\s+(don'?t|do\s+not)\s+(have\s+one|have\s+any)(\s+yet)?\s*$/i,
    /^(nothing\s+(yet|comes\s+to\s+mind|specific))\s*$/i,
  ];
  if (DECLINE.some(p => p.test(norm))) return 'declined_or_unsure';

  // Everything else is treated as actual detail → pass to academic pipeline
  return 'provided_detail';
}

// ── Conversation reply builder (pre-gate responses) ───────────────────────────

function buildFollowUpReply(question: string, lastAssistantMsg: ChatMessage | undefined): string {
  const norm = question.trim().toLowerCase().replace(/[!.,?…]+$/, '').trim().replace(/\s+/g, ' ');

  // Reassurance / exam-readiness question — needs empathy, not topic prompt
  const isReassuranceQ =
    /\bwill\s+i\s+be\s+(ready|okay?|fine|prepared|able)\b/i.test(norm) ||
    /\bcan\s+i\s+(make\s+it|do\s+(this|it)|pass|be\s+ready)\b/i.test(norm) ||
    /\bwill\s+i\s+(make\s+it|pass|succeed|understand(\s+(it|this))?)\b/i.test(norm);
  if (isReassuranceQ) {
    return [
      "I can't promise it will be effortless, but you can become more ready by starting small.",
      '',
      "Do you have a course, topic, past question, or exam in mind?",
    ].join('\n');
  }

  const prevType = lastAssistantMsg?.msgType;
  const prevContent = (lastAssistantMsg?.content ?? '').toLowerCase();

  const wasGuidance =
    prevType === 'guidance' ||
    prevType === 'unsure_support' ||
    prevContent.includes("it's okay") ||
    prevContent.includes("no problem") ||
    prevContent.includes('start with') ||
    prevContent.includes('you do not need to know') ||
    prevContent.includes('feeling overwhelmed') ||
    prevContent.includes("you're not searching");

  const isConfirmQ = /^(are\s+[uy](ou)?\s+sure|you\s+sure|u\s+sure|really|for\s+real|is\s+that\s+right|is\s+this\s+right|are\s+you\s+certain)$/.test(norm);
  const isHowQ = /^(how|okay\s+but\s+how|ok\s+but\s+how|yes\s+but\s+how|but\s+how|how\s+do\s+i(\s+start)?)/.test(norm);
  const isWhyQ = /^why/.test(norm);
  const isWhatNextQ = /^(what\s+next|then\s+what|and\s+then|so\s+what|what\s+should\s+i\s+do|what\s+can\s+i\s+do)/.test(norm);
  const isExplainQ = /^explain/.test(norm);

  if (isConfirmQ && wasGuidance) {
    return [
      "Yes. You do not need the exact course or topic first.",
      '',
      "A vague clue is enough — a phrase from class, exam, course code, material title, or topic idea. I'll interpret it and guide you to the right materials.",
    ].join('\n');
  }

  if (isConfirmQ) {
    return "Yes, that's right. Is there a specific course, topic, or exam you want to focus on?";
  }

  if (isHowQ && wasGuidance) {
    return [
      "Start with the easiest clue you have:",
      "- A phrase or material title you remember",
      '- A course code',
      '- A topic phrase from class',
      '- An exam date',
      '- Even something vague like "the human relations thingy"',
      '',
      "I'll try to interpret it and guide you to the right materials.",
    ].join('\n');
  }

  if (isHowQ) {
    return "What specifically would you like help with? I can explain a topic, find past questions, or generate practice — just tell me the course or topic.";
  }

  if (isWhyQ) {
    return "ExamMind works with uploaded materials — lecture notes, past questions, course outlines — so it can give you grounded answers even when you describe a topic vaguely. The more materials uploaded, the better it can help.";
  }

  if (isWhatNextQ && wasGuidance) {
    return [
      "You can start by typing any course code, topic, material title, or exam date.",
      '',
      'Even a vague description works — try something like "the motivation topic" or "what Iheanetu taught".',
    ].join('\n');
  }

  if (isWhatNextQ) {
    return "You can search the ExamMind library, generate practice questions, or upload new course materials. What would you like to do?";
  }

  if (isExplainQ) {
    return "I can explain topics from uploaded materials. What course or topic would you like me to explain?";
  }

  return "Is there a specific course, topic, or exam you want to focus on? You can describe it in plain language.";
}

function normalizeStudentState(state: string): DecisionStudentState {
  if (state === 'anxious') return 'anxious';
  if (state === 'confused') return 'confused';
  if (state === 'overwhelmed' || state === 'frustrated') return 'overwhelmed';
  if (state === 'focused') return 'focused';
  return 'neutral';
}

function previousAssistant(messages: ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find(m => m.role === 'assistant');
}

function firstNameForGreeting(user: User | null, messages: ChatMessage[]): string {
  const name = user?.name?.trim().split(/\s+/)[0] || '';
  if (!name) return '';
  const hasAlreadyGreeted = messages.some(m => m.role === 'assistant' && m.msgType === 'greeting');
  return hasAlreadyGreeted ? '' : name;
}

function pickVariant(variants: string[], seed: string): string {
  if (variants.length === 0) return '';
  let hash = 0;
  const mixed = `${seed}|${Date.now()}|${Math.random()}`;
  for (let i = 0; i < mixed.length; i += 1) hash = (hash * 31 + mixed.charCodeAt(i)) >>> 0;
  return variants[hash % variants.length];
}

function decisionFromPrecheck(
  precheck: ConversationPrecheck,
  question: string,
): AssistantDecision {
  const studentState = normalizeStudentState(precheck.studentState);
  const intentMap: Record<ConversationFunction, DecisionIntent> = {
    greeting: 'greeting',
    self_doubt_or_anxiety: 'self_doubt',
    emotional_confusion: 'emotional_confusion',
    correction_or_complaint: 'correction_or_complaint',
    confirmation_or_followup: 'confirmation_or_followup',
    acknowledgement: 'acknowledgement',
    academic_or_search_intent: 'academic_explanation',
  };
  const intent = intentMap[precheck.intent];
  const needsDetail = ['self_doubt', 'emotional_confusion', 'confirmation_or_followup', 'acknowledgement', 'unclear'].includes(intent);

  return {
    intent,
    student_state: studentState,
    action: needsDetail ? 'ask_for_detail' : 'local_reply',
    should_search: false,
    should_call_rag: false,
    should_show_understood_as: false,
    interpreted_topic: null,
    related_terms: [],
    response_goal: question.trim() ? 'Respond naturally and ask for the smallest useful study clue.' : 'Invite a study starting point.',
  };
}

function decisionFromIntentResult(result: IntentResult): AssistantDecision {
  const personName = result.person_name || result.possible_person || null;
  const courseCode = result.course_code || result.possible_course || null;
  const intentMap: Record<string, DecisionIntent> = {
    greeting: 'greeting',
    guidance_needed: normalizeStudentState(result.student_state) === 'neutral' ? 'unclear' : 'emotional_confusion',
    self_doubt_or_anxiety: 'self_doubt',
    emotional_confusion: 'emotional_confusion',
    correction_or_complaint: 'correction_or_complaint',
    confirmation_or_followup: 'confirmation_or_followup',
    confirmation: 'confirmation_or_followup',
    acknowledgement: 'acknowledgement',
    help: 'upload_help',
    upload_help: 'upload_help',
    practice_request: 'practice_request',
    campus_social: 'campus_social',
    person_pattern: 'person_pattern',
    academic_search: 'academic_search',
    academic_explanation: 'academic_explanation',
    unclear: 'unclear',
  };
  const intent = intentMap[result.intent] || 'unclear';
  const action: DecisionAction =
    result.should_call_rag ? 'rag'
    : intent === 'practice_request' ? 'practice'
    : intent === 'unclear' ? 'clarify'
    : intent === 'academic_search' ? 'search'
    : ['emotional_confusion', 'self_doubt', 'confirmation_or_followup'].includes(intent) ? 'ask_for_detail'
    : 'local_reply';

  return {
    intent,
    student_state: normalizeStudentState(result.student_state),
    action,
    should_search: result.should_search,
    should_call_rag: result.should_call_rag,
    should_show_understood_as: false,
    interpreted_topic: result.interpreted_topic,
    person_name: personName,
    course_code: courseCode,
    needs_course: result.needs_course ?? (intent === 'person_pattern' && Boolean(personName) && !courseCode),
    needs_person: result.needs_person ?? (intent === 'person_pattern' && !personName),
    related_terms: result.related_terms || [],
    response_goal: result.response_strategy || 'Respond naturally with the next useful action.',
  };
}

function composeNaturalAssistantReply(decision: AssistantDecision, context: NaturalReplyContext): string {
  const name = decision.intent === 'greeting' ? firstNameForGreeting(context.user, context.messages) : '';
  const userMessage = context.userMessage.trim().toLowerCase();
  const prevType = context.previousAssistant?.msgType;
  const seed = `${decision.intent}|${decision.student_state}|${userMessage}|${context.previousAssistant?.content ?? ''}`;
  const cluePrompt = 'Give me one clue: a course, topic, material title, exam, or even a rough phrase from class.';

  if (decision.intent === 'greeting') {
    return pickVariant([
      `Hey${name ? ` ${name}` : ''}. What are we studying today?`,
      `Hi${name ? ` ${name}` : ''}. Send me a course, topic, material title, or past-question clue and I will take it from there.`,
      `I am ready. What topic, course, or exam should we look at first?`,
      `Hello${name ? ` ${name}` : ''}. What do you want to prepare for right now?`,
    ], seed);
  }

  if (decision.intent === 'self_doubt') {
    return pickVariant([
      `That worry makes sense, but it does not mean you are stuck. We can make the next step small. ${cluePrompt}`,
      `You do not have to feel ready before you start. Pick one small area and we will build from there. Which course or topic is making you most nervous?`,
      `I hear you. Let us reduce the pressure: one topic, one past question, or one material clue is enough to begin.`,
      `You can still get more ready than you feel right now. Tell me the part that feels heaviest and I will help you break it down.`,
      `That sounds stressful. Start with the smallest thing you remember from class, and I will help turn it into a plan.`,
    ], seed);
  }

  if (decision.intent === 'emotional_confusion') {
    const overwhelmed = decision.student_state === 'overwhelmed';
    return pickVariant([
      `${overwhelmed ? 'That is a lot to carry.' : 'I get you.'} We do not need a perfect topic name yet. ${cluePrompt}`,
      `No need to force the exact words. Send whatever you remember, even something vague, and I will help connect it to the right material.`,
      `Let us make it simpler. What is the nearest clue you have: course code, exam, phrase, material title, or topic area?`,
      `You are not behind for being unsure. Start with one clue and I will help narrow it down.`,
      `Okay, we can start messy. Type the little bit you remember and I will help shape it into something useful.`,
    ], seed);
  }

  if (decision.intent === 'confirmation_or_followup') {
    const asksReadiness = /\b(ready|prepared|pass|make it|understand|cope)\b/i.test(userMessage);
    if (asksReadiness || decision.student_state === 'anxious') {
      return pickVariant([
        `You can be more ready than you feel right now. I cannot promise the exam will be easy, but I can help you focus. What course or topic should we start with?`,
        `Yes, there is still a way to prepare. Let us not try to cover everything at once. Which topic or course worries you most?`,
        `You do not need total confidence first. Give me one course, topic, or past-question area and I will help you make the next step concrete.`,
        `I believe we can make progress from here. What is the first area you want to feel steadier on?`,
      ], seed);
    }
    if (prevType === 'guidance' || prevType === 'unsure_support') {
      return pickVariant([
        `Yes. A vague clue is enough. Type the course, topic, phrase, material title, or exam you have in mind.`,
        `That is enough to begin. What is the clue you are thinking of?`,
        `Exactly. You do not need the perfect keyword. Send the rough version and I will interpret it.`,
        `Yes, we can work from a small clue. What should I use?`,
      ], seed);
    }
    return pickVariant([
      `Yes. What course, topic, or exam should we focus on next?`,
      `That is right. Send me the next thing you want to study.`,
      `Yes. What should I check for you?`,
      buildFollowUpReply(context.userMessage, context.previousAssistant),
    ], seed);
  }

  if (decision.intent === 'pending_slot_reply') {
    return pickVariant([
      'Great. What is it?',
      'Okay, send it to me.',
      'Nice. Type the course, topic, material title, exam, or rough description.',
      'Good. What clue should I use?',
      'I am with you. What do you have in mind?',
    ], seed);
  }

  if (decision.intent === 'correction_or_complaint') {
    const prevWasSearch =
      context.previousAssistant?.wasStudyQuery ||
      (context.previousAssistant?.content ?? '').toLowerCase().includes('i think you mean');
    return pickVariant(prevWasSearch ? [
      `You are right. I read that too much like a search. Let us reset: what did you want me to focus on?`,
      `Got it. I jumped ahead there. Send the course, topic, material title, or clue you meant.`,
      `Thanks for correcting me. I will slow down. What should I use as the actual clue?`,
      `Fair point. Let us take it again from your meaning. What are you trying to study?`,
    ] : [
      `Got it. Tell me the version you meant and I will follow that.`,
      `Okay, I will not assume. What should I focus on?`,
      `Understood. Send the course, topic, material title, or rough clue you want me to use.`,
      `Thanks for clarifying. What do you want to do next?`,
    ], seed);
  }

  if (decision.intent === 'acknowledgement') {
    return pickVariant([
      'Alright. Send me the course, topic, material title, exam, or clue when you are ready.',
      'Okay. What should we look at next?',
      'Got it. Give me the next study clue.',
      'Sure. What do you want to focus on?',
      'I am ready when you are. Send any rough clue.',
    ], seed);
  }

  if (decision.intent === 'upload_help') {
    return pickVariant([
      'You can upload lecture notes, past questions, course outlines, tutorial sheets, assignment questions, revision slides, or exam-prep PDFs. After that, ask in plain language and I will search them.',
      'Upload anything that represents the course: notes, past questions, outlines, slides, tutorial sheets, or assignments. The more grounded the material, the better the answers.',
      'For best results, upload the actual course materials first: past questions, notes, outlines, slides, or tutorial sheets. Then tell me what you want explained or searched.',
      'I can work with notes, past questions, course outlines, assignments, slides, and exam-prep PDFs. Upload what you have, then ask naturally.',
    ], seed);
  }

  if (decision.intent === 'practice_request') {
    return pickVariant([
      'I can help with practice. Send the course or topic, or open Generate Practice for a full quiz.',
      'Sure. What topic should the practice questions cover?',
      'Give me the course or topic and I will help you drill it.',
      'We can practice that. What area should I test you on?',
    ], seed);
  }

  if (decision.intent === 'person_pattern') {
    const person = decision.person_name || decision.interpreted_topic;
    const course = decision.course_code;
    if (!person || decision.needs_person) {
      return 'Which material or question pattern should I analyze?';
    }
    if (!course || decision.needs_course) {
      return `I can see the clue is ${person}. What course should I analyze? If you've uploaded past questions or notes, I'll check repeated topics, question style, difficulty, and patterns.`;
    }
    return `I'll analyze the ${course} pattern for ${person} using uploaded past questions and notes.`;
  }

  if (decision.intent === 'campus_social') {
    return pickVariant([
      'For reading rooms and study groups, open Study Groups from the navigation and look for an active room around your topic.',
      'You can use Study Groups for reading rooms. Pick a room tied to your course or topic, then come back here when you want materials explained.',
      'Study Groups is the best place for rooms and group study. What topic are you trying to revise with others?',
      'Open Study Groups to find rooms. If you already have a course or topic, send it here and I can help you prepare before joining.',
    ], seed);
  }

  if (decision.intent === 'academic_search' || decision.intent === 'academic_explanation') {
    const topic = decision.interpreted_topic || 'that topic';
    return `Understood as: ${topic}.`;
  }

  if (context.pendingSlot) {
    return composeNaturalAssistantReply({ ...decision, intent: 'pending_slot_reply' }, context);
  }

  if (decision.response_goal && decision.response_goal !== 'Respond naturally with the next useful action.') {
    return decision.response_goal;
  }

  return pickVariant([
    'Tell me the course, topic, material title, exam, or rough clue you want to work on.',
    'What should we focus on first?',
    'Send any small study clue and I will help from there.',
    'Give me the nearest topic, course, material title, or phrase you remember.',
  ], seed);
}

function buildConversationReply(
  precheck: ConversationPrecheck,
  question: string,
  user: User | null,
  messages: ChatMessage[],
): string {
  const decision = decisionFromPrecheck(precheck, question);
  return composeNaturalAssistantReply(decision, {
    user,
    userMessage: question,
    messages,
    pendingSlot: null,
    previousAssistant: previousAssistant(messages),
    currentPage: 'assistant',
  });

  const name = user?.name?.trim().split(/\s+/)[0] || '';
  const prevAssistant = [...messages].reverse().find(m => m.role === 'assistant');

  switch (precheck.intent) {
    case 'greeting':
      return `Hey${name ? ` ${name}` : ''}. What course, topic, past question, or exam are you preparing for today?`;

    case 'self_doubt_or_anxiety':
      return [
        `${name ? `Hey ${name} — that` : 'That'} feeling is more common than you think. A lot of students feel this way before exams.`,
        '',
        "You don't need to understand everything at once. Start with one small step: the course you're most worried about, one topic, or even a phrase you remember from class.",
        '',
        "What subject are you most anxious about? I'll help you focus there.",
      ].join('\n');

    case 'emotional_confusion': {
      if (precheck.studentState === 'frustrated') {
        return [
          "I get you — feeling stuck like that is completely normal before exams.",
          '',
          "You don't need to search anything right now. Start with the easiest clue you have: a course code, an exam date, a material title, or even a vague phrase from class. I'll help you connect it to materials, past questions, practice, or a reading room.",
        ].join('\n');
      }
      if (precheck.studentState === 'overwhelmed') {
        return [
          `${name ? `Hey ${name}, it` : 'It'}'s okay — feeling overwhelmed before exams is completely normal.`,
          '',
          "You're not trying to search right now — you're figuring out where to start. Start with the smallest clue you have: a course code, an exam, a material title, a phrase from class, or something very vague. I'll interpret it and guide you.",
        ].join('\n');
      }
      return [
        "I get you. You're not searching for a topic yet — you're trying to figure out where to start.",
        '',
        "Start with any small clue: a course code, an exam, a material title, a phrase from class, or even something vague. I'll help you connect it to materials, past questions, practice, or a reading room.",
      ].join('\n');
    }

    case 'correction_or_complaint': {
      const prevWasSearch =
        prevAssistant?.wasStudyQuery ||
        (prevAssistant?.content ?? '').toLowerCase().includes('i think you mean') ||
        (prevAssistant?.content ?? '').toLowerCase().includes('searching the');
      return prevWasSearch
        ? [
          "You're right — I misunderstood. I treated your message like a search when you were actually in conversation.",
          '',
          "Let's reset. Tell me any small clue you remember — a course, exam, topic phrase, material title, or something you vaguely remember from class.",
        ].join('\n')
        : [
          "Got it — let me not assume what you meant.",
          '',
          "Tell me what you'd like help with: a course, topic, past question, exam, or anything from class.",
        ].join('\n');
    }

    case 'confirmation_or_followup':
      return buildFollowUpReply(question, prevAssistant);

    case 'acknowledgement': {
      const prevType = prevAssistant?.msgType;
      if (prevType === 'guidance' || prevType === 'unsure_support') {
        return "Alright. Whenever you're ready, give me any clue — a course, exam, topic phrase, material title, or something you vaguely remember. There's no wrong way to start.";
      }
      if (prevAssistant) return "Alright. What would you like to do next?";
      return "When you're ready, give me any clue — course, exam, topic phrase, material title, or something you vaguely remember.";
    }

    default:
      return `Which course, topic, or material do you want to study${name ? `, ${name}` : ''}?`;
  }
}

// ── Post-/understand local reply (for non-RAG intents from /understand) ───────

function intentToMsgType(intent: string, studentState: string): MsgType {
  if (intent === 'greeting') return 'greeting';
  if (intent === 'self_doubt_or_anxiety') return 'unsure_support';
  if (intent === 'emotional_confusion' || intent === 'guidance_needed') {
    return studentState === 'frustrated' || studentState === 'overwhelmed'
      ? 'unsure_support'
      : 'guidance';
  }
  if (intent === 'correction_or_complaint') return 'follow_up';
  if (intent === 'confirmation_or_followup' || intent === 'confirmation') return 'confirmation';
  if (intent === 'acknowledgement') return 'follow_up';
  if (intent === 'practice_request') return 'practice_help';
  if (intent === 'upload_help') return 'upload_help';
  if (intent === 'academic_search') return 'search_result';
  return 'follow_up';
}

function buildLocalReply(result: IntentResult, user: User | null, messages: ChatMessage[]): string {
  const decision = decisionFromIntentResult(result);
  return composeNaturalAssistantReply(decision, {
    user,
    userMessage: result.interpreted_topic || '',
    messages,
    pendingSlot: null,
    previousAssistant: previousAssistant(messages),
    currentPage: 'assistant',
  });

  const name = user?.name?.trim().split(/\s+/)[0] || '';
  const { intent, student_state, clarifying_question } = result;

  if (intent === 'greeting') {
    return `Hey${name ? ` ${name}` : ''}. What course, topic, past question, or exam are you preparing for today?`;
  }

  if (intent === 'guidance_needed') {
    if (student_state === 'frustrated' || student_state === 'overwhelmed') {
      return [
        `${name ? `Hey ${name}, it` : 'It'}'s okay — feeling overwhelmed before exams is normal.`,
        '',
        'Start with whatever feels most familiar: a course, a topic, a material title, or just an exam date. You do not need to know the exact topic name.',
        '',
        'You can also:',
        '- Search the ExamMind library',
        '- Upload lecture notes or past questions',
        '- Generate practice questions',
        '- Join a reading room',
      ].join('\n');
    }
    return [
      `No problem${name ? `, ${name}` : ''}. Start with a course, a topic from class, a material title, or an upcoming exam.`,
      '',
      'You can describe what you remember from class, even if you do not know the exact topic name.',
    ].join('\n');
  }

  if (intent === 'help' || intent === 'upload_help') {
    return [
      'I can help you:',
      '- Search uploaded course materials (lecture notes, past questions, course outlines)',
      '- Explain a topic from the ExamMind library',
      '- Find related past questions',
      '- Generate practice questions',
      '- Guide you on what to upload',
      '- Connect you to study groups and reading rooms',
      '',
      'You can describe a topic in plain language. You do not need exact keywords.',
    ].join('\n');
  }

  if (intent === 'confirmation') {
    return 'Yes. You do not need to know the exact topic name. Describe what you remember, and ExamMind will try to connect it to uploaded materials, past questions, and practice.';
  }

  if (intent === 'practice_request') {
    return 'I can generate practice for you. Tell me the topic or course, or go to Generate Practice from the navigation to build a full quiz.';
  }

  if (intent === 'campus_social') {
    return 'You can find reading rooms and study groups from the Study Groups section in the navigation. Look for active rooms on topics you are studying.';
  }

  if (intent === 'person_pattern') {
    const whom = result.possible_person ? `${result.possible_person}'s` : "that pattern's";
    return [
      `If ${whom} materials have been uploaded, I can analyze them.`,
      '',
      'Upload materials connected to that course or topic: lecture notes, past questions, course outlines, or tutorial sheets. Once indexed, ask me about the topic or material by name.',
    ].join('\n');
  }

  if (intent === 'academic_search') {
    return 'I can search for past questions and exam materials. Go to the Questions section to search uploaded materials, or upload new past questions first.';
  }

  if (intent === 'unclear') {
    if (clarifying_question) return clarifying_question || '';
    return 'Which course, topic, or material do you want to study?';
  }

  const prevAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  const prevLower = (prevAssistant?.content ?? '').toLowerCase();
  if (
    prevLower.includes('what course') ||
    prevLower.includes('which course') ||
    prevLower.includes('what topic') ||
    prevLower.includes('which topic')
  ) {
    return 'Try typing a course, topic, or upcoming exam. You can search the ExamMind library or upload course materials if you are not sure where to begin.';
  }
  return `Which course, topic, or material do you want to study${name ? `, ${name}` : ''}?`;
}

function buildContext(msgs: ChatMessage[]): string {
  return msgs
    .slice(-4)
    .map(m => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content.slice(0, 150)}`)
    .join('\n');
}

function extractCourseCode(value: string): string | null {
  const match = value.match(/\b([A-Za-z]{2,4})\s*-?\s*(\d{3,4})\b/);
  return match ? `${match[1].toUpperCase()}${match[2]}` : null;
}

function isContextualFollowUp(value: string): boolean {
  return /\b(what did you find|what did u find|okay so|ok so|so what|continue|tell me more|more details|explain that|what about the topics|what topics|that topic|the topics|what about it)\b/i.test(value);
}

function buildRecentContext(messages: ChatMessage[], lastContext: LastRagContext | null): string {
  const recent = messages.slice(-6).map(m => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content.slice(0, 220)}`).join('\n');
  const memory = lastContext
    ? [
        `Last source: ${lastContext.lastDocumentTitle || lastContext.lastSources[0] || 'unknown uploaded material'}`,
        `Last course: ${lastContext.lastCourseCode || 'unknown'}`,
        `Last topic: ${lastContext.lastTopic || 'unknown'}`,
        `Last question: ${lastContext.lastQuestion}`,
      ].join('\n')
    : 'No previous RAG context.';
  return `${memory}\n\nRecent messages:\n${recent}`;
}

function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVagueAcademicInput(original: string): boolean {
  const norm = normalizeForComparison(original);
  return [
    /\b(thingy|thing|stuff|something|that one|the one)\b/,
    /\b(what we did|what they taught|from class|in class)\b/,
    /\b(i forgot|cannot remember|cant remember|not sure what it is called)\b/,
    /\b(topic|part|area)\s+(about|on)\b/,
  ].some(pattern => pattern.test(norm));
}

function shouldShowUnderstoodAs(
  understanding: Pick<QueryUnderstanding, 'interpreted_topic' | 'related_terms'> | Pick<IntentResult, 'interpreted_topic' | 'related_terms'> | null | undefined,
  original: string,
): boolean {
  const topic = understanding?.interpreted_topic?.trim();
  if (!topic) return false;

  const normalizedTopic = normalizeForComparison(topic);
  const normalizedOriginal = normalizeForComparison(original);
  if (!normalizedTopic || normalizedTopic === normalizedOriginal) return false;

  const topicWords = normalizedTopic.split(/\s+/).filter(Boolean);
  if (topicWords.length === 1 && normalizedTopic.length <= 5) return false;
  if (topicWords.every(w => CONVERSATIONAL_TOKENS.has(w))) return false;

  const originalWords = new Set(normalizedOriginal.split(/\s+/).filter(Boolean));
  const topicAlreadyPresent = topicWords.length > 0 && topicWords.every(w => originalWords.has(w));
  return isVagueAcademicInput(original) || !topicAlreadyPresent;
}

function buildVagueInterpretationMessage(result: IntentResult, original: string): string {
  if (result.intent === 'person_pattern') return '';
  if (!shouldShowUnderstoodAs(result, original) || !result.interpreted_topic) return '';
  const related = result.related_terms.slice(0, 3);
  return `Understood as "${result.interpreted_topic}"${related.length ? `; also checking ${related.join(', ')}` : ''}.`;
}

function buildPersonPatternIntro(result: IntentResult): string {
  const person = result.person_name || result.possible_person;
  const course = result.course_code || result.possible_course;
  if (person && course) {
    return `I'll analyze the ${course} pattern for ${person} using uploaded past questions and notes.`;
  }
  if (person) {
    return `I can see the clue is ${person}. What course should I analyze? If you've uploaded past questions or notes, I'll check repeated topics, question style, difficulty, and patterns.`;
  }
  return 'Which material or question pattern should I analyze?';
}

// Only show interpretation when the topic is meaningfully different from the input
// and doesn't consist entirely of conversational filler words.
function buildInterpretationMsg(result: IntentResult, original: string): string {
  return buildVagueInterpretationMessage(result, original);

  if (!result.interpreted_topic) return '';
  const topic = result.interpreted_topic || '';
  if (topic.toLowerCase().trim() === original.toLowerCase().trim()) return '';

  const topicWords = topic.trim().split(/\s+/);
  // Single short word (≤5 chars) → likely filler
  if (topicWords.length === 1 && topic.length <= 5) return '';
  // All words are conversational non-topic tokens → discard
  if (topicWords.every(w => CONVERSATIONAL_TOKENS.has(w.toLowerCase()))) return '';

  const related = result.related_terms.slice(0, 3);
  return `I think you mean "${topic}"${related.length ? ` — also searching: ${related.join(', ')}` : ''}. Searching the ExamMind library.`;
}

// ── RAG / error helpers ───────────────────────────────────────────────────────

function missingMaterialsReply(question: string, understanding?: QueryUnderstanding | null): string {
  const topic = understanding?.interpreted_topic || question;
  const related = (understanding?.related_terms || [])
    .filter(t => t.toLowerCase() !== topic.toLowerCase())
    .slice(0, 5);
  const relatedText = related.length ? ` I also checked related terms like ${related.slice(0, 3).join(', ')}.` : '';
  return pickVariant([
    `I did not find uploaded materials for "${topic}" yet.${relatedText} You can upload lecture notes, past questions, course outlines, tutorial sheets, assignment questions, revision slides, or exam-prep PDFs, then ask again. If you want, I can still give a general explanation from the topic name.`,
    `There is not enough uploaded ExamMind material on "${topic}" yet.${relatedText} The best next step is to add the course notes or past questions. Slides, outlines, tutorials, assignments, and exam-prep PDFs also help.`,
    `I could not ground this in your uploaded materials yet.${relatedText} Upload anything tied to "${topic}" - notes, past questions, outlines, slides, tutorials, or assignments - and I will use that first next time.`,
    `I checked, but "${topic}" is not in the uploaded library yet.${relatedText} Add the related lecture notes or past questions when you have them. A course outline, tutorial sheet, revision slide, or exam-prep PDF is useful too.`,
    `I do not have uploaded material for "${topic}" to lean on yet.${relatedText} Upload the closest course file you have, or ask me to explain it generally while you gather the notes.`,
  ], `${topic}|${related.join(',')}`);

  return [
    'I could not find this topic in the uploaded ExamMind materials yet. To improve answers, upload lecture notes, past questions, course outlines, tutorial sheets, revision slides, or exam prep PDFs for this topic.',
    related.length ? `\nRelated terms searched: ${related.join(', ')}.` : '',
    '',
    'Useful materials to upload:',
    '- Lecture notes',
    '- Past questions',
    '- Course outline',
    '- Tutorial sheets',
    '- Assignment questions',
    '- Revision slides',
    '- Exam prep PDFs',
  ]
    .filter((line, i) => i === 0 || line !== '')
    .join('\n');
}

function friendlyError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "I couldn't reach the AI service right now. Please check the backend or AI key.";
  }
  const lowered = error.message.toLowerCase();
  if (
    lowered.includes('not authenticated') ||
    lowered.includes('401') ||
    lowered.includes('could not validate credentials')
  ) {
    return 'Your session is not authenticated. Please log out, sign in again, and retry your question.';
  }
  return "I couldn't reach the AI service right now. Please check the backend or AI key.";
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const GENERIC_PROMPTS = [
  'Explain a topic',
  'Find past questions',
  'Search uploaded notes',
  'Generate practice',
  'What should I revise?',
  'Upload course material',
];

function ThinkingBubble({ text }: { text: string }) {
  return (
    <div className="msg">
      <div className="msg-ava ai">AI</div>
      <div className="bubble ai thinking-bubble">
        <span className="thinking-text">{text}</span>
        <span className="thinking-dots" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Assistant({
  go,
  selectedQuestion,
  notifyUnavailable,
  messages,
  onMessagesChange,
  user,
}: {
  go: (s: ScreenType) => void;
  selectedQuestion?: string;
  notifyUnavailable: (feature: string) => void;
  messages: ChatMessage[];
  onMessagesChange: (updater: (current: ChatMessage[]) => ChatMessage[]) => void;
  user: User | null;
}) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [thinkingPhase, setThinkingPhase] = useState<ThinkingPhase>('idle');
  const [courses, setCourses] = useState<{ id: number; code: string; name: string }[]>([]);
  const [lastRagContext, setLastRagContext] = useState<LastRagContext | null>(null);
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const lastAutoSubmittedRef = useRef('');
  const conversationStateRef = useRef<ConversationState>({
    pendingSlot: null,
    lastAssistantMsgType: null,
    awaitingUserDetail: false,
  });

  const latestStudyAssistant = useMemo(
    () => [...messages].reverse().find(m => m.role === 'assistant' && m.wasStudyQuery),
    [messages],
  );

  const promptChips = useMemo(() => {
    if (courses.length === 0) return GENERIC_PROMPTS;
    const coursePrompts = courses.slice(0, 2).flatMap(c => [
      `Explain a topic in ${c.code}`,
      `Find past questions for ${c.code}`,
    ]);
    return [...coursePrompts, 'Search uploaded notes', 'Generate practice', 'Upload course material'].slice(0, 6);
  }, [courses]);

  useEffect(() => {
    let cancelled = false;
    apiGet('/courses')
      .then(data => { if (!cancelled) setCourses(data as Course[]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selectedQuestion) setInput(selectedQuestion);
  }, [selectedQuestion]);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinkingPhase]);

  // Show thinking bubble briefly before locally-computed replies.
  const localReplyWithAnim = useCallback(
    async (
      phase: Exclude<ThinkingPhase, 'idle'>,
      delayMs: number,
      content: string,
      msgType: MsgType,
    ) => {
      setLoading(true);
      setThinkingPhase(phase);
      await new Promise<void>(r => setTimeout(r, delayMs));
      onMessagesChange(current => [
        ...current,
        { id: `assistant-local-${Date.now()}`, role: 'assistant', content, msgType, wasStudyQuery: false },
      ]);
      setLoading(false);
      setThinkingPhase('idle');
    },
    [onMessagesChange],
  );

  // Only path that calls /rag/ask
  const callRag = useCallback(
    async (question: string, originalQuestion = question) => {
      setLoading(true);
      setThinkingPhase('searching');
      try {
        const courseCode = extractCourseCode(question) || extractCourseCode(originalQuestion) || lastRagContext?.lastCourseCode || null;
        const course = courseCode
          ? courses.find(c => c.code.replace(/\s+/g, '').toLowerCase() === courseCode.replace(/\s+/g, '').toLowerCase())
          : null;
        const data = (await apiPost('/rag/ask', {
          question,
          course_id: course?.id ?? lastRagContext?.lastCourseId,
          recent_context: buildRecentContext(messages, lastRagContext),
        })) as AskResponse;
        const noSources = data.no_past_questions_found && data.no_lecture_notes_found;
        if (!noSources) {
          const nextSource = (data.sources || [])[0] || lastRagContext?.lastDocumentTitle;
          const nextCourseCode = extractCourseCode(nextSource || '') || courseCode || data.understanding?.course_code || undefined;
          setLastRagContext({
            lastCourseId: course?.id ?? lastRagContext?.lastCourseId,
            lastCourseCode: nextCourseCode || undefined,
            lastDocumentTitle: nextSource,
            lastTopic: data.understanding?.interpreted_topic || data.understanding?.topic || lastRagContext?.lastTopic,
            lastSources: data.sources || [],
            lastQuestion: originalQuestion,
          });
        }
        onMessagesChange(current => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: noSources ? missingMaterialsReply(question, data.understanding) : data.answer,
            sources: data.sources || [],
            noPastQuestionsFound: data.no_past_questions_found,
            noLectureNotesFound: data.no_lecture_notes_found,
            wasStudyQuery: true,
            msgType: noSources ? 'missing_materials' : 'academic_answer',
            understanding: data.understanding || null,
            showUnderstoodAs: shouldShowUnderstoodAs(data.understanding, originalQuestion),
          },
        ]);
      } catch (err) {
        onMessagesChange(current => [
          ...current,
          { id: `assistant-error-${Date.now()}`, role: 'assistant', content: friendlyError(err), wasStudyQuery: true, msgType: 'error' },
        ]);
      } finally {
        setLoading(false);
        setThinkingPhase('idle');
      }
    },
    [courses, lastRagContext, messages, onMessagesChange],
  );

  const handleSend = useCallback(
    async (prompt?: string) => {
      const question = (prompt ?? input).trim();
      if (!question || loading) return;

      onMessagesChange(current => [
        ...current,
        { id: `user-${Date.now()}`, role: 'user', content: question },
      ]);
      setInput('');

      // ── PENDING SLOT CHECK: user replied to "what course/topic?" prompt ───
      // Runs BEFORE the pre-gate so short affirmations are never sent to search.
      const convState = conversationStateRef.current;
      if (convState.awaitingUserDetail && convState.pendingSlot) {
        const slotClass = classifyPendingSlotReply(question);
        if (import.meta.env.DEV) {
          console.debug('[Assistant slot check]', { question, slotClass, pendingSlot: convState.pendingSlot });
        }
        if (slotClass === 'affirmed_but_no_detail') {
          const slotDecision: AssistantDecision = {
            intent: 'pending_slot_reply',
            student_state: 'focused',
            action: 'ask_for_detail',
            should_search: false,
            should_call_rag: false,
            should_show_understood_as: false,
            interpreted_topic: null,
            related_terms: [],
            response_goal: 'Ask for the specific study clue they have in mind.',
          };
          // User confirmed they have a topic but hasn't typed it yet — ask again
          await localReplyWithAnim(
            'context', 360,
            composeNaturalAssistantReply(slotDecision, {
              user,
              userMessage: question,
              messages,
              pendingSlot: convState.pendingSlot,
              previousAssistant: previousAssistant(messages),
              currentPage: 'assistant',
            }),
            'guidance',
          );
          // Keep slot open so next reply is also checked
          conversationStateRef.current = { ...convState };
          return;
        }
        if (slotClass === 'declined_or_unsure') {
          const slotDecision: AssistantDecision = {
            intent: 'emotional_confusion',
            student_state: 'confused',
            action: 'ask_for_detail',
            should_search: false,
            should_call_rag: false,
            should_show_understood_as: false,
            interpreted_topic: null,
            related_terms: [],
            response_goal: 'Help them start from any small clue.',
          };
          await localReplyWithAnim(
            'context', 360,
            composeNaturalAssistantReply(slotDecision, {
              user,
              userMessage: question,
              messages,
              pendingSlot: convState.pendingSlot,
              previousAssistant: previousAssistant(messages),
              currentPage: 'assistant',
            }),
            'guidance',
          );
          conversationStateRef.current = { pendingSlot: 'material_clue', lastAssistantMsgType: 'guidance', awaitingUserDetail: true };
          return;
        }
        // 'provided_detail' → clear slot and fall through to normal processing
        conversationStateRef.current = { pendingSlot: null, lastAssistantMsgType: null, awaitingUserDetail: false };
      }

      // ── HARD PRE-GATE: classify message function BEFORE any API call ──────
      const followUpLooksContextual =
        Boolean(lastRagContext || latestStudyAssistant) &&
        isContextualFollowUp(question);
      if (followUpLooksContextual) {
        const previousTopic = lastRagContext?.lastDocumentTitle
          || latestStudyAssistant?.sources?.[0]
          || latestStudyAssistant?.understanding?.interpreted_topic
          || latestStudyAssistant?.understanding?.course_code
          || latestStudyAssistant?.understanding?.topic
          || 'the uploaded material we were discussing';
        await callRag(`Using the previous context, answer about ${previousTopic}: ${question}`, question);
        conversationStateRef.current = { pendingSlot: null, lastAssistantMsgType: 'academic_answer', awaitingUserDetail: false };
        return;
      }

      const precheck = classifyConversationFunction(question);

      if (import.meta.env.DEV) {
        console.debug('[Assistant decision]', {
          input: question,
          precheckIntent: precheck.intent,
          shouldBypassAcademicSearch: precheck.shouldBypassAcademicSearch,
          studentState: precheck.studentState,
          confidence: precheck.confidence,
          willCallUnderstand: !precheck.shouldBypassAcademicSearch,
          willCallRag: false, // determined after /understand
        });
      }

      // ── Non-academic path: handle locally (no /understand, no /rag/ask) ───
      if (precheck.shouldBypassAcademicSearch) {
        const phase: Exclude<ThinkingPhase, 'idle'> =
          precheck.intent === 'self_doubt_or_anxiety'
            ? 'empathy'
            : precheck.intent === 'emotional_confusion' || precheck.intent === 'correction_or_complaint'
            ? 'support'
            : 'context';
        const delay =
          precheck.intent === 'greeting' ? 180
          : precheck.intent === 'acknowledgement' ? 240
          : precheck.intent === 'self_doubt_or_anxiety' ? 600
          : precheck.intent === 'emotional_confusion' ? 520
          : precheck.intent === 'correction_or_complaint' ? 460
          : 370;

        const content = buildConversationReply(precheck, question, user, messages);
        const msgType = intentToMsgType(precheck.intent, precheck.studentState);
        await localReplyWithAnim(phase, delay, content, msgType);
        // All non-academic replies leave us ready to receive a topic/course
        conversationStateRef.current = { pendingSlot: 'course_or_topic', lastAssistantMsgType: msgType, awaitingUserDetail: true };
        return;
      }

      // ── Academic path: call /understand → route → optionally /rag/ask ─────
      setLoading(true);
      setThinkingPhase('understanding');

      let result: IntentResult;
      try {
        result = (await apiPost('/understand', {
          message: question,
          conversation_context: buildContext(messages),
        })) as IntentResult;
      } catch (err) {
        setLoading(false);
        setThinkingPhase('idle');
        onMessagesChange(current => [
          ...current,
          { id: `assistant-error-${Date.now()}`, role: 'assistant', content: friendlyError(err), wasStudyQuery: false, msgType: 'error' },
        ]);
        conversationStateRef.current = { pendingSlot: null, lastAssistantMsgType: 'error', awaitingUserDetail: false };
        return;
      }

      if (import.meta.env.DEV) {
        console.debug('[/understand result]', {
          intent: result.intent,
          should_call_rag: result.should_call_rag,
          interpreted_topic: result.interpreted_topic,
          confidence: result.confidence,
        });
      }

      if (
        !result.should_call_rag &&
        extractCourseCode(question) &&
        /\b(what\s+topics?|topics?\s+appear|cover|covered|in\s+the\s+past\s+question)\b/i.test(question)
      ) {
        result = {
          ...result,
          intent: 'academic_explanation',
          should_call_rag: true,
          should_search: true,
          interpreted_topic: question,
          course_code: extractCourseCode(question),
          response_strategy: 'list topics from uploaded source',
        };
      }

      // ── Non-RAG intent from /understand ──────────────────────────────────
      if (!result.should_call_rag) {
        if (result.intent === 'guidance_needed') {
          setThinkingPhase('support');
          await new Promise<void>(r => setTimeout(r, 350));
        }
        setLoading(false);
        setThinkingPhase('idle');
        const nonRagMsgType = intentToMsgType(result.intent, result.student_state);
        onMessagesChange(current => [
          ...current,
          {
            id: `assistant-local-${Date.now()}`,
            role: 'assistant',
            content: buildLocalReply(result, user, messages),
            msgType: nonRagMsgType,
            wasStudyQuery: false,
          },
        ]);
        // Guidance/unclear intents still need the user to provide a topic
        const needsTopic = ['guidance_needed', 'greeting', 'unclear'].includes(result.intent);
        conversationStateRef.current = {
          pendingSlot: needsTopic ? 'course_or_topic' : null,
          lastAssistantMsgType: nonRagMsgType,
          awaitingUserDetail: needsTopic,
        };
        return;
      }

      // ── Academic with RAG ────────────────────────────────────────────────
      const hasSpecificSource = Boolean(extractCourseCode(question) || /\bpast\s+question|uploaded|source|document|topics?\s+appear\b/i.test(question));
      const ragQuery = hasSpecificSource ? question : (result.interpreted_topic || question);
      const interpMsg =
        result.intent === 'person_pattern'
          ? buildPersonPatternIntro(result)
          : buildInterpretationMsg(result, question);
      if (interpMsg) {
        onMessagesChange(current => [
          ...current,
          { id: `assistant-interp-${Date.now()}`, role: 'assistant', content: interpMsg, wasStudyQuery: false, msgType: 'follow_up' },
        ]);
      }

      await callRag(ragQuery, question);
      conversationStateRef.current = { pendingSlot: null, lastAssistantMsgType: 'academic_answer', awaitingUserDetail: false };
    },
    [input, loading, messages, onMessagesChange, user, callRag, localReplyWithAnim, latestStudyAssistant, lastRagContext],
  );

  useEffect(() => {
    const question = selectedQuestion?.trim();
    if (!question || loading || lastAutoSubmittedRef.current === question) return;
    lastAutoSubmittedRef.current = question;
    void handleSend(question);
  }, [selectedQuestion, loading, handleSend]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page" id="s-assistant">
      <div className="pg-head">
        <div className="pg-title">AI <em>Assistant</em></div>
        <div className="pg-sub">
          Describe a topic, course, past question, or exam in plain language. Exact keywords are not required.
        </div>
      </div>

      <div className="ai-layout">
        <div className="ai-panel">
          <div className="ai-hd">
            <div className="ai-dot"></div>
            <div className="ai-hd-title">ExamMind AI</div>
            <div className="ai-hd-sub">
              {thinkingPhase !== 'idle' ? PHASE_TEXT[thinkingPhase] : 'Ready for your questions'}
            </div>
          </div>

          <div className="ai-msgs">
            {messages.map(message => (
              <div className={`msg ${message.role === 'user' ? 'usr' : ''}`} key={message.id}>
                <div className={`msg-ava ${message.role === 'user' ? 'usr' : 'ai'}`}>
                  {message.role === 'user' ? 'You' : 'AI'}
                </div>
                <div className={`bubble ${message.role === 'user' ? 'usr' : 'ai'}`}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
                  {/* "Understood as" only for real academic search results — never for conversation */}
                  {message.wasStudyQuery && message.showUnderstoodAs && message.understanding?.interpreted_topic && (
                    <div className="pq-ref-row">
                      <div className="pq-ref">
                        <div className="pq-ref-yr">Understood as</div>
                        <div className="pq-ref-q">
                          {message.understanding.interpreted_topic}
                          {message.understanding.related_terms.length > 0 && (
                            <span>
                              {' '}· also searched{' '}
                              {message.understanding.related_terms.slice(0, 3).join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {message.sources && message.sources.length > 0 && (
                    <div className="pq-ref-row">
                      {message.sources.map(source => (
                        <div className="pq-ref" key={source}>
                          <div className="pq-ref-yr">Source</div>
                          <div className="pq-ref-q">{source}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {thinkingPhase !== 'idle' && <ThinkingBubble text={PHASE_TEXT[thinkingPhase]} />}
            <div ref={msgsEndRef} />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 20px 14px' }}>
            {promptChips.map(p => (
              <button className="pill" key={p} onClick={() => void handleSend(p)} disabled={loading}>
                {p}
              </button>
            ))}
          </div>

          <div className="ai-foot">
            <input
              className="ai-inp"
              type="text"
              placeholder="Ask about a topic, past question, material, or anything you remember…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleSend(); } }}
              disabled={loading}
            />
            <button className="send" onClick={() => void handleSend()} disabled={loading || !input.trim()}>
              {loading ? '...' : '>'}
            </button>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="related-panel">
          {!latestStudyAssistant && (
            <div className="card">
              <div className="card-hd"><div className="card-ttl">What can you ask?</div></div>
              <div className="note-absent-msg">
                Ask about any course topic, uploaded note, past question, material, or exam preparation task. You can describe what you remember, even if you do not know the exact topic name.
              </div>
              <div style={{ marginTop: 12 }}>
                {[
                  { label: 'Search uploaded materials', screen: 'questions' as ScreenType },
                  { label: 'Upload course material', screen: 'upload' as ScreenType },
                  { label: 'Generate practice', screen: 'practice' as ScreenType },
                  { label: 'Join a reading room', screen: 'groups' as ScreenType },
                ].map(({ label, screen }) => (
                  <button
                    key={label}
                    className="cta cta-ghost"
                    style={{ width: '100%', justifyContent: 'center', fontSize: 12, marginTop: 8 }}
                    onClick={() => go(screen)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {latestStudyAssistant?.noLectureNotesFound && (
            <div className="note-absent">
              <div className="note-absent-lbl">No lecture notes found</div>
              <div className="note-absent-msg">
                The assistant did not find lecture notes for this question. Upload lecture notes, revision slides, or course outlines to improve future answers.
              </div>
              <button className="upload-prompt" onClick={() => go('upload')}>+ Upload lecture notes</button>
            </div>
          )}

          {latestStudyAssistant?.noPastQuestionsFound && (
            <div className="note-absent">
              <div className="note-absent-lbl">No past questions found</div>
              <div className="note-absent-msg">
                No matching past question has been indexed yet. Upload past questions, tutorial sheets, assignment questions, or exam prep material for this topic.
              </div>
              <button className="upload-prompt" onClick={() => go('upload')}>+ Upload past question</button>
            </div>
          )}

          <div className="card">
            <div className="card-hd"><div className="card-ttl">Sources</div></div>
            {latestStudyAssistant?.sources && latestStudyAssistant.sources.length > 0 ? (
              <div className="prog-list">
                {latestStudyAssistant.sources.map(source => (
                  <div className="qi" key={source}>
                    <div className="qi-body"><div className="qi-title">{source}</div></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="note-absent-msg">
                {latestStudyAssistant
                  ? 'Sources will appear here after the assistant finds matching uploaded material.'
                  : 'Sources appear here after you ask a study question that searches uploaded material.'}
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <button
                className="cta cta-ghost"
                style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
                onClick={() => notifyUnavailable('Related questions view')}
              >
                View related questions
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
