import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ScreenType, User } from '../types';
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
  possible_lecturers: string[];
  intent: string;
  confidence: number;
  needs_clarification: boolean;
  clarifying_question: string | null;
};

type Course = {
  id: number;
  code: string;
  name: string;
};

/**
 * Message intent categories.
 *
 * GUARD: Only 'academic' and 'vague_academic' call /rag/ask.
 * Every other intent is handled LOCALLY with no API call.
 */
type MessageIntent =
  | 'greeting'       // hey, hi, hello
  | 'help'           // what can you do, show me examples
  | 'unsure'         // I don't know, not sure, what should I study
  | 'thinking'       // I'm thinking about it, let me think
  | 'confirmation'   // are you sure?, really?
  | 'vague'          // ok, yes, thanks, hmm
  | 'practice_req'   // test me, quiz me, generate practice
  | 'campus_social'  // who is reading this, is there a reading room
  | 'lecturer_q'     // what did Iheanetu teach, how does she set questions
  | 'vague_academic' // the human relations thingy, computer stuffs, motivation thing
  | 'academic';      // everything else → calls /rag/ask

// ── Intent patterns ───────────────────────────────────────────────────────────

const greetingPattern =
  /^(hi|hey|hello|yo|good morning|good afternoon|good evening|morning|evening|sup|hiya|heyy+)[!., ]*$/i;

const helpPattern =
  /^(help|what can you do\??|how does this work\??|what should i ask\??|what can i ask\??|show me examples\??|examples\??)$/i;

const thinkingPattern =
  /^(i'?m thinking( about it)?|thinking about it|let me think|give me a sec(ond)?|i'?m still thinking)[!., ]*$/i;

const confirmationPattern =
  /^(are you sure\??|you sure\??|really\??|are you certain\??|is that right\??|is this right\??|you confident\??)[!., ]*$/i;

