import { useEffect, useRef, useState } from 'react';
import './App.css';
import type {
  ChatMessage,
  GlobalSearchResult,
  LectureNote,
  PastQuestion,
  ScreenType,
  SearchSuggestedAction,
  User,
} from './types';

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: 'Ask me anything about your uploaded past questions and lecture notes. You can also ask me to explain a topic, find related past questions, or suggest practice.',
  },
];
const AUTH_RESET_KEY = 'exammind-first-upload-auth-reset-v1';
import Dashboard from './screens/Dashboard';
import Questions from './screens/Questions';
import Assistant from './screens/Assistant';
import Upload from './screens/Upload';
import Offline from './screens/Offline';
import Analytics from './screens/Analytics';
import Collab from './screens/Collab';
import Practice from './screens/Practice';
import Progress from './screens/Progress';
import StudyGroups from './screens/StudyGroups';
import Empty from './screens/Empty';
import OfflineStatus from './components/OfflineStatus';
import { Auth } from './components/Auth';
import { apiGet } from './lib/api';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const SEARCH_GUIDANCE = 'Try searching for a course, topic, lecturer, past question, note, or exam phrase.';
const SEARCH_NONTOPICS = new Set([
  'hey', 'hi', 'hello', 'okay', 'ok', 'sure', 'yes', 'yeah', 'yep', 'no', 'nah',
  'lost', 'tired', 'confused', 'meant', 'thanks', 'thank', 'hmm', 'hm',
]);

function isConversationOnlySearch(query: string): boolean {
  const words = query.toLowerCase().match(/[a-z]+/g) || [];
  return words.length > 0 && words.every(word => SEARCH_NONTOPICS.has(word));
}

