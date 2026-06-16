import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenType, User } from '../types';
import { saveStudyPack } from '../offline';
import { apiGet, apiPost } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type Course = {
  id: number;
  code: string;
  name: string;
};

type PastQuestion = {
  id: number;
  course_id?: number | null;
  year?: number | null;
  semester?: string | null;
  difficulty?: string | null;
  content_text: string;
  verified_status?: string;
  metadata_json?: {
    course_code?: string;
    topics_covered?: string[];
    [key: string]: unknown;
  } | null;
};

type LectureNote = {
  id: number;
  course_id?: number | null;
  topic?: string | null;
  title: string;
  year?: number | null;
  semester?: string | null;
  verified_status?: string;
  metadata_json?: { course_code?: string; [key: string]: unknown } | null;
};

type SearchThread = {
  id: number;
  title: string;
  created_by?: number;
  created_by_username?: string | null;
  course_id?: number | null;
  created_at: string;
};

type StudyGroupResult = {
  id: number;
  name: string;
  description: string | null;
  course_id: number | null;
  topic: string | null;
  created_by_username: string | null;
  created_at: string;
  member_count: number;
  is_member: boolean;
};

type StudySessionResult = {
  id: number;
  title: string;
  topic: string | null;
  exam_goal: string | null;
  course_id: number | null;
  creator_username: string | null;
  status: string;
  created_at: string;
  participant_count: number;
  studying_count: number;
  on_break_count: number;
};

type SearchResult = {
  query: string;
  understanding?: QueryUnderstanding | null;
  past_questions: PastQuestion[];
  lecture_notes: LectureNote[];
  threads: SearchThread[];
  related_topics: string[];
  study_groups: StudyGroupResult[];
  study_sessions: StudySessionResult[];
};

type QueryUnderstanding = {
  interpreted_topic: string | null;
  related_terms: string[];
  possible_courses: string[];
  possible_people: string[];
  intent: string;
  confidence: number;
  needs_clarification: boolean;
  clarifying_question: string | null;
};

