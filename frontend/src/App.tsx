import { useEffect, useRef, useState } from 'react';
import { BellIcon } from '@phosphor-icons/react/dist/icons/Bell';
import { BooksIcon } from '@phosphor-icons/react/dist/icons/Books';
import { ChartLineUpIcon } from '@phosphor-icons/react/dist/icons/ChartLineUp';
import { ChatsCircleIcon } from '@phosphor-icons/react/dist/icons/ChatsCircle';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/icons/DotsThree';
import { ExamIcon } from '@phosphor-icons/react/dist/icons/Exam';
import { GaugeIcon } from '@phosphor-icons/react/dist/icons/Gauge';
import { GearSixIcon } from '@phosphor-icons/react/dist/icons/GearSix';
import { ListIcon } from '@phosphor-icons/react/dist/icons/List';
import { MagicWandIcon } from '@phosphor-icons/react/dist/icons/MagicWand';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/icons/MagnifyingGlass';
import { SignOutIcon } from '@phosphor-icons/react/dist/icons/SignOut';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/icons/SquaresFour';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/icons/UploadSimple';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/icons/UsersThree';
import { XIcon } from '@phosphor-icons/react/dist/icons/X';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import './App.css';
import './Navigation.css';
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
import Settings from './screens/Settings';
import OfflineStatus from './components/OfflineStatus';
import { Auth } from './components/Auth';
import Landing from './components/Landing';
import { apiGet } from './lib/api';
import { DEV_AUTH_USER, isDevAuthToken } from './lib/devAuth';

type NavigationItem = {
  label: string;
  screen: ScreenType;
  icon: PhosphorIcon;
};

const NAV_GROUPS: { label: string; items: NavigationItem[] }[] = [
  {
    label: 'Main',
    items: [
      { label: 'Dashboard', screen: 'dashboard', icon: SquaresFourIcon },
      { label: 'AI Assistant', screen: 'assistant', icon: MagicWandIcon },
      { label: 'Upload', screen: 'upload', icon: UploadSimpleIcon },
      { label: 'Offline Library', screen: 'offline', icon: BooksIcon },
      { label: 'Practice', screen: 'practice', icon: ExamIcon },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Exam Analytics', screen: 'analytics', icon: ChartLineUpIcon },
      { label: 'My Progress', screen: 'progress', icon: GaugeIcon },
    ],
  },
  {
    label: 'Community',
    items: [
      { label: 'Collaboration', screen: 'collab', icon: ChatsCircleIcon },
      { label: 'Study Groups', screen: 'groups', icon: UsersThreeIcon },
    ],
  },
];

