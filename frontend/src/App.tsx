import { useEffect, useRef, useState } from 'react';
import './App.css';
import type {
  ChatMessage,
  GlobalSearchResult,
  SearchActionContext,
  ScreenType,
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
import SearchResults from './screens/SearchResults';
import OfflineStatus from './components/OfflineStatus';
import { Auth } from './components/Auth';
import { apiGet } from './lib/api';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const SEARCH_GUIDANCE = 'Try searching for a course, topic, past question, note, or exam phrase.';
const SEARCH_NONTOPICS = new Set([
  'hey', 'hi', 'hello', 'okay', 'ok', 'sure', 'yes', 'yeah', 'yep', 'no', 'nah',
  'lost', 'tired', 'confused', 'meant', 'thanks', 'thank', 'hmm', 'hm',
]);

function isConversationOnlySearch(query: string): boolean {
  const words = query.toLowerCase().match(/[a-z]+/g) || [];
  return words.length > 0 && words.every(word => SEARCH_NONTOPICS.has(word));
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

function hasUsefulSearchInterpretation(result: GlobalSearchResult | null): boolean {
  const topic = result?.understanding?.interpreted_topic?.trim();
  if (!topic) return false;
  const query = (result?.query || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normalizedTopic = topic.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return Boolean(normalizedTopic && normalizedTopic !== query && !query.includes(normalizedTopic));
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
  const [practiceContext, setPracticeContext] = useState<SearchActionContext | null>(null);
  const [communityContext, setCommunityContext] = useState<(SearchActionContext & { action: 'discussion' | 'study_group' | 'reading_room' }) | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<GlobalSearchResult | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchGuidance, setSearchGuidance] = useState('');
  // State for the full Search Results screen (set on Enter, stable while user continues typing)
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [submittedResult, setSubmittedResult] = useState<GlobalSearchResult | null>(null);
  const [submittedLoading, setSubmittedLoading] = useState(false);
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

  const runGlobalSearch = async (query: string, forceOpen = true): Promise<GlobalSearchResult | null> => {
    const trimmed = query.trim();
    const seq = ++searchSeq.current;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);

    if (trimmed.length < 2) {
      setSearchResult(null);
      setSearchError('');
      setSearchGuidance('');
      setSearchLoading(false);
      setSearchOpen(false);
      return null;
    }

    if (isConversationOnlySearch(trimmed)) {
      setSearchResult(null);
      setSearchError('');
      setSearchGuidance(SEARCH_GUIDANCE);
      setSearchLoading(false);
      setSearchOpen(true);
      return null;
    }

    setSearchLoading(true);
    setSearchError('');
    setSearchGuidance('');
    if (forceOpen) setSearchOpen(true);
    try {
      const data = await apiGet(`/search?q=${encodeURIComponent(trimmed)}`) as GlobalSearchResult;
      if (seq !== searchSeq.current) return null;
      setSearchResult(data);
      setSearchOpen(true);
      return data;
    } catch {
      if (seq !== searchSeq.current) return null;
      setSearchResult(null);
      setSearchError('Cannot reach ExamMind search. Check that the backend is running and VITE_API_BASE_URL matches the backend port.');
      setSearchOpen(true);
      return null;
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
      if (event.key === 'Escape') {
        setSearchOpen(false);
      }
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

  const handleGoToPractice = (topic: string, context?: SearchActionContext) => {
    setPracticeInitialTopic(topic);
    setPracticeContext(context || { query: topic, topic });
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

  const handleCommunityAction = (action: 'discussion' | 'study_group' | 'reading_room', context: SearchActionContext) => {
    setCommunityContext({ ...context, action });
    go(action === 'discussion' ? 'collab' : 'groups');
  };

  const handleGlobalSearchEnter = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    // Navigate to the full Search Results screen immediately; close the dropdown.
    setActiveScreen('search');
    setSearchOpen(false);
    setSubmittedQuery(query);
    setSubmittedResult(null);
    setSubmittedLoading(true);

    try {
      // Reuse live dropdown result if it already matched this exact query.
      const liveMatchesQuery =
        searchResult?.query?.trim().toLowerCase() === query.toLowerCase();
      const data: GlobalSearchResult | null = liveMatchesQuery
        ? searchResult
        : await apiGet(`/search?q=${encodeURIComponent(query)}`) as GlobalSearchResult;
      setSubmittedResult(data);
    } catch {
      setSubmittedResult(null);
    } finally {
      setSubmittedLoading(false);
    }
  };

  const refreshSubmittedSearchAfterDelete = async () => {
    const query = submittedQuery.trim();
    setToast('Material removed. You can upload it again.');
    window.setTimeout(() => setToast(''), 3600);
    if (!query) return;
    setSubmittedLoading(true);
    try {
      const data = await apiGet(`/search?q=${encodeURIComponent(query)}`) as GlobalSearchResult;
      setSubmittedResult(data);
    } catch {
      setSubmittedResult(null);
    } finally {
      setSubmittedLoading(false);
    }
  };

  if (!token) {
    return <Auth onLogin={handleLogin} />;
  }

  const userInitials = user ? initials(user.name) : '?';
  const userRole = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : 'Loading...';
  const searchResults = searchResult?.past_questions || [];
  const discussionContext =
    communityContext?.action === 'discussion'
      ? (communityContext as SearchActionContext & { action: 'discussion' })
      : null;
  const groupContext =
    communityContext && communityContext.action !== 'discussion'
      ? (communityContext as SearchActionContext & { action: 'study_group' | 'reading_room' })
      : null;

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
                  void handleGlobalSearchEnter();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSearchOpen(false);
                }
              }}
            />
            {searchOpen && (
              <div className="global-search-panel gs-preview-panel">
                <div className="global-search-preview">
                  <div className="gsp-header">
                    <div>
                      <div className="gsp-title">Search ExamMind for "{searchQuery.trim()}"</div>
                      <div className="gsp-subtitle">Materials · Past questions · Notes · Groups · Discussions · Rooms</div>
                    </div>
                    <span className="gsp-kbd">Enter</span>
                  </div>

                  {searchLoading && (
                    <div className="gsp-card">
                      <div className="gsp-card-title"><span className="ai-dot"></span>Searching ExamMind...</div>
                    </div>
                  )}

                  {!searchLoading && searchGuidance && (
                    <div className="gsp-card">
                      <div className="gsp-card-title">Search needs an academic clue</div>
                      <div className="gsp-card-body">Try a course, topic, past question, note, or exam phrase.</div>
                    </div>
                  )}

                  {!searchLoading && searchError && (
                    <>
                      <div className="gsp-card">
                        <div className="gsp-card-title">Search is offline</div>
                        <div className="gsp-card-body">Cannot reach ExamMind search. Check the backend and try again.</div>
                      </div>
                      <div className="gsp-actions">
                        <button className="gsp-chip" onMouseDown={(e) => { e.preventDefault(); void runGlobalSearch(searchQuery, true); }}>Retry</button>
                      </div>
                    </>
                  )}

                  {!searchLoading && !searchGuidance && !searchError && searchResult && (
                    <>
                      {hasUsefulSearchInterpretation(searchResult) && (
                        <div className="gsp-card is-accent">
                          <div className="gsp-card-title">{searchResult.understanding?.interpreted_topic}</div>
                          {(searchResult.understanding?.related_terms || []).length > 0 && (
                            <div className="gsp-card-body">Also searched {(searchResult.understanding?.related_terms || []).slice(0, 3).join(', ')}</div>
                          )}
                        </div>
                      )}

                      {resultCount(searchResult) > 0 ? (
                        <div className="gsp-results">
                          {searchResult.lecture_notes.slice(0, 1).map(note => (
                            <div key={`prev-note-${note.id}`} className="gsp-row" onMouseDown={(e) => { e.preventDefault(); void handleGlobalSearchEnter(); }}>
                              <span className="gsp-row-type">Note</span>
                              <span>
                                <span className="gsp-row-title">{note.title}</span>
                                <span className="gsp-row-meta">{note.topic || 'Lecture note'}</span>
                              </span>
                            </div>
                          ))}
                          {searchResult.past_questions.slice(0, 1).map(item => (
                            <div key={`prev-pq-${item.id}`} className="gsp-row" onMouseDown={(e) => { e.preventDefault(); void handleGlobalSearchEnter(); }}>
                              <span className="gsp-row-type">Question</span>
                              <span>
                                <span className="gsp-row-title">{textPreview(item.content_text, 'Past question', 78)}</span>
                                <span className="gsp-row-meta">Past question preview</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <>
                          <div className="gsp-card">
                            <div className="gsp-card-title">No uploaded matches yet</div>
                            <div className="gsp-card-body">Open full results to see related actions, AI overview, practice, groups and discussions.</div>
                          </div>
                          <div className="gsp-actions">
                            <button className="gsp-chip" onMouseDown={(e) => { e.preventDefault(); go('upload'); closeSearch(); }}>Upload material</button>
                            <button className="gsp-chip" onMouseDown={(e) => { e.preventDefault(); handleGoToPractice(searchQuery.trim()); closeSearch(); }}>Generate practice</button>
                            <button className="gsp-chip" onMouseDown={(e) => { e.preventDefault(); go('collab'); closeSearch(); }}>Start discussion</button>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {!searchLoading && !searchGuidance && !searchError && !searchResult && (
                    <div className="gsp-card">
                      <div className="gsp-card-title">Ready to search</div>
                      <div className="gsp-card-body">Press Enter to open full results across the academic brain.</div>
                    </div>
                  )}

                  <div className="gsp-footer">Press Enter to see full results</div>
                </div>
              </div>
            )}
            {false && searchOpen && (
              <div className="global-search-panel gs-preview-panel">
                {/* Loading */}
                {searchLoading && (
                  <div className="gs-loading"><span className="ai-dot"></span>Searching…</div>
                )}

                {/* Guidance (conversational query) */}
                {!searchLoading && searchGuidance && (
                  <div className="gs-preview-guide">
                    {searchGuidance}
                    <div className="gs-preview-actions">
                      <button className="gs-action" onMouseDown={(e) => { e.preventDefault(); void handleGlobalSearchEnter(); }}>Search anyway</button>
                    </div>
                  </div>
                )}

                {/* Error */}
                {!searchLoading && searchError && (
                  <div className="gs-preview-guide">
                    Search is offline — check the backend.
                    <div className="gs-preview-actions">
                      <button className="gs-action" onMouseDown={(e) => { e.preventDefault(); void runGlobalSearch(searchQuery, true); }}>Retry</button>
                    </div>
                  </div>
                )}

                {/* Compact results preview */}
                {!searchLoading && !searchGuidance && !searchError && searchResult && (
                  <>
                    {(searchResult?.lecture_notes || []).slice(0, 1).map(note => (
                      <div key={`prev-note-${note.id}`} className="gs-preview-row" onMouseDown={(e) => { e.preventDefault(); void handleGlobalSearchEnter(); }}>
                        <span className="gs-preview-tag">Note</span>
                        <span className="gs-preview-text">{note.title}</span>
                      </div>
                    ))}
                    {(searchResult?.past_questions || []).slice(0, 2).map(item => (
                      <div key={`prev-pq-${item.id}`} className="gs-preview-row" onMouseDown={(e) => { e.preventDefault(); void handleGlobalSearchEnter(); }}>
                        <span className="gs-preview-tag">Q</span>
                        <span className="gs-preview-text">{textPreview(item.content_text, 'Past question', 72)}</span>
                      </div>
                    ))}
                    {resultCount(searchResult) === 0 && (
                      <div className="gs-preview-guide">No uploaded matches yet.</div>
                    )}
                    <div className="gs-preview-enter">Press Enter to see full results ↵</div>
                  </>
                )}

                {/* Default hint (query ready but search hasn't returned yet) */}
                {!searchLoading && !searchGuidance && !searchError && !searchResult && (
                  <div className="gs-preview-guide">Press Enter to search</div>
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
        {activeScreen === 'collab' && <Collab go={go} user={user} notifyUnavailable={notifyUnavailable} initialContext={discussionContext} />}
        {activeScreen === 'practice' && <Practice go={go} initialTopic={practiceInitialTopic} initialContext={practiceContext} />}
        {activeScreen === 'progress' && <Progress go={go} userId={user?.id ?? null} />}
        {activeScreen === 'groups' && <StudyGroups go={go} notifyUnavailable={notifyUnavailable} user={user} initialContext={groupContext} />}
        {activeScreen === 'empty' && <Empty go={go} />}
        {activeScreen === 'search' && (
          <SearchResults
            query={submittedQuery}
            result={submittedResult}
            loading={submittedLoading}
            onAskAI={askAIFromSearch}
            onUpload={() => go('upload')}
            onPractice={(topic, context) => { handleGoToPractice(topic, context); }}
            onCommunityAction={handleCommunityAction}
            onMaterialDeleted={() => void refreshSubmittedSearchAfterDelete()}
            go={go}
          />
        )}
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
