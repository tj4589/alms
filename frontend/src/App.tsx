import { useEffect, useRef, useState } from 'react';
import './App.css';
import type { ChatMessage, ScreenType, User } from './types';

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

  type SearchResult = { id: number; content_text: string | null; year: number | null; metadata_json: Record<string, unknown> | null };
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (searchQuery.length < 2) { setSearchResults([]); setSearchOpen(false); return; }
    searchDebounce.current = setTimeout(async () => {
      try {
        const data = await apiGet(`/past-questions?topic=${encodeURIComponent(searchQuery)}`) as SearchResult[];
        setSearchResults(data.slice(0, 6));
        setSearchOpen(data.length > 0);
      } catch {
        setSearchResults([]);
        setSearchOpen(false);
      }
    }, 300);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchQuery]);

  const askQuestion = (questionText: string) => {
    setSelectedQuestion(questionText);
    go('assistant');
  };

  const handleGoToPractice = (topic: string) => {
    setPracticeInitialTopic(topic);
    go('practice');
  };

  if (!token) {
    return <Auth onLogin={handleLogin} />;
  }

  const userInitials = user ? initials(user.name) : '?';
  const userRole = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : 'Loading...';

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
          <div className="search" style={{ position: 'relative' }}>
            <span className="search-ico">Search</span>
            <input
              type="text"
              placeholder="Search past questions, topics, courses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            />
            {searchOpen && searchResults.length > 0 && (
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
          <div className={`mob-tab ${activeScreen === 'questions' ? 'on' : ''}`} onClick={() => go('questions')}><div className="mob-tab-ico">Q</div>Questions</div>
          <div className={`mob-tab ${activeScreen === 'assistant' ? 'on' : ''}`} onClick={() => go('assistant')}><div className="mob-tab-ico">AI</div>AI</div>
          <div className={`mob-tab ${activeScreen === 'offline' ? 'on' : ''}`} onClick={() => go('offline')}><div className="mob-tab-ico">D</div>Offline</div>
          <div className={`mob-tab ${activeScreen === 'collab' ? 'on' : ''}`} onClick={() => go('collab')}><div className="mob-tab-ico">C</div>Community</div>
        </div>
      </nav>
    </div>
  );
}