const unsurePattern =
  /^(i\s+)?(do\s+not|don'?t|dont)?\s*(know|no idea)(\s+yet)?[!., ]*$|^not sure[!., ]*$|^nothing yet[!., ]*$|^i'?m confused[!., ]*$|^i\s+(do\s+not|don'?t|dont)\s+know\s+what\s+to\s+(read|study)[!., ]*$|^what topic\??$|^what should i study\??$|^what should i revise\??$|^i have no topic yet[!., ]*$|^no topic yet[!., ]*$|^i'?m not sure what to ask[!., ]*$/i;

const vaguePattern =
  /^(ok|okay|hmm+|hm+|yes|yeah|yep|no|nah|what|why|how|sure|alright|cool|fine|thanks|thank you|i see|got it|i understand|understood|noted)[!., ]*$/i;

const localActionPattern =
  /^(explain a topic|find past questions|generate practice|generate practice questions|search uploaded notes|upload course material|search uploaded materials)$/i;

const practiceReqPattern =
  /\b(test me|quiz me|give me questions|create a quiz|make practice|build a quiz|drill me|start a quiz|generate a quiz)\b/i;

const campusSocialPattern =
  /\b(reading room|study group|who is (studying|reading)|join (people|others|a group)|is there a (group|room)|find (others|people) (studying|reading)|others studying|who else is studying)\b/i;

// Lecturer-context queries: "what did X teach", "how does she set", "madam X"
const lecturerQPattern =
  /what\s+(did|does)\s+\w+\s+(teach|cover|explain|ask|focus|like\s+to\s+ask)|how\s+(does|did)\s+(she|he|they|the\s+lecturer|madam|sir|\w+)\s+(set|ask|make|write|structure)\s*(the|her|his|their)?\s*(question|exam|test)?|what\s+topic\s+did\s+\w+\s+(teach|cover)|give\s+me\s+questions\s+from\s+what\s+\w+\s+(explained|taught)|from\s+what\s+(madam|sir|the\s+lecturer)\s+explained|(madam|sir|dr\.?|prof\.?|professor)\s+\w+/i;

// Vague marker words that signal the student is describing a topic imprecisely
const VAGUE_MARKERS =
  /\b(thingy|stuffs?|that\s+topic|the\s+topic\s+about|the\s+thing\s+about|that\s+thing\s+about|something\s+about|the\s+concept\s+of|the\s+chapter\s+on|that\s+concept|that\s+chapter|what\s+we\s+did|what\s+they\s+teach)\b/i;

// Words to strip when counting content tokens
const FILLER = new Set([
  'the', 'a', 'an', 'that', 'this', 'thing', 'thingy', 'stuff', 'stuffs',
  'topic', 'about', 'on', 'we', 'did', 'last', 'week', 'give', 'find',
  'explain', 'from', 'what', 'i', 'remember', 'dont', 'know', 'was',
  'for', 'my', 'and', 'or', 'in', 'of', 'to', 'with',
]);

function contentWordCount(text: string): number {
  return text.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !FILLER.has(w)).length;
}

// ── Local topic interpretation (mirrors backend synonym map) ─────────────────

const TOPIC_HINTS: Array<{ triggers: string[]; topic: string; related: string[] }> = [
  {
    triggers: ['human relations', 'human relation'],
    topic: 'Human Relations Theory',
    related: ['Elton Mayo', 'Hawthorne Studies', 'employee motivation', 'organizational behaviour'],
  },
  {
    triggers: ['hawthorne', 'observed workers', 'workers watched', 'people being watched', 'being watched'],
    topic: 'Hawthorne Studies',
    related: ['Elton Mayo', 'Human Relations Theory', 'observer effect', 'employee productivity'],
  },
  {
    triggers: ['workers motivation', 'worker motivation', 'employees motivation', 'motivation workers'],
    topic: 'Motivation Theory',
    related: ['Maslow hierarchy of needs', 'Herzberg two factor theory', 'employee motivation'],
  },
  {
    triggers: ['maslow', 'hierarchy of needs', 'hierarchy needs'],
    topic: "Maslow's Hierarchy of Needs",
    related: ['motivation theory', 'self-actualization', 'physiological needs', 'employee motivation'],
  },
  {
    triggers: ['herzberg', 'two factor', 'hygiene factor'],
    topic: 'Herzberg Two Factor Theory',
    related: ['motivators', 'hygiene factors', 'job satisfaction', 'motivation theory'],
  },
  {
    triggers: ['leadership style', 'leadership theory', 'leadership types', 'leadership thing'],
    topic: 'Leadership Theory',
    related: ['transformational leadership', 'transactional leadership', 'autocratic leadership', 'democratic leadership'],
  },
  {
    triggers: ['demand supply', 'supply demand', 'demand and supply'],
    topic: 'Demand and Supply',
    related: ['market equilibrium', 'price mechanism', 'elasticity', 'economics'],
  },
  {
    triggers: ['communication organization', 'communication in organization', 'organizational communication'],
    topic: 'Organizational Communication',
    related: ['formal communication', 'informal communication', 'management communication'],
  },
  {
    triggers: ['scientific management', 'taylor management'],
    topic: 'Scientific Management (Taylor)',
    related: ['time and motion study', 'classical management', 'Frederick Taylor'],
  },
  {
    triggers: ['bureaucracy', 'weber'],
    topic: 'Bureaucracy Theory (Weber)',
    related: ['classical management', 'organization theory', 'Max Weber'],
  },
  {
    triggers: ['computer stuff', 'computer thing', 'programming thing', 'coding stuff', 'computer stuffs'],
    topic: 'Computer Science / Programming',
    related: ['algorithms', 'data structures', 'software engineering'],
  },
  {
    triggers: ['accounting stuff', 'accounting thing', 'accounting thingy'],
    topic: 'Accounting',
    related: ['financial accounting', 'cost accounting', 'auditing', 'bookkeeping'],
  },
  {
    triggers: ['management stuff', 'management thing', 'management thingy'],
    topic: 'Management Theory',
    related: ['classical management', 'scientific management', 'organization theory'],
  },
  {
    triggers: ['motivation'],
    topic: 'Motivation Theory',
    related: ['Maslow hierarchy of needs', 'Herzberg two factor theory', 'employee motivation'],
  },
  {
    triggers: ['leadership'],
    topic: 'Leadership',
    related: ['leadership styles', 'management', 'transformational leadership'],
  },
];

function interpretVagueTopic(text: string): { topic: string; related: string[] } | null {
  const lower = text.toLowerCase();
  for (const hint of TOPIC_HINTS) {
    if (hint.triggers.some((t) => lower.includes(t))) return hint;
  }
  return null;
}

// ── Classifier ────────────────────────────────────────────────────────────────

function meaningfulLength(text: string) {
  return text.replace(/[^a-z0-9]/gi, '').length;
}

/**
 * Classify a user message.
 *
 * ONLY 'academic' and 'vague_academic' call /rag/ask.
 * All other intents are handled locally — no API call is made.
 */
function classifyMessage(text: string): MessageIntent {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized || meaningfulLength(normalized) < 3) return 'vague';
  if (greetingPattern.test(normalized)) return 'greeting';
  if (thinkingPattern.test(normalized)) return 'thinking';
  if (confirmationPattern.test(normalized)) return 'confirmation';
  if (unsurePattern.test(normalized)) return 'unsure';
  if (helpPattern.test(normalized)) return 'help';
  if (localActionPattern.test(normalized)) return 'help';
  if (practiceReqPattern.test(normalized)) return 'practice_req';
  if (campusSocialPattern.test(normalized)) return 'campus_social';
  if (lecturerQPattern.test(text)) return 'lecturer_q';  // use original for case
  if (vaguePattern.test(normalized)) return 'vague';
  // vague_academic: has vague markers but also real content words
  if (VAGUE_MARKERS.test(text) && contentWordCount(text) >= 1) return 'vague_academic';
  return 'academic';
}

