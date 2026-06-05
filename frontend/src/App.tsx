import { useState } from 'react';
import './App.css';
import type { ScreenType } from './types';
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


export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenType>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const go = (screen: ScreenType) => {
    setActiveScreen(screen);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="shell">
      {/* SIDEBAR */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
        <div className="logo">
          <div className="logo-mark">E</div>
          <div className="logo-name">Exam<span>Mind</span></div>
        </div>
        <nav className="nav">
          <div className="nav-section">Main</div>
          <div className={`ni ${activeScreen === 'dashboard' ? 'on' : ''}`} onClick={() => go('dashboard')}><span className="ni-ico">◈</span>Dashboard</div>
          <div className={`ni ${activeScreen === 'questions' ? 'on' : ''}`} onClick={() => go('questions')}><span className="ni-ico">◉</span>Past Questions<span className="ni-badge">847</span></div>
          <div className={`ni ${activeScreen === 'assistant' ? 'on' : ''}`} onClick={() => go('assistant')}><span className="ni-ico">◎</span>AI Assistant</div>
          <div className={`ni ${activeScreen === 'upload' ? 'on' : ''}`} onClick={() => go('upload')}><span className="ni-ico">+</span>Upload</div>
          <div className={`ni ${activeScreen === 'offline' ? 'on' : ''}`} onClick={() => go('offline')}><span className="ni-ico">↓</span>Offline Library</div>
          <div className={`ni ${activeScreen === 'practice' ? 'on' : ''}`} onClick={() => go('practice')}><span className="ni-ico">◇</span>Practice</div>
          <div className="nav-section">Insights</div>
          <div className={`ni ${activeScreen === 'analytics' ? 'on' : ''}`} onClick={() => go('analytics')}><span className="ni-ico">◈</span>Exam Analytics</div>
          <div className={`ni ${activeScreen === 'progress' ? 'on' : ''}`} onClick={() => go('progress')}><span className="ni-ico">◎</span>My Progress</div>
          <div className="nav-section">Community</div>
          <div className={`ni ${activeScreen === 'collab' ? 'on' : ''}`} onClick={() => go('collab')}><span className="ni-ico">◉</span>Collaboration<span className="ni-badge">3</span></div>
          <div className={`ni ${activeScreen === 'groups' ? 'on' : ''}`} onClick={() => go('groups')}><span className="ni-ico">◇</span>Study Groups</div>
        </nav>
        <div className="user-row">
          <div className="user-btn">
            <div className="ava">AO</div>
            <div><div className="ava-name">Adaeze Okonkwo</div><div className="ava-role">CS · Year 3</div></div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        <div className="topbar">
          <button className="mob-menu" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <div className="search">
            <span className="search-ico">⌕</span>
            <input type="text" placeholder="Search past questions, topics, courses..."/>
          </div>
          <div className="tb-right">
            <OfflineStatus />
            <div className="ico-btn">⚙</div>
            <div className="ico-btn">🔔<span className="notif-pip"></span></div>
            <div className="ava" style={{width: 32, height: 32, fontSize: 11}}>AO</div>
          </div>
        </div>

        {/* SCREENS */}
        {activeScreen === 'dashboard' && <Dashboard go={go} />}
        {activeScreen === 'questions' && <Questions go={go} />}
        {activeScreen === 'assistant' && <Assistant go={go} />}
        {activeScreen === 'upload' && <Upload go={go} />}
        {activeScreen === 'offline' && <Offline go={go} />}
        {activeScreen === 'analytics' && <Analytics go={go} />}
        {activeScreen === 'collab' && <Collab go={go} />}
        {activeScreen === 'practice' && <Practice go={go} />}
        {activeScreen === 'progress' && <Progress go={go} />}
        {activeScreen === 'groups' && <StudyGroups go={go} />}
        {activeScreen === 'empty' && <Empty go={go} />}
      </main>

      {/* MOBILE BOTTOM NAV */}
      <nav className="mob-nav">
        <div className="mob-tabs">
          <div className={`mob-tab ${activeScreen === 'dashboard' ? 'on' : ''}`} onClick={() => go('dashboard')}><div className="mob-tab-ico">◈</div>Home</div>
          <div className={`mob-tab ${activeScreen === 'questions' ? 'on' : ''}`} onClick={() => go('questions')}><div className="mob-tab-ico">◉</div>Questions</div>
          <div className={`mob-tab ${activeScreen === 'assistant' ? 'on' : ''}`} onClick={() => go('assistant')}><div className="mob-tab-ico">◎</div>AI</div>
          <div className={`mob-tab ${activeScreen === 'offline' ? 'on' : ''}`} onClick={() => go('offline')}><div className="mob-tab-ico">↓</div>Offline</div>
          <div className={`mob-tab ${activeScreen === 'collab' ? 'on' : ''}`} onClick={() => go('collab')}><div className="mob-tab-ico">◉</div>Community</div>
        </div>
      </nav>
    </div>
  );
}