type AiExplanation = {
  answer: string;
  sources: string[];
  past_question_sources: string[];
  lecture_note_sources: string[];
  no_past_questions_found: boolean;
  no_lecture_notes_found: boolean;
  understanding?: QueryUnderstanding | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function difficultyClass(difficulty?: string | null) {
  const d = (difficulty || '').toLowerCase();
  if (d === 'hard') return 'tag-h';
  if (d === 'medium' || d === 'mixed') return 'tag-m';
  return 'tag-e';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: 7,
  padding: '7px 12px',
  color: 'var(--text)',
  fontFamily: 'var(--font)',
  fontSize: 13,
  outline: 'none',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function SmartSearch({
  go,
  onAskQuestion,
  onQuestionCountChange,
  user: _user,
  onGoToPractice,
}: {
  go: (s: ScreenType) => void;
  onAskQuestion: (questionText: string) => void;
  onQuestionCountChange?: (count: number) => void;
  user: User | null;
  onGoToPractice: (topic: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState<number | ''>('');
  const [showFilters, setShowFilters] = useState(false);

  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiExplanation | null>(null);
  const [aiError, setAiError] = useState('');

  const [offlineMsg, setOfflineMsg] = useState('');
  const [creatingThreadFor, setCreatingThreadFor] = useState<number | null>(null);
  const [groupActionPending, setGroupActionPending] = useState<number | null>(null);

  const [courses, setCourses] = useState<Course[]>([]);

  const courseMap = new Map(courses.map((c) => [c.id, c]));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet('/courses')
      .then((data) => { if (!cancelled) setCourses(data as Course[]); })
      .catch(() => { /* filters still work without course list */ });
    return () => { cancelled = true; };
  }, []);

  // Focus the search input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const runSearch = useCallback(async (q: string) => {
    q = q.trim();
    if (!q) return;
    setSearching(true);
    setSearchError('');
    setHasSearched(true);
    setResults(null);
    setAiResult(null);
    setAiError('');
    setOfflineMsg('');
    try {
      const params = new URLSearchParams({ q });
      if (selectedCourseId) params.set('course_id', String(selectedCourseId));
      const data = await apiGet(`/search?${params.toString()}`) as SearchResult;
      setResults(data);
      onQuestionCountChange?.(data.past_questions.length);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed. Is the backend running?');
    } finally {
      setSearching(false);
    }
  }, [selectedCourseId, onQuestionCountChange]);

  const getAiExplanation = async () => {
    if (!searchQuery.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError('');
    try {
      const body: Record<string, unknown> = { question: searchQuery };
      if (selectedCourseId) body.course_id = Number(selectedCourseId);
      const data = await apiPost('/rag/ask', body) as AiExplanation;
      setAiResult(data);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI explanation unavailable.');
    } finally {
      setAiLoading(false);
    }
  };

  const discussQuestion = async (event: React.MouseEvent, question: PastQuestion) => {
    event.stopPropagation();
    if (creatingThreadFor !== null) return;
    setCreatingThreadFor(question.id);
    try {
      await apiPost('/threads', {
        title: question.content_text.slice(0, 100).trim(),
        past_question_id: question.id,
      });
    } catch {
      // best-effort — if it fails, navigate anyway
    } finally {
      setCreatingThreadFor(null);
    }
    go('collab');
  };

  const saveOffline = async () => {
    if (!results?.past_questions.length) return;
    const packQuestions = results.past_questions.map((q) => ({
      year: String(q.year || 'Unknown'),
      topic: q.metadata_json?.topics_covered?.[0] || 'General',
      difficulty: q.difficulty || 'Mixed',
      text: q.content_text,
    }));
    await saveStudyPack({
      id: `search-${Date.now()}`,
      courseCode: selectedCourseId ? (courseMap.get(Number(selectedCourseId))?.code || 'All') : 'All',
      title: `"${results.query}" study pack`,
      savedAt: new Date().toISOString(),
      questions: packQuestions,
    });
    setOfflineMsg(`${packQuestions.length} question${packQuestions.length > 1 ? 's' : ''} saved for offline study.`);
    window.dispatchEvent(new Event('exammind-offline-updated'));
  };

  const joinGroup = async (groupId: number) => {
    if (groupActionPending !== null) return;
    setGroupActionPending(groupId);
    try {
      const res = await apiPost(`/study-groups/${groupId}/join`, {}) as { member_count: number };
      setResults((prev) =>
        prev
          ? {
              ...prev,
              study_groups: prev.study_groups.map((g) =>
                g.id === groupId ? { ...g, is_member: true, member_count: res.member_count } : g
              ),
            }
          : prev
      );
    } catch {
      // leave state — user can retry
    } finally {
      setGroupActionPending(null);
    }
  };

  const leaveGroup = async (groupId: number) => {
    if (groupActionPending !== null) return;
    setGroupActionPending(groupId);
    try {
      const res = await apiPost(`/study-groups/${groupId}/leave`, {}) as { member_count: number };
      setResults((prev) =>
        prev
          ? {
              ...prev,
              study_groups: prev.study_groups.map((g) =>
                g.id === groupId ? { ...g, is_member: false, member_count: res.member_count } : g
              ),
            }
          : prev
      );
    } catch {
      // leave state — user can retry
    } finally {
      setGroupActionPending(null);
    }
  };

  const pqCourseLabel = (q: PastQuestion) => {
    if (q.course_id && courseMap.has(q.course_id)) return courseMap.get(q.course_id)!.code;
    return q.metadata_json?.course_code || '';
  };

  const lnCourseLabel = (note: LectureNote) => {
    if (note.course_id && courseMap.has(note.course_id)) return courseMap.get(note.course_id)!.code;
    return (note.metadata_json as { course_code?: string } | null)?.course_code || '';
  };

  const hasAnyResults = results && (
    results.past_questions.length > 0 ||
    results.lecture_notes.length > 0 ||
    results.threads.length > 0 ||
    (results.study_groups?.length ?? 0) > 0 ||
    (results.study_sessions?.length ?? 0) > 0
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page" id="s-questions">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="pg-head">
        <div className="pg-title">Knowledge <em>Search</em></div>
        <div className="pg-sub">No exact keywords needed. Describe a topic, course, question, or anything you remember.</div>
      </div>

      {/* ── Search bar ───────────────────────────────────────── */}
      <div className="card" style={{ padding: '18px 22px', marginBottom: 22 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            ref={inputRef}
            className="ai-inp"
            type="text"
            placeholder="Describe a topic, course, question, or anything you remember..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) void runSearch(searchQuery); }}
            style={{ flex: 1 }}
          />
          <button
            className="cta"
            style={{ marginTop: 0, padding: '0 22px', height: 40, flexShrink: 0 }}
            onClick={() => void runSearch(searchQuery)}
            disabled={searching || !searchQuery.trim()}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
          <button
            className="cta cta-ghost"
            style={{ marginTop: 0, height: 40, padding: '0 14px', flexShrink: 0 }}
            onClick={() => setShowFilters((v) => !v)}
          >
            {showFilters ? 'Hide filters' : 'Filters'}
          </button>
        </div>

        {showFilters && (
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: .5 }}>Optional filters</div>
            <select style={selectStyle} value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">All courses</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text3)' }}>
          ExamMind understands vague topic descriptions and searches the uploaded library around what you probably mean.
        </div>
      </div>

      {/* ── Pre-search state ─────────────────────────────────── */}
      {!hasSearched && !searching && (
        <div className="pred-card">
          <div className="pred-lbl">Knowledge Search</div>
          <div className="pred-title">Find anything, learn <em style={{ color: 'var(--gold)' }}>instantly</em></div>
          <div className="pred-body">
            Type a keyword, sentence, or natural-language question. ExamMind searches past questions,
            lecture notes, and discussions in one go — semantically when AI is configured, by keyword otherwise.
            <br /><br />
            Try: "the human relations thingy" · "what came out last year?" · "workers motivation" · "find past questions on leadership" · "demand and supply stuff" · "what should I read tonight?"
          </div>
        </div>
      )}

      {searching && (
        <div className="card" style={{ padding: '18px 22px', textAlign: 'center', color: 'var(--text2)', fontSize: 13.5 }}>
          Searching across knowledge base…
        </div>
      )}

      {searchError && <div className="upload-alert" style={{ marginBottom: 16 }}>{searchError}</div>}

      {/* ── Results ──────────────────────────────────────────── */}
      {hasSearched && !searching && results && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {results.understanding && (
            <div className="card" style={{ borderColor: results.understanding.needs_clarification ? 'rgba(232,162,58,0.35)' : 'rgba(62,207,178,0.22)' }}>
              <div className="card-hd" style={{ marginBottom: 8 }}>
                <div className="card-ttl">Search Interpretation</div>
              </div>
              {results.understanding.needs_clarification ? (
                <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                  I'm not fully sure what you mean. {results.understanding.clarifying_question}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.65 }}>
                  {results.understanding.interpreted_topic && (
                    <div>I understood this as: <strong style={{ color: 'var(--text)' }}>{results.understanding.interpreted_topic}</strong></div>
                  )}
                  {results.understanding.related_terms.length > 0 && (
                    <div style={{ marginTop: 4 }}>Also searched: {results.understanding.related_terms.slice(0, 6).join(', ')}</div>
                  )}
                  {results.understanding.possible_courses && results.understanding.possible_courses.length > 0 && (
                    <div style={{ marginTop: 4 }}>Related courses: {results.understanding.possible_courses.join(', ')}</div>
                  )}
                  {results.understanding.possible_people && results.understanding.possible_people.length > 0 && (
                    <div style={{ marginTop: 4 }}>Name references: {results.understanding.possible_people.join(', ')}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── AI Explanation ─────────────────────────────── */}
          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, var(--bg2), rgba(62,207,178,0.025))',
              borderColor: 'rgba(62,207,178,0.18)',
            }}
          >
            <div className="card-hd" style={{ marginBottom: aiResult ? 14 : 0 }}>
              <div className="card-ttl" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: .8, textTransform: 'uppercase', color: 'var(--teal)', background: 'var(--teal2)', border: '1px solid rgba(62,207,178,0.25)', borderRadius: 4, padding: '1px 6px' }}>AI</span>
                AI Explanation
              </div>
              {!aiResult && !aiLoading && !aiError && (
                <button className="cta" style={{ marginTop: 0, fontSize: 12, padding: '6px 16px' }} onClick={() => void getAiExplanation()}>
                  Get AI Explanation
                </button>
              )}
            </div>

            {!aiResult && !aiLoading && !aiError && (
              <div style={{ fontSize: 13, color: 'var(--text3)' }}>
                Click "Get AI Explanation" to generate a grounded answer from your uploaded knowledge base. Costs one AI call.
              </div>
            )}

            {aiLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)', fontSize: 13 }}>
                <div className="ai-dot"></div>
                Generating explanation from knowledge base…
              </div>
            )}

            {aiError && (
              <div>
                <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 8 }}>{aiError}</div>
                <button className="cta cta-ghost" style={{ marginTop: 0, fontSize: 12 }} onClick={() => void getAiExplanation()}>Retry</button>
              </div>
            )}

            {aiResult && (
              <div>
                <div style={{ fontSize: 13.5, lineHeight: 1.75, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
                  {aiResult.answer}
                </div>
                {aiResult.sources.length > 0 && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: .6, marginBottom: 6 }}>Sources</div>
                    {aiResult.sources.map((s, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--teal)', marginBottom: 3 }}>· {s}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Past Questions ─────────────────────────────── */}
          <div className="card">
            <div className="card-hd">
              <div className="card-ttl">
                Past Questions
                {results.past_questions.length > 0 && (
                  <span className="ni-badge" style={{ marginLeft: 7 }}>{results.past_questions.length}</span>
                )}
              </div>
              {results.past_questions.length > 0 && (
                <button className="cta cta-ghost" style={{ marginTop: 0, fontSize: 12 }} onClick={() => void saveOffline()}>
                  Save offline
                </button>
              )}
            </div>

            {offlineMsg && (
              <div style={{ fontSize: 12, color: 'var(--teal)', marginBottom: 10 }}>{offlineMsg}</div>
            )}

            {results.past_questions.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text3)', padding: '4px 0' }}>
                No past questions matched this search.{' '}
                <button className="card-lnk as-button" onClick={() => go('upload')}>
                  Upload past questions →
                </button>
              </div>
            ) : (
              results.past_questions.map((q) => (
                <div className="qd" style={{ cursor: 'default' }} key={q.id}>
                  <div className="qd-text">{q.content_text}</div>
                  <div className="qd-meta">
                    <span className={`tag ${difficultyClass(q.difficulty)}`}>{q.difficulty || 'Mixed'}</span>
                    {q.year && <span className="qi-yr">{q.year}</span>}
                    {q.semester && <span className="qi-yr">{q.semester}</span>}
                    {pqCourseLabel(q) && (
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>{pqCourseLabel(q)}</span>
                    )}
                    {q.metadata_json?.topics_covered?.[0] && (
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>· {q.metadata_json.topics_covered[0]}</span>
                    )}
                    <button
                      className="ask-ai-btn"
                      onClick={(e) => { e.stopPropagation(); onAskQuestion(q.content_text); }}
                    >
                      Ask AI →
                    </button>
                    <button
                      className="cta cta-ghost"
                      style={{ marginTop: 0, fontSize: 11, padding: '3px 10px' }}
                      onClick={(e) => void discussQuestion(e, q)}
                      disabled={creatingThreadFor === q.id}
                    >
                      {creatingThreadFor === q.id ? '…' : 'Discuss'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Lecture Notes ──────────────────────────────── */}
          <div className="card">
            <div className="card-hd">
              <div className="card-ttl">
                Lecture Notes
                {results.lecture_notes.length > 0 && (
                  <span className="ni-badge" style={{ marginLeft: 7 }}>{results.lecture_notes.length}</span>
                )}
              </div>
            </div>

            {results.lecture_notes.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text3)', padding: '4px 0' }}>
                No lecture notes found for this search.
                <div style={{ marginTop: 12 }}>
                  <button className="cta" style={{ marginTop: 0, fontSize: 12 }} onClick={() => go('upload')}>
                    Upload notes to help others →
                  </button>
                </div>
              </div>
            ) : (
              results.lecture_notes.map((note) => (
                <div className="qd" style={{ cursor: 'default' }} key={note.id}>
                  <div className="qd-text" style={{ fontWeight: 500 }}>{note.title}</div>
                  <div className="qd-meta">
                    {lnCourseLabel(note) && (
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>{lnCourseLabel(note)}</span>
                    )}
                    {note.topic && <span className="tag tag-m">{note.topic}</span>}
                    {note.year && <span className="qi-yr">{note.year}</span>}
                    {note.semester && <span className="qi-yr">{note.semester}</span>}
                    <button
                      className="ask-ai-btn"
                      onClick={() => onAskQuestion(`Explain: ${note.title}`)}
                    >
                      Ask AI →
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Discussions ────────────────────────────────── */}
          <div className="card">
            <div className="card-hd">
              <div className="card-ttl">
                Discussions
                {results.threads.length > 0 && (
                  <span className="ni-badge" style={{ marginLeft: 7 }}>{results.threads.length}</span>
                )}
              </div>
              <button
                className="card-lnk"
                style={{ cursor: 'pointer' }}
                onClick={() => go('collab')}
              >
                All threads →
              </button>
            </div>

            {results.threads.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text3)', padding: '4px 0' }}>
                No discussion threads found for this topic.{' '}
                <button className="card-lnk as-button" onClick={() => go('collab')}>
                  Start one in Collaboration →
                </button>
              </div>
            ) : (
              results.threads.map((thread) => (
                <div
                  className="collab-item"
                  key={thread.id}
                  onClick={() => go('collab')}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="collab-top">
                    <div className="collab-name">{thread.title}</div>
                    <div className="collab-time">{timeAgo(thread.created_at)}</div>
                  </div>
                  {thread.created_by_username && (
                    <div className="collab-msg" style={{ color: 'var(--text3)', fontSize: 12 }}>
                      Started by @{thread.created_by_username}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* ── Study Groups ───────────────────────────────── */}
          <div className="card">
            <div className="card-hd">
              <div className="card-ttl">
                Study Groups
                {results.study_groups.length > 0 && (
                  <span className="ni-badge" style={{ marginLeft: 7 }}>{results.study_groups.length}</span>
                )}
              </div>
              <button className="card-lnk" style={{ cursor: 'pointer' }} onClick={() => go('groups')}>
                All groups →
              </button>
            </div>

            {results.study_groups.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text3)', padding: '4px 0' }}>
                No study groups found for "{results.query}".{' '}
                <button className="card-lnk as-button" onClick={() => go('groups')}>
                  Create one in Study Groups →
                </button>
              </div>
            ) : (
              results.study_groups.map((group) => {
                const pending = groupActionPending === group.id;
                return (
                  <div className="qd" style={{ cursor: 'default' }} key={group.id}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{group.name}</div>
                    {group.description && (
                      <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 3, marginBottom: 4 }}>{group.description}</div>
                    )}
                    <div className="qd-meta">
                      {group.topic && <span className="tag tag-m">{group.topic}</span>}
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {group.member_count} member{group.member_count !== 1 ? 's' : ''}
                      </span>
                      {group.created_by_username && (
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>by @{group.created_by_username}</span>
                      )}
                      {group.is_member ? (
                        <button
                          className="cta cta-ghost"
                          style={{ marginTop: 0, fontSize: 11, padding: '3px 10px', color: 'var(--text3)' }}
                          onClick={() => void leaveGroup(group.id)}
                          disabled={pending}
                        >
                          {pending ? '…' : 'Leave'}
                        </button>
                      ) : (
                        <button
                          className="cta"
                          style={{ marginTop: 0, fontSize: 11, padding: '3px 12px' }}
                          onClick={() => void joinGroup(group.id)}
                          disabled={pending}
                        >
                          {pending ? '…' : 'Join'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Reading Rooms ──────────────────────────────── */}
          <div className="card">
            <div className="card-hd">
              <div className="card-ttl">
                Reading Rooms
                {(results.study_sessions?.length ?? 0) > 0 && (
                  <span className="ni-badge" style={{ marginLeft: 7 }}>{results.study_sessions.length}</span>
                )}
              </div>
              <button className="card-lnk" style={{ cursor: 'pointer' }} onClick={() => go('groups')}>
                All rooms →
              </button>
            </div>

            {(results.study_sessions?.length ?? 0) === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text3)', padding: '4px 0' }}>
                No active reading rooms for "{results.query}".{' '}
                <button className="card-lnk as-button" onClick={() => go('groups')}>
                  Start one in Study Groups →
                </button>
              </div>
            ) : (
              results.study_sessions.map((room) => (
                <div className="qd" style={{ cursor: 'default' }} key={room.id}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{room.title}</div>
                  {room.exam_goal && (
                    <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 3, marginBottom: 4 }}>Goal: {room.exam_goal}</div>
                  )}
                  <div className="qd-meta">
                    {room.topic && <span className="tag tag-m">{room.topic}</span>}
                    <span style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 600 }}>
                      {room.studying_count} studying · {room.on_break_count} on break
                    </span>
                    {room.creator_username && (
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>by @{room.creator_username}</span>
                    )}
                    <button
                      className="cta"
                      style={{ marginTop: 0, fontSize: 11, padding: '3px 12px' }}
                      onClick={() => go('groups')}
                    >
                      Join Room →
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Practice Suggestions ───────────────────────── */}
          {hasAnyResults && (
            <div className="card" style={{ background: 'linear-gradient(135deg, var(--bg2), rgba(232,162,58,0.025))', borderColor: 'rgba(232,162,58,0.18)' }}>
              <div className="card-hd" style={{ marginBottom: 0 }}>
                <div style={{ flex: 1 }}>
                  <div className="card-ttl">Generate Practice</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 4 }}>
                    Build a practice test from "<strong>{results.query}</strong>" using matched past questions.
                  </div>
                </div>
                <button
                  className="cta"
                  style={{ marginTop: 0, flexShrink: 0 }}
                  onClick={() => onGoToPractice(results.query)}
                >
                  Generate Practice →
                </button>
              </div>
            </div>
          )}

          {/* ── Related Topics ─────────────────────────────── */}
          {results.related_topics.length > 0 && (
            <div className="card">
              <div className="card-hd">
                <div className="card-ttl">Related Topics</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>click to search</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {results.related_topics.map((topic) => (
                  <button
                    key={topic}
                    className="pill"
                    onClick={() => { setSearchQuery(topic); void runSearch(topic); }}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Empty state (all sections empty) ───────────── */}
          {!hasAnyResults && !searchError && (
            <div className="empty-state">
              <div className="empty-title">No results found</div>
              <div className="empty-body">
                Nothing matched "<em>{results.query}</em>". Try a different keyword, or upload materials to build the knowledge base.
              </div>
              <div className="empty-actions">
                <button className="cta" onClick={() => go('upload')}>Upload material</button>
                <button className="cta cta-ghost" onClick={() => { setSearchQuery(''); setHasSearched(false); setResults(null); }}>
                  Clear search
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
