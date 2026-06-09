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

type IntentResult = {
  intent: string;
  student_state: string;
  should_call_rag: boolean;
  should_search: boolean;
  should_ask_clarifying_question: boolean;
  interpreted_topic: string | null;
  related_terms: string[];
  possible_course: string | null;
  possible_lecturer: string | null;
  confidence: number;
  response_strategy: string;
  clarifying_question: string | null;
};

type Course = {
  id: number;
  code: string;
  name: string;
};

type ThinkingPhase = 'idle' | 'understanding' | 'searching';

const PHASE_TEXT: Record<Exclude<ThinkingPhase, 'idle'>, string> = {
  understanding: 'Understanding what you mean…',
  searching: 'Searching the ExamMind library…',
};

// Pure single-word greetings handled locally without any API call
const TRIVIAL_GREETINGS = new Set([
  'hi', 'hey', 'hello', 'yo', 'sup', 'hiya',
  'good morning', 'good afternoon', 'good evening',
]);

// ── Local reply helpers ───────────────────────────────────────────────────────

function firstName(user: User | null) {
  return user?.name?.trim().split(/\s+/)[0] || '';
}

function buildContext(msgs: ChatMessage[]): string {
  return msgs
    .slice(-4)
    .map((m) => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content.slice(0, 150)}`)
    .join('\n');
}

function buildLocalReply(
  result: IntentResult,
  user: User | null,
  messages: ChatMessage[],
): string {
  const name = firstName(user);
  const { intent, student_state, clarifying_question } = result;

  if (intent === 'greeting') {
    return `Hey${name ? ` ${name}` : ''}. What course, topic, lecturer, or exam are you preparing for today?`;
  }

  if (intent === 'guidance_needed') {
    if (student_state === 'frustrated' || student_state === 'overwhelmed') {
      return [
        `${name ? `Hey ${name}, it` : 'It'}'s okay — feeling overwhelmed before exams is normal.`,
        '',
        'Start with whatever feels most familiar: a course, a topic, a lecturer, or just an exam date. You do not need to know the exact topic name.',
        '',
        'You can also:',
        '- Search the ExamMind library',
        '- Upload lecture notes or past questions',
        '- Generate practice questions',
        '- Join a reading room',
      ].join('\n');
    }
    return [
      `No problem${name ? `, ${name}` : ''}. Start with a course, a topic from class, a lecturer, or an upcoming exam.`,
      '',
      'If ExamMind does not have materials for it yet, upload lecture notes, past questions, course outlines, tutorial sheets, assignment questions, revision slides, or exam prep material.',
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

  if (intent === 'lecturer_pattern') {
    const whom = result.possible_lecturer ? `${result.possible_lecturer}'s` : "that lecturer's";
    return [
      `If ${whom} materials have been uploaded, I can analyze them.`,
      '',
      'To identify topics, question style, and patterns, upload materials connected to that lecturer:',
      '- Lecture notes or slides',
      '- Past questions from their course',
      '- Course outlines',
      '- Tutorial sheets or assignment questions',
      '',
      'Once uploaded and indexed, ask me about the lecturer by name and I will search the uploaded materials.',
    ].join('\n');
  }

  if (intent === 'academic_search') {
    return 'I can search for past questions and exam materials. Go to the Questions section to search uploaded materials, or upload new past questions first.';
  }

  if (intent === 'unclear') {
    if (clarifying_question) return clarifying_question;
    return 'Which course, topic, or lecturer do you want to study?';
  }

  // Generic fallback
  const prevAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const prevLower = (prevAssistant?.content ?? '').toLowerCase();
  const prevAskedForTopic =
    prevLower.includes('what course') ||
    prevLower.includes('which course') ||
    prevLower.includes('what topic') ||
    prevLower.includes('which topic');
  if (prevAskedForTopic) {
    return 'Try typing a course, topic, or upcoming exam. You can search the ExamMind library or upload course materials if you are not sure where to begin.';
  }
  return `Which course, topic, or lecturer do you want to study${name ? `, ${name}` : ''}?`;
}

function buildInterpretationMsg(result: IntentResult, original: string): string {
  const topic = result.interpreted_topic!;
  const isSame = topic.toLowerCase().trim() === original.toLowerCase().trim();
  if (isSame) return '';
  const related = result.related_terms.slice(0, 3);
  return `I think you mean "${topic}"${related.length ? ` — also searching: ${related.join(', ')}` : ''}. Searching the ExamMind library.`;
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
  const [courses, setCourses] = useState<Course[]>([]);
  const msgsEndRef = useRef<HTMLDivElement>(null);

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
  }, [messages, loading, thinkingPhase]);

  // Only path that calls /rag/ask
  const callRag = useCallback(
    async (question: string) => {
      setLoading(true);
      setThinkingPhase('searching');
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
        setThinkingPhase('idle');
      }
    },
    [onMessagesChange],
  );

  const handleSend = useCallback(
    async (prompt?: string) => {
      const question = (prompt ?? input).trim();
      if (!question || loading) return;

      onMessagesChange((current) => [
        ...current,
        { id: `user-${Date.now()}`, role: 'user', content: question },
      ]);
      setInput('');

      // Trivial guard — pure greeting words handled locally, no API call
      const norm = question.toLowerCase().replace(/\s+/g, ' ').trim();
      if (TRIVIAL_GREETINGS.has(norm)) {
        const name = firstName(user);
        onMessagesChange((current) => [
          ...current,
          {
            id: `assistant-local-${Date.now()}`,
            role: 'assistant',
            content: `Hey${name ? ` ${name}` : ''}. What course, topic, lecturer, or exam are you preparing for today?`,
            wasStudyQuery: false,
          },
        ]);
        return;
      }

      // Phase 1 — call /understand for semantic intent classification
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
        onMessagesChange((current) => [
          ...current,
          {
            id: `assistant-error-${Date.now()}`,
            role: 'assistant',
            content: friendlyError(err),
            wasStudyQuery: false,
          },
        ]);
        return;
      }

      // Non-RAG intents — reply locally, never call /rag/ask
      if (!result.should_call_rag) {
        setLoading(false);
        setThinkingPhase('idle');
        onMessagesChange((current) => [
          ...current,
          {
            id: `assistant-local-${Date.now()}`,
            role: 'assistant',
            content: buildLocalReply(result, user, messages),
            wasStudyQuery: false,
          },
        ]);
        return;
      }

      // Phase 2 — academic intent with topic: show interpretation if topic expanded from vague
      const ragQuery = result.interpreted_topic || question;
      const interpMsg = buildInterpretationMsg(result, question);
      if (interpMsg) {
        onMessagesChange((current) => [
          ...current,
          {
            id: `assistant-interp-${Date.now()}`,
            role: 'assistant',
            content: interpMsg,
            wasStudyQuery: false,
          },
        ]);
      }

      // callRag transitions phase to 'searching' and back to 'idle' when done
      await callRag(ragQuery);
    },
    [input, loading, messages, onMessagesChange, user, callRag],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const headerSub =
    thinkingPhase !== 'idle' ? PHASE_TEXT[thinkingPhase] : 'Ready for your questions';

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
            <div className="ai-hd-sub">{headerSub}</div>
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

            {thinkingPhase !== 'idle' && <ThinkingBubble text={PHASE_TEXT[thinkingPhase]} />}
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