// ── Local reply helpers ───────────────────────────────────────────────────────

function firstName(user: User | null) {
  return user?.name?.trim().split(/\s+/)[0] || '';
}

function extractLecturerName(text: string): string | null {
  const match =
    text.match(/what\s+(?:did|does)\s+([A-Z][a-z]+)\s+(?:teach|cover|explain|ask)/i) ||
    text.match(/(?:madam|sir|dr\.?|prof\.?|professor|mr\.?|mrs\.?)\s+([A-Za-z]+)/i) ||
    text.match(/how\s+does\s+([A-Z][a-z]+)\s+(?:set|ask|make|write)/i);
  return match ? match[1] : null;
}

function localAssistantReply(
  intent: Exclude<MessageIntent, 'academic' | 'vague_academic'>,
  question: string,
  user: User | null,
  repeatedVague: boolean,
  previousAssistantMessage: string,
): string {
  if (intent === 'greeting') {
    const name = firstName(user);
    return `Hey${name ? ` ${name}` : ''}. What course, topic, lecturer, or exam are you preparing for today?`;
  }

  if (intent === 'thinking') {
    return 'No problem. You can start with any course, topic, exam, or something you vaguely remember from class. You do not need exact keywords.';
  }

  if (intent === 'confirmation') {
    return 'Yes. You do not need to know the exact topic name. Describe what you remember, and ExamMind will try to connect it to uploaded materials, past questions, discussions, and practice.';
  }

  if (intent === 'help') {
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

  if (intent === 'unsure') {
    return [
      'No problem. You can start with a course, a topic from class, a lecturer, or an upcoming exam.',
      'If ExamMind does not have materials for it yet, upload lecture notes, past questions, course outlines, tutorial sheets, assignment questions, revision slides, or exam prep material.',
      '',
      'You can also:',
      '- Search the ExamMind library',
      '- Upload lecture notes or past questions',
      '- Generate practice',
      '- Join a reading room',
      '- Ask about any course topic in plain language',
    ].join('\n');
  }

  if (intent === 'practice_req') {
    return 'I can generate practice for you. Tell me the topic or course, or go to Generate Practice from the navigation to build a full quiz.';
  }

  if (intent === 'campus_social') {
    return 'You can find reading rooms and study groups from the Study Groups section in the navigation. Look for active rooms on topics you are studying.';
  }

  if (intent === 'lecturer_q') {
    const name = extractLecturerName(question);
    const whom = name ? `${name}'s` : "that lecturer's";
    return [
      `If ${whom} materials have been uploaded, I can analyze them.`,
      '',
      `To identify topics, question style, and patterns, upload materials connected to that lecturer:`,
      '- Lecture notes or slides',
      '- Past questions from their course',
      '- Course outlines',
      '- Tutorial sheets or assignment questions',
      '',
      'Once uploaded and indexed, ask me about the lecturer by name and I will search the uploaded materials.',
    ].join('\n');
  }

  // vague fallback
  const prevLower = previousAssistantMessage.toLowerCase();
  const prevAskedForTopic =
    prevLower.includes('what course') ||
    prevLower.includes('which course') ||
    prevLower.includes('what topic') ||
    prevLower.includes('which topic');

  if (repeatedVague || prevAskedForTopic) {
    return 'Try typing a course, topic, or upcoming exam. You can search the ExamMind library or upload course materials if you are not sure where to begin.';
  }

  return 'Which course, topic, or lecturer do you want to study?';
}

// ── RAG response helpers ──────────────────────────────────────────────────────

function missingMaterialsReply(question: string, understanding?: QueryUnderstanding | null): string {
  const topic = understanding?.interpreted_topic || question;
  const related = (understanding?.related_terms || [])
    .filter((t) => t.toLowerCase() !== topic.toLowerCase())
    .slice(0, 5);

  return [
    'I could not find this topic in the uploaded ExamMind materials yet. To make answers more grounded, upload lecture notes, past questions, course outlines, tutorial sheets, assignment questions, revision slides, or exam prep PDFs for this course/topic.',
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

const THINKING_STEPS_ACADEMIC = [
  'Understanding what you mean…',
  'Searching the ExamMind library…',
  'Checking lecture notes and past questions…',
  'Preparing a grounded answer…',
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
  const [thinkingText, setThinkingText] = useState(THINKING_STEPS_ACADEMIC[0]);
  const [courses, setCourses] = useState<Course[]>([]);
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const thinkingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const latestStudyAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'assistant' && m.wasStudyQuery),
    [messages],
  );

  const promptChips = useMemo(() => {
    if (courses.length === 0) return GENERIC_PROMPTS;
    const coursePrompts = courses.slice(0, 2).flatMap((course) => [
      `Explain a topic in ${course.code}`,
      `Find past questions for ${course.code}`,
    ]);
    return [...coursePrompts, 'Search uploaded notes', 'Generate practice', 'Upload course material'].slice(0, 6);
  }, [courses]);

  useEffect(() => {
    let cancelled = false;
    apiGet('/courses')
      .then((data) => {
        if (!cancelled) setCourses(data as Course[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedQuestion) setInput(selectedQuestion);
  }, [selectedQuestion]);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Cycle thinking steps while an API call is in progress
  useEffect(() => {
    if (loading) {
      let step = 0;
      setThinkingText(THINKING_STEPS_ACADEMIC[0]);
      thinkingIntervalRef.current = setInterval(() => {
        step = (step + 1) % THINKING_STEPS_ACADEMIC.length;
        setThinkingText(THINKING_STEPS_ACADEMIC[step]);
      }, 1500);
    } else {
      if (thinkingIntervalRef.current) {
        clearInterval(thinkingIntervalRef.current);
        thinkingIntervalRef.current = null;
      }
    }
    return () => {
      if (thinkingIntervalRef.current) clearInterval(thinkingIntervalRef.current);
    };
  }, [loading]);

  /**
   * Core RAG call — shared by 'academic' and 'vague_academic' intents.
   * This is the ONLY path that calls apiPost('/rag/ask').
   */
  const callRag = useCallback(
    async (question: string) => {
      setLoading(true);
      try {
        const data = (await apiPost('/rag/ask', { question })) as AskResponse;
        const noSources = data.no_past_questions_found && data.no_lecture_notes_found;
        onMessagesChange((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: noSources
              ? missingMaterialsReply(question, data.understanding)
              : data.answer,
            sources: data.sources || [],
            noPastQuestionsFound: data.no_past_questions_found,
            noLectureNotesFound: data.no_lecture_notes_found,
            wasStudyQuery: true,
            understanding: data.understanding || null,
          },
        ]);
      } catch (err) {
        onMessagesChange((current) => [
          ...current,
          {
            id: `assistant-error-${Date.now()}`,
            role: 'assistant',
            content: friendlyError(err),
            wasStudyQuery: true,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [onMessagesChange],
  );

  /**
   * GUARD: handleSend only calls /rag/ask when intent is 'academic' or 'vague_academic'.
   * Every other intent is handled locally with no API call.
   */
  const handleSend = useCallback(
    async (prompt?: string) => {
      const question = (prompt ?? input).trim();
      if (!question || loading) return;

      const intent = classifyMessage(question);

      // Add user message to chat
      onMessagesChange((current) => [
        ...current,
        { id: `user-${Date.now()}`, role: 'user', content: question },
      ]);
      setInput('');

      // ── Local intents (no API call) ──────────────────────────────────────
      if (intent !== 'academic' && intent !== 'vague_academic') {
        const recentVagueCount = [...messages]
          .reverse()
          .filter((m) => m.role === 'user')
          .slice(0, 2)
          .filter((m) => classifyMessage(m.content) === 'vague').length;
        const prevAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
        const prevContent = prevAssistant?.content ?? '';
        const content = localAssistantReply(
          intent,
          question,
          user,
          intent === 'vague' && recentVagueCount >= 1,
          prevContent,
        );
        onMessagesChange((current) => [
          ...current,
          {
            id: `assistant-local-${Date.now()}`,
            role: 'assistant',
            content,
            sources: [],
            wasStudyQuery: false,
          },
        ]);
        return;
      }

      // ── vague_academic: show interpretation, then call /rag/ask ─────────
      if (intent === 'vague_academic') {
        const hint = interpretVagueTopic(question);
        const interpMsg = hint
          ? `I think you may mean ${hint.topic}${
              hint.related.length > 0
                ? `, possibly linked to ${hint.related.slice(0, 3).join(', ')}`
                : ''
            }. I'll search the ExamMind library for those.`
          : "I'll try to understand what you mean and search the ExamMind library. Give me a moment.";

        onMessagesChange((current) => [
          ...current,
          {
            id: `assistant-interp-${Date.now()}`,
            role: 'assistant',
            content: interpMsg,
            sources: [],
            wasStudyQuery: false,
          },
        ]);
        // fall through to callRag
      }

      // ── academic / vague_academic: call /rag/ask ─────────────────────────
      await callRag(question);
    },
    [input, loading, messages, onMessagesChange, user, callRag],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page" id="s-assistant">
      <div className="pg-head">
        <div className="pg-title">
          AI <em>Assistant</em>
        </div>
        <div className="pg-sub">
          Describe a topic, course, lecturer, or exam in plain language. Exact keywords are not
          required.
        </div>
      </div>

      <div className="ai-layout">
        <div className="ai-panel">
          <div className="ai-hd">
            <div className="ai-dot"></div>
            <div className="ai-hd-title">ExamMind AI</div>
            <div className="ai-hd-sub">{loading ? thinkingText : 'Ready for your questions'}</div>
          </div>

          <div className="ai-msgs">
            {messages.map((message) => (
              <div
                className={`msg ${message.role === 'user' ? 'usr' : ''}`}
                key={message.id}
              >
                <div className={`msg-ava ${message.role === 'user' ? 'usr' : 'ai'}`}>
                  {message.role === 'user' ? 'You' : 'AI'}
                </div>
                <div className={`bubble ${message.role === 'user' ? 'usr' : 'ai'}`}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
                  {message.wasStudyQuery && message.understanding?.interpreted_topic && (
                    <div className="pq-ref-row">
                      <div className="pq-ref">
                        <div className="pq-ref-yr">Understood as</div>
                        <div className="pq-ref-q">
                          {message.understanding.interpreted_topic}
                          {message.understanding.related_terms.length > 0 && (
                            <span>
                              {' '}
                              · also searched{' '}
                              {message.understanding.related_terms.slice(0, 3).join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {message.sources && message.sources.length > 0 && (
                    <div className="pq-ref-row">
                      {message.sources.map((source) => (
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

            {/* Thinking animation — only shown during /rag/ask calls */}
            {loading && <ThinkingBubble text={thinkingText} />}
            <div ref={msgsEndRef} />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 20px 14px' }}>
            {promptChips.map((prompt) => (
              <button
                className="pill"
                key={prompt}
                onClick={() => void handleSend(prompt)}
                disabled={loading}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="ai-foot">
            <input
              className="ai-inp"
              type="text"
              placeholder="Ask about a topic, lecturer, past question, or anything you remember…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              disabled={loading}
            />
            <button
              className="send"
              onClick={() => void handleSend()}
              disabled={loading || !input.trim()}
            >
              {loading ? '...' : '>'}
            </button>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="related-panel">
          {!latestStudyAssistant && (
            <div className="card">
              <div className="card-hd">
                <div className="card-ttl">What can you ask?</div>
              </div>
              <div className="note-absent-msg">
                Ask about any course topic, uploaded note, past question, lecturer, or exam
                preparation task. You can describe what you remember, even if you do not know
                the exact topic name.
              </div>
              <div style={{ marginTop: 12 }}>
                <button
                  className="cta cta-ghost"
                  style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
                  onClick={() => go('questions')}
                >
                  Search uploaded materials
                </button>
                <button
                  className="cta cta-ghost"
                  style={{ width: '100%', justifyContent: 'center', fontSize: 12, marginTop: 8 }}
                  onClick={() => go('upload')}
                >
                  Upload course material
                </button>
                <button
                  className="cta cta-ghost"
                  style={{ width: '100%', justifyContent: 'center', fontSize: 12, marginTop: 8 }}
                  onClick={() => go('practice')}
                >
                  Generate practice
                </button>
                <button
                  className="cta cta-ghost"
                  style={{ width: '100%', justifyContent: 'center', fontSize: 12, marginTop: 8 }}
                  onClick={() => go('groups')}
                >
                  Join a reading room
                </button>
              </div>
            </div>
          )}

          {/* Warning cards only appear after a real academic query (wasStudyQuery === true) */}
          {latestStudyAssistant?.noLectureNotesFound && (
            <div className="note-absent">
              <div className="note-absent-lbl">No lecture notes found</div>
              <div className="note-absent-msg">
                The assistant did not find lecture notes for this question. Upload lecture
                notes, revision slides, or course outlines to improve future answers.
              </div>
              <button className="upload-prompt" onClick={() => go('upload')}>
                + Upload lecture notes
              </button>
            </div>
          )}

          {latestStudyAssistant?.noPastQuestionsFound && (
            <div className="note-absent">
              <div className="note-absent-lbl">No past questions found</div>
              <div className="note-absent-msg">
                No matching past question has been indexed yet. Upload past questions, tutorial
                sheets, assignment questions, or exam prep material for this topic.
              </div>
              <button className="upload-prompt" onClick={() => go('upload')}>
                + Upload past question
              </button>
            </div>
          )}

          <div className="card">
            <div className="card-hd">
              <div className="card-ttl">Sources</div>
            </div>
            {latestStudyAssistant?.sources && latestStudyAssistant.sources.length > 0 ? (
              <div className="prog-list">
                {latestStudyAssistant.sources.map((source) => (
                  <div className="qi" key={source}>
                    <div className="qi-body">
                      <div className="qi-title">{source}</div>
                    </div>
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