const MOBILE_NAV_ITEMS: NavigationItem[] = [
  { label: 'Home', screen: 'dashboard', icon: SquaresFourIcon },
  { label: 'AI', screen: 'assistant', icon: MagicWandIcon },
  { label: 'Upload', screen: 'upload', icon: UploadSimpleIcon },
  { label: 'Practice', screen: 'practice', icon: ExamIcon },
];

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
  const [publicView, setPublicView] = useState<'landing' | 'auth'>('landing');
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register'>('register');
  const [user, setUser] = useState<User | null>(null);
  const [activeScreen, setActiveScreen] = useState<ScreenType>('dashboard');
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
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!sidebarOpen) return;
    mobileMenuCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSidebarOpen(false);
      mobileMenuButtonRef.current?.focus();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);

  // Hydrate user info from a stored token on first load
  useEffect(() => {
    if (!token) return;

    if (isDevAuthToken(token)) {
      setUser(DEV_AUTH_USER);
      return;
    }

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

    if (isDevAuthToken(jwt)) {
      setUser(DEV_AUTH_USER);
      setActiveScreen('dashboard');
      return;
    }

    try {
      const data = await apiGet('/auth/me') as User;
      setUser(data);
    } catch {
      // /me failed but login succeeded — proceed without user info
    }
    setActiveScreen('dashboard');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setActiveScreen('dashboard');
    setPublicView('landing');
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

  const openSearchResults = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) return;

    go('search');
    setSearchOpen(false);
    setSearchQuery(query);
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

  const handleGlobalSearchEnter = async () => {
    await openSearchResults(searchQuery);
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
    if (publicView === 'landing') {
      return (
        <Landing
          onGetStarted={() => {
            setAuthInitialMode('register');
            setPublicView('auth');
          }}
          onSignIn={() => {
            setAuthInitialMode('login');
            setPublicView('auth');
          }}
        />
      );
    }

    return (
      <Auth
        key={authInitialMode}
        onLogin={handleLogin}
        initialMode={authInitialMode}
        onBackToLanding={() => setPublicView('landing')}
      />
    );
  }

  const userInitials = user ? initials(user.name) : '?';
  const discussionContext =
    communityContext?.action === 'discussion'
      ? (communityContext as SearchActionContext & { action: 'discussion' })
      : null;
  const groupContext =
    communityContext && communityContext.action !== 'discussion'
      ? (communityContext as SearchActionContext & { action: 'study_group' | 'reading_room' })
      : null;
  const isMobileMoreActive = !MOBILE_NAV_ITEMS.some((item) => item.screen === activeScreen);

  return (
    <div className="shell">
      <aside className="sidebar" id="sidebar" aria-label="Primary navigation">
        <div className="logo" aria-label="ExamMind">
          <div className="logo-mark">E</div>
          <div className="logo-name">Exam<span>Mind</span></div>
        </div>
        <nav className="nav">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" role="group" aria-label={group.label} key={group.label}>
              <div className="nav-section">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeScreen === item.screen;
                return (
                  <button
                    type="button"
                    className={`ni rail-button ${isActive ? 'on' : ''}`}
                    onClick={() => go(item.screen)}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={item.label}
                    key={item.screen}
                  >
                    <span className="rail-item-surface" aria-hidden="true">
                      <Icon className="ni-ico" weight="regular" />
                      <span className="rail-item-label">{item.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="user-row">
          <button
            type="button"
            className="user-btn rail-button"
            onClick={() => go('settings')}
            aria-label={`Open account settings for ${user?.name ?? 'Student'}`}
          >
            <span className="rail-item-surface rail-account-surface" aria-hidden="true">
              <span className="ava">{userInitials}</span>
              <span className="rail-account-copy">
                <span className="rail-item-label">{user?.name ?? 'Account'}</span>
                <span className="rail-account-meta">{user?.username ? `@${user.username}` : 'Student account'}</span>
              </span>
            </span>
          </button>
          <button
            type="button"
            className={`settings-btn rail-button ${activeScreen === 'settings' ? 'on' : ''}`}
            onClick={() => go('settings')}
            aria-label="Settings"
            aria-current={activeScreen === 'settings' ? 'page' : undefined}
          >
            <span className="rail-item-surface" aria-hidden="true">
              <GearSixIcon className="rail-control-icon" weight="regular" />
              <span className="rail-item-label">Settings</span>
            </span>
          </button>
          <span className="rail-account-divider" aria-hidden="true" />
          <button
            type="button"
            className="logout-btn rail-button"
            onClick={handleLogout}
            aria-label="Log out"
          >
            <span className="rail-item-surface" aria-hidden="true">
              <SignOutIcon className="rail-control-icon" weight="regular" />
              <span className="rail-item-label">Log out</span>
            </span>
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close mobile navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="mob-menu"
            ref={mobileMenuButtonRef}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
            aria-controls="mobile-nav-sheet"
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <XIcon aria-hidden="true" weight="regular" /> : <ListIcon aria-hidden="true" weight="regular" />}
          </button>
          <button type="button" className="topbar-brand" aria-label="Go to Dashboard" onClick={() => go('dashboard')}>
            <span className="topbar-brand-mark" aria-hidden="true">E</span>
            <span className="topbar-brand-name" aria-hidden="true">Exam<span>Mind</span></span>
          </button>
          <div className="search global-search" ref={searchBoxRef}>
            <MagnifyingGlassIcon className="search-ico" aria-hidden="true" weight="regular" />
            <input
              type="text"
              aria-label="Search ExamMind"
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
              <div className="global-search-panel gs-preview-panel" aria-live="polite">
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
                            <button type="button" key={`prev-note-${note.id}`} className="gsp-row" onMouseDown={(e) => { e.preventDefault(); void handleGlobalSearchEnter(); }}>
                              <span className="gsp-row-type">Note</span>
                              <span>
                                <span className="gsp-row-title">{note.title}</span>
                                <span className="gsp-row-meta">{note.topic || 'Lecture note'}</span>
                              </span>
                            </button>
                          ))}
                          {searchResult.past_questions.slice(0, 1).map(item => (
                            <button type="button" key={`prev-pq-${item.id}`} className="gsp-row" onMouseDown={(e) => { e.preventDefault(); void handleGlobalSearchEnter(); }}>
                              <span className="gsp-row-type">Question</span>
                              <span>
                                <span className="gsp-row-title">{textPreview(item.content_text, 'Past question', 78)}</span>
                                <span className="gsp-row-meta">Past question preview</span>
                              </span>
                            </button>
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
                      <div className="gsp-card-body">Press Enter to open all ExamMind results.</div>
                    </div>
                  )}

                  <div className="gsp-footer">Press Enter to see full results</div>
                </div>
              </div>
            )}
          </div>
          <div className="tb-right">
            <OfflineStatus />
            <button type="button" className="ico-btn" aria-label="Open settings" title="Settings" onClick={() => go('settings')}><GearSixIcon aria-hidden="true" weight="regular" /></button>
            <button type="button" className="ico-btn" aria-label="Open notifications" title="Notifications" onClick={() => notifyUnavailable('Notifications')}><BellIcon aria-hidden="true" weight="regular" /><span className="notif-pip"></span></button>
            <button type="button" className="topbar-avatar" aria-label="Open account settings" onClick={() => go('settings')}>{userInitials}</button>
          </div>
        </header>

        {toast && <div className="app-toast" role="status">{toast}</div>}

        {activeScreen === 'dashboard' && (
          <Dashboard
            go={go}
            user={user}
            onOpenSearch={(query) => { void openSearchResults(query); }}
          />
        )}
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
        {activeScreen === 'settings' && <Settings go={go} user={user} />}
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

      {sidebarOpen && (
        <section
          className="mobile-nav-sheet"
          id="mobile-nav-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="All ExamMind destinations"
        >
          <header className="mobile-nav-sheet-head">
            <div>
              <span className="mobile-nav-sheet-mark">E</span>
              <strong>Navigate</strong>
            </div>
            <button
              type="button"
              ref={mobileMenuCloseRef}
              onClick={() => {
                setSidebarOpen(false);
                mobileMenuButtonRef.current?.focus();
              }}
              aria-label="Close navigation"
            >
              <XIcon aria-hidden="true" weight="regular" />
            </button>
          </header>
          <div className="mobile-nav-sheet-groups">
            {NAV_GROUPS.map((group) => (
              <div className="mobile-nav-sheet-group" key={`mobile-${group.label}`}>
                <p>{group.label}</p>
                <div>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeScreen === item.screen;
                    return (
                      <button
                        type="button"
                        className={isActive ? 'is-active' : ''}
                        onClick={() => go(item.screen)}
                        aria-current={isActive ? 'page' : undefined}
                        key={`mobile-sheet-${item.screen}`}
                      >
                        <Icon aria-hidden="true" weight={isActive ? 'regular' : 'light'} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <footer className="mobile-nav-sheet-account">
            <span className="ava">{userInitials}</span>
            <span><strong>{user?.name ?? 'Student'}</strong><small>{user?.username ? `@${user.username}` : 'Account'}</small></span>
            <div className="mobile-nav-sheet-account-actions">
              <button
                type="button"
                className={activeScreen === 'settings' ? 'is-active' : ''}
                onClick={() => go('settings')}
                aria-current={activeScreen === 'settings' ? 'page' : undefined}
              >
                <GearSixIcon aria-hidden="true" weight={activeScreen === 'settings' ? 'regular' : 'light'} /> Settings
              </button>
              <button type="button" onClick={handleLogout}><SignOutIcon aria-hidden="true" weight="light" /> Log out</button>
            </div>
          </footer>
        </section>
      )}

      <nav className="mob-nav" aria-label="Mobile navigation">
        <div className="mob-tabs">
          {MOBILE_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeScreen === item.screen;
            return (
              <button
                type="button"
                className={`mob-tab ${isActive ? 'on' : ''}`}
                onClick={() => go(item.screen)}
                aria-current={isActive ? 'page' : undefined}
                key={item.screen}
              >
                <Icon className="mob-tab-ico" aria-hidden="true" weight={isActive ? 'regular' : 'light'} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            className={`mob-tab ${isMobileMoreActive || sidebarOpen ? 'on' : ''}`}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open all navigation"
            aria-expanded={sidebarOpen}
            aria-controls="mobile-nav-sheet"
          >
            <DotsThreeIcon className="mob-tab-ico" aria-hidden="true" weight={isMobileMoreActive || sidebarOpen ? 'regular' : 'light'} />
            <span>More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