function hasUsefulInterpretation(result: GlobalSearchResult | null): boolean {
  const topic = result?.understanding?.interpreted_topic?.trim();
  if (!topic) return false;
  const query = (result?.query || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normalizedTopic = topic.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return Boolean(normalizedTopic && normalizedTopic !== query && !query.includes(normalizedTopic));
}

function resultCount(result: GlobalSearchResult | null): number {
  if (!result) return 0;
  return (
    result.past_questions.length +
    result.lecture_notes.length +
    result.threads.length +
    result.study_groups.length +
    result.study_sessions.length +
    result.related_topics.length
  );
}

function textPreview(value: string | null | undefined, fallback: string, max = 92): string {
  const text = (value || fallback).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

export default function App() {
  const [token, setToken] = useState(() => {
    if (!localStorage.getItem(AUTH_RESET_KEY)) {
      localStorage.removeItem('token');
      localStorage.setItem(AUTH_RESET_KEY, 'true');
      return null;
    }
    return localStorage.getItem('token');
  });
  const [user, setUser] = useState<User | null>(null);
  const [activeScreen, setActiveScreen] = useState<ScreenType>('upload');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState('');
  const [toast, setToast] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [practiceInitialTopic, setPracticeInitialTopic] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<GlobalSearchResult | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchGuidance, setSearchGuidance] = useState('');
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // Hydrate user info from a stored token on first load
  useEffect(() => {
    if (!token) return;

    apiGet('/auth/me')
      .then((data) => setUser(data as User))
      .catch(() => {
        // Token is expired or invalid — force back to login
        localStorage.removeItem('token');
        setToken(null);
      });
  }, [token]);

  const handleLogin = async (jwt: string) => {
    localStorage.setItem('token', jwt);
    setToken(jwt);
    try {
      const data = await apiGet('/auth/me') as User;
      setUser(data);
    } catch {
      // /me failed but login succeeded — proceed without user info
    }
    setActiveScreen('upload');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setActiveScreen('upload');
    setSidebarOpen(false);
  };

  const go = (screen: ScreenType) => {
    setActiveScreen(screen);
    setSidebarOpen(false);
    setToast('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const notifyUnavailable = (feature: string) => {
    setToast(`${feature} is not available yet.`);
    window.setTimeout(() => setToast(''), 3600);
  };

  const runGlobalSearch = async (query: string, forceOpen = true) => {
    const trimmed = query.trim();
    const seq = ++searchSeq.current;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);

    if (trimmed.length < 2) {
      setSearchResult(null);
      setSearchError('');
      setSearchGuidance('');
      setSearchLoading(false);
      setSearchOpen(false);
      return;
    }

    if (isConversationOnlySearch(trimmed)) {
      setSearchResult(null);
      setSearchError('');
      setSearchGuidance(SEARCH_GUIDANCE);
      setSearchLoading(false);
      setSearchOpen(true);
      return;
    }

    setSearchLoading(true);
    setSearchError('');
    setSearchGuidance('');
    if (forceOpen) setSearchOpen(true);
    try {
      const data = await apiGet(`/search?q=${encodeURIComponent(trimmed)}`) as GlobalSearchResult;
      if (seq !== searchSeq.current) return;
      setSearchResult(data);
      setSearchOpen(true);
    } catch {
      if (seq !== searchSeq.current) return;
      setSearchResult(null);
      setSearchError('Cannot reach ExamMind search. Check that the backend is running and VITE_API_BASE_URL matches the backend port.');
      setSearchOpen(true);
    } finally {
      if (seq === searchSeq.current) setSearchLoading(false);
    }
  };

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (searchQuery.trim().length < 2) {
      setSearchResult(null);
      setSearchOpen(false);
      setSearchGuidance('');
      setSearchError('');
      return;
    }
    searchDebounce.current = setTimeout(() => {
      void runGlobalSearch(searchQuery, true);
    }, 420);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchQuery]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!searchBoxRef.current?.contains(event.target as Node)) setSearchOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSearchOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const askQuestion = (questionText: string) => {
    setSelectedQuestion(questionText);
    go('assistant');
  };

  const handleGoToPractice = (topic: string) => {
    setPracticeInitialTopic(topic);
    go('practice');
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
  };

  const askAIFromSearch = (question: string) => {
    askQuestion(question);
    closeSearch();
  };

  const handleSearchAction = (action: SearchSuggestedAction) => {
    const payload = action.payload || {};
    const topic = String(payload.topic || searchResult?.understanding?.interpreted_topic || searchQuery || '');
    const question = String(payload.question || `Explain ${topic || searchQuery}`);
    if (action.action === 'ask_ai') askAIFromSearch(question);
    if (action.action === 'practice') {
      handleGoToPractice(topic || searchQuery);
      closeSearch();
    }
    if (action.action === 'upload') {
      go('upload');
      closeSearch();
    }
    if (action.action === 'discussion') {
      go('collab');
      closeSearch();
    }
    if (action.action === 'study_group' || action.action === 'reading_room') {
      go('groups');
      closeSearch();
    }
  };

  const handlePastQuestionSearchClick = (question: PastQuestion) => {
    askAIFromSearch(question.content_text || `Explain ${searchResult?.understanding?.interpreted_topic || searchQuery}`);
  };

  const handleLectureNoteSearchClick = (note: LectureNote) => {
    askAIFromSearch(`Explain: ${note.title}`);
  };

  const runRelatedTopicSearch = (topic: string) => {
    setSearchQuery(topic);
    void runGlobalSearch(topic, true);
  };

  if (!token) {
    return <Auth onLogin={handleLogin} />;
  }

  const userInitials = user ? initials(user.name) : '?';
  const userRole = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : 'Loading...';
  const searchResults = searchResult?.past_questions || [];

  return (
    <div className="shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
        <div className="logo">
          <div className="logo-mark">E</div>
          <div className="logo-name">Exam<span>Mind</span></div>
        </div>
        <nav className="nav">
          <div className="nav-section">Main</div>
          <div className={`ni ${activeScreen === 'dashboard' ? 'on' : ''}`} onClick={() => go('dashboard')}><span className="ni-ico">*</span>Dashboard</div>
          <div className={`ni ${activeScreen === 'assistant' ? 'on' : ''}`} onClick={() => go('assistant')}><span className="ni-ico">AI</span>AI Assistant</div>
          <div className={`ni ${activeScreen === 'upload' ? 'on' : ''}`} onClick={() => go('upload')}><span className="ni-ico">+</span>Upload</div>
          <div className={`ni ${activeScreen === 'offline' ? 'on' : ''}`} onClick={() => go('offline')}><span className="ni-ico">D</span>Offline Library</div>
          <div className={`ni ${activeScreen === 'practice' ? 'on' : ''}`} onClick={() => go('practice')}><span className="ni-ico">P</span>Practice</div>
          <div className="nav-section">Insights</div>
          <div className={`ni ${activeScreen === 'analytics' ? 'on' : ''}`} onClick={() => go('analytics')}><span className="ni-ico">A</span>Exam Analytics</div>
          <div className={`ni ${activeScreen === 'progress' ? 'on' : ''}`} onClick={() => go('progress')}><span className="ni-ico">%</span>My Progress</div>
          <div className="nav-section">Community</div>
          <div className={`ni ${activeScreen === 'collab' ? 'on' : ''}`} onClick={() => go('collab')}><span className="ni-ico">C</span>Collaboration</div>
          <div className={`ni ${activeScreen === 'groups' ? 'on' : ''}`} onClick={() => go('groups')}><span className="ni-ico">G</span>Study Groups</div>
        </nav>
        <div className="user-row">
          <div className="user-btn">
            <div className="ava">{userInitials}</div>
            <div>
              <div className="ava-name">{user?.name ?? 'Loading...'}</div>
              <div className="ava-role">{user?.username ? `@${user.username}` : userRole}</div>
            </div>
          </div>
          <button
            className="cta cta-ghost"
            style={{ width: '100%', justifyContent: 'center', marginTop: 10, fontSize: 12 }}
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="mob-menu" onClick={() => setSidebarOpen(!sidebarOpen)}>Menu</button>
          <div className="search global-search" ref={searchBoxRef}>
            <span className="search-ico">Search</span>
            <input
              type="text"
              placeholder="Search topics, notes, past questions, groups, rooms..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => { if (searchQuery.trim().length >= 2) setSearchOpen(true); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runGlobalSearch(searchQuery, true);
                }
                if (e.key === 'Escape') setSearchOpen(false);
              }}
            />
            {searchOpen && (
              <div className="global-search-panel">
                {searchLoading && (
                  <div className="gs-loading"><span className="ai-dot"></span>Searching ExamMind...</div>
                )}
                {!searchLoading && searchGuidance && (
                  <div className="gs-empty">
                    <div className="gs-empty-title">Search needs an academic clue</div>
                    <div>{searchGuidance}</div>
                  </div>
                )}
                {!searchLoading && searchError && (
                  <div className="gs-empty">
                    <div className="gs-empty-title">Search is offline</div>
                    <div>{searchError}</div>
                    <button className="gs-action" onMouseDown={(e) => { e.preventDefault(); void runGlobalSearch(searchQuery, true); }}>Retry</button>
                  </div>
                )}
                {!searchLoading && !searchGuidance && !searchError && searchResult && (
                  <>
                    {hasUsefulInterpretation(searchResult) && (
                      <section className="gs-section">
                        <div className="gs-section-title">Interpretation</div>
                        <div className="gs-interpret">
                          <div>Understood as: <strong>{searchResult.understanding?.interpreted_topic}</strong></div>
                          {(searchResult.understanding?.related_terms || []).length > 0 && (
                            <div className="gs-muted">Also searched: {(searchResult.understanding?.related_terms || []).slice(0, 5).join(', ')}</div>
                          )}
                        </div>
                      </section>
                    )}
                    {(searchResult.suggested_actions || []).length > 0 && (
                      <section className="gs-section">
                        <div className="gs-section-title">Best Next Actions</div>
                        <div className="gs-actions">
                          {(searchResult.suggested_actions || []).slice(0, 5).map(action => (
                            <button className="gs-action" key={`${action.action}-${action.label}`} onMouseDown={(e) => { e.preventDefault(); handleSearchAction(action); }}>{action.label}</button>
                          ))}
                        </div>
                      </section>
                    )}
                    {searchResult.past_questions.length > 0 && (
                      <section className="gs-section">
                        <div className="gs-section-title">Past Questions</div>
                        {searchResult.past_questions.slice(0, 3).map(item => {
                          const meta = item.metadata_json as { course_code?: string; topics_covered?: string[] } | null;
                          return (
                            <button className="gs-row" key={`pq-${item.id}`} onMouseDown={(e) => { e.preventDefault(); handlePastQuestionSearchClick(item); }}>
                              <span className="gs-row-main">{textPreview(item.content_text, 'Past question')}</span>
                              <span className="gs-row-meta">{meta?.course_code || 'Past question'}{item.year ? ` · ${item.year}` : ''}{meta?.topics_covered?.[0] ? ` · ${meta.topics_covered[0]}` : ''}</span>
                            </button>
                          );
                        })}
                      </section>
                    )}
                    {searchResult.lecture_notes.length > 0 && (
                      <section className="gs-section">
                        <div className="gs-section-title">Lecture Notes</div>
                        {searchResult.lecture_notes.slice(0, 3).map(note => (
                          <button className="gs-row" key={`note-${note.id}`} onMouseDown={(e) => { e.preventDefault(); handleLectureNoteSearchClick(note); }}>
                            <span className="gs-row-main">{note.title}</span>
                            <span className="gs-row-meta">{note.topic || 'Lecture note'}{note.year ? ` · ${note.year}` : ''}</span>
                          </button>
                        ))}
                      </section>
                    )}
                    {searchResult.threads.length > 0 && (
                      <section className="gs-section">
                        <div className="gs-section-title">Discussions</div>
                        {searchResult.threads.slice(0, 2).map(thread => (
                          <button className="gs-row" key={`thread-${thread.id}`} onMouseDown={(e) => { e.preventDefault(); go('collab'); closeSearch(); }}>
                            <span className="gs-row-main">{thread.title}</span>
                            <span className="gs-row-meta">{thread.created_by_username ? `@${thread.created_by_username}` : 'Discussion'}</span>
                          </button>
                        ))}
                      </section>
                    )}
                    {searchResult.study_groups.length > 0 && (
                      <section className="gs-section">
                        <div className="gs-section-title">Study Groups</div>
                        {searchResult.study_groups.slice(0, 2).map(group => (
                          <button className="gs-row" key={`group-${group.id}`} onMouseDown={(e) => { e.preventDefault(); go('groups'); closeSearch(); }}>
                            <span className="gs-row-main">{group.name}</span>
                            <span className="gs-row-meta">{group.topic || 'Study group'} · {group.member_count || 0} members</span>
                          </button>
                        ))}
                      </section>
                    )}
                    {searchResult.study_sessions.length > 0 && (
                      <section className="gs-section">
                        <div className="gs-section-title">Reading Rooms</div>
                        {searchResult.study_sessions.slice(0, 2).map(room => (
                          <button className="gs-row" key={`room-${room.id}`} onMouseDown={(e) => { e.preventDefault(); go('groups'); closeSearch(); }}>
                            <span className="gs-row-main">{room.title}</span>
                            <span className="gs-row-meta">{room.topic || room.exam_goal || 'Active room'} · {room.participant_count || 0} active</span>
                          </button>
                        ))}
                      </section>
                    )}
                    {searchResult.related_topics.length > 0 && (
                      <section className="gs-section">
                        <div className="gs-section-title">Related Topics</div>
                        <div className="gs-chips">
                          {searchResult.related_topics.slice(0, 8).map(topic => (
                            <button className="gs-chip" key={topic} onMouseDown={(e) => { e.preventDefault(); runRelatedTopicSearch(topic); }}>{topic}</button>
                          ))}
                        </div>
                      </section>
                    )}
                    {resultCount(searchResult) === 0 && (
                      <div className="gs-empty">
                        <div className="gs-empty-title">No strong matches yet</div>
                        <div>No strong matches yet for this. You can upload lecture notes, past questions, course outlines, tutorial sheets, assignment questions, revision slides, or exam prep PDFs.</div>
                        <div className="gs-actions">
                          <button className="gs-action" onMouseDown={(e) => { e.preventDefault(); askAIFromSearch(`Explain ${searchResult.understanding?.interpreted_topic || searchQuery}`); }}>Ask AI anyway</button>
                          <button className="gs-action" onMouseDown={(e) => { e.preventDefault(); go('upload'); closeSearch(); }}>Upload material</button>
                          <button className="gs-action" onMouseDown={(e) => { e.preventDefault(); go('collab'); closeSearch(); }}>Start discussion</button>
                          <button className="gs-action" onMouseDown={(e) => { e.preventDefault(); go('groups'); closeSearch(); }}>Create study group</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {false && searchOpen && searchResults.length > 0 && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 12px 30px rgba(0,0,0,0.22)', zIndex: 200, overflow: 'hidden' }}>
                {searchResults.map((r) => {
                  const meta = r.metadata_json as { course_code?: string; topics_covered?: string[] } | null;
                  const preview = (r.content_text ?? '').slice(0, 80).trim();
                  return (
                    <div
                      key={r.id}
                      style={{ padding: '9px 13px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}
                      onMouseDown={() => { askQuestion(r.content_text ?? ''); setSearchQuery(''); setSearchOpen(false); }}
                    >
                      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{preview || 'Question'}{preview.length === 80 ? '...' : ''}</div>
                      <div style={{ color: 'var(--text3)', fontSize: 11, marginTop: 2 }}>
                        {meta?.course_code ?? 'Unknown course'}{r.year ? ` · ${r.year}` : ''}
                        {meta?.topics_covered?.[0] ? ` · ${meta.topics_covered[0]}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="tb-right">
            <OfflineStatus />
            <button className="ico-btn" title="Settings" onClick={() => notifyUnavailable('Settings')}>S</button>
            <button className="ico-btn" title="Notifications" onClick={() => notifyUnavailable('Notifications')}>!<span className="notif-pip"></span></button>
            <div className="ava" style={{ width: 32, height: 32, fontSize: 11 }}>{userInitials}</div>
          </div>
        </div>

        {toast && <div className="app-toast">{toast}</div>}

        {activeScreen === 'dashboard' && <Dashboard go={go} user={user} notifyUnavailable={notifyUnavailable} />}
        {activeScreen === 'questions' && <Questions go={go} onAskQuestion={askQuestion} user={user} onGoToPractice={handleGoToPractice} />}
        {activeScreen === 'assistant' && <Assistant go={go} selectedQuestion={selectedQuestion} notifyUnavailable={notifyUnavailable} messages={chatMessages} onMessagesChange={setChatMessages} user={user} />}
        {activeScreen === 'upload' && <Upload go={go} user={user} />}
        {activeScreen === 'offline' && <Offline go={go} />}
        {activeScreen === 'analytics' && <Analytics go={go} notifyUnavailable={notifyUnavailable} user={user} />}
        {activeScreen === 'collab' && <Collab go={go} user={user} notifyUnavailable={notifyUnavailable} />}
        {activeScreen === 'practice' && <Practice go={go} initialTopic={practiceInitialTopic} />}
        {activeScreen === 'progress' && <Progress go={go} userId={user?.id ?? null} />}
        {activeScreen === 'groups' && <StudyGroups go={go} notifyUnavailable={notifyUnavailable} user={user} />}
        {activeScreen === 'empty' && <Empty go={go} />}
      </main>

      <nav className="mob-nav">
        <div className="mob-tabs">
          <div className={`mob-tab ${activeScreen === 'dashboard' ? 'on' : ''}`} onClick={() => go('dashboard')}><div className="mob-tab-ico">*</div>Home</div>
          <div className={`mob-tab ${activeScreen === 'upload' ? 'on' : ''}`} onClick={() => go('upload')}><div className="mob-tab-ico">+</div>Upload</div>
          <div className={`mob-tab ${activeScreen === 'assistant' ? 'on' : ''}`} onClick={() => go('assistant')}><div className="mob-tab-ico">AI</div>AI</div>
          <div className={`mob-tab ${activeScreen === 'offline' ? 'on' : ''}`} onClick={() => go('offline')}><div className="mob-tab-ico">D</div>Offline</div>
          <div className={`mob-tab ${activeScreen === 'collab' ? 'on' : ''}`} onClick={() => go('collab')}><div className="mob-tab-ico">C</div>Community</div>
        </div>
      </nav>
    </div>
  );
}
